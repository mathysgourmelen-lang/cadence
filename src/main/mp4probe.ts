// Minimal, dependency-free MP4 / MOV reader. It reads only the box headers and the
// moov atom, so probing a 2 GB file is instant. It extracts what we need to validate
// a video for Instagram Reels and YouTube Shorts.

import { open, stat } from 'node:fs/promises'
import type { MediaInfo } from '../shared/types'

interface Box {
  type: string
  start: number // offset of the box header within its buffer/file
  headerSize: number
  size: number // total size including header
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'mvex'])

export class ProbeError extends Error {}

function readBoxes(buf: Buffer, start: number, end: number): Box[] {
  const boxes: Box[] = []
  let off = start
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off)
    const type = buf.toString('latin1', off + 4, off + 8)
    let headerSize = 8
    if (size === 1) {
      if (off + 16 > end) break
      size = Number(buf.readBigUInt64BE(off + 8))
      headerSize = 16
    } else if (size === 0) {
      size = end - off
    }
    if (size < headerSize || off + size > end) break
    boxes.push({ type, start: off, headerSize, size })
    off += size
  }
  return boxes
}

function child(buf: Buffer, parent: Box, type: string): Box | undefined {
  return readBoxes(buf, parent.start + parent.headerSize, parent.start + parent.size).find((b) => b.type === type)
}

function children(buf: Buffer, parent: Box, type: string): Box[] {
  return readBoxes(buf, parent.start + parent.headerSize, parent.start + parent.size).filter((b) => b.type === type)
}

function path(buf: Buffer, parent: Box, ...types: string[]): Box | undefined {
  let cur: Box | undefined = parent
  for (const t of types) {
    if (!cur) return undefined
    cur = child(buf, cur, t)
  }
  return cur
}

interface TrackInfo {
  trackId: number
  handler: string
  width: number
  height: number
  rotation: 0 | 90 | 180 | 270
  timescale: number
  duration: number
  codec: string | null
  sampleCount: number
  sttsDuration: number
  sampleRate: number | null
  channels: number | null
  hasEditList: boolean
}

function parseTrack(buf: Buffer, trak: Box): TrackInfo {
  const info: TrackInfo = {
    trackId: 0,
    handler: '',
    width: 0,
    height: 0,
    rotation: 0,
    timescale: 0,
    duration: 0,
    codec: null,
    sampleCount: 0,
    sttsDuration: 0,
    sampleRate: null,
    channels: null,
    hasEditList: false
  }

  const tkhd = child(buf, trak, 'tkhd')
  if (tkhd) {
    const p = tkhd.start + tkhd.headerSize
    const version = buf.readUInt8(p)
    info.trackId = buf.readUInt32BE(p + 4 + (version === 1 ? 16 : 8))
    // version/flags(4) + times/ids: v1 = 8+8+4+4+8 = 32, v0 = 4+4+4+4+4 = 20
    let q = p + 4 + (version === 1 ? 32 : 20)
    q += 8 + 2 + 2 + 2 + 2 // reserved, layer, alternate group, volume, reserved
    const a = buf.readInt32BE(q) / 65536
    const b = buf.readInt32BE(q + 4) / 65536
    q += 36 // matrix
    info.width = Math.round(buf.readUInt32BE(q) / 65536)
    info.height = Math.round(buf.readUInt32BE(q + 4) / 65536)
    let deg = Math.round((Math.atan2(b, a) * 180) / Math.PI)
    deg = ((deg % 360) + 360) % 360
    const snapped = (Math.round(deg / 90) * 90) % 360
    info.rotation = snapped as 0 | 90 | 180 | 270
  }

  const elst = path(buf, trak, 'edts', 'elst')
  if (elst) {
    const p = elst.start + elst.headerSize
    const version = buf.readUInt8(p)
    const count = buf.readUInt32BE(p + 4)
    let firstMediaTime = 0
    if (count > 0) {
      const e = p + 8
      firstMediaTime = version === 1 ? Number(buf.readBigInt64BE(e + 8)) : buf.readInt32BE(e + 4)
    }
    info.hasEditList = count > 1 || firstMediaTime === -1
  }

  const mdia = child(buf, trak, 'mdia')
  if (!mdia) return info

  const mdhd = child(buf, mdia, 'mdhd')
  if (mdhd) {
    const p = mdhd.start + mdhd.headerSize
    const version = buf.readUInt8(p)
    if (version === 1) {
      info.timescale = buf.readUInt32BE(p + 4 + 16)
      info.duration = Number(buf.readBigUInt64BE(p + 4 + 20))
    } else {
      info.timescale = buf.readUInt32BE(p + 4 + 8)
      info.duration = buf.readUInt32BE(p + 4 + 12)
    }
  }

  const hdlr = child(buf, mdia, 'hdlr')
  if (hdlr) info.handler = buf.toString('latin1', hdlr.start + hdlr.headerSize + 8, hdlr.start + hdlr.headerSize + 12)

  const stbl = path(buf, mdia, 'minf', 'stbl')
  if (!stbl) return info

  const stts = child(buf, stbl, 'stts')
  if (stts) {
    const p = stts.start + stts.headerSize
    const count = buf.readUInt32BE(p + 4)
    let samples = 0
    let dur = 0
    for (let i = 0; i < count; i++) {
      const e = p + 8 + i * 8
      if (e + 8 > stts.start + stts.size) break
      const c = buf.readUInt32BE(e)
      const d = buf.readUInt32BE(e + 4)
      samples += c
      dur += c * d
    }
    info.sampleCount = samples
    info.sttsDuration = dur
  }

  const stsd = child(buf, stbl, 'stsd')
  if (stsd) {
    const p = stsd.start + stsd.headerSize + 8 // version/flags + entry_count
    const entries = readBoxes(buf, p, stsd.start + stsd.size)
    const entry = entries[0]
    if (entry) {
      info.codec = entry.type
      const e = entry.start + entry.headerSize + 8 // reserved(6) + data_reference_index(2)
      if (info.handler === 'vide') {
        if (!info.width || !info.height) {
          info.width = buf.readUInt16BE(e + 16)
          info.height = buf.readUInt16BE(e + 18)
        }
      } else if (info.handler === 'soun') {
        const version = buf.readUInt16BE(e)
        let childStart = e + 20
        if (version === 2) {
          // QuickTime SoundDescription v2: rate is a float64, channels uint32
          info.sampleRate = Math.round(buf.readDoubleBE(e + 24))
          info.channels = buf.readUInt32BE(e + 32)
          childStart = e + 56
        } else {
          info.channels = buf.readUInt16BE(e + 8)
          info.sampleRate = buf.readUInt32BE(e + 16) >>> 16
          if (version === 1) childStart = e + 36
        }
        if (entry.type === 'mp4a') {
          const esds = readBoxes(buf, childStart, entry.start + entry.size).find((b) => b.type === 'esds')
          const oti = esds ? readObjectType(buf, esds) : null
          if (oti === 0x69 || oti === 0x6b) info.codec = 'mp3 '
        }
      }
    }
  }
  return info
}

/** Reads objectTypeIndication from an esds box (0x40 = AAC, 0x6B/0x69 = MP3). */
function readObjectType(buf: Buffer, esds: Box): number | null {
  const end = esds.start + esds.size
  let p = esds.start + esds.headerSize + 4
  const readLen = (): number => {
    let len = 0
    for (let i = 0; i < 4 && p < end; i++) {
      const byte = buf.readUInt8(p++)
      len = (len << 7) | (byte & 0x7f)
      if (!(byte & 0x80)) break
    }
    return len
  }
  if (p >= end || buf.readUInt8(p++) !== 0x03) return null
  readLen()
  p += 2 // ES_ID
  const flags = buf.readUInt8(p++)
  if (flags & 0x80) p += 2
  if (flags & 0x40) p += 1 + buf.readUInt8(p)
  if (flags & 0x20) p += 2
  if (p >= end || buf.readUInt8(p++) !== 0x04) return null
  readLen()
  return p < end ? buf.readUInt8(p) : null
}

export async function probeMp4(filePath: string): Promise<MediaInfo> {
  const st = await stat(filePath)
  const fileSize = st.size
  const fh = await open(filePath, 'r')
  try {
    const header = Buffer.alloc(16)
    let off = 0
    let moovOff = -1
    let moovSize = 0
    let firstMdat = -1
    let brand = ''
    let hasMoof = false
    const moofs: { off: number; size: number }[] = []
    let guard = 0
    while (off + 8 <= fileSize && guard++ < 100000) {
      const { bytesRead } = await fh.read(header, 0, 16, off)
      if (bytesRead < 8) break
      let size = header.readUInt32BE(0)
      const type = header.toString('latin1', 4, 8)
      if (size === 1) {
        if (bytesRead < 16) break
        size = Number(header.readBigUInt64BE(8))
      } else if (size === 0) size = fileSize - off
      if (size < 8) throw new ProbeError('This file is damaged or is not an MP4/MOV video.')
      if (type === 'ftyp') {
        const b = Buffer.alloc(4)
        await fh.read(b, 0, 4, off + 8)
        brand = b.toString('latin1')
      } else if (type === 'moov') {
        moovOff = off
        moovSize = size
      } else if (type === 'mdat' && firstMdat < 0) firstMdat = off
      else if (type === 'moof') {
        hasMoof = true
        if (moofs.length < 50000 && size < 16 * 1024 * 1024) moofs.push({ off, size })
      }
      if (off === 0 && !/^[\x20-\x7e]{4}$/.test(type)) throw new ProbeError('This is not an MP4/MOV video file.')
      off += size
    }
    if (moovOff < 0) throw new ProbeError('This file has no video index (moov atom). It may be incomplete or still being exported.')
    if (moovSize > 512 * 1024 * 1024) throw new ProbeError('The video index is unexpectedly large.')

    const moov = Buffer.alloc(moovSize)
    await fh.read(moov, 0, moovSize, moovOff)
    const root: Box = { type: 'moov', start: 0, headerSize: moov.readUInt32BE(0) === 1 ? 16 : 8, size: moovSize }

    let movieDuration = 0
    const mvhd = child(moov, root, 'mvhd')
    if (mvhd) {
      const p = mvhd.start + mvhd.headerSize
      const version = moov.readUInt8(p)
      const timescale = version === 1 ? moov.readUInt32BE(p + 20) : moov.readUInt32BE(p + 12)
      const duration = version === 1 ? Number(moov.readBigUInt64BE(p + 24)) : moov.readUInt32BE(p + 16)
      if (timescale > 0) movieDuration = duration / timescale
    }
    const tracks = children(moov, root, 'trak').map((t) => parseTrack(moov, t))
    const video = tracks.find((t) => t.handler === 'vide')
    const audio = tracks.find((t) => t.handler === 'soun')

    let durationSec = movieDuration
    if (!durationSec && video && video.timescale) durationSec = (video.duration || video.sttsDuration) / video.timescale

    // Fragmented MP4s keep sample timing in the moof boxes instead of the moov.
    if (video && video.timescale && video.sampleCount === 0 && moofs.length) {
      const trex = readTrexDefault(moov, root, video.trackId)
      let samples = 0
      let dur = 0
      for (const mf of moofs) {
        const b = Buffer.alloc(mf.size)
        await fh.read(b, 0, mf.size, mf.off)
        const r = sumFragment(b, video.trackId, trex)
        samples += r.samples
        dur += r.duration
      }
      video.sampleCount = samples
      video.sttsDuration = dur
      if (!durationSec && dur) durationSec = dur / video.timescale
    }

    let fps: number | null = null
    if (video && video.timescale && video.sampleCount > 1 && video.sttsDuration > 0) {
      fps = video.sampleCount / (video.sttsDuration / video.timescale)
    }

    const rotation = video?.rotation ?? 0
    const swap = rotation === 90 || rotation === 270
    const width = video ? (swap ? video.height : video.width) : 0
    const height = video ? (swap ? video.width : video.height) : 0

    return {
      brand,
      isQuickTime: brand === 'qt  ',
      durationSec,
      width,
      height,
      rotation,
      videoCodec: video?.codec ?? null,
      audioCodec: audio?.codec ?? null,
      audioSampleRate: audio?.sampleRate ?? null,
      audioChannels: audio?.channels ?? null,
      fps,
      bitrate: durationSec > 0 ? Math.round((fileSize * 8) / durationSec) : 0,
      fastStart: firstMdat < 0 || moovOff < firstMdat,
      hasEditList: video?.hasEditList ?? false,
      isFragmented: hasMoof || !!child(moov, root, 'mvex'),
      sizeBytes: fileSize
    }
  } finally {
    await fh.close()
  }
}

function readTrexDefault(buf: Buffer, root: Box, trackId: number): number {
  const mvex = child(buf, root, 'mvex')
  if (!mvex) return 0
  for (const trex of children(buf, mvex, 'trex')) {
    const p = trex.start + trex.headerSize
    if (buf.readUInt32BE(p + 4) === trackId) return buf.readUInt32BE(p + 12)
  }
  return 0
}

/** Sums sample count and duration for one track inside a moof box. */
function sumFragment(buf: Buffer, trackId: number, trexDuration: number): { samples: number; duration: number } {
  const moof: Box = { type: 'moof', start: 0, headerSize: buf.readUInt32BE(0) === 1 ? 16 : 8, size: buf.length }
  let samples = 0
  let duration = 0
  for (const traf of children(buf, moof, 'traf')) {
    const tfhd = child(buf, traf, 'tfhd')
    if (!tfhd) continue
    let p = tfhd.start + tfhd.headerSize
    const flags = buf.readUInt32BE(p) & 0xffffff
    if (buf.readUInt32BE(p + 4) !== trackId) continue
    p += 8
    if (flags & 0x01) p += 8
    if (flags & 0x02) p += 4
    const defaultDuration = flags & 0x08 ? buf.readUInt32BE(p) : trexDuration
    for (const trun of children(buf, traf, 'trun')) {
      let q = trun.start + trun.headerSize
      const tf = buf.readUInt32BE(q) & 0xffffff
      const count = buf.readUInt32BE(q + 4)
      q += 8
      if (tf & 0x01) q += 4
      if (tf & 0x04) q += 4
      const per = (tf & 0x100 ? 4 : 0) + (tf & 0x200 ? 4 : 0) + (tf & 0x400 ? 4 : 0) + (tf & 0x800 ? 4 : 0)
      samples += count
      if (tf & 0x100) {
        for (let i = 0; i < count && q + 4 <= trun.start + trun.size; i++, q += per) duration += buf.readUInt32BE(q)
      } else duration += count * defaultDuration
    }
  }
  return { samples, duration }
}
