// The Views tab: total views per connected account, top posts, and a daily history
// so the UI can show trends.

import { ApiError } from './http'
import type { InstagramClient, InstagramCredentials, IgMediaItem } from './instagram'
import type { YouTubeClient, YouTubeTokens } from './youtube'
import type { AccountInsights, InsightsPoint, InsightsState, MediaStat, Post } from '../shared/types'

export const IG_MAX_POSTS = 1000
const IG_PER_POST_FALLBACK = 300
export const YT_MAX_VIDEOS = 200
const TOP_N = 12
const RECENT_N = 24
const HISTORY_DAYS = 400

export const EMPTY_INSIGHTS: InsightsState = { history: [], refreshing: false }

function isPermissionError(err: unknown): boolean {
  return err instanceof ApiError && !!err.opts.authError && /permission/i.test(err.message)
}

function captionTitle(caption?: string): string {
  const line = (caption ?? '').split('\n').find((l) => l.trim()) ?? ''
  return line.trim().slice(0, 120) || 'Untitled post'
}

function rank(items: MediaStat[]): { top: MediaStat[]; recent: MediaStat[] } {
  const top = items
    .filter((m) => m.views != null)
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
    .slice(0, TOP_N)
  const recent = [...items].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')).slice(0, RECENT_N)
  return { top, recent }
}

export async function instagramInsights(client: InstagramClient, creds: InstagramCredentials, posts: Post[]): Promise<AccountInsights> {
  const ours = new Set(posts.map((p) => p.instagram.mediaId).filter(Boolean) as string[])
  const acct = await client.accountStats(creds)
  const items: IgMediaItem[] = []
  let mode: 'expand' | 'perPost' | 'none' = 'expand'
  let after: string | undefined
  let note: string | undefined

  for (let page = 0; page < IG_MAX_POSTS / 50; page++) {
    let res: { items: IgMediaItem[]; after?: string }
    if (mode === 'expand') {
      try {
        res = await client.mediaPage(creds, { after, insights: true })
      } catch (err) {
        if (err instanceof ApiError && err.opts.authError && !isPermissionError(err)) throw err
        // Either the insights permission is missing, or one post doesn't support views
        // (e.g. posted before the account became professional). Fall back per post.
        mode = isPermissionError(err) ? 'none' : 'perPost'
        res = await client.mediaPage(creds, { after, insights: false })
      }
    } else {
      res = await client.mediaPage(creds, { after, insights: false })
    }
    if (mode === 'perPost') {
      const need = res.items.filter((m) => m.views === undefined)
      let done = items.length
      for (const m of need) {
        if (done++ >= IG_PER_POST_FALLBACK) {
          m.views = null
          continue
        }
        try {
          m.views = await client.mediaViews(creds, m.id)
        } catch (err) {
          if (isPermissionError(err)) {
            mode = 'none'
            break
          }
          if (err instanceof ApiError && err.opts.authError) throw err
          m.views = null
        }
      }
    }
    items.push(...res.items)
    after = res.after
    if (!after) break
  }

  if (mode === 'none') {
    note =
      'Instagram did not allow Cadence to read views. Reconnect Instagram in Accounts and make sure the instagram_manage_insights permission is ticked when you generate the token.'
    for (const m of items) m.views = null
  } else if (after) {
    note = `Views are summed over your latest ${items.length} posts.`
  }

  const stats: MediaStat[] = items.map((m) => ({
    id: m.id,
    title: captionTitle(m.caption),
    url: m.permalink,
    thumbnailUrl: m.thumbnailUrl,
    publishedAt: m.timestamp,
    views: m.views ?? null,
    likes: m.likes,
    comments: m.comments,
    viaCadence: ours.has(m.id) || undefined
  }))
  const counted = stats.filter((m) => m.views != null)
  return {
    fetchedAt: new Date().toISOString(),
    totalViews: mode === 'none' ? null : counted.reduce((n, m) => n + (m.views ?? 0), 0),
    followers: acct.followers,
    postCount: acct.mediaCount,
    countedPosts: counted.length,
    note,
    ...rank(stats)
  }
}

export async function youtubeInsights(client: YouTubeClient, tokens: YouTubeTokens, posts: Post[]): Promise<AccountInsights> {
  const ours = new Set(posts.map((p) => p.youtube.videoId).filter(Boolean) as string[])
  const ch = await client.channelStats(tokens)
  const ids = ch.uploadsPlaylist ? await client.uploadIds(tokens, ch.uploadsPlaylist, YT_MAX_VIDEOS) : []
  const vids = await client.videoStats(tokens, ids)
  const stats: MediaStat[] = vids.map((v) => ({
    id: v.id,
    title: v.title || 'Untitled video',
    url: `https://www.youtube.com/shorts/${v.id}`,
    thumbnailUrl: v.thumbnailUrl,
    publishedAt: v.publishedAt,
    views: v.views,
    likes: v.likes,
    comments: v.comments,
    viaCadence: ours.has(v.id) || undefined
  }))
  return {
    fetchedAt: new Date().toISOString(),
    // YouTube's own lifetime total for the channel (it can lag a little behind per-video counts).
    totalViews: ch.views,
    followers: ch.subscribers,
    postCount: ch.videoCount,
    countedPosts: ch.videoCount,
    note: ch.videoCount > YT_MAX_VIDEOS ? `Top videos are picked from your latest ${YT_MAX_VIDEOS} uploads. The total covers every video.` : undefined,
    ...rank(stats)
  }
}

export function localDay(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Records today's totals (one point per day, latest value wins). */
export function recordHistory(history: InsightsPoint[], patch: Omit<InsightsPoint, 'day'>, now = new Date()): InsightsPoint[] {
  const day = localDay(now)
  const out = history.filter((p) => p.day !== day)
  const prev = history.find((p) => p.day === day) ?? { day }
  const point: InsightsPoint = { ...prev, day }
  if (patch.instagram != null) point.instagram = patch.instagram
  if (patch.youtube != null) point.youtube = patch.youtube
  out.push(point)
  out.sort((a, b) => a.day.localeCompare(b.day))
  return out.slice(-HISTORY_DAYS)
}
