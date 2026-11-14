// Reads the length of an online MP4 (e.g. an Instagram reel's media_url) without
// downloading the video: only the box headers and the "moov" index are fetched,
// with HTTP range requests.

const MAX_MOOV = 8 * 1024 * 1024
/** When a server ignores range requests the whole file comes back; cap it. */
const MAX_FULL = 80 * 1024 * 1024

type Fetch = typeof fetch

async function range(f: Fetch, url: string, start: number, len: number, signal?: AbortSignal): Promise<{ buf: Buffer; full: boolean }> {
  const res = await f(url, { headers: { Range: `bytes=${start}-${start + len - 1}` }, signal })
  if (res.status !== 206 && res.status !== 200) throw new Error(`HTTP ${res.status}`)
  if (res.status === 200) {
    const size = Number(res.headers.get('content-length') ?? 0)
    if (size > MAX_FULL) {
      await res.body?.cancel()
      throw new Error('File too large to read without range support')
    }
    return { buf: Buffer.from(await res.arrayBuffer()), full: true }
  }
  return { buf: Buffer.from(await res.arrayBuffer()), full: false }
}

/** Duration in seconds from an mvhd box body (after the 8-byte header). */
export function mvhdDuration(buf: Buffer, at: number): number | null {
  const version = buf.readUInt8(at)
  const timescale = version === 1 ? buf.readUInt32BE(at + 20) : buf.readUInt32BE(at + 12)
  const duration = version === 1 ? Number(buf.readBigUInt64BE(at + 24)) : buf.readUInt32BE(at + 16)
  if (!timescale || !duration) return null
  return duration / timescale
}

/** Finds moov → mvhd inside a buffer that holds the moov box at `start`. */
function durationInMoov(buf: Buffer, start: number, end: number): number | null {
  let p = start + 8
  while (p + 8 <= end) {
    const size = buf.readUInt32BE(p)
    const type = buf.toString('latin1', p + 4, p + 8)
    if (type === 'mvhd') return mvhdDuration(buf, p + 8)
    if (size < 8) break
    p += size
  }
  return null
}

/** Walks the top-level boxes of an in-memory file. */
function durationInFile(buf: Buffer): number | null {
  let p = 0
  while (p + 8 <= buf.length) {
    let size = buf.readUInt32BE(p)
    const type = buf.toString('latin1', p + 4, p + 8)
    if (size === 1 && p + 16 <= buf.length) size = Number(buf.readBigUInt64BE(p + 8))
    if (size === 0) size = buf.length - p
    if (type === 'moov') return durationInMoov(buf, p, Math.min(buf.length, p + size))
    if (size < 8) break
    p += size
  }
  return null
}

export async function remoteMp4Duration(url: string, f: Fetch = fetch, timeoutMs = 15_000): Promise<number | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    let off = 0
    for (let i = 0; i < 24; i++) {
      const head = await range(f, url, off, 16, ctrl.signal)
      if (head.full) return durationInFile(head.buf)
      if (head.buf.length < 8) return null
      let size = head.buf.readUInt32BE(0)
      const type = head.buf.toString('latin1', 4, 8)
      if (size === 1 && head.buf.length >= 16) size = Number(head.buf.readBigUInt64BE(8))
      if (size < 8) return null
      if (type === 'moov') {
        if (size > MAX_MOOV) return null
        const moov = await range(f, url, off, size, ctrl.signal)
        return moov.full ? durationInFile(moov.buf) : durationInMoov(moov.buf, 0, moov.buf.length)
      }
      off += size
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}
