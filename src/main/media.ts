// Importing videos into the app library and serving them to the UI.

import { copyFile, constants as fsConstants, stat, unlink, readdir, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { basename, extname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { probeMp4, ProbeError } from './mp4probe'
import type { ImportedVideo, Post } from '../shared/types'

export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v']

export async function importVideo(libraryDir: string, sourcePath: string): Promise<ImportedVideo> {
  const ext = extname(sourcePath).toLowerCase()
  if (!VIDEO_EXTENSIONS.includes(ext)) {
    return { ok: false, error: `${basename(sourcePath)} is not an MP4 or MOV video.` }
  }
  try {
    const st = await stat(sourcePath)
    if (!st.isFile()) return { ok: false, error: `${basename(sourcePath)} is not a file.` }
    // Probe the original first, so a bad file is rejected before copying.
    const media = await probeMp4(sourcePath)
    const id = randomUUID()
    const libraryPath = join(libraryDir, `${id}${ext}`)
    // On APFS this is an instant copy-on-write clone that uses no extra space.
    await copyFile(sourcePath, libraryPath, fsConstants.COPYFILE_FICLONE)
    return {
      ok: true,
      video: { fileName: basename(sourcePath), originalPath: sourcePath, libraryPath, sizeBytes: st.size, media }
    }
  } catch (err) {
    const msg = err instanceof ProbeError ? err.message : `Could not read ${basename(sourcePath)}: ${(err as Error).message}`
    return { ok: false, error: msg }
  }
}

export async function saveThumbnail(libraryDir: string, videoPath: string, dataUrl: string): Promise<string | undefined> {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl)
  if (!m) return undefined
  if (!isInside(libraryDir, videoPath)) return undefined
  const out = videoPath.replace(/\.[^.]+$/, '') + `.thumb.${m[1] === 'jpeg' ? 'jpg' : m[1]}`
  await writeFile(out, Buffer.from(m[2], 'base64'))
  return out
}

export function isInside(dir: string, p: string): boolean {
  const d = resolve(dir) + sep
  return resolve(p).startsWith(d)
}

/** Deletes library files that no post references (e.g. imports that were never saved). */
export async function cleanLibrary(libraryDir: string, posts: Post[], minAgeMs = 24 * 3600 * 1000): Promise<number> {
  const keep = new Set<string>()
  for (const p of posts) {
    keep.add(resolve(p.video.libraryPath))
    if (p.video.thumbnailPath) keep.add(resolve(p.video.thumbnailPath))
  }
  let removed = 0
  for (const name of await readdir(libraryDir).catch(() => [] as string[])) {
    const full = resolve(join(libraryDir, name))
    if (keep.has(full)) continue
    try {
      const st = await stat(full)
      if (Date.now() - st.mtimeMs > minAgeMs) {
        await unlink(full)
        removed++
      }
    } catch {
      /* ignore */
    }
  }
  return removed
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
}

/** Serves a library file with HTTP Range support, so the <video> element can seek. */
export async function serveLibraryFile(libraryDir: string, request: Request): Promise<Response> {
  const url = new URL(request.url)
  // URLs look like cadence-media://lib/<file name>. Only flat names inside the library are served.
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!name || name.includes('/') || name.includes('\\') || name.startsWith('.')) return new Response('Forbidden', { status: 403 })
  const filePath = join(libraryDir, name)
  if (!isInside(libraryDir, filePath)) return new Response('Forbidden', { status: 403 })
  return serveFile(filePath, request)
}

/** Streams a file, honouring Range requests. Callers must check the path is allowed. */
export async function serveFile(filePath: string, request: Request): Promise<Response> {
  let size: number
  try {
    size = (await stat(filePath)).size
  } catch {
    return new Response('Not found', { status: 404 })
  }
  const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  const range = request.headers.get('range')
  const m = range && /bytes=(\d*)-(\d*)/.exec(range)
  if (m && (m[1] || m[2])) {
    let start: number
    let end: number
    if (m[1]) {
      start = Number(m[1])
      end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
    } else {
      start = Math.max(0, size - Number(m[2]))
      end = size - 1
    }
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as unknown as ReadableStream
    return new Response(stream, {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }
  const stream = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' }
  })
}
