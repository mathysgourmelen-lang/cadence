// Generates small test videos with ffmpeg (skipped if ffmpeg is unavailable).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const FIX = join(__dirname, 'fixtures')

export function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function ff(out: string, args: string[]): string {
  const p = join(FIX, out)
  if (!existsSync(p)) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args, p])
  return p
}

const src = (w: number, h: number, d: number, rate = 30) => ['-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=${rate}:duration=${d}`]
const tone = (d: number, sr = 48000, layout = 'stereo') => ['-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=${sr}:duration=${d}`, '-ac', layout === 'stereo' ? '2' : layout === 'mono' ? '1' : '6']

export function makeFixtures() {
  mkdirSync(FIX, { recursive: true })
  return {
    vertical: ff('vertical.mp4', [...src(1080, 1920, 5), ...tone(5), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-shortest']),
    moovAtEnd: ff('moov-end.mp4', [...src(720, 1280, 4), ...tone(4), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']),
    rotated: ff('rotated.mp4', ['-display_rotation', '90', '-i', ff('rotated-base.mp4', [...src(1920, 1080, 4), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']), '-c', 'copy']),
    landscape: ff('landscape.mp4', [...src(1920, 1080, 4, 25), ...tone(4, 44100, 'mono'), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']),
    hevc: ff('hevc.mp4', [...src(1080, 1920, 3), '-c:v', 'libx265', '-preset', 'ultrafast', '-tag:v', 'hvc1', '-x265-params', 'log-level=error']),
    mov: ff('clip.mov', [...src(1080, 1920, 3, 60), ...tone(3), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']),
    tooShort: ff('short.mp4', [...src(1080, 1920, 2), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']),
    fragmented: ff('frag.mp4', [...src(1080, 1920, 3), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov']),
    lowFps: ff('lowfps.mp4', [...src(1080, 1920, 4, 15), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']),
    mp3audio: ff('mp3audio.mp4', [...src(1080, 1920, 3), ...tone(3), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'libmp3lame', '-shortest']),
    notVideo: (() => {
      const p = join(FIX, 'not-video.mp4')
      writeFileSync(p, 'this is definitely not a video file, just some text pretending to be one')
      return p
    })()
  }
}

export function ffprobe(file: string): any {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]).toString())
}
