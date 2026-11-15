import type { AnalyticsState, InsightsState, Platform, Post } from './types'
import { postStatus } from './status'

/** A post made outside Cadence (in the Instagram or YouTube app), read from the platform. */
export interface OutsidePost {
  key: string
  platform: Platform
  accountId: string
  id: string
  at: string
  title: string
  url?: string
  thumbnailUrl?: string
}

export type CalendarItem = { kind: 'cadence'; at: string; post: Post } | { kind: 'outside'; at: string; item: OutsidePost }

/**
 * The time a Cadence post sits on the calendar: its scheduled time, or for a
 * "Post now" post (no scheduled time), when it went out.
 */
export function cadencePostTime(p: Post): string | null {
  if (p.scheduledAt) return p.scheduledAt
  const done = [p.instagram, p.youtube]
    .filter((t) => t.enabled && t.publishedAt)
    .map((t) => t.publishedAt!)
    .sort()
  return done[0] ?? null
}

/**
 * Everything to show on the calendar: Cadence's own posts plus the posts the
 * platforms report that Cadence did not make, without listing a post twice.
 */
export function calendarItems(posts: Post[], insights?: InsightsState, analytics?: AnalyticsState): CalendarItem[] {
  const items: CalendarItem[] = []
  const ours = new Set<string>()
  for (const p of posts) {
    if (p.instagram.mediaId) ours.add(`instagram:${p.instagram.mediaId}`)
    if (p.youtube.videoId) ours.add(`youtube:${p.youtube.videoId}`)
    if (postStatus(p) === 'canceled') continue
    const at = cadencePostTime(p)
    if (at) items.push({ kind: 'cadence', at, post: p })
  }

  const outside = new Map<string, OutsidePost>()
  const add = (platform: Platform, accountId: string, m: { id: string; publishedAt?: string; title: string; url?: string; thumbnailUrl?: string }) => {
    const key = `${platform}:${m.id}`
    if (!m.publishedAt || Number.isNaN(Date.parse(m.publishedAt)) || ours.has(key) || outside.has(key)) return
    outside.set(key, { key, platform, accountId, id: m.id, at: new Date(m.publishedAt).toISOString(), title: m.title, url: m.url, thumbnailUrl: m.thumbnailUrl })
  }
  for (const [k, acct] of Object.entries(insights?.accounts ?? {})) {
    if (!acct) continue
    const accountId = k.slice(k.indexOf(':') + 1)
    for (const m of [...acct.recent, ...acct.top]) add(acct.platform, accountId, m)
  }
  for (const [id, a] of Object.entries(analytics?.instagram ?? {})) for (const r of a.reels) add('instagram', id, r)
  for (const [id, a] of Object.entries(analytics?.youtube ?? {})) for (const v of a.videos) add('youtube', id, v)
  for (const item of outside.values()) items.push({ kind: 'outside', at: item.at, item })

  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

