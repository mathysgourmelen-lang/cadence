import { describe, expect, it } from 'vitest'
import type { MediaInfo } from '../src/shared/types'
import {
  aspectLabel,
  charCount,
  countHashtags,
  countMentions,
  tagsLength,
  validateInstagram,
  validateYouTube
} from '../src/shared/validation'

const base: MediaInfo = {
  brand: 'isom',
  isQuickTime: false,
  durationSec: 30,
  width: 1080,
  height: 1920,
  rotation: 0,
  videoCodec: 'avc1',
  audioCodec: 'mp4a',
  audioSampleRate: 48000,
  audioChannels: 2,
  fps: 30,
  bitrate: 8_000_000,
  fastStart: true,
  hasEditList: false,
  isFragmented: false,
  sizeBytes: 30_000_000
}
const m = (o: Partial<MediaInfo>) => ({ ...base, ...o })
const sev = (v: { checks: { id: string; severity: string }[] }, id: string) => v.checks.find((c) => c.id === id)?.severity

describe('Instagram rules', () => {
  it('accepts a perfect reel', () => {
    const v = validateInstagram(base, 'Hello #reels')
    expect(v.canPost).toBe(true)
    expect(v.checks.every((c) => c.severity === 'ok')).toBe(true)
  })
  it('enforces duration 3s–15min', () => {
    expect(validateInstagram(m({ durationSec: 2.5 }), 'x').canPost).toBe(false)
    expect(validateInstagram(m({ durationSec: 3 }), 'x').canPost).toBe(true)
    expect(validateInstagram(m({ durationSec: 900 }), 'x').canPost).toBe(true)
    expect(validateInstagram(m({ durationSec: 901 }), 'x').canPost).toBe(false)
  })
  it('enforces 300 MB', () => {
    expect(validateInstagram(m({ sizeBytes: 300 * 1024 * 1024 + 1 }), 'x').canPost).toBe(false)
  })
  it('warns (not blocks) on non-9:16', () => {
    const v = validateInstagram(m({ width: 1080, height: 1080 }), 'x')
    expect(v.canPost).toBe(true)
    expect(sev(v, 'aspect')).toBe('warn')
  })
  it('blocks width over 1920 and unsupported codecs', () => {
    expect(validateInstagram(m({ width: 3840, height: 2160 }), 'x').canPost).toBe(false)
    expect(validateInstagram(m({ videoCodec: 'vp09' }), 'x').canPost).toBe(false)
    expect(validateInstagram(m({ videoCodec: 'hvc1' }), 'x').canPost).toBe(true)
    expect(validateInstagram(m({ audioCodec: 'mp3 ' }), 'x').canPost).toBe(false)
    expect(validateInstagram(m({ audioCodec: null }), 'x').canPost).toBe(true)
    expect(validateInstagram(m({ audioSampleRate: 96000 }), 'x').canPost).toBe(false)
  })
  it('enforces 23–60 fps with rounding tolerance', () => {
    expect(validateInstagram(m({ fps: 15 }), 'x').canPost).toBe(false)
    expect(validateInstagram(m({ fps: 23.976 }), 'x').canPost).toBe(true)
    expect(validateInstagram(m({ fps: 59.94 }), 'x').canPost).toBe(true)
    expect(validateInstagram(m({ fps: 120 }), 'x').canPost).toBe(false)
  })
  it('warns on moov at end and fragmented files', () => {
    expect(sev(validateInstagram(m({ fastStart: false }), 'x'), 'faststart')).toBe('warn')
    expect(sev(validateInstagram(m({ isFragmented: true }), 'x'), 'fragmented')).toBe('warn')
  })
  it('caption limits: 2200 chars, 30 hashtags, 20 mentions', () => {
    expect(validateInstagram(base, 'a'.repeat(2200)).canPost).toBe(true)
    expect(validateInstagram(base, 'a'.repeat(2201)).canPost).toBe(false)
    const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ')
    expect(validateInstagram(base, tags).canPost).toBe(false)
    const ments = Array.from({ length: 21 }, (_, i) => `@u${i}`).join(' ')
    expect(validateInstagram(base, ments).canPost).toBe(false)
  })
})

describe('YouTube rules', () => {
  it('accepts a vertical short', () => {
    expect(validateYouTube(base, 'Title', 'desc', ['a']).canPost).toBe(true)
  })
  it('warns when it will not be a Short', () => {
    const v = validateYouTube(m({ durationSec: 200 }), 'T', '', [])
    expect(v.canPost).toBe(true)
    expect(sev(v, 'duration')).toBe('warn')
    expect(sev(validateYouTube(m({ width: 1920, height: 1080 }), 'T', '', []), 'aspect')).toBe('warn')
    expect(sev(validateYouTube(m({ width: 1080, height: 1080 }), 'T', '', []), 'aspect')).toBe('ok')
  })
  it('requires a valid title and description', () => {
    expect(validateYouTube(base, '', '', []).canPost).toBe(false)
    expect(validateYouTube(base, 'a'.repeat(101), '', []).canPost).toBe(false)
    expect(validateYouTube(base, 'a <b>', '', []).canPost).toBe(false)
    expect(validateYouTube(base, 'ok', 'x'.repeat(5001), []).canPost).toBe(false)
    expect(validateYouTube(base, 'ok', 'é'.repeat(2501), []).canPost).toBe(false) // 5002 bytes
    expect(validateYouTube(base, 'ok', 'a > b', []).canPost).toBe(false)
  })
  it('counts tags like YouTube', () => {
    expect(tagsLength(['a', 'b c'])).toBe(1 + 5 + 1)
    expect(validateYouTube(base, 'ok', '', ['x'.repeat(501)]).canPost).toBe(false)
  })
})

describe('helpers', () => {
  it('counts graphemes, hashtags, mentions', () => {
    expect(charCount('👍🏽ab')).toBe(3)
    expect(countHashtags('#one two #three a#not https://x.com/#frag')).toBe(2)
    expect(countMentions('hi @max and @x.y, mail me@mail.com')).toBe(2)
  })
  it('labels aspect ratios', () => {
    expect(aspectLabel(1080, 1920)).toBe('9:16')
    expect(aspectLabel(1920, 1080)).toBe('16:9')
    expect(aspectLabel(1080, 1350)).toBe('4:5')
  })
})

import { isUpcoming, postStatus } from '../src/shared/status'
describe('post status', () => {
  const t = (state: string, enabled = true) => ({ enabled, state, attempts: 0, log: [] }) as any
  const post = (ig: any, yt: any) => ({ instagram: ig, youtube: yt }) as any
  it('keeps a post in the queue while one platform is still pending', () => {
    const p = post(t('scheduled'), t('failed'))
    expect(isUpcoming(p)).toBe(true)
    expect(postStatus(p)).toBe('failed')
  })
  it('moves fully finished posts out of the queue', () => {
    expect(isUpcoming(post(t('published'), t('failed')))).toBe(false)
    expect(postStatus(post(t('published'), t('failed')))).toBe('partial')
    expect(isUpcoming(post(t('published'), t('scheduled_remote')))).toBe(true)
    expect(postStatus(post(t('published'), t('x', false)))).toBe('published')
  })
})
