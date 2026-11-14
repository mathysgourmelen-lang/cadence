import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { InstagramClient } from '../src/main/instagram'
import { YouTubeClient } from '../src/main/youtube'
import { ApiError } from '../src/main/http'

interface Req {
  method: string
  url: URL
  headers: IncomingMessage['headers']
  body: Buffer
}
type Handler = (req: Req, res: ServerResponse) => void

let server: Server
let base = ''
let handler: Handler = (_r, res) => res.writeHead(500).end()
const log: Req[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const r: Req = { method: req.method!, url: new URL(req.url!, base), headers: req.headers, body: Buffer.concat(chunks) }
      log.push(r)
      handler(r, res)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) =>
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers }).end(JSON.stringify(body))

const dir = mkdtempSync(join(tmpdir(), 'cadence-test-'))
const video = join(dir, 'v.mp4')
const VIDEO_SIZE = 20 * 1024 * 1024 + 12345 // spans several YouTube chunks
const bytes = Buffer.alloc(VIDEO_SIZE)
for (let i = 0; i < VIDEO_SIZE; i++) bytes[i] = (i * 31) & 0xff
writeFileSync(video, bytes)

describe('InstagramClient', () => {
  const ig = () => new InstagramClient('v24.0', { graph: base, rupload: `${base}/rup` })
  const creds = { igUserId: '1784', accessToken: 'PAGE_TOKEN' }

  it('creates a resumable REELS container with the right parameters', async () => {
    log.length = 0
    handler = (r, res) => json(res, 200, { id: 'C1', uri: `${base}/rup/ig-api-upload/v24.0/C1` })
    const c = await ig().createReelContainer(creds, { caption: 'Hi #x ✨', shareToFeed: true, coverOffsetMs: 1500 })
    expect(c).toEqual({ id: 'C1', uploadUri: `${base}/rup/ig-api-upload/v24.0/C1` })
    const r = log[0]
    expect(r.method).toBe('POST')
    expect(r.url.pathname).toBe('/v24.0/1784/media')
    const form = new URLSearchParams(r.body.toString())
    expect(form.get('media_type')).toBe('REELS')
    expect(form.get('upload_type')).toBe('resumable')
    expect(form.get('caption')).toBe('Hi #x ✨')
    expect(form.get('share_to_feed')).toBe('true')
    expect(form.get('thumb_offset')).toBe('1500')
    expect(form.get('access_token')).toBe('PAGE_TOKEN')
  })

  it('falls back to the rupload URL when no uri is returned', async () => {
    handler = (_r, res) => json(res, 200, { id: 'C2' })
    const c = await ig().createReelContainer(creds, { caption: '', shareToFeed: false, coverOffsetMs: null })
    expect(c.uploadUri).toBe(`${base}/rup/ig-api-upload/v24.0/C2`)
    expect(new URLSearchParams(log[log.length - 1].body.toString()).has('thumb_offset')).toBe(false)
  })

  it('uploads the raw bytes with OAuth, offset and file_size headers', async () => {
    log.length = 0
    handler = (_r, res) => json(res, 200, { success: true, message: 'Upload successful.' })
    const progress: number[] = []
    await ig().uploadVideo(creds, `${base}/rup/ig-api-upload/v24.0/C1`, video, VIDEO_SIZE, (f) => progress.push(f))
    const r = log[0]
    expect(r.headers.authorization).toBe('OAuth PAGE_TOKEN')
    expect(r.headers.offset).toBe('0')
    expect(r.headers.file_size).toBe(String(VIDEO_SIZE))
    expect(r.headers['content-length']).toBe(String(VIDEO_SIZE))
    expect(r.body.equals(bytes)).toBe(true)
    expect(progress[progress.length - 1]).toBe(1)
  })

  it('reports rupload debug_info failures', async () => {
    handler = (_r, res) => json(res, 400, { debug_info: { retriable: false, type: 'ProcessingFailedError', message: 'Bad file' } })
    await expect(ig().uploadVideo(creds, `${base}/rup/x`, video, VIDEO_SIZE)).rejects.toMatchObject({ message: expect.stringContaining('Bad file'), retriable: false })
  })

  it('uploads with the user token first and falls back to the Page token', async () => {
    log.length = 0
    handler = (r, res) =>
      r.headers.authorization === 'OAuth USER_TOKEN'
        ? json(res, 400, { debug_info: { retriable: false, type: 'ProcessingFailedError', message: 'Request processing failed' } })
        : json(res, 200, { success: true, message: 'Upload successful.' })
    await ig().uploadVideo({ ...creds, userToken: 'USER_TOKEN' }, `${base}/rup/x`, video, VIDEO_SIZE)
    expect(log.map((r) => r.headers.authorization)).toEqual(['OAuth USER_TOKEN', 'OAuth PAGE_TOKEN'])
    expect(log[1].body.equals(bytes)).toBe(true)
  })

  it('shows the inner rupload error message', async () => {
    handler = (_r, res) =>
      json(res, 400, { debug_info: { retriable: false, type: 'ProcessingFailedError', message: '{"success":false,"error":{"message":"unauthorized user request"}}' } })
    await expect(ig().uploadVideo(creds, `${base}/rup/x`, video, VIDEO_SIZE)).rejects.toMatchObject({
      message: 'Instagram upload failed: unauthorized user request',
      opts: expect.objectContaining({ authError: true })
    })
  })

  it('creates the container with the user token when there is one', async () => {
    log.length = 0
    handler = (_r, res) => json(res, 200, { id: 'C3' })
    await ig().createReelContainer({ ...creds, userToken: 'USER_TOKEN' }, { caption: '', shareToFeed: true, coverOffsetMs: null })
    expect(new URLSearchParams(log[0].body.toString()).get('access_token')).toBe('USER_TOKEN')
  })

  it('reads container status and publishes', async () => {
    handler = (r, res) => {
      if (r.url.pathname === '/v24.0/C1') return json(res, 200, { status_code: 'FINISHED', status: 'Finished: Media has been uploaded' })
      if (r.url.pathname === '/v24.0/1784/media_publish') {
        expect(new URLSearchParams(r.body.toString()).get('creation_id')).toBe('C1')
        return json(res, 200, { id: 'M1' })
      }
      if (r.url.pathname === '/v24.0/M1') return json(res, 200, { permalink: 'https://www.instagram.com/reel/abc/' })
      json(res, 404, {})
    }
    expect((await ig().containerStatus(creds, 'C1')).statusCode).toBe('FINISHED')
    expect(await ig().publish(creds, 'C1')).toBe('M1')
    expect(await ig().permalink(creds, 'M1')).toBe('https://www.instagram.com/reel/abc/')
  })

  it('maps Graph errors: expired token, rate limit, publishing limit', async () => {
    handler = (_r, res) => json(res, 400, { error: { message: 'Error validating access token', type: 'OAuthException', code: 190 } })
    await expect(ig().publish(creds, 'C1')).rejects.toMatchObject({ retriable: false, opts: { authError: true } })
    handler = (_r, res) => json(res, 400, { error: { message: 'Application request limit reached', code: 4, is_transient: true } })
    await expect(ig().publish(creds, 'C1')).rejects.toMatchObject({ retriable: true })
    handler = (_r, res) => json(res, 400, { error: { message: 'limit', code: 9, error_subcode: 2207042 } })
    const e = (await ig().publish(creds, 'C1').catch((x) => x)) as ApiError
    expect(e.retriable).toBe(true)
    expect(e.opts.retryAfter!.getTime()).toBeGreaterThan(Date.now() + 50 * 60_000)
    handler = (_r, res) => json(res, 500, { error: { message: 'boom', code: 2 } })
    await expect(ig().publish(creds, 'C1')).rejects.toMatchObject({ retriable: true })
  })

  it('exchanges a token and lists Instagram accounts across pages', async () => {
    handler = (r, res) => {
      if (r.url.pathname === '/v24.0/oauth/access_token') {
        expect(r.url.searchParams.get('grant_type')).toBe('fb_exchange_token')
        expect(r.url.searchParams.get('client_id')).toBe('111')
        expect(r.url.searchParams.get('client_secret')).toBe('sec')
        return json(res, 200, { access_token: 'LONG', token_type: 'bearer' })
      }
      if (r.url.pathname === '/v24.0/me/accounts' && !r.url.searchParams.get('after')) {
        expect(r.url.searchParams.get('access_token')).toBe('LONG')
        return json(res, 200, {
          data: [
            { id: 'P1', name: 'No IG page', access_token: 'PT1' },
            { id: 'P2', name: 'Max Creates', access_token: 'PT2', instagram_business_account: { id: 'IG2', username: 'max' } }
          ],
          paging: { next: `${base}/v24.0/me/accounts?after=x&access_token=LONG` }
        })
      }
      if (r.url.pathname === '/v24.0/me/accounts')
        return json(res, 200, { data: [{ id: 'P3', name: 'Second', access_token: 'PT3', instagram_business_account: { id: 'IG3', username: 'max2' } }] })
      json(res, 404, {})
    }
    const tok = await ig().exchangeToken('111', 'sec', 'SHORT')
    expect(tok).toBe('LONG')
    const list = await ig().listInstagramAccounts(tok)
    expect(list.map((x) => [x.igUserId, x.pageToken])).toEqual([
      ['IG2', 'PT2'],
      ['IG3', 'PT3']
    ])
  })
})

describe('YouTubeClient', () => {
  const yt = () => new YouTubeClient({ auth: `${base}/auth`, token: `${base}/token`, api: `${base}/yt`, upload: `${base}/up` })
  const tokens = () => ({ clientId: 'cid', clientSecret: 'csec', refreshToken: 'RT' })

  it('refreshes the access token and caches it', async () => {
    log.length = 0
    handler = (r, res) => {
      const f = new URLSearchParams(r.body.toString())
      expect(f.get('grant_type')).toBe('refresh_token')
      expect(f.get('refresh_token')).toBe('RT')
      json(res, 200, { access_token: 'AT', expires_in: 3599 })
    }
    const t = tokens()
    expect(await yt().accessToken(t)).toBe('AT')
    expect(await yt().accessToken(t)).toBe('AT')
    expect(log.length).toBe(1)
  })

  it('maps invalid_grant to a reconnect error', async () => {
    handler = (_r, res) => json(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
    await expect(yt().accessToken(tokens())).rejects.toMatchObject({ retriable: false, opts: { authError: true } })
  })

  it('builds metadata: publishAt forces private', () => {
    const r = YouTubeClient.buildResource({ title: ' T ', description: 'D', tags: [' a ', ''], categoryId: '22', privacy: 'public', madeForKids: false, publishAt: '2030-01-01T10:00:00+01:00' })
    expect(r.snippet).toEqual({ title: 'T', description: 'D', categoryId: '22', tags: ['a'] })
    expect(r.status).toEqual({ privacyStatus: 'private', publishAt: '2030-01-01T09:00:00.000Z', selfDeclaredMadeForKids: false, embeddable: true })
    const now = YouTubeClient.buildResource({ title: 'T', description: '', tags: [], categoryId: '24', privacy: 'unlisted', madeForKids: true })
    expect(now.status).toEqual({ privacyStatus: 'unlisted', selfDeclaredMadeForKids: true, embeddable: true })
    expect(now.snippet.tags).toBeUndefined()
  })

  it('runs a full resumable upload in chunks, then resumes after an interruption', async () => {
    let received = Buffer.alloc(0)
    let failOnce = true
    log.length = 0
    handler = (r, res) => {
      if (r.url.pathname === '/token') return json(res, 200, { access_token: 'AT', expires_in: 3599 })
      if (r.url.pathname === '/up/videos') {
        expect(r.url.searchParams.get('uploadType')).toBe('resumable')
        expect(r.url.searchParams.get('part')).toBe('snippet,status')
        expect(r.headers['x-upload-content-length']).toBe(String(VIDEO_SIZE))
        expect(r.headers['x-upload-content-type']).toBe('video/mp4')
        expect(JSON.parse(r.body.toString()).snippet.title).toBe('My Short')
        return res.writeHead(200, { Location: `${base}/session/1` }).end()
      }
      if (r.url.pathname === '/session/1') {
        const range = String(r.headers['content-range'])
        if (range === `bytes */${VIDEO_SIZE}`) {
          return received.length ? res.writeHead(308, { Range: `bytes=0-${received.length - 1}` }).end() : res.writeHead(308).end()
        }
        const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(range)!
        expect(Number(m[1])).toBe(received.length)
        expect(r.body.length).toBe(Number(m[2]) - Number(m[1]) + 1)
        // Simulate a dropped connection on the second chunk.
        if (received.length > 0 && failOnce) {
          failOnce = false
          return json(res, 503, { error: { message: 'backend error' } })
        }
        received = Buffer.concat([received, r.body])
        if (received.length < VIDEO_SIZE) return res.writeHead(308, { Range: `bytes=0-${received.length - 1}` }).end()
        return json(res, 201, { id: 'VID123', status: { privacyStatus: 'public' } })
      }
      json(res, 404, {})
    }
    const t = tokens()
    const client = yt()
    const url = await client.startUpload(t, { title: 'My Short', description: '', tags: [], categoryId: '22', privacy: 'public', madeForKids: false }, VIDEO_SIZE, 'video/mp4')
    expect(url).toBe(`${base}/session/1`)
    const err = (await client.uploadFile(t, url, video, VIDEO_SIZE).catch((e) => e)) as ApiError
    expect(err.retriable).toBe(true)
    const q = await client.queryUpload(t, url, VIDEO_SIZE)
    expect(q.offset).toBe(received.length)
    const progress: number[] = []
    const v = await client.uploadFile(t, url, video, VIDEO_SIZE, (f) => progress.push(f), q.offset)
    expect(v.id).toBe('VID123')
    expect(received.equals(bytes)).toBe(true)
    expect(progress[progress.length - 1]).toBe(1)
    // Querying a finished session returns the video, so a crash after upload never duplicates it.
    handler = (_r, res) => json(res, 200, { id: 'VID123' })
    expect((await client.queryUpload(t, url, VIDEO_SIZE)).video.id).toBe('VID123')
  })

  it('maps quota errors with a retry time', async () => {
    handler = (r, res) => {
      if (r.url.pathname === '/token') return json(res, 200, { access_token: 'AT', expires_in: 3599 })
      json(res, 403, { error: { code: 403, message: 'quota', errors: [{ reason: 'quotaExceeded' }] } })
    }
    const e = (await yt()
      .startUpload(tokens(), { title: 'x', description: '', tags: [], categoryId: '22', privacy: 'public', madeForKids: false }, 10, 'video/mp4')
      .catch((x) => x)) as ApiError
    expect(e.retriable).toBe(true)
    expect(e.opts.retryAfter).toBeInstanceOf(Date)
  })

  it('completes the OAuth loopback flow with PKCE', async () => {
    let verifierOk = false
    let challenge = ''
    handler = (r, res) => {
      if (r.url.pathname === '/token') {
        const f = new URLSearchParams(r.body.toString())
        expect(f.get('grant_type')).toBe('authorization_code')
        expect(f.get('code')).toBe('CODE')
        expect(f.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
        verifierOk = createHash('sha256').update(f.get('code_verifier')!).digest('base64url') === challenge
        return json(res, 200, { access_token: 'AT', refresh_token: 'NEW_RT', expires_in: 3599, scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly' })
      }
      json(res, 404, {})
    }
    const t = await yt().authorize('cid', 'csec', (url) => {
      const u = new URL(url)
      expect(u.searchParams.get('access_type')).toBe('offline')
      expect(u.searchParams.get('scope')).toContain('youtube.upload')
      challenge = u.searchParams.get('code_challenge')!
      // Simulate the browser redirect back to the app.
      void fetch(`${u.searchParams.get('redirect_uri')}/?code=CODE&state=${u.searchParams.get('state')}`)
    })
    expect(t.refreshToken).toBe('NEW_RT')
    expect(verifierOk).toBe(true)
  })

  it('rejects a callback with the wrong state and reports cancellation', async () => {
    const p = yt().authorize('cid', 'csec', (url) => {
      const u = new URL(url)
      const redirect = u.searchParams.get('redirect_uri')
      void fetch(`${redirect}/?code=CODE&state=WRONG`).then(() => fetch(`${redirect}/?error=access_denied&state=${u.searchParams.get('state')}`))
    })
    await expect(p).rejects.toThrow(/cancelled/)
  })
})
