import { describe, expect, it } from 'vitest'
import { buildOverview, localDay } from '../src/shared/overview'
import type { InsightsPoint } from '../src/shared/types'

const NOW = new Date(2026, 10, 17, 15, 0).getTime()
const day = (n: number) => localDay(NOW - n * 86400_000)
const at = (n: number) => new Date(NOW - n * 86400_000).toISOString()

describe('buildOverview', () => {
  const history: InsightsPoint[] = [
    { day: day(4), values: { 'instagram:a': 100, 'youtube:b': 1000 } },
    { day: day(3), values: { 'instagram:a': 150, 'youtube:b': 1200 } },
    // missed a day: the gain lands on the next reading
    { day: day(1), values: { 'instagram:a': 400, 'youtube:b': 1100 } }
  ]
  const posts = [
    { id: 'r1', account: 'instagram:a' as const, publishedAt: at(3), likes: 10, comments: 2, shares: 1, saves: 4, watchHours: 1.5 },
    { id: 'r1', account: 'instagram:a' as const, publishedAt: at(3), likes: 99 }, // duplicate from the view lists
    { id: 'v1', account: 'youtube:b' as const, publishedAt: at(1), likes: 5, subscribers: 3, watchHours: 2 },
    { id: 'old', account: 'youtube:b' as const, publishedAt: at(40), likes: 500 }
  ]

  it('sums views gained and per-post stats by day across accounts', () => {
    const ov = buildOverview({ history, posts, accounts: ['instagram:a', 'youtube:b'], rangeDays: 7, now: NOW })
    expect(ov.days).toHaveLength(7)
    expect(ov.days[6].day).toBe(localDay(NOW))
    const d3 = ov.days.find((d) => d.day === day(3))!
    expect(d3).toMatchObject({ views: 250, posts: 1, likes: 10, comments: 2, shares: 1, saves: 4, watchHours: 1.5 })
    const d1 = ov.days.find((d) => d.day === day(1))!
    // instagram +250, youtube dropped (never negative)
    expect(d1).toMatchObject({ views: 250, posts: 1, likes: 5, subscribers: 3, watchHours: 2 })
    expect(ov.totals.likes).toBe(15)
    expect(ov.available).toEqual(['views', 'posts', 'likes', 'comments', 'shares', 'saves', 'watchHours', 'subscribers'])
  })

  it('only counts the chosen accounts', () => {
    const ov = buildOverview({ history, posts, accounts: ['youtube:b'], rangeDays: 7, now: NOW })
    expect(ov.totals).toMatchObject({ views: 200, posts: 1, likes: 5, saves: 0 })
    expect(ov.available).not.toContain('saves')
  })
})
