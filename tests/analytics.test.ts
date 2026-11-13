import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { InstagramClient } from '../src/main/instagram'
import { YouTubeClient, parseIsoDuration } from '../src/main/youtube'
import { instagramAnalytics, youtubeAnalytics, youtubeRetention } from '../src/main/analytics'
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
const ours = { instagram: { mediaId: 'r1' }, youtube: { videoId: 'v1' }, video: { media: { durationSec: 20 } } } as unknown as Post

describe('instagramAnalytics', () => {
  it('reads per-reel watch time and skip rate, dropping metrics Instagram refuses', async () => {
    seen.length = 0
    let refusedSkip = 0
    handler = (u, res) => {
      if (u.pathname === '/v24.0/1784/media')
        return json(res, 200, {
          data: [
            { id: 'r1', caption: 'Hook test\n#x', media_type: 'VIDEO', media_product_type: 'REELS', like_count: 3 },
            { id: 'p1', caption: 'A photo', media_type: 'IMAGE', media_product_type: 'FEED' },
            { id: 'r2', caption: 'Second', media_type: 'VIDEO', media_product_type: 'REELS' }
          ]
        })
      if (u.pathname.endsWith('/insights')) {
        const metrics = u.searchParams.get('metric')!.split(',')
        if (metrics.includes('reels_skip_rate')) {
          refusedSkip++
          return json(res, 400, { error: { message: '(#100) metric[4] must be one of the following values', code: 100 } })
        }
        const vals: Record<string, number> = { views: 1000, reach: 800, ig_reels_avg_watch_time: 6420, ig_reels_video_view_total_time: 7_200_000, likes: 50, comments: 4, shares: 9, saved: 12 }
        return json(res, 200, { data: metrics.map((m) => ({ name: m, values: [{ value: vals[m] }] })) })
      }
      json(res, 404, {})
    }
    const r = await instagramAnalytics(new InstagramClient('v24.0', { graph: base, rupload: base }), creds, [ours])
    expect(r.reels.map((x) => x.id)).toEqual(['r1', 'r2'])
    expect(r.unavailable).toEqual(['reels_skip_rate'])
    expect(refusedSkip).toBe(1) // only the probe on the first reel
    expect(r.reels[0]).toMatchObject({ title: 'Hook test', views: 1000, reach: 800, avgWatchSec: 6.4, totalWatchSec: 7200, skipRate: null, shares: 9, saves: 12, durationSec: 20, viaCadence: true })
  })

  it('accepts skip rate when available', async () => {
    handler = (u, res) => {
      if (u.pathname === '/v24.0/1784/media') return json(res, 200, { data: [{ id: 'r9', media_type: 'VIDEO', media_product_type: 'REELS' }] })
      if (u.pathname.endsWith('/insights')) return json(res, 200, { data: [{ name: 'reels_skip_rate', values: [{ value: 37.5 }] }] })
      json(res, 404, {})
    }
    const r = await instagramAnalytics(new InstagramClient('v24.0', { graph: base, rupload: base }), creds, [])
    expect(r.reels[0].skipRate).toBe(37.5)
    expect(r.unavailable).toEqual([])
  })
})

describe('youtubeAnalytics', () => {
  const yt = () => new YouTubeClient({ auth: `${base}/a`, token: `${base}/t`, api: `${base}/yt`, upload: `${base}/up`, analytics: `${base}/ya` })
  const tokens = () => ({ clientId: 'c', clientSecret: 's', refreshToken: 'r', accessToken: 'A', accessTokenExpiresAt: Date.now() + 3600_000 })

  it('combines per-video analytics with video details and traffic sources', async () => {
    seen.length = 0
    handler = (u, res) => {
      if (u.pathname === '/yt/channels') return json(res, 200, { items: [{ statistics: { viewCount: '10', videoCount: '2' }, contentDetails: { relatedPlaylists: { uploads: 'UU' } } }] })
      if (u.pathname === '/yt/playlistItems') return json(res, 200, { items: [{ contentDetails: { videoId: 'v1' } }, { contentDetails: { videoId: 'v2' } }] })
      if (u.pathname === '/yt/videos')
        return json(res, 200, {
          items: [
            { id: 'v1', snippet: { title: 'One', publishedAt: '2026-10-01T00:00:00Z' }, statistics: { viewCount: '100' }, contentDetails: { duration: 'PT32S' } },
            { id: 'v2', snippet: { title: 'Two', publishedAt: '2026-09-15T00:00:00Z' }, statistics: { viewCount: '50' }, contentDetails: { duration: 'PT1M5S' } }
          ]
        })
      if (u.pathname === '/ya/reports') {
        expect(u.searchParams.get('ids')).toBe('channel==MINE')
        if (u.searchParams.get('dimensions') === 'video') {
          if (u.searchParams.get('metrics')!.includes('engagedViews')) return json(res, 400, { error: { message: 'The query is not supported.', errors: [{ reason: 'badRequest' }] } })
          expect(u.searchParams.get('filters')).toBe('video==v1,v2')
          expect(u.searchParams.get('startDate')).toBe('2026-09-15')
          return json(res, 200, {
            columnHeaders: ['video', 'views', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage', 'likes', 'comments', 'shares', 'subscribersGained'].map((name) => ({ name })),
            rows: [['v1', 120, 60, 30, 93.7, 10, 2, 3, 4]]
          })
        }
        if (u.searchParams.get('dimensions') === 'insightTrafficSourceType')
          return json(res, 200, { columnHeaders: [{ name: 'insightTrafficSourceType' }, { name: 'views' }], rows: [['SHORTS', 900], ['YT_SEARCH', 40], ['PLAYLIST', 0]] })
      }
      json(res, 404, {})
    }
    const r = await youtubeAnalytics(yt(), tokens(), [ours], new Date(2026, 10, 13))
    expect(r.videos[0]).toMatchObject({ id: 'v1', views: 120, avgViewSec: 30, avgViewPct: 93.7, watchMinutes: 60, subscribersGained: 4, durationSec: 32, engagedViews: null, viaCadence: true })
    // v2 has no analytics row yet: falls back to the public view count.
    expect(r.videos[1]).toMatchObject({ id: 'v2', views: 50, avgViewPct: null, durationSec: 65 })
    expect(r.traffic).toEqual([
      { source: 'SHORTS', views: 900 },
      { source: 'YT_SEARCH', views: 40 }
    ])
  })

  it('explains a missing analytics permission', async () => {
    handler = (u, res) => {
      if (u.pathname === '/ya/reports') return json(res, 403, { error: { message: 'Request had insufficient authentication scopes.', errors: [{ reason: 'insufficientPermissions' }] } })
      json(res, 404, {})
    }
    await expect(youtubeRetention(yt(), tokens(), 'abcdefghijk')).rejects.toThrow(/reconnect YouTube/i)
  })

  it('returns the retention curve in order', async () => {
    handler = (u, res) => {
      expect(u.searchParams.get('filters')).toBe('video==abcdefghijk')
      json(res, 200, {
        columnHeaders: [{ name: 'elapsedVideoTimeRatio' }, { name: 'audienceWatchRatio' }, { name: 'relativeRetentionPerformance' }],
        rows: [
          [0.02, 0.9, 0.6],
          [0.01, 1.1, 0.7]
        ]
      })
    }
    const p = await youtubeRetention(yt(), tokens(), 'abcdefghijk', '2026-10-01T00:00:00Z')
    expect(p).toEqual([
      { at: 0.01, watch: 1.1, relative: 0.7 },
      { at: 0.02, watch: 0.9, relative: 0.6 }
    ])
    await expect(youtubeRetention(yt(), tokens(), 'bad id;x')).rejects.toThrow()
  })

  it('parses ISO 8601 durations', () => {
    expect(parseIsoDuration('PT59S')).toBe(59)
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723)
    expect(parseIsoDuration('P1DT1S')).toBe(86401)
    expect(parseIsoDuration(undefined)).toBeUndefined()
  })
})
