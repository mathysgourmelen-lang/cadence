import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { InstagramClient } from '../src/main/instagram'
import { YouTubeClient } from '../src/main/youtube'
import { instagramInsights, recordHistory, youtubeInsights } from '../src/main/insights'
import type { Post } from '../src/shared/types'

let server: Server
let base = ''
let handler: (url: URL, res: ServerResponse) => void = (_u, res) => res.writeHead(500).end()
const seen: URL[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url!, base)
    seen.push(u)
    handler(u, res)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

const json = (res: ServerResponse, status: number, body: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
const creds = { igUserId: '1784', accessToken: 'T' }
const ig = () => new InstagramClient('v24.0', { graph: base, rupload: base })
const ourPost = { instagram: { mediaId: 'm2' }, youtube: { videoId: 'v1' } } as unknown as Post

const media = (id: string, views?: number) => ({
  id,
  caption: `Post ${id}\n#tag`,
  media_type: 'VIDEO',
  timestamp: '2026-11-01T10:00:00+0000',
  permalink: `https://instagram.com/p/${id}`,
  thumbnail_url: `https://cdn/${id}.jpg`,
  like_count: 10,
  comments_count: 2,
  ...(views != null ? { insights: { data: [{ name: 'views', values: [{ value: views }] }] } } : {})
})

describe('instagramInsights', () => {
  it('sums views across every page of posts and ranks the top ones', async () => {
    seen.length = 0
    handler = (u, res) => {
      if (u.pathname === '/v24.0/1784') return json(res, 200, { followers_count: 5000, media_count: 3 })
      if (u.pathname === '/v24.0/1784/media') {
        expect(u.searchParams.get('fields')).toContain('insights.metric(views)')
        if (!u.searchParams.get('after')) return json(res, 200, { data: [media('m1', 100), media('m2', 900)], paging: { cursors: { after: 'C2' }, next: 'x' } })
        return json(res, 200, { data: [media('m3', 50)], paging: { cursors: { after: 'C3' } } })
      }
      json(res, 404, {})
    }
    const r = await instagramInsights(ig(), creds, [ourPost])
    expect(r.totalViews).toBe(1050)
    expect(r.followers).toBe(5000)
    expect(r.countedPosts).toBe(3)
    expect(r.top.map((m) => m.id)).toEqual(['m2', 'm1', 'm3'])
    expect(r.top[0]).toMatchObject({ title: 'Post m2', viaCadence: true, url: 'https://instagram.com/p/m2' })
    expect(r.note).toBeUndefined()
  })

  it('falls back to per-post views when one post does not support the metric', async () => {
    handler = (u, res) => {
      if (u.pathname === '/v24.0/1784') return json(res, 200, { followers_count: 1 })
      if (u.pathname === '/v24.0/1784/media') {
        if (u.searchParams.get('fields')!.includes('insights')) return json(res, 400, { error: { message: 'Invalid parameter', code: 100 } })
        return json(res, 200, { data: [media('a'), media('b')] })
      }
      if (u.pathname === '/v24.0/a/insights') return json(res, 200, { data: [{ name: 'views', total_value: { value: 40 } }] })
      if (u.pathname === '/v24.0/b/insights') return json(res, 400, { error: { message: 'Not supported for media posted before conversion', code: 100 } })
      json(res, 404, {})
    }
    const r = await instagramInsights(ig(), creds, [])
    expect(r.totalViews).toBe(40)
    expect(r.countedPosts).toBe(1)
    expect(r.recent.find((m) => m.id === 'b')!.views).toBeNull()
  })

  it('explains a missing insights permission instead of failing', async () => {
    handler = (u, res) => {
      if (u.pathname === '/v24.0/1784') return json(res, 200, { followers_count: 7, media_count: 1 })
      if (u.pathname === '/v24.0/1784/media') {
        if (u.searchParams.get('fields')!.includes('insights')) return json(res, 403, { error: { message: '(#10) Application does not have permission for this action', code: 10 } })
        return json(res, 200, { data: [media('a')] })
      }
      json(res, 404, {})
    }
    const r = await instagramInsights(ig(), creds, [])
    expect(r.totalViews).toBeNull()
    expect(r.note).toMatch(/instagram_manage_insights/)
    expect(r.followers).toBe(7)
  })

  it('still fails loudly when the sign-in expired', async () => {
    handler = (_u, res) => json(res, 400, { error: { message: 'Session expired', code: 190 } })
    await expect(instagramInsights(ig(), creds, [])).rejects.toThrow(/sign-in expired/)
  })
})

describe('youtubeInsights', () => {
  it('uses the channel lifetime total and ranks uploads by views', async () => {
    handler = (u, res) => {
      if (u.pathname === '/yt/channels') return json(res, 200, { items: [{ statistics: { viewCount: '123456', subscriberCount: '900', videoCount: '3' }, contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] })
      if (u.pathname === '/yt/playlistItems') {
        expect(u.searchParams.get('playlistId')).toBe('UU1')
        return json(res, 200, { items: [{ contentDetails: { videoId: 'v1' } }, { contentDetails: { videoId: 'v2' } }, { contentDetails: { videoId: 'v3' } }] })
      }
      if (u.pathname === '/yt/videos') {
        expect(u.searchParams.get('id')).toBe('v1,v2,v3')
        return json(res, 200, {
          items: [
            { id: 'v1', snippet: { title: 'One', publishedAt: '2026-11-01T00:00:00Z' }, statistics: { viewCount: '500', likeCount: '5' } },
            { id: 'v2', snippet: { title: 'Two', publishedAt: '2026-11-02T00:00:00Z' }, statistics: { viewCount: '9000' } },
            { id: 'v3', snippet: { title: 'Three', publishedAt: '2026-11-03T00:00:00Z' }, statistics: { viewCount: '20' } }
          ]
        })
      }
      json(res, 404, {})
    }
    const yt = new YouTubeClient({ auth: `${base}/auth`, token: `${base}/token`, api: `${base}/yt`, upload: `${base}/up` })
    const tokens = { clientId: 'c', clientSecret: 's', refreshToken: 'r', accessToken: 'A', accessTokenExpiresAt: Date.now() + 3600_000 }
    const r = await youtubeInsights(yt, tokens, [ourPost])
    expect(r.totalViews).toBe(123456)
    expect(r.followers).toBe(900)
    expect(r.postCount).toBe(3)
    expect(r.top.map((m) => m.id)).toEqual(['v2', 'v1', 'v3'])
    expect(r.top.find((m) => m.id === 'v1')).toMatchObject({ viaCadence: true, likes: 5 })
    expect(r.recent[0].id).toBe('v3')
  })
})

describe('recordHistory', () => {
  it('keeps one point per day and merges platforms', () => {
    const d1 = new Date(2026, 10, 10, 9)
    const d2 = new Date(2026, 10, 11, 9)
    let h = recordHistory([], { 'instagram:A': 10 }, d1)
    h = recordHistory(h, { 'youtube:C': 50 }, d1)
    h = recordHistory(h, { 'instagram:A': 12, 'instagram:B': 3 }, d1)
    h = recordHistory(h, { 'instagram:A': 20, 'youtube:C': 70 }, d2)
    expect(h).toEqual([
      { day: '2026-11-10', values: { 'instagram:A': 12, 'instagram:B': 3, 'youtube:C': 50 } },
      { day: '2026-11-11', values: { 'instagram:A': 20, 'youtube:C': 70 } }
    ])
  })
})
