import { describe, expect, it } from 'vitest'
import { analyzeTiming, blockLabel, suggestedTimes } from '../src/shared/bestTime'
import type { TimingSample } from '../src/shared/types'

const now = new Date(2026, 10, 14, 12).getTime()
/** A local time n days ago at hour h. */
const at = (daysAgo: number, h: number) => new Date(2026, 10, 14 - daysAgo, h, 15).toISOString()

describe('best time to post', () => {
  it('finds the evening window when evening posts beat their neighbours', () => {
    const s: TimingSample[] = []
    for (let d = 3; d < 60; d += 2) {
      // The account grows over time; evening posts do 3x the morning ones posted around them.
      const base = 1000 + (60 - d) * 200
      s.push([at(d, 19), base * 3])
      s.push([at(d + 1, 9), base])
    }
    const r = analyzeTiming(s, now)
    expect(r.bestBlocks[0].start).toBe(18)
    expect(r.bestBlocks[0].lift).toBeGreaterThan(1.5)
    expect(r.worstBlock?.start).toBe(9)
    expect(suggestedTimes(r)).toEqual(['18:00'])
  })

  it('ignores posts younger than 2 days and needs enough data', () => {
    const r = analyzeTiming([[at(0, 19), 100], [at(1, 19), 100], [at(5, 9), 10]], now)
    expect(r.n).toBe(1)
    expect(r.bestBlocks).toEqual([])
  })

  it('does not call a winner when everything performs the same', () => {
    const s: TimingSample[] = []
    for (let d = 3; d < 40; d++) s.push([at(d, (d * 5) % 24), 1000])
    const r = analyzeTiming(s, now)
    expect(r.bestBlocks).toEqual([])
    expect(r.worstBlock).toBeUndefined()
  })

  it('labels windows in 12-hour time', () => {
    expect(blockLabel(18)).toBe('6–9 PM')
    expect(blockLabel(9)).toBe('9 AM–12 PM')
    expect(blockLabel(21)).toBe('9 PM–12 AM')
    expect(blockLabel(0)).toBe('12–3 AM')
  })
})
