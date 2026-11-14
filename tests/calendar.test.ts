import { describe, expect, it } from 'vitest'
import { calendarItems, cadencePostTime } from '../src/shared/calendar'

const target = (state: string, extra: any = {}) => ({ enabled: true, state, attempts: 0, log: [], ...extra })
const post = (id: string, scheduledAt: string | null, ig: any, yt: any = { enabled: false, state: 'draft', attempts: 0, log: [] }) =>
  ({ id, scheduledAt, video: { fileName: 'a.mp4' }, instagram: ig, youtube: yt }) as any

const stat = (id: string, publishedAt: string, extra: any = {}) => ({ id, title: id, publishedAt, views: 10, ...extra })

describe('Calendar', () => {
  it('places "Post now" posts on the day they went out', () => {
    const p = post('p1', null, target('published', { publishedAt: '2026-11-03T10:00:00.000Z' }))
    expect(cadencePostTime(p)).toBe('2026-11-03T10:00:00.000Z')
    expect(calendarItems([p]).map((i) => i.at)).toEqual(['2026-11-03T10:00:00.000Z'])
  })

  it('leaves out drafts and canceled posts', () => {
    const draft = post('d', null, target('draft'))
    const canceled = post('c', '2026-11-05T10:00:00.000Z', target('canceled'))
    expect(calendarItems([draft, canceled])).toEqual([])
  })

  it('adds posts made in the apps, once, and skips the ones Cadence made', () => {
    const mine = post('p1', '2026-11-02T09:00:00.000Z', target('published', { mediaId: 'IG1' }), target('published', { videoId: 'YT1' }))
    const insights: any = {
      accounts: {
        'instagram:17841': { platform: 'instagram', recent: [stat('IG1', '2026-11-02T09:00:05+0000'), stat('IG2', '2026-11-04T18:30:00+0000')], top: [stat('IG2', '2026-11-04T18:30:00+0000')] },
        'youtube:UC1': { platform: 'youtube', recent: [stat('YT1', '2026-11-02T09:00:00Z'), stat('YT2', '2026-11-06T12:00:00Z')], top: [] }
      }
    }
    const analytics: any = { instagram: { '17841': { reels: [stat('IG3', '2026-11-08T12:00:00+0000'), stat('IG2', '2026-11-04T18:30:00+0000')] } }, youtube: {} }
    const items = calendarItems([mine], insights, analytics)
    expect(items.map((i) => (i.kind === 'cadence' ? i.post.id : i.item.key))).toEqual(['p1', 'instagram:IG2', 'youtube:YT2', 'instagram:IG3'])
    const ig2 = items[1]
    expect(ig2.kind === 'outside' && ig2.item.accountId).toBe('17841')
    expect(ig2.at).toBe('2026-11-04T18:30:00.000Z')
  })
})
