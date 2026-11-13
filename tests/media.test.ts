import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importVideo, serveLibraryFile, cleanLibrary } from '../src/main/media'
import { hasFfmpeg, makeFixtures } from './fixtures'

const lib = mkdtempSync(join(tmpdir(), 'cadence-lib-'))
const data = Buffer.from(Array.from({ length: 1000 }, (_, i) => i & 0xff))
writeFileSync(join(lib, 'abc.mp4'), data)

describe('serveLibraryFile', () => {
  it('serves whole files and byte ranges', async () => {
    const full = await serveLibraryFile(lib, new Request('cadence-media://lib/abc.mp4'))
    expect(full.status).toBe(200)
    expect(full.headers.get('content-type')).toBe('video/mp4')
    expect(Buffer.from(await full.arrayBuffer()).equals(data)).toBe(true)

    const part = await serveLibraryFile(lib, new Request('cadence-media://lib/abc.mp4', { headers: { Range: 'bytes=10-19' } }))
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 10-19/1000')
    expect(Buffer.from(await part.arrayBuffer()).equals(data.subarray(10, 20))).toBe(true)

    const open = await serveLibraryFile(lib, new Request('cadence-media://lib/abc.mp4', { headers: { Range: 'bytes=990-' } }))
    expect((await open.arrayBuffer()).byteLength).toBe(10)
    const suffix = await serveLibraryFile(lib, new Request('cadence-media://lib/abc.mp4', { headers: { Range: 'bytes=-5' } }))
    expect(suffix.headers.get('content-range')).toBe('bytes 995-999/1000')
    const bad = await serveLibraryFile(lib, new Request('cadence-media://lib/abc.mp4', { headers: { Range: 'bytes=5000-' } }))
    expect(bad.status).toBe(416)
  })

  it('refuses anything outside the library', async () => {
    for (const u of ['cadence-media://lib/..%2F..%2Fetc%2Fpasswd', 'cadence-media://lib/%2Fetc%2Fpasswd', 'cadence-media://lib/.hidden', 'cadence-media://lib/a%2Fb.mp4']) {
      const r = await serveLibraryFile(lib, new Request(u))
      expect(r.status).toBe(403)
    }
    expect((await serveLibraryFile(lib, new Request('cadence-media://lib/missing.mp4'))).status).toBe(404)
  })
})

;(hasFfmpeg() ? describe : describe.skip)('importVideo', () => {
  it('copies a valid video into the library and probes it', async () => {
    const f = makeFixtures()
    const r = await importVideo(lib, f.vertical)
    expect(r.ok).toBe(true)
    expect(existsSync(r.video!.libraryPath)).toBe(true)
    expect(readFileSync(r.video!.libraryPath).equals(readFileSync(f.vertical))).toBe(true)
    expect(r.video!.media.height).toBe(1920)
  }, 60_000)

  it('rejects other file types and broken files with a clear message', async () => {
    const f = makeFixtures()
    expect((await importVideo(lib, '/tmp/photo.jpg')).error).toMatch(/not an MP4/)
    const r = await importVideo(lib, f.notVideo)
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  }, 60_000)

  it('cleans unreferenced files only', async () => {
    writeFileSync(join(lib, 'orphan.mp4'), 'x')
    const removed = await cleanLibrary(lib, [], 0)
    expect(removed).toBeGreaterThan(0)
    expect(existsSync(join(lib, 'orphan.mp4'))).toBe(false)
  })
})
