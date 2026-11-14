// The Analytics tab: watch time, skip rate and retention per video, from the
// Instagram media insights API and the YouTube Analytics API.

import { ApiError } from './http'
import type { InstagramClient, InstagramCredentials, IgMediaItem } from './instagram'
import type { YouTubeClient, YouTubeTokens } from './youtube'
import { remoteMp4Duration } from './remotemp4'
import type { Post, ReelAnalytics, RetentionPoint, YtVideoAnalytics } from '../shared/types'

export const IG_ANALYTICS_REELS = 50
export const YT_ANALYTICS_VIDEOS = 50

/** Per-reel metrics, most useful first. Some are marked "in development" by Meta and may be refused. */
export const REEL_METRICS = ['views', 'reach', 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time', 'reels_skip_rate', 'likes', 'comments', 'shares', 'saved']
/** Metrics that can be dropped if Instagram refuses them, without losing the rest. */
const OPTIONAL_REEL_METRICS = ['reels_skip_rate', 'ig_reels_video_view_total_time', 'views']

function captionTitle(caption?: string): string {
  const line = (caption ?? '').split('\n').find((l) => l.trim()) ?? ''
  return line.trim().slice(0, 120) || 'Untitled reel'
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await fn(items[i++])
    })
  )
}

/** Instagram reports watch time in milliseconds. */
const msToSec = (v: number | null | undefined) => (v == null ? null : Math.round(v / 100) / 10)

/** Skip rate comes as a percentage; accept a 0-1 fraction too. */
function percent(v: number | null | undefined): number | null {
  if (v == null) return null
  return v <= 1 && v > 0 ? v * 100 : v
}

function isMetricError(err: unknown): boolean {
  return err instanceof ApiError && !err.opts.authError && (err.opts.code === 100 || err.opts.status === 400)
}

export async function instagramAnalytics(
  client: InstagramClient,
  creds: InstagramCredentials,
  posts: Post[],
  /** Lengths already known from an earlier refresh, by reel id. */
  knownDurations: Map<string, number> = new Map(),
  probeDuration: (url: string) => Promise<number | null> = remoteMp4Duration
): Promise<{ reels: ReelAnalytics[]; unavailable: string[] }> {
  // Latest reels only; photos and carousels have no watch time.
  const reels: IgMediaItem[] = []
  let after: string | undefined
  for (let page = 0; page < 6 && reels.length < IG_ANALYTICS_REELS; page++) {
    const res = await client.mediaPage(creds, { after, insights: false })
    reels.push(...res.items.filter((m) => m.productType === 'REELS' || (m.mediaType === 'VIDEO' && m.productType !== 'STORY')))
    after = res.after
    if (!after) break
  }
  const byMedia = new Map(posts.filter((p) => p.instagram.mediaId).map((p) => [p.instagram.mediaId!, p]))
  let metrics = [...REEL_METRICS]
  const unavailable = new Set<string>()

  // Find a metric set Instagram accepts using the newest reel, then use it for all.
  const fetchOne = async (id: string): Promise<Record<string, number | null>> => {
    for (;;) {
      try {
        return await client.mediaInsights(creds, id, metrics)
      } catch (err) {
        const drop = OPTIONAL_REEL_METRICS.find((m) => metrics.includes(m))
        if (!isMetricError(err) || !drop) throw err
        metrics = metrics.filter((m) => m !== drop)
        unavailable.add(drop)
      }
    }
  }

  const values = new Map<string, Record<string, number | null>>()
  const list = reels.slice(0, IG_ANALYTICS_REELS)
  if (list.length) values.set(list[0].id, await fetchOne(list[0].id))
  await pool(list.slice(1), 4, async (m) => {
    try {
      values.set(m.id, await client.mediaInsights(creds, m.id, metrics))
    } catch (err) {
      if (err instanceof ApiError && err.opts.authError) throw err
      // e.g. a reel posted before the account was professional: leave its numbers empty.
    }
  })

  // Instagram's API doesn't give a reel's length; read it from the video file's header.
  const durations = new Map<string, number>()
  for (const m of list) {
    const d = byMedia.get(m.id)?.video.media.durationSec ?? knownDurations.get(m.id)
    if (d) durations.set(m.id, d)
  }
  await pool(
    list.filter((m) => !durations.has(m.id) && m.mediaUrl),
    4,
    async (m) => {
      try {
        const d = await probeDuration(m.mediaUrl!)
        if (d) durations.set(m.id, Math.round(d * 10) / 10)
      } catch {
        // Leave the length unknown; the reel still shows everything else.
      }
    }
  )

  const out = list.map((m): ReelAnalytics => {
    const v = values.get(m.id) ?? {}
    const post = byMedia.get(m.id)
    return {
      id: m.id,
      title: captionTitle(m.caption),
      url: m.permalink,
      thumbnailUrl: m.thumbnailUrl,
      publishedAt: m.timestamp,
      views: v.views ?? null,
      reach: v.reach ?? null,
      avgWatchSec: msToSec(v.ig_reels_avg_watch_time),
      totalWatchSec: msToSec(v.ig_reels_video_view_total_time),
      skipRate: percent(v.reels_skip_rate),
      likes: v.likes ?? m.likes ?? null,
      comments: v.comments ?? m.comments ?? null,
      shares: v.shares ?? null,
      saves: v.saved ?? null,
      durationSec: durations.get(m.id),
      viaCadence: post ? true : undefined
    }
  })
  return { reels: out, unavailable: [...unavailable] }
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v))

const VIDEO_METRICS = ['views', 'engagedViews', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage', 'likes', 'comments', 'shares', 'subscribersGained']

export async function youtubeAnalytics(
  client: YouTubeClient,
  tokens: YouTubeTokens,
  posts: Post[],
  now = new Date()
): Promise<{ videos: YtVideoAnalytics[]; traffic: { source: string; views: number }[] }> {
  const ch = await client.channelStats(tokens)
  const ids = ch.uploadsPlaylist ? await client.uploadIds(tokens, ch.uploadsPlaylist, YT_ANALYTICS_VIDEOS) : []
  const info = await client.videoStats(tokens, ids)
  const ours = new Set(posts.map((p) => p.youtube.videoId).filter(Boolean) as string[])
  const endDate = ymd(now)
  const earliest = info.reduce((min, v) => (v.publishedAt && v.publishedAt < min ? v.publishedAt : min), endDate)
  const startDate = earliest.slice(0, 10)

  let rows: Record<string, string | number>[] = []
  if (ids.length) {
    let metrics = [...VIDEO_METRICS]
    const query = () =>
      client.analyticsReport(tokens, {
        startDate,
        endDate,
        dimensions: 'video',
        filters: `video==${ids.join(',')}`,
        metrics: metrics.join(','),
        sort: '-views',
        maxResults: String(YT_ANALYTICS_VIDEOS)
      })
    try {
      rows = await query()
    } catch (err) {
      // Older API combinations don't accept engagedViews; retry without it.
      if (!(err instanceof ApiError) || err.opts.status !== 400) throw err
      metrics = metrics.filter((m) => m !== 'engagedViews')
      rows = await query()
    }
  }
  const byId = new Map(rows.map((r) => [String(r.video), r]))

  const videos = info.map((v): YtVideoAnalytics => {
    const r = byId.get(v.id) ?? {}
    return {
      id: v.id,
      title: v.title || 'Untitled video',
      url: `https://www.youtube.com/shorts/${v.id}`,
      thumbnailUrl: v.thumbnailUrl,
      publishedAt: v.publishedAt,
      durationSec: v.durationSec,
      views: num(r.views) ?? v.views,
      engagedViews: num(r.engagedViews),
      avgViewSec: num(r.averageViewDuration),
      avgViewPct: num(r.averageViewPercentage),
      watchMinutes: num(r.estimatedMinutesWatched),
      likes: num(r.likes) ?? v.likes ?? null,
      comments: num(r.comments) ?? v.comments ?? null,
      shares: num(r.shares),
      subscribersGained: num(r.subscribersGained),
      viaCadence: ours.has(v.id) || undefined
    }
  })

  const from = new Date(now.getTime() - 28 * 86400_000)
  const trafficRows = await client.analyticsReport(tokens, {
    startDate: ymd(from),
    endDate,
    dimensions: 'insightTrafficSourceType',
    metrics: 'views',
    sort: '-views'
  })
  const traffic = trafficRows.map((r) => ({ source: String(r.insightTrafficSourceType), views: Number(r.views ?? 0) })).filter((t) => t.views > 0)
  return { videos, traffic }
}

/** The audience retention curve of one video: 100 points from 1% to 100% of its length. */
export async function youtubeRetention(client: YouTubeClient, tokens: YouTubeTokens, videoId: string, publishedAt?: string, now = new Date()): Promise<RetentionPoint[]> {
  if (!/^[\w-]{6,20}$/.test(videoId)) throw new ApiError('Unknown video.', { retriable: false })
  const rows = await client.analyticsReport(tokens, {
    startDate: (publishedAt ?? '2010-01-01').slice(0, 10),
    endDate: ymd(now),
    dimensions: 'elapsedVideoTimeRatio',
    metrics: 'audienceWatchRatio,relativeRetentionPerformance',
    filters: `video==${videoId}`
  })
  return rows
    .map((r) => ({ at: Number(r.elapsedVideoTimeRatio), watch: Number(r.audienceWatchRatio ?? 0), relative: num(r.relativeRetentionPerformance) }))
    .sort((a, b) => a.at - b.at)
}
