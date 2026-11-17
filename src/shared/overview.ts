// Builds the day-by-day data for the "Everything" graph on the Views tab:
// every stat Cadence knows about, for every account, on one timeline.
import type { AccountKey, InsightsPoint } from './types'

export type OverviewMetric = 'views' | 'posts' | 'likes' | 'comments' | 'shares' | 'saves' | 'watchHours' | 'subscribers'

export const OVERVIEW_METRICS: { key: OverviewMetric; label: string; unit: string; hint: string }[] = [
  { key: 'views', label: 'Views gained', unit: 'views', hint: 'New views across all your posts that day' },
  { key: 'posts', label: 'Posts', unit: 'posts', hint: 'Reels and Shorts published that day' },
  { key: 'likes', label: 'Likes', unit: 'likes', hint: 'Likes on the posts published that day' },
  { key: 'comments', label: 'Comments', unit: 'comments', hint: 'Comments on the posts published that day' },
  { key: 'shares', label: 'Shares', unit: 'shares', hint: 'Shares of the posts published that day' },
  { key: 'saves', label: 'Saves', unit: 'saves', hint: 'Instagram saves of the reels published that day' },
  { key: 'watchHours', label: 'Watch time', unit: 'hours', hint: 'Hours watched on the posts published that day' },
  { key: 'subscribers', label: 'Subscribers', unit: 'subscribers', hint: 'YouTube subscribers gained from the Shorts published that day' }
]

/** One published Reel or Short with whatever stats its platform returned. */
export interface OverviewPost {
  id: string
  account: AccountKey
  publishedAt: string
  likes?: number | null
  comments?: number | null
  shares?: number | null
  saves?: number | null
  watchHours?: number | null
  subscribers?: number | null
}

export type OverviewDay = { day: string } & Record<OverviewMetric, number>

export interface Overview {
  days: OverviewDay[]
  /** Metrics with at least one non-zero value, in display order. */
  available: OverviewMetric[]
  totals: Record<OverviewMetric, number>
}

export function localDay(t: number | Date): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function empty(day: string): OverviewDay {
  return { day, views: 0, posts: 0, likes: 0, comments: 0, shares: 0, saves: 0, watchHours: 0, subscribers: 0 }
}

/**
 * Daily totals over the last `rangeDays` days (today included), for the given accounts.
 * Views gained come from the daily view-count history; every other stat is credited
 * to the day its post went live.
 */
export function buildOverview(opts: { history: InsightsPoint[]; posts: OverviewPost[]; accounts: AccountKey[]; rangeDays: number; now: number }): Overview {
  const { history, posts, rangeDays, now } = opts
  const keys = new Set(opts.accounts)
  const days: OverviewDay[] = []
  const index = new Map<string, OverviewDay>()
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setHours(12, 0, 0, 0)
    d.setDate(d.getDate() - i)
    const row = empty(localDay(d))
    days.push(row)
    index.set(row.day, row)
  }

  // Views gained: the rise in each account's total since its previous reading.
  const sorted = [...history].sort((a, b) => a.day.localeCompare(b.day))
  for (const key of keys) {
    let prev: number | null = null
    for (const p of sorted) {
      const v = p.values?.[key]
      if (v == null) continue
      if (prev != null) {
        const row = index.get(p.day)
        if (row) row.views += Math.max(0, v - prev)
      }
      prev = v
    }
  }

  const seen = new Set<string>()
  for (const p of posts) {
    if (!keys.has(p.account)) continue
    const id = `${p.account}/${p.id}`
    if (seen.has(id)) continue
    seen.add(id)
    const t = Date.parse(p.publishedAt)
    if (!Number.isFinite(t)) continue
    const row = index.get(localDay(t))
    if (!row) continue
    row.posts += 1
    row.likes += p.likes ?? 0
    row.comments += p.comments ?? 0
    row.shares += p.shares ?? 0
    row.saves += p.saves ?? 0
    row.watchHours += p.watchHours ?? 0
    row.subscribers += p.subscribers ?? 0
  }

  const totals = Object.fromEntries(OVERVIEW_METRICS.map((m) => [m.key, days.reduce((s, d) => s + d[m.key], 0)])) as Record<OverviewMetric, number>
  const available = OVERVIEW_METRICS.map((m) => m.key).filter((k) => totals[k] > 0)
  return { days, available, totals }
}
