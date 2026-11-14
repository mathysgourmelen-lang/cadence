import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { analyzeLength, lengthLabel, shortLengthLabel, type LengthSample } from '../src/shared/videoLength'
import { remoteMp4Duration } from '../src/main/remotemp4'

const NOW = Date.parse('2026-11-14T12:00:00Z')

function samples(): LengthSample[] {
  // 40 posts, steadily growing account; 15-20s videos do 2x, 45-60s do half.
  const lengths = [8, 12, 17, 25, 50]
  return Array.from({ length: 40 }, (_, i) => {
    const d = lengths[i % lengths.length]
    const base = 1000 * (1 + i / 10)
    const f = d === 17 ? 2 : d === 50 ? 0.5 : 1
    return { publishedAt: new Date(NOW - (45 - i) * 86400_000).toISOString(), durationSec: d, views: Math.round(base * f), watchedPct: d === 8 ? 110 : 100 - d }
  })
}

describe('analyzeLength', () => {
  it('finds the sweet spot, the most watched band and the weakest', () => {
    const a = analyzeLength(samples(), NOW)
    expect(a.n).toBe(40)
    expect(a.bands.map(shortLengthLabel)).toEqual(['<10s', '10–15s', '15–20s', '20–30s', '30–45s', '45–60s'])
    expect(a.best && lengthLabel(a.best)).toBe('15–20s')
    expect(a.best!.lift!).toBeGreaterThan(1.6)
    expect(a.worst && lengthLabel(a.worst)).toBe('45–60s')
    expect(a.mostWatched && lengthLabel(a.mostWatched)).toBe('under 10s')
    expect(a.bands[4]).toMatchObject({ n: 0, lift: null, watchedPct: null })
  })

  it('says nothing with too few posts and ignores fresh ones', () => {
    const fresh = samples().map((s) => ({ ...s, publishedAt: new Date(NOW - 3600_000).toISOString() }))
    const a = analyzeLength(fresh, NOW)
    expect(a.n).toBe(0)
    expect(a.best).toBeUndefined()
    expect(analyzeLength(samples().slice(0, 5), NOW).best).toBeUndefined()
  })

  it('labels bands', () => {
    expect(lengthLabel({ from: 60, to: 90 })).toBe('60–90s')
    expect(lengthLabel({ from: 90, to: 180 })).toBe('90s–3 min')
    expect(lengthLabel({ from: 180, to: Infinity })).toBe('3 min+')
    expect(shortLengthLabel({ from: 90, to: 180 })).toBe('90s–3m')
    expect(shortLengthLabel({ from: 180, to: Infinity })).toBe('3m+')
  })
})

// A tiny MP4: ftyp, a big mdat, then moov with an mvhd of 27.5 s (timescale 1000).
function mp4(): Buffer {
  const box = (type: string, body: Buffer) => {
    const h = Buffer.alloc(8)
    h.writeUInt32BE(8 + body.length)
    h.write(type, 4, 'latin1')
    return Buffer.concat([h, body])
  }
  const mvhd = Buffer.alloc(100)
  mvhd.writeUInt32BE(1000, 12)
  mvhd.writeUInt32BE(27_500, 16)
  return Buffer.concat([box('ftyp', Buffer.from('isom0000isom')), box('mdat', Buffer.alloc(200_000)), box('moov', box('mvhd', mvhd))])
}

describe('remoteMp4Duration', () => {
  const file = mp4()
  let server: Server
  let base = ''
  let bytesSent = 0
  let honourRange = true
  beforeAll(async () => {
    server = createServer((req, res) => {
      const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? '')
      if (!m || !honourRange) {
        bytesSent += file.length
        return res.writeHead(200, { 'Content-Length': file.length }).end(file)
      }
      const part = file.subarray(Number(m[1]), Number(m[2]) + 1)
      bytesSent += part.length
      res.writeHead(206, { 'Content-Length': part.length }).end(part)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v.mp4`
  })
  afterAll(() => server.close())

  it('reads the length without downloading the video', async () => {
    bytesSent = 0
    expect(await remoteMp4Duration(base)).toBe(27.5)
    expect(bytesSent).toBeLessThan(500)
  })

  it('still works when the server ignores ranges', async () => {
    honourRange = false
    expect(await remoteMp4Duration(base)).toBe(27.5)
    honourRange = true
  })
})
