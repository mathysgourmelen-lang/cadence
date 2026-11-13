import { beforeAll, describe, expect, it } from 'vitest'
import { probeMp4 } from '../src/main/mp4probe'
import { ffprobe, hasFfmpeg, makeFixtures } from './fixtures'

const run = hasFfmpeg() ? describe : describe.skip

run('probeMp4 (compared against ffprobe)', () => {
  let f: ReturnType<typeof makeFixtures>
  beforeAll(() => {
    f = makeFixtures()
  }, 120_000)

  it('reads a standard 9:16 H.264/AAC file', async () => {
    const m = await probeMp4(f.vertical)
    const ref = ffprobe(f.vertical)
    expect(m.width).toBe(1080)
    expect(m.height).toBe(1920)
    expect(m.videoCodec).toBe('avc1')
    expect(m.audioCodec).toBe('mp4a')
    expect(m.audioSampleRate).toBe(48000)
    expect(m.audioChannels).toBe(2)
    expect(m.fps).toBeCloseTo(30, 1)
    expect(m.durationSec).toBeCloseTo(Number(ref.format.duration), 1)
    expect(m.fastStart).toBe(true)
    expect(m.isFragmented).toBe(false)
    expect(m.rotation).toBe(0)
    expect(m.sizeBytes).toBe(Number(ref.format.size))
  })

  it('detects the moov atom at the end of the file', async () => {
    const m = await probeMp4(f.moovAtEnd)
    expect(m.fastStart).toBe(false)
    expect(m.width).toBe(720)
    expect(m.height).toBe(1280)
  })

  it('applies the rotation matrix (phone videos)', async () => {
    const m = await probeMp4(f.rotated)
    expect([90, 270]).toContain(m.rotation)
    expect(m.width).toBe(1080)
    expect(m.height).toBe(1920)
    expect(m.audioCodec).toBeNull()
  })

  it('reads landscape, 25 fps, 44.1 kHz mono', async () => {
    const m = await probeMp4(f.landscape)
    expect(m.width).toBe(1920)
    expect(m.height).toBe(1080)
    expect(m.fps).toBeCloseTo(25, 1)
    expect(m.audioSampleRate).toBe(44100)
    expect(m.audioChannels).toBe(1)
  })

  it('reads HEVC (hvc1)', async () => {
    const m = await probeMp4(f.hevc)
    expect(m.videoCodec).toBe('hvc1')
  })

  it('reads QuickTime .mov at 60 fps', async () => {
    const m = await probeMp4(f.mov)
    expect(m.isQuickTime).toBe(true)
    expect(m.fps).toBeCloseTo(60, 1)
    expect(m.videoCodec).toBe('avc1')
  })

  it('detects fragmented MP4', async () => {
    const m = await probeMp4(f.fragmented)
    expect(m.isFragmented).toBe(true)
    expect(m.width).toBe(1080)
    expect(m.durationSec).toBeCloseTo(3, 1)
    expect(m.fps).toBeCloseTo(30, 1)
  })

  it('distinguishes MP3 audio inside MP4 from AAC', async () => {
    const m = await probeMp4(f.mp3audio)
    expect(m.audioCodec).toBe('mp3 ')
  })

  it('reads low frame rates', async () => {
    const m = await probeMp4(f.lowFps)
    expect(m.fps).toBeCloseTo(15, 1)
  })

  it('rejects files that are not videos', async () => {
    await expect(probeMp4(f.notVideo)).rejects.toThrow()
  })
})
