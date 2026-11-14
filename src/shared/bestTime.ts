// "Best time to post": which hours and weekdays your posts do best at.
//
// Raw views are a poor signal: an account that grows gets more views on newer
// posts whatever the time. So each post is compared with the posts published
// around it (the median of its 10 neighbours in time), and the score is how many
// times better or worse it did (log2). Times are grouped into 3-hour windows and
// weekdays in the Mac's time zone, and small groups are shrunk towards "typical"
// so one lucky post doesn't decide the answer.

import type { TimingSample } from './types'

export const BLOCK_HOURS = 3
export const BLOCKS = 24 / BLOCK_HOURS
/** Posts newer than this haven't collected most of their views yet. */
export const SETTLE_MS = 2 * 86400_000
export const MIN_SAMPLES = 8
const NEIGHBOURS = 10
const SHRINK = 2

export interface Bucket {
  n: number
  /** Views compared with typical: 1.5 = 50% more. 1 when there's no data. */
  lift: number
}

export interface BlockBucket extends Bucket {
  /** Start hour, 0-21. */
  start: number
}

export interface DayBucket extends Bucket {
  /** 0 = Sunday, as Date.getDay(). */
  day: number
}

export interface BestTime {
  /** Posts used. */
  n: number
  blocks: BlockBucket[]
  days: DayBucket[]
  /** cells[day][block] */
  cells: Bucket[][]
  /** Up to 3 windows that clearly beat typical, best first. */
  bestBlocks: BlockBucket[]
  /** Up to 2 days that clearly beat typical, best first. */
  bestDays: DayBucket[]
  worstBlock?: BlockBucket
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

interface Acc {
  sum: number
  n: number
}

const lift = (a: Acc): number => (a.n ? 2 ** (a.sum / (a.n + SHRINK)) : 1)
/** Unshrunk, for display. */
const rawLift = (a: Acc): number => (a.n ? 2 ** (a.sum / a.n) : 1)

export function analyzeTiming(samples: TimingSample[], now = Date.now()): BestTime {
  const posts = samples
    .map(([at, views]) => ({ t: Date.parse(at), views }))
    .filter((p) => Number.isFinite(p.t) && p.t <= now - SETTLE_MS && Number.isFinite(p.views) && p.views >= 0)
    .sort((a, b) => a.t - b.t)

  const blocks: Acc[] = Array.from({ length: BLOCKS }, () => ({ sum: 0, n: 0 }))
  const days: Acc[] = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }))
  const cells: Acc[][] = Array.from({ length: 7 }, () => Array.from({ length: BLOCKS }, () => ({ sum: 0, n: 0 })))

  posts.forEach((p, i) => {
    const from = Math.max(0, Math.min(i - NEIGHBOURS / 2, posts.length - NEIGHBOURS - 1))
    const around = posts.slice(from, from + NEIGHBOURS + 1).filter((_, j) => from + j !== i).map((x) => x.views)
    const typical = around.length ? median(around) : p.views
    // +1 keeps zero-view posts finite; clamp to ±3 (8x) so one viral post can't dominate.
    const score = Math.max(-3, Math.min(3, Math.log2((p.views + 1) / (typical + 1))))
    const d = new Date(p.t)
    const b = Math.floor(d.getHours() / BLOCK_HOURS)
    for (const a of [blocks[b], days[d.getDay()], cells[d.getDay()][b]]) {
      a.sum += score
      a.n++
    }
  })

  const blockOut = blocks.map((a, i) => ({ start: i * BLOCK_HOURS, n: a.n, lift: rawLift(a), shrunk: lift(a) }))
  const dayOut = days.map((a, i) => ({ day: i, n: a.n, lift: rawLift(a), shrunk: lift(a) }))
  const enough = posts.length >= MIN_SAMPLES
  const pick = <T extends { n: number; shrunk: number }>(xs: T[], k: number) =>
    enough ? xs.filter((x) => x.n >= 2 && x.shrunk > 1.08).sort((a, b) => b.shrunk - a.shrunk).slice(0, k) : []
  const strip = <T extends { shrunk: number }>({ shrunk: _s, ...rest }: T) => rest
  const worst = enough ? blockOut.filter((x) => x.n >= 2 && x.shrunk < 0.92).sort((a, b) => a.shrunk - b.shrunk)[0] : undefined

  return {
    n: posts.length,
    blocks: blockOut.map(strip),
    days: dayOut.map(strip),
    cells: cells.map((row) => row.map((a) => ({ n: a.n, lift: rawLift(a) }))),
    bestBlocks: pick(blockOut, 3).map(strip),
    bestDays: pick(dayOut, 2).map(strip),
    worstBlock: worst && strip(worst)
  }
}

/** Default posting times from the best windows, e.g. ["12:00", "18:00"]. */
export function suggestedTimes(best: BestTime): string[] {
  return best.bestBlocks.map((b) => `${String(b.start).padStart(2, '0')}:00`).sort()
}

export function blockLabel(start: number): string {
  const fmt = (h: number) => {
    const hh = h % 24
    const ampm = hh < 12 ? 'AM' : 'PM'
    const h12 = hh % 12 === 0 ? 12 : hh % 12
    return { h12, ampm }
  }
  const a = fmt(start)
  const b = fmt(start + BLOCK_HOURS)
  return a.ampm === b.ampm ? `${a.h12}–${b.h12} ${b.ampm}` : `${a.h12} ${a.ampm}–${b.h12} ${b.ampm}`
}
