// "Best video length": which lengths get you the most views and the most watching.
//
// Views are compared the same way as "best time to post": each post against the
// posts published around it, so a growing account doesn't make newer (often
// longer or shorter) videos look better. Lengths are grouped into bands.

import { neighbourScores, SETTLE_MS } from './bestTime'

export interface LengthSample {
  publishedAt: string
  durationSec: number
  views: number
  /** Average share of the video watched, in percent (over 100 with rewatches). */
  watchedPct: number | null
}

export interface LengthBand {
  /** Seconds, inclusive. */
  from: number
  /** Seconds, exclusive. Infinity for the last band. */
  to: number
  n: number
  /** Views compared with typical (1.5 = 50% more). null with no posts. */
  lift: number | null
  /** Average % watched of the posts in this band that report it. */
  watchedPct: number | null
  /** Middle views of the band, for context. */
  medianViews: number | null
}

export interface LengthAnalysis {
  /** Posts used. */
  n: number
  /** From the shortest to the longest band you've used. */
  bands: LengthBand[]
  /** Band with clearly the most views. */
  best?: LengthBand
  /** Band people watch the largest share of. */
  mostWatched?: LengthBand
  /** Band with clearly the fewest views. */
  worst?: LengthBand
}

export const LENGTH_EDGES = [0, 10, 15, 20, 30, 45, 60, 90, 180]
export const MIN_LENGTH_SAMPLES = 8
const SHRINK = 2

const secOrMin = (s: number, short: boolean) => (s >= 120 && s % 60 === 0 ? `${s / 60}${short ? 'm' : ' min'}` : `${s}s`)

export function lengthLabel(b: { from: number; to: number }): string {
  if (b.from === 0) return `under ${b.to}s`
  if (!Number.isFinite(b.to)) return `${secOrMin(b.from, false)}+`
  if (b.to <= 90) return `${b.from}–${b.to}s`
  return `${secOrMin(b.from, false)}–${secOrMin(b.to, false)}`
}

export function shortLengthLabel(b: { from: number; to: number }): string {
  if (b.from === 0) return `<${b.to}s`
  if (!Number.isFinite(b.to)) return `${secOrMin(b.from, true)}+`
  if (b.to <= 90) return `${b.from}–${b.to}s`
  return `${secOrMin(b.from, true)}–${secOrMin(b.to, true)}`
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function analyzeLength(samples: LengthSample[], now = Date.now()): LengthAnalysis {
  const posts = samples
    .map((s) => ({ ...s, t: Date.parse(s.publishedAt) }))
    .filter((p) => Number.isFinite(p.t) && p.t <= now - SETTLE_MS && p.durationSec > 0 && Number.isFinite(p.views) && p.views >= 0)
    .sort((a, b) => a.t - b.t)
  const scores = neighbourScores(posts)

  const edges = [...LENGTH_EDGES, Infinity]
  const acc = edges.slice(0, -1).map((from, i) => ({ from, to: edges[i + 1], sum: 0, n: 0, watched: [] as number[], views: [] as number[] }))
  posts.forEach((p, i) => {
    const a = acc.find((b) => p.durationSec >= b.from && p.durationSec < b.to)!
    a.sum += scores[i]
    a.n++
    a.views.push(p.views)
    if (p.watchedPct != null && Number.isFinite(p.watchedPct)) a.watched.push(p.watchedPct)
  })

  const used = acc.map((a, i) => (a.n ? i : -1)).filter((i) => i >= 0)
  const slice = used.length ? acc.slice(used[0], used[used.length - 1] + 1) : []
  const scored = slice.map((a) => ({
    band: {
      from: a.from,
      to: a.to,
      n: a.n,
      lift: a.n ? 2 ** (a.sum / a.n) : null,
      watchedPct: a.watched.length ? a.watched.reduce((x, y) => x + y, 0) / a.watched.length : null,
      medianViews: a.views.length ? median(a.views) : null
    } as LengthBand,
    shrunk: a.n ? 2 ** (a.sum / (a.n + SHRINK)) : 1
  }))

  const enough = posts.length >= MIN_LENGTH_SAMPLES
  const ranked = enough ? scored.filter((x) => x.band.n >= 2) : []
  const best = ranked.filter((x) => x.shrunk > 1.08).sort((a, b) => b.shrunk - a.shrunk)[0]
  const worst = ranked.filter((x) => x.shrunk < 0.92).sort((a, b) => a.shrunk - b.shrunk)[0]
  const watched = ranked.filter((x) => x.band.watchedPct != null).sort((a, b) => b.band.watchedPct! - a.band.watchedPct!)
  return {
    n: posts.length,
    bands: scored.map((x) => x.band),
    best: best?.band,
    worst: worst && worst !== best ? worst.band : undefined,
    mostWatched: watched.length >= 2 ? watched[0].band : undefined
  }
}
