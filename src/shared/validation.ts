// Pure validation rules for Instagram Reels and YouTube Shorts.
// Sources: Meta "IG User Media" Reels specs and YouTube Data API / Shorts docs.

import type { Check, MediaInfo, PlatformValidation, Severity } from './types'

export const IG_LIMITS = {
  minDurationSec: 3,
  maxDurationSec: 15 * 60,
  maxSizeBytes: 300 * 1024 * 1024,
  maxWidth: 1920,
  minFps: 23,
  maxFps: 60,
  maxAudioSampleRate: 48000,
  maxCaptionChars: 2200,
  maxHashtags: 30,
  maxMentions: 20,
  maxBitrate: 25_000_000
}

export const YT_LIMITS = {
  maxShortDurationSec: 180,
  maxTitleChars: 100,
  maxDescriptionBytes: 5000,
  maxTagsChars: 500,
  maxSizeBytes: 256 * 1024 * 1024 * 1024
}

const IG_VIDEO_CODECS = ['avc1', 'avc3', 'hvc1', 'hev1']
const YT_VIDEO_CODECS = ['avc1', 'avc3', 'hvc1', 'hev1', 'vp09', 'av01', 'mp4v', 'apcn', 'apch', 'apcs', 'apco', 'ap4h']

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`
}

export function formatDuration(sec: number): string {
  const s = Math.round(sec)
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`
}

export function aspectLabel(w: number, h: number): string {
  if (!w || !h) return 'unknown'
  const r = w / h
  const known: [number, string][] = [
    [9 / 16, '9:16'],
    [3 / 4, '3:4'],
    [4 / 5, '4:5'],
    [1, '1:1'],
    [16 / 9, '16:9'],
    [4 / 3, '4:3']
  ]
  for (const [v, label] of known) if (Math.abs(r - v) < 0.012) return label
  return r < 1 ? `${(w / h).toFixed(2)}:1 (vertical)` : `${(w / h).toFixed(2)}:1`
}

/** Hashtags as Instagram counts them: # followed by letters/digits/underscore. */
export function countHashtags(text: string): number {
  return (text.match(/(^|[^\p{L}\p{N}_&/])#[\p{L}\p{N}_]+/gu) || []).length
}

export function countMentions(text: string): number {
  return (text.match(/(^|[^\p{L}\p{N}_./])@[A-Za-z0-9_.]+/gu) || []).length
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

/** Number of user-perceived characters (emoji count as one). */
export function charCount(text: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    let n = 0
    for (const _ of seg.segment(text)) n++
    return n
  }
  return Array.from(text).length
}

function check(id: string, label: string, severity: Severity, detail?: string): Check {
  return { id, label, severity, detail }
}

export function validateInstagram(media: MediaInfo, caption: string): PlatformValidation {
  const checks: Check[] = []
  const d = media.durationSec

  if (d < IG_LIMITS.minDurationSec) checks.push(check('duration', 'Duration', 'error', `${d.toFixed(1)}s is shorter than 3 seconds.`))
  else if (d > IG_LIMITS.maxDurationSec) checks.push(check('duration', 'Duration', 'error', `${formatDuration(d)} is longer than 15 minutes.`))
  else if (d > 90)
    checks.push(check('duration', 'Duration', 'ok', `${formatDuration(d)}. Reels over 90 seconds may not be recommended to non-followers.`))
  else checks.push(check('duration', 'Duration', 'ok', formatDuration(d)))

  if (media.sizeBytes > IG_LIMITS.maxSizeBytes)
    checks.push(check('size', 'File size', 'error', `${formatBytes(media.sizeBytes)} is over the 300 MB limit. Export at a lower bitrate.`))
  else checks.push(check('size', 'File size', 'ok', formatBytes(media.sizeBytes)))

  const ratio = media.width / media.height
  const label = aspectLabel(media.width, media.height)
  if (!media.width || !media.height) checks.push(check('aspect', 'Aspect ratio', 'error', 'Could not read the video size.'))
  else if (ratio < 0.01 || ratio > 10) checks.push(check('aspect', 'Aspect ratio', 'error', `${label} is outside what Instagram accepts.`))
  else if (Math.abs(ratio - 9 / 16) < 0.012) checks.push(check('aspect', 'Aspect ratio', 'ok', `${label}, ${media.width}×${media.height}`))
  else
    checks.push(
      check('aspect', 'Aspect ratio', 'warn', `${label} (${media.width}×${media.height}). Reels display best at 9:16, otherwise Instagram adds bars or crops.`)
    )

  const longSide = Math.max(media.width, media.height)
  if (media.width > IG_LIMITS.maxWidth)
    checks.push(check('resolution', 'Resolution', 'error', `Width is ${media.width}px. Instagram allows at most 1920px wide.`))
  else if (longSide < 960) checks.push(check('resolution', 'Resolution', 'warn', `${media.width}×${media.height} is low. 1080×1920 is recommended.`))
  else checks.push(check('resolution', 'Resolution', 'ok', `${media.width}×${media.height}`))

  if (!media.videoCodec) checks.push(check('vcodec', 'Video codec', 'error', 'No video track found.'))
  else if (!IG_VIDEO_CODECS.includes(media.videoCodec))
    checks.push(check('vcodec', 'Video codec', 'error', `${codecName(media.videoCodec)} is not supported. Export as H.264 or HEVC.`))
  else checks.push(check('vcodec', 'Video codec', 'ok', codecName(media.videoCodec)))

  if (!media.audioCodec) checks.push(check('acodec', 'Audio', 'ok', 'No audio track (silent video).'))
  else if (media.audioCodec !== 'mp4a')
    checks.push(check('acodec', 'Audio', 'error', `${codecName(media.audioCodec)} audio is not supported. Export with AAC audio.`))
  else if ((media.audioSampleRate ?? 0) > IG_LIMITS.maxAudioSampleRate)
    checks.push(check('acodec', 'Audio', 'error', `AAC at ${media.audioSampleRate} Hz. Instagram allows at most 48 kHz.`))
  else if ((media.audioChannels ?? 2) > 2) checks.push(check('acodec', 'Audio', 'error', `${media.audioChannels} channels. Use mono or stereo.`))
  else checks.push(check('acodec', 'Audio', 'ok', `AAC${media.audioSampleRate ? `, ${media.audioSampleRate / 1000} kHz` : ''}`))

  if (media.fps == null) checks.push(check('fps', 'Frame rate', 'warn', 'Could not read the frame rate.'))
  else if (media.fps < IG_LIMITS.minFps - 0.5 || media.fps > IG_LIMITS.maxFps + 0.5)
    checks.push(check('fps', 'Frame rate', 'error', `${media.fps.toFixed(2)} fps. Instagram needs 23 to 60 fps.`))
  else checks.push(check('fps', 'Frame rate', 'ok', `${roundFps(media.fps)} fps`))

  if (media.bitrate > IG_LIMITS.maxBitrate * 1.05)
    checks.push(check('bitrate', 'Bitrate', 'warn', `${(media.bitrate / 1e6).toFixed(1)} Mbps is above the 25 Mbps Instagram recommends. It may be rejected.`))

  if (media.isFragmented) checks.push(check('fragmented', 'File structure', 'warn', 'This is a fragmented MP4. Re-export it as a regular MP4 if Instagram rejects it.'))
  else if (!media.fastStart || media.hasEditList)
    checks.push(
      check(
        'faststart',
        'File structure',
        'warn',
        [!media.fastStart ? 'the index (moov) is at the end of the file' : '', media.hasEditList ? 'the file contains an edit list' : '']
          .filter(Boolean)
          .join(' and ')
          .replace(/^./, (c) => c.toUpperCase()) +
          '. Instagram usually accepts this, but if it fails, export with "Optimize for network use" / Fast Start.'
      )
    )

  checks.push(...validateInstagramCaption(caption))
  return { platform: 'instagram', checks, canPost: !checks.some((c) => c.severity === 'error') }
}

export function validateInstagramCaption(caption: string): Check[] {
  const out: Check[] = []
  const chars = charCount(caption)
  const tags = countHashtags(caption)
  const mentions = countMentions(caption)
  if (chars > IG_LIMITS.maxCaptionChars) out.push(check('caption', 'Caption', 'error', `${chars} characters. The limit is 2,200.`))
  else out.push(check('caption', 'Caption', caption.trim() ? 'ok' : 'warn', caption.trim() ? `${chars} / 2,200 characters` : 'The caption is empty.'))
  if (tags > IG_LIMITS.maxHashtags) out.push(check('hashtags', 'Hashtags', 'error', `${tags} hashtags. Instagram allows at most 30.`))
  if (mentions > IG_LIMITS.maxMentions) out.push(check('mentions', 'Mentions', 'error', `${mentions} @mentions. Instagram allows at most 20.`))
  return out
}

export function validateYouTube(media: MediaInfo, title: string, description: string, tags: string[]): PlatformValidation {
  const checks: Check[] = []
  const d = media.durationSec
  const vertical = media.height >= media.width

  if (d > YT_LIMITS.maxShortDurationSec)
    checks.push(check('duration', 'Shorts length', 'warn', `${formatDuration(d)} is longer than 3 minutes, so YouTube will post it as a regular video, not a Short.`))
  else checks.push(check('duration', 'Shorts length', 'ok', `${formatDuration(d)} (Shorts can be up to 3:00)`))

  if (!media.width || !media.height) checks.push(check('aspect', 'Aspect ratio', 'error', 'Could not read the video size.'))
  else if (!vertical)
    checks.push(check('aspect', 'Aspect ratio', 'warn', `${aspectLabel(media.width, media.height)} is horizontal, so it will be a regular video, not a Short. Use 9:16 or 1:1.`))
  else checks.push(check('aspect', 'Aspect ratio', 'ok', `${aspectLabel(media.width, media.height)}, ${media.width}×${media.height}`))

  if (!media.videoCodec) checks.push(check('vcodec', 'Video codec', 'error', 'No video track found.'))
  else if (!YT_VIDEO_CODECS.includes(media.videoCodec))
    checks.push(check('vcodec', 'Video codec', 'warn', `${codecName(media.videoCodec)} may not be supported. H.264 is safest.`))
  else checks.push(check('vcodec', 'Video codec', 'ok', codecName(media.videoCodec)))

  if (media.sizeBytes > YT_LIMITS.maxSizeBytes) checks.push(check('size', 'File size', 'error', 'Over 256 GB.'))

  checks.push(...validateYouTubeText(title, description, tags))
  return { platform: 'youtube', checks, canPost: !checks.some((c) => c.severity === 'error') }
}

export function validateYouTubeText(title: string, description: string, tags: string[]): Check[] {
  const out: Check[] = []
  const t = title.trim()
  const titleChars = charCount(t)
  if (!t) out.push(check('title', 'Title', 'error', 'YouTube needs a title.'))
  else if (titleChars > YT_LIMITS.maxTitleChars) out.push(check('title', 'Title', 'error', `${titleChars} characters. The limit is 100.`))
  else if (/[<>]/.test(t)) out.push(check('title', 'Title', 'error', 'YouTube does not allow < or > in titles.'))
  else out.push(check('title', 'Title', 'ok', `${titleChars} / 100 characters`))

  const bytes = utf8Bytes(description)
  if (bytes > YT_LIMITS.maxDescriptionBytes) out.push(check('description', 'Description', 'error', `${bytes} bytes. The limit is 5,000 bytes.`))
  else if (/[<>]/.test(description)) out.push(check('description', 'Description', 'error', 'YouTube does not allow < or > in descriptions.'))
  else out.push(check('description', 'Description', 'ok', description ? `${bytes} / 5,000 bytes` : 'Empty (optional)'))

  const tagChars = tagsLength(tags)
  if (tagChars > YT_LIMITS.maxTagsChars) out.push(check('tags', 'Tags', 'error', `Tags total ${tagChars} characters. The limit is 500.`))
  else if (tags.some((x) => /[<>]/.test(x))) out.push(check('tags', 'Tags', 'error', 'Tags cannot contain < or >.'))
  return out
}

/** YouTube counts tags with spaces as if wrapped in quotes, plus commas between tags. */
export function tagsLength(tags: string[]): number {
  const clean = tags.map((t) => t.trim()).filter(Boolean)
  if (!clean.length) return 0
  return clean.reduce((n, t) => n + charCount(t) + (t.includes(' ') ? 2 : 0), 0) + (clean.length - 1)
}

export function codecName(fourcc: string): string {
  const names: Record<string, string> = {
    avc1: 'H.264',
    avc3: 'H.264',
    hvc1: 'HEVC (H.265)',
    hev1: 'HEVC (H.265)',
    vp09: 'VP9',
    av01: 'AV1',
    mp4v: 'MPEG-4 Part 2',
    mp4a: 'AAC',
    'ac-3': 'Dolby AC-3',
    'ec-3': 'Dolby E-AC-3',
    alac: 'Apple Lossless',
    Opus: 'Opus',
    lpcm: 'PCM',
    sowt: 'PCM',
    twos: 'PCM',
    apcn: 'ProRes 422',
    apch: 'ProRes 422 HQ',
    apcs: 'ProRes 422 LT',
    apco: 'ProRes 422 Proxy',
    ap4h: 'ProRes 4444'
  }
  return names[fourcc] ?? fourcc
}

function roundFps(fps: number): string {
  const r = Math.round(fps * 100) / 100
  return Number.isInteger(r) ? String(r) : r.toFixed(2)
}
