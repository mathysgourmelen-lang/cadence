// YouTube Shorts uploads through the YouTube Data API v3.
// OAuth uses the "Desktop app" loopback flow with PKCE. Uploads use Google's
// resumable upload protocol so a dropped connection resumes instead of restarting.

import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { open, readFile } from 'node:fs/promises'
import { ApiError, fetchWithTimeout, readJson } from './http'
import type { YouTubePrivacy } from '../shared/types'

/** YouTube's limit for custom thumbnails. */
export const THUMB_MAX_BYTES = 2 * 1024 * 1024

export const YT_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  // Posting the comments you add to a Short once it goes live.
  'https://www.googleapis.com/auth/youtube.force-ssl',
  // Watch time, retention and traffic sources for the Analytics tab.
  'https://www.googleapis.com/auth/yt-analytics.readonly'
]

export interface YouTubeEndpoints {
  auth: string
  token: string
  api: string
  upload: string
  /** YouTube Analytics API. */
  analytics?: string
}

export const DEFAULT_YT_ENDPOINTS: YouTubeEndpoints = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  api: 'https://www.googleapis.com/youtube/v3',
  upload: 'https://www.googleapis.com/upload/youtube/v3',
  analytics: 'https://youtubeanalytics.googleapis.com/v2'
}

export interface YouTubeTokens {
  clientId: string
  clientSecret: string
  refreshToken: string
  accessToken?: string
  accessTokenExpiresAt?: number
  /** Permissions Google granted at sign-in (space separated), when known. */
  scope?: string
}

/** True when the sign-in includes the permission to post comments. */
export function canComment(scope: string | undefined): boolean {
  return !scope || scope.includes('youtube.force-ssl')
}

export interface VideoMetadata {
  title: string
  description: string
  tags: string[]
  categoryId: string
  privacy: YouTubePrivacy
  madeForKids: boolean
  /** ISO time. When set, the video is uploaded as private and YouTube makes it public then. */
  publishAt?: string
}

/**
 * Since June 2026, videos.insert has its own "Video Uploads" quota bucket:
 * each upload counts once and the default allowance is 100 uploads per day
 * (resets at midnight Pacific). Cadence counts uploads to show how many are left.
 */
export const UPLOAD_QUOTA_COST = 1
export const DAILY_UPLOADS = 100

const CHUNK = 8 * 1024 * 1024 // multiple of 256 KiB, as Google requires

export function nextPacificMidnight(from = new Date()): Date {
  // Find the next midnight in America/Los_Angeles, when YouTube quotas reset.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  const parts = Object.fromEntries(fmt.formatToParts(from).map((p) => [p.type, p.value]))
  const h = Number(parts.hour) % 24
  const secondsIntoDay = h * 3600 + Number(parts.minute) * 60 + Number(parts.second)
  return new Date(from.getTime() + (86400 - secondsIntoDay) * 1000 + 60_000)
}

export function googleError(status: number, body: any, context: string): ApiError {
  const err = body?.error
  const reason: string | undefined = err?.errors?.[0]?.reason ?? (typeof err === 'string' ? err : undefined)
  const message: string = err?.message || body?.error_description || body?._text || `HTTP ${status}`

  if (reason === 'invalid_grant' || reason === 'unauthorized_client' || reason === 'invalid_client') {
    return new ApiError(
      `YouTube sign-in expired or was revoked. Reconnect YouTube in Accounts. (${body?.error_description || reason})`,
      { status, retriable: false, authError: true, code: reason, raw: body }
    )
  }
  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
    return new ApiError('YouTube\'s daily API quota is used up. Cadence will retry after it resets at midnight Pacific time.', {
      status,
      retriable: true,
      retryAfter: nextPacificMidnight(),
      code: reason,
      raw: body
    })
  }
  if (reason === 'uploadLimitExceeded') {
    return new ApiError('YouTube says this channel has hit its upload limit for now. Cadence will retry in a few hours.', {
      status,
      retriable: true,
      retryAfter: new Date(Date.now() + 6 * 3600 * 1000),
      code: reason,
      raw: body
    })
  }
  if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
    return new ApiError('YouTube is rate limiting requests. Retrying shortly.', { status, retriable: true, code: reason, raw: body })
  }
  if (status === 401) {
    return new ApiError(`YouTube sign-in is no longer valid. Reconnect YouTube in Accounts. (${message})`, {
      status,
      retriable: false,
      authError: true,
      code: reason,
      raw: body
    })
  }
  if (reason === 'youtubeSignupRequired') {
    return new ApiError('This Google account has no YouTube channel yet. Create one at youtube.com, then reconnect.', {
      status,
      retriable: false,
      code: reason,
      raw: body
    })
  }
  if (status === 403 && /has not been used|is disabled|accessNotConfigured/i.test(message + (reason ?? ''))) {
    const analytics = /youtubeanalytics|YouTube Analytics/i.test(message)
    return new ApiError(
      analytics
        ? 'The YouTube Analytics API is not enabled in your Google Cloud project. Enable it (Setup Guide, step 3.1), wait a few minutes, then refresh.'
        : 'The YouTube Data API v3 is not enabled in your Google Cloud project. Enable it, wait a few minutes, then retry.',
      { status, retriable: false, code: reason, raw: body }
    )
  }
  const retriable = status >= 500 || status === 429 || status === 408
  return new ApiError(`${context}: ${message}`, { status, retriable, code: reason, raw: body })
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

const SUCCESS_PAGE = `<!doctype html><meta charset="utf-8"><title>Cadence</title>
<body style="font-family:-apple-system,system-ui,sans-serif;background:#0b0b10;color:#f4f4f6;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><div style="font-size:44px">✓</div><h2 style="margin:8px 0">YouTube connected</h2>
<p style="opacity:.7">You can close this tab and go back to Cadence.</p></div></body>`

const FAIL_PAGE = (msg: string) => `<!doctype html><meta charset="utf-8"><title>Cadence</title>
<body style="font-family:-apple-system,system-ui,sans-serif;background:#0b0b10;color:#f4f4f6;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h2>Connection failed</h2><p style="opacity:.7">${msg.replace(/[<>&]/g, '')}</p></div></body>`

export class YouTubeClient {
  constructor(private readonly endpoints: YouTubeEndpoints = DEFAULT_YT_ENDPOINTS) {}

  /**
   * Runs the OAuth loopback flow. `openBrowser` opens the consent URL in the user's browser.
   * Resolves with a refresh token once the user approves.
   */
  async authorize(
    clientId: string,
    clientSecret: string,
    openBrowser: (url: string) => void,
    timeoutMs = 5 * 60 * 1000
  ): Promise<YouTubeTokens> {
    const { verifier, challenge } = pkcePair()
    const state = randomBytes(16).toString('hex')
    let server: Server | undefined

    const code = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      let redirectUri = ''
      const timer = setTimeout(() => {
        reject(new ApiError('Google sign-in timed out. Try again.', { retriable: false }))
      }, timeoutMs)
      server = createServer((req, res) => {
        const u = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (u.pathname !== '/') {
          res.writeHead(404).end()
          return
        }
        const err = u.searchParams.get('error')
        const gotState = u.searchParams.get('state')
        const gotCode = u.searchParams.get('code')
        if (err) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(FAIL_PAGE(err))
          clearTimeout(timer)
          reject(new ApiError(err === 'access_denied' ? 'Google sign-in was cancelled.' : `Google sign-in failed: ${err}`, { retriable: false }))
          return
        }
        if (!gotCode || gotState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(FAIL_PAGE('Invalid response from Google.'))
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(SUCCESS_PAGE)
        clearTimeout(timer)
        resolve({ code: gotCode, redirectUri })
      })
      server.on('error', (e) => {
        clearTimeout(timer)
        reject(new ApiError(`Could not start the sign-in listener: ${e.message}`, { retriable: false }))
      })
      server.listen(0, '127.0.0.1', () => {
        const port = (server!.address() as AddressInfo).port
        redirectUri = `http://127.0.0.1:${port}`
        const u = new URL(this.endpoints.auth)
        u.searchParams.set('client_id', clientId)
        u.searchParams.set('redirect_uri', redirectUri)
        u.searchParams.set('response_type', 'code')
        u.searchParams.set('scope', YT_SCOPES.join(' '))
        u.searchParams.set('access_type', 'offline')
        u.searchParams.set('prompt', 'select_account consent')
        u.searchParams.set('include_granted_scopes', 'true')
        u.searchParams.set('code_challenge', challenge)
        u.searchParams.set('code_challenge_method', 'S256')
        u.searchParams.set('state', state)
        openBrowser(u.toString())
      })
    }).finally(() => {
      server?.close()
      server?.closeAllConnections?.()
    })

    const res = await fetchWithTimeout(this.endpoints.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: code.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier
      }).toString()
    })
    const body = await readJson(res)
    if (!res.ok || body.error) throw googleError(res.status, body, 'Google sign-in failed')
    if (!body.refresh_token) {
      throw new ApiError(
        'Google did not return a refresh token. Remove Cadence from myaccount.google.com/permissions and connect again.',
        { retriable: false, raw: body }
      )
    }
    const granted = String(body.scope ?? '')
    if (granted && !granted.includes('youtube.upload')) {
      throw new ApiError('You need to tick the "Manage your YouTube videos" permission on the Google screen. Connect again.', {
        retriable: false
      })
    }
    return {
      clientId,
      clientSecret,
      refreshToken: body.refresh_token,
      accessToken: body.access_token,
      accessTokenExpiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
      scope: granted || undefined
    }
  }

  /** Returns a valid access token, refreshing it when needed. Mutates `tokens`. */
  async accessToken(tokens: YouTubeTokens): Promise<string> {
    if (tokens.accessToken && tokens.accessTokenExpiresAt && tokens.accessTokenExpiresAt - Date.now() > 120_000) return tokens.accessToken
    const res = await fetchWithTimeout(this.endpoints.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: tokens.clientId,
        client_secret: tokens.clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: 'refresh_token'
      }).toString()
    })
    const body = await readJson(res)
    if (!res.ok || body.error) throw googleError(res.status, body, 'Could not refresh the YouTube sign-in')
    tokens.accessToken = body.access_token
    tokens.accessTokenExpiresAt = Date.now() + (Number(body.expires_in) || 3600) * 1000
    return tokens.accessToken!
  }

  async channel(tokens: YouTubeTokens): Promise<{ id: string; title: string; thumbnailUrl?: string }> {
    const token = await this.accessToken(tokens)
    const res = await fetchWithTimeout(`${this.endpoints.api}/channels?part=snippet&mine=true`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const body = await readJson(res)
    if (!res.ok) throw googleError(res.status, body, 'Could not read your YouTube channel')
    const ch = body.items?.[0]
    if (!ch) throw new ApiError('This Google account has no YouTube channel. Create one at youtube.com, then connect again.', { retriable: false })
    return { id: ch.id, title: ch.snippet?.title ?? 'YouTube channel', thumbnailUrl: ch.snippet?.thumbnails?.default?.url }
  }

  private async apiGet(tokens: YouTubeTokens, path: string, params: Record<string, string | undefined>, context: string): Promise<any> {
    const token = await this.accessToken(tokens)
    const u = new URL(`${this.endpoints.api}/${path}`)
    for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v)
    const res = await fetchWithTimeout(u.toString(), { headers: { Authorization: `Bearer ${token}` } })
    const body = await readJson(res)
    if (!res.ok) throw googleError(res.status, body, context)
    return body
  }

  /**
   * Runs a YouTube Analytics report and returns rows as objects keyed by column name.
   * https://developers.google.com/youtube/analytics/reference/reports/query
   */
  async analyticsReport(tokens: YouTubeTokens, params: Record<string, string | undefined>): Promise<Record<string, string | number>[]> {
    const token = await this.accessToken(tokens)
    const u = new URL(`${this.endpoints.analytics ?? DEFAULT_YT_ENDPOINTS.analytics}/reports`)
    u.searchParams.set('ids', 'channel==MINE')
    for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v)
    const res = await fetchWithTimeout(u.toString(), { headers: { Authorization: `Bearer ${token}` } })
    const body = await readJson(res)
    if (!res.ok) {
      const reason = body?.error?.errors?.[0]?.reason
      if (res.status === 403 && (reason === 'insufficientPermissions' || /insufficient|scope/i.test(body?.error?.message ?? ''))) {
        throw new ApiError('Cadence needs permission to read your YouTube analytics. Disconnect and reconnect YouTube in Accounts, and tick every box on the Google screen.', {
          status: 403,
          retriable: false,
          code: 'analyticsScope',
          raw: body
        })
      }
      throw googleError(res.status, body, 'Could not read YouTube analytics')
    }
    const cols: string[] = (body.columnHeaders ?? []).map((c: { name: string }) => c.name)
    return (body.rows ?? []).map((r: (string | number)[]) => Object.fromEntries(cols.map((c, i) => [c, r[i]])))
  }

  /** Lifetime channel totals and the playlist that holds every upload. */
  async channelStats(tokens: YouTubeTokens): Promise<{ views: number; subscribers?: number; videoCount: number; uploadsPlaylist?: string }> {
    const body = await this.apiGet(tokens, 'channels', { part: 'statistics,contentDetails', mine: 'true' }, 'Could not read channel stats')
    const ch = body.items?.[0]
    if (!ch) throw new ApiError('This Google account has no YouTube channel.', { retriable: false })
    const st = ch.statistics ?? {}
    return {
      views: Number(st.viewCount ?? 0),
      subscribers: st.hiddenSubscriberCount ? undefined : Number(st.subscriberCount ?? 0),
      videoCount: Number(st.videoCount ?? 0),
      uploadsPlaylist: ch.contentDetails?.relatedPlaylists?.uploads
    }
  }

  /** Video ids of the most recent uploads, newest first. */
  async uploadIds(tokens: YouTubeTokens, playlistId: string, max = 200): Promise<string[]> {
    const ids: string[] = []
    let pageToken: string | undefined
    do {
      const body = await this.apiGet(
        tokens,
        'playlistItems',
        { part: 'contentDetails', playlistId, maxResults: '50', pageToken },
        'Could not list your uploads'
      )
      for (const it of body.items ?? []) if (it.contentDetails?.videoId) ids.push(it.contentDetails.videoId)
      pageToken = body.nextPageToken
    } while (pageToken && ids.length < max)
    return ids.slice(0, max)
  }

  async videoStats(
    tokens: YouTubeTokens,
    ids: string[]
  ): Promise<{ id: string; title: string; publishedAt?: string; thumbnailUrl?: string; durationSec?: number; views: number; likes?: number; comments?: number }[]> {
    const out = []
    for (let i = 0; i < ids.length; i += 50) {
      const body = await this.apiGet(tokens, 'videos', { part: 'snippet,statistics,contentDetails', id: ids.slice(i, i + 50).join(','), maxResults: '50' }, 'Could not read video stats')
      for (const v of body.items ?? []) {
        const st = v.statistics ?? {}
        out.push({
          id: v.id,
          title: v.snippet?.title ?? '',
          publishedAt: v.snippet?.publishedAt,
          thumbnailUrl: v.snippet?.thumbnails?.medium?.url ?? v.snippet?.thumbnails?.default?.url,
          durationSec: parseIsoDuration(v.contentDetails?.duration),
          views: Number(st.viewCount ?? 0),
          likes: st.likeCount != null ? Number(st.likeCount) : undefined,
          comments: st.commentCount != null ? Number(st.commentCount) : undefined
        })
      }
    }
    return out
  }

  static buildResource(meta: VideoMetadata): any {
    const status: Record<string, unknown> = {
      privacyStatus: meta.publishAt ? 'private' : meta.privacy,
      selfDeclaredMadeForKids: meta.madeForKids,
      embeddable: true
    }
    if (meta.publishAt) status.publishAt = new Date(meta.publishAt).toISOString()
    const tags = meta.tags.map((t) => t.trim()).filter(Boolean)
    return {
      snippet: {
        title: meta.title.trim(),
        description: meta.description,
        categoryId: meta.categoryId || '22',
        ...(tags.length ? { tags } : {})
      },
      status
    }
  }

  /** Sets a custom thumbnail (JPEG or PNG, at most 2 MB) on an uploaded video. */
  async setThumbnail(tokens: YouTubeTokens, videoId: string, imagePath: string): Promise<void> {
    if (!/^[\w-]{6,20}$/.test(videoId)) throw new ApiError('Unknown video.', { retriable: false })
    const buf = await readFile(imagePath)
    if (buf.length > THUMB_MAX_BYTES) throw new ApiError('The thumbnail is larger than 2 MB.', { retriable: false })
    const type = /\.png$/i.test(imagePath) ? 'image/png' : 'image/jpeg'
    const token = await this.accessToken(tokens)
    const res = await fetchWithTimeout(`${this.endpoints.upload}/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, {
      method: 'POST',
      timeoutMs: 2 * 60 * 1000,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': type, 'Content-Length': String(buf.length) },
      body: new Uint8Array(buf)
    })
    const body = await readJson(res)
    if (res.ok) return
    const reason: string | undefined = body?.error?.errors?.[0]?.reason
    if (res.status === 403 && (reason === 'forbidden' || /permission|verif/i.test(body?.error?.message ?? ''))) {
      throw new ApiError(
        'YouTube only allows custom thumbnails on verified channels. Verify your channel with a phone number at youtube.com/verify, then set the thumbnail in YouTube Studio.',
        { status: 403, retriable: false, code: 'thumbnail_not_allowed', raw: body }
      )
    }
    throw googleError(res.status, body, 'YouTube did not accept the thumbnail')
  }

  /**
   * Posts a top-level comment from the channel under one of its videos and returns the comment id.
   * https://developers.google.com/youtube/v3/docs/commentThreads/insert (50 quota units)
   */
  async postComment(tokens: YouTubeTokens, videoId: string, text: string): Promise<string> {
    if (!/^[\w-]{6,20}$/.test(videoId)) throw new ApiError('Unknown video.', { retriable: false })
    const token = await this.accessToken(tokens)
    const res = await fetchWithTimeout(`${this.endpoints.api}/commentThreads?part=snippet`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ snippet: { videoId, topLevelComment: { snippet: { textOriginal: text } } } })
    })
    const body = await readJson(res)
    if (res.ok) return String(body?.id ?? '')
    const reason: string | undefined = body?.error?.errors?.[0]?.reason
    const message: string = body?.error?.message ?? ''
    if (res.status === 403 && (reason === 'insufficientPermissions' || /insufficient.*scope|ACCESS_TOKEN_SCOPE/i.test(message))) {
      throw new ApiError('Cadence needs permission to post comments. Disconnect and reconnect this channel in Accounts, and tick every box on the Google screen.', {
        status: 403,
        retriable: false,
        code: 'commentScope',
        raw: body
      })
    }
    if (reason === 'commentsDisabled') {
      throw new ApiError('Comments are turned off on this Short (Shorts made for kids never allow comments).', { status: res.status, retriable: false, code: reason, raw: body })
    }
    // Right after an upload YouTube can still be processing the video, or not see it yet.
    if (reason === 'videoNotFound' || reason === 'processingFailure' || reason === 'forbidden') {
      throw new ApiError(`YouTube isn't taking comments on this Short yet (${reason}).`, { status: res.status, retriable: true, code: reason, raw: body })
    }
    throw googleError(res.status, body, 'YouTube did not accept the comment')
  }

  /** Starts a resumable upload session and returns its upload URL. */
  async startUpload(tokens: YouTubeTokens, meta: VideoMetadata, size: number, mimeType: string): Promise<string> {
    const token = await this.accessToken(tokens)
    const res = await fetchWithTimeout(`${this.endpoints.upload}/videos?uploadType=resumable&part=snippet,status&notifySubscribers=true`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(size),
        'X-Upload-Content-Type': mimeType
      },
      body: JSON.stringify(YouTubeClient.buildResource(meta))
    })
    if (!res.ok) throw googleError(res.status, await readJson(res), 'YouTube rejected the upload')
    await res.arrayBuffer().catch(() => undefined)
    const location = res.headers.get('location')
    if (!location) throw new ApiError('YouTube did not return an upload URL.', { retriable: true })
    return location
  }

  /**
   * Asks the upload session how many bytes it already has.
   * Returns { done: video } if the upload already completed, or { offset }.
   * Throws a non-retriable error with code 'session_expired' if the session is gone.
   */
  async queryUpload(tokens: YouTubeTokens, uploadUrl: string, size: number): Promise<{ offset: number; video?: any }> {
    const token = await this.accessToken(tokens)
    const res = await fetchWithTimeout(uploadUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Length': '0', 'Content-Range': `bytes */${size}` }
    })
    if (res.status === 200 || res.status === 201) return { offset: size, video: await readJson(res) }
    if (res.status === 308) {
      await res.arrayBuffer().catch(() => undefined)
      const range = res.headers.get('range')
      const m = range?.match(/bytes=0-(\d+)/)
      return { offset: m ? Number(m[1]) + 1 : 0 }
    }
    const body = await readJson(res)
    if (res.status === 404 || res.status === 410) {
      throw new ApiError('The YouTube upload session expired. Starting a fresh upload.', { status: res.status, retriable: true, code: 'session_expired' })
    }
    throw googleError(res.status, body, 'Could not resume the YouTube upload')
  }

  /** Uploads (or resumes) the file. Returns the created video resource. */
  async uploadFile(
    tokens: YouTubeTokens,
    uploadUrl: string,
    filePath: string,
    size: number,
    onProgress?: (fraction: number) => void,
    startOffset = 0
  ): Promise<any> {
    const fh = await open(filePath, 'r')
    try {
      let offset = startOffset
      let stalls = 0
      onProgress?.(offset / size)
      while (offset < size) {
        const len = Math.min(CHUNK, size - offset)
        const buf = Buffer.alloc(len)
        const { bytesRead } = await fh.read(buf, 0, len, offset)
        if (bytesRead !== len) throw new ApiError('The video file changed while uploading.', { retriable: false })
        const token = await this.accessToken(tokens)
        const res = await fetchWithTimeout(uploadUrl, {
          method: 'PUT',
          timeoutMs: 10 * 60 * 1000,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Length': String(len),
            'Content-Range': `bytes ${offset}-${offset + len - 1}/${size}`
          },
          body: buf
        })
        if (res.status === 200 || res.status === 201) {
          onProgress?.(1)
          return await readJson(res)
        }
        if (res.status === 308) {
          await res.arrayBuffer().catch(() => undefined)
          const range = res.headers.get('range')
          const m = range?.match(/bytes=0-(\d+)/)
          const newOffset = m ? Number(m[1]) + 1 : 0
          stalls = newOffset <= offset ? stalls + 1 : 0
          if (stalls >= 5) throw new ApiError('YouTube stopped accepting upload data. Retrying later.', { retriable: true })
          offset = newOffset
          onProgress?.(offset / size)
          continue
        }
        const body = await readJson(res)
        if (res.status === 404 || res.status === 410) {
          throw new ApiError('The YouTube upload session expired. Starting a fresh upload.', { status: res.status, retriable: true, code: 'session_expired' })
        }
        throw googleError(res.status, body, 'YouTube upload failed')
      }
      // All bytes acknowledged with 308 but no final response: ask for the result.
      const q = await this.queryUpload(tokens, uploadUrl, size)
      if (q.video) return q.video
      throw new ApiError('YouTube did not confirm the upload. Retrying.', { retriable: true })
    } finally {
      await fh.close()
    }
  }
}

/** "PT1M5S" -> 65. */
export function parseIsoDuration(d?: string): number | undefined {
  const m = d && /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(d)
  if (!m) return undefined
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0)
}
