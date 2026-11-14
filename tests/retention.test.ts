import { describe, expect, it } from 'vitest'
import { retentionMoments, watchAt } from '../src/shared/retention'
import type { RetentionPoint } from '../src/shared/types'

// 100 points of a 30 s Short: steady decline, a cliff at 40-46%, a rewatch bump at 80%.
const points: RetentionPoint[] = Array.from({ length: 100 }, (_, i) => {
  const at = (i + 1) / 100
  let w = 1 - at * 0.3
  if (at > 0.4) w -= Math.min(0.2, (at - 0.4) * 3.4)
  if (at > 0.8 && at <= 0.86) w += (at - 0.8) * 1.5
  if (at > 0.86) w += 0.09
  return { at, watch: w, relative: 0.5 }
})

describe('retentionMoments', () => {
  it('finds the cliff and the rewatch bump', () => {
    const m = retentionMoments(points, 30)
    const drop = m.find((x) => x.kind === 'drop')!
    expect(drop.from).toBeGreaterThanOrEqual(0.38)
    expect(drop.from).toBeLessThan(0.46)
    expect(drop.change).toBeGreaterThan(0.1)
    const re = m.find((x) => x.kind === 'rewatch')!
    expect(re.from).toBeGreaterThanOrEqual(0.78)
    expect(re.to).toBeLessThanOrEqual(0.88)
    // Sorted by position, no overlapping drops.
    expect(m.map((x) => x.from)).toEqual([...m.map((x) => x.from)].sort((a, b) => a - b))
  })

  it('ignores a smooth curve', () => {
    const smooth = points.map((p) => ({ ...p, watch: 1 - p.at * 0.3 }))
    expect(retentionMoments(smooth, 30)).toEqual([])
  })

  it('interpolates', () => {
    expect(watchAt(points, 0.005)).toBeCloseTo(points[0].watch)
    expect(watchAt(points, 0.105)).toBeCloseTo((points[9].watch + points[10].watch) / 2)
    expect(watchAt([], 0.5)).toBeNull()
  })
})
