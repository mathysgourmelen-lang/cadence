import type { AccountsState, Platform } from '../../shared/types'
export function cx(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(' ')
}

export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function dayLabel(d: Date, now = new Date()): string {
  if (sameDay(d, now)) return 'Today'
  if (sameDay(d, addDays(now, 1))) return 'Tomorrow'
  if (sameDay(d, addDays(now, -1))) return 'Yesterday'
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

export function timeLabel(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function shortDateTime(d: Date, now = new Date()): string {
  const day = dayLabel(d, now)
  return `${day.length > 12 ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : day}, ${timeLabel(d)}`
}

export function relative(target: number, now = Date.now()): string {
  const diff = target - now
  const abs = Math.abs(diff)
  const min = Math.round(abs / 60000)
  let s: string
  if (min < 1) s = 'less than a minute'
  else if (min < 60) s = `${min} min`
  else if (min < 60 * 24) {
    const h = Math.floor(min / 60)
    const m = min % 60
    s = m ? `${h}h ${m}m` : `${h}h`
  } else {
    const d = Math.floor(min / 1440)
    const h = Math.round((min % 1440) / 60)
    s = h ? `${d}d ${h}h` : `${d}d`
  }
  return diff >= 0 ? `in ${s}` : `${s} ago`
}

/** "18:00" + date -> Date */
export function atTime(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(day)
  d.setHours(h || 0, m || 0, 0, 0)
  return d
}

export function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function formatHHMM(v: string): string {
  return timeLabel(atTime(new Date(), v))
}

export function timezoneName(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const short = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value
    return short ? `${tz.replace(/_/g, ' ')} (${short})` : tz
  } catch {
    return 'local time'
  }
}

export function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/** Grabs a JPEG frame from a video URL. */
export function captureFrame(src: string, atSec: number, width = 360): Promise<string> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'auto'
    v.playsInline = true
    v.crossOrigin = 'anonymous'
    v.src = src
    const fail = () => reject(new Error('Could not read a frame from the video.'))
    const timer = setTimeout(fail, 15000)
    v.addEventListener('error', () => {
      clearTimeout(timer)
      fail()
    })
    v.addEventListener('loadedmetadata', () => {
      v.currentTime = Math.min(Math.max(0, atSec), Math.max(0, v.duration - 0.1))
    })
    v.addEventListener('seeked', () => {
      try {
        const ratio = v.videoHeight / v.videoWidth || 16 / 9
        const c = document.createElement('canvas')
        c.width = width
        c.height = Math.round(width * ratio)
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
        clearTimeout(timer)
        resolve(c.toDataURL('image/jpeg', 0.82))
      } catch (e) {
        clearTimeout(timer)
        reject(e)
      }
      v.removeAttribute('src')
      v.load()
    })
  })
}

export function firstLine(text: string): string {
  return (text.split('\n').find((l) => l.trim()) ?? '').replace(/#[\p{L}\p{N}_]+/gu, '').trim()
}

export function parseTags(s: string): string[] {
  return s
    .split(',')
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean)
}

/** "@name" or the channel title for a post's account; '' when it can't be found. */
export function accountLabel(accounts: AccountsState, platform: Platform, id: string | undefined): string {
  if (platform === 'instagram') {
    const a = accounts.instagram.find((x) => x.id === id)
    return a ? `@${a.username}` : ''
  }
  return accounts.youtube.find((x) => x.id === id)?.channelTitle ?? ''
}
