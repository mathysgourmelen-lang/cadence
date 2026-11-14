// Turns a retention curve into the moments worth looking at: where viewers leave
// fastest, and where they rewind to watch again.

import type { RetentionPoint } from './types'

export interface RetentionMoment {
  kind: 'drop' | 'rewatch'
  /** Position in the video where the moment starts, 0-1. */
  from: number
  /** Position where it ends, 0-1. */
  to: number
  /** Share of the audience lost (drop) or gained (rewatch), in points of the curve (0.12 = 12%). */
  change: number
}

/** Value of the curve at a position (0-1), interpolated between points. */
export function watchAt(points: RetentionPoint[], at: number): number | null {
  if (!points.length) return null
  if (at <= points[0].at) return points[0].watch
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (at <= b.at) return a.watch + ((b.watch - a.watch) * (at - a.at)) / (b.at - a.at || 1)
  }
  return points[points.length - 1].watch
}

/**
 * The steepest drops (and the biggest rewatch bump) over windows of about
 * 2 seconds, without overlapping each other.
 */
export function retentionMoments(points: RetentionPoint[], durationSec?: number, maxDrops = 3): RetentionMoment[] {
  if (points.length < 4) return []
  const step = points.length > 1 ? points[1].at - points[0].at : 0.01
  const windowAt = durationSec && durationSec > 0 ? Math.max(step, 2 / durationSec) : 0.04
  const k = Math.max(1, Math.round(windowAt / step))
  const changes = points.slice(k).map((p, j) => ({ from: points[j].at, to: p.at, i: j, d: p.watch - points[j].watch }))

  const pick = (sign: 1 | -1, min: number, max: number): RetentionMoment[] => {
    const out: (typeof changes)[number][] = []
    for (const c of [...changes].sort((a, b) => sign * (b.d - a.d))) {
      if (out.length >= max || sign * c.d < min) break
      if (out.some((o) => Math.abs(o.i - c.i) < k + 2)) continue
      out.push(c)
    }
    return out.map((c) => ({ kind: sign > 0 ? 'rewatch' : 'drop', from: c.from, to: c.to, change: Math.abs(c.d) }))
  }

  // Only drops that stand out: at least 4 points and at least 40% of the steepest one.
  const steepest = Math.max(0, ...changes.map((c) => -c.d))
  const drops = pick(-1, Math.max(0.04, steepest * 0.4), maxDrops)
  // The first moments of a Short often climb as the loop starts again; that isn't a rewatch.
  const rewatch = pick(1, 0.04, 2).filter((m) => m.from >= 0.05).slice(0, 1)
  return [...drops, ...rewatch].sort((a, b) => a.from - b.from)
}
