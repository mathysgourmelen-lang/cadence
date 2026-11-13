// The Library tab: lists the videos in a folder the user picked, with metadata,
// cached thumbnails and live updates when files are added or removed.

import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readdir, stat, writeFile, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { extname, join, relative, resolve, sep } from 'node:path'
import { probeMp4, ProbeError } from './mp4probe'
import { isInside, serveFile, VIDEO_EXTENSIONS } from './media'
import type { FolderListing, FolderVideo, MediaInfo } from '../shared/types'

export const MAX_FOLDER_VIDEOS = 2000
const MAX_DEPTH = 4
/** macOS bundles that look like folders but must not be walked into. */
const PACKAGE_EXT = ['.app', '.photoslibrary', '.fcpbundle', '.imovielibrary', '.tvlibrary', '.musiclibrary', '.lrlibrary', '.prproj', '.dvr']
const SKIP_DIRS = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information'])

interface ProbeCacheEntry {
  key: string
  media?: MediaInfo
  error?: string
}

/** Runs async work over items with a concurrency limit. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  })
  await Promise.all(workers)
}

export class FolderLibrary {
  private cache = new Map<string, ProbeCacheEntry>()
  private watcher: FSWatcher | null = null
  private watching: string | null = null
  private debounce: NodeJS.Timeout | null = null

  constructor(
    readonly thumbsDir: string,
    private readonly onChange: () => void
  ) {}

  /** Finds video files under `folder`, newest first. */
  async scan(folder: string): Promise<{ files: { path: string; size: number; mtimeMs: number }[]; truncated: boolean }> {
    const files: { path: string; size: number; mtimeMs: number }[] = []
    let truncated = false
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (truncated) return
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue
        const full = join(dir, e.name)
        if (e.isDirectory()) {
          if (depth >= MAX_DEPTH || SKIP_DIRS.has(e.name) || PACKAGE_EXT.includes(extname(e.name).toLowerCase())) continue
          await walk(full, depth + 1)
        } else if (e.isFile() && VIDEO_EXTENSIONS.includes(extname(e.name).toLowerCase())) {
          try {
            const st = await stat(full)
            if (files.length >= MAX_FOLDER_VIDEOS) {
              truncated = true
              return
            }
            files.push({ path: full, size: st.size, mtimeMs: st.mtimeMs })
          } catch {
            /* vanished while scanning */
          }
        }
        if (truncated) return
      }
    }
    await walk(folder, 0)
    files.sort((a, b) => b.mtimeMs - a.mtimeMs)
    return { files, truncated }
  }

  async list(folder: string | null): Promise<FolderListing> {
    const scannedAt = new Date().toISOString()
    if (!folder) return { folder: null, exists: false, videos: [], truncated: false, scannedAt }
    try {
      if (!(await stat(folder)).isDirectory()) throw new Error('not a folder')
    } catch {
      return { folder, exists: false, videos: [], truncated: false, scannedAt }
    }
    const { files, truncated } = await this.scan(folder)
    const videos: FolderVideo[] = files.map((f) => ({
      path: f.path,
      relPath: relative(folder, f.path),
      name: f.path.split(sep).pop() ?? f.path,
      sizeBytes: f.size,
      mtimeMs: f.mtimeMs
    }))
    await pool(videos, 6, async (v) => {
      const key = `${v.sizeBytes}:${v.mtimeMs}`
      let entry = this.cache.get(v.path)
      if (!entry || entry.key !== key) {
        try {
          entry = { key, media: await probeMp4(v.path) }
        } catch (err) {
          entry = { key, error: err instanceof ProbeError ? err.message : 'Could not read this file.' }
        }
        this.cache.set(v.path, entry)
      }
      v.media = entry.media
      v.error = entry.error
      const thumb = this.thumbName(v.path, v.sizeBytes, v.mtimeMs)
      try {
        await access(join(this.thumbsDir, thumb))
        v.thumbUrl = `cadence-media://thumbs/${thumb}`
      } catch {
        /* not generated yet */
      }
    })
    return { folder, exists: true, videos, truncated, scannedAt }
  }

  thumbName(path: string, size: number, mtimeMs: number): string {
    return createHash('sha1').update(`${path}|${size}|${mtimeMs}`).digest('hex').slice(0, 24) + '.jpg'
  }

  /** Saves a thumbnail the UI rendered from the video. Returns its URL. */
  async saveThumb(folder: string | null, path: string, dataUrl: string): Promise<string | undefined> {
    if (!folder || !isInside(folder, path)) return undefined
    const m = /^data:image\/jpeg;base64,(.+)$/.exec(dataUrl)
    if (!m) return undefined
    const st = await stat(path)
    const name = this.thumbName(path, st.size, st.mtimeMs)
    await mkdir(this.thumbsDir, { recursive: true })
    await writeFile(join(this.thumbsDir, name), Buffer.from(m[1], 'base64'))
    return `cadence-media://thumbs/${name}`
  }

  /** Watches the folder and calls onChange (debounced) when videos are added, removed or changed. */
  watch(folder: string | null): void {
    if (folder === this.watching) return
    this.watcher?.close()
    this.watcher = null
    this.watching = folder
    if (!folder) return
    try {
      this.watcher = watch(folder, { recursive: true, persistent: false }, (_ev, file) => {
        if (file && typeof file === 'string') {
          const base = file.split(/[\\/]/).pop() ?? ''
          // Ignore files that are not videos, except folder changes (no extension).
          const ext = extname(base).toLowerCase()
          if (base.startsWith('.') || (ext && !VIDEO_EXTENSIONS.includes(ext))) return
        }
        if (this.debounce) clearTimeout(this.debounce)
        this.debounce = setTimeout(() => this.onChange(), 800)
      })
      this.watcher.on('error', () => {
        this.watcher?.close()
        this.watcher = null
      })
    } catch {
      this.watcher = null
    }
  }

  close(): void {
    this.watch(null)
    if (this.debounce) clearTimeout(this.debounce)
  }

  /**
   * Serves cadence-media://folder/<encoded relative path> (videos inside the chosen folder)
   * and cadence-media://thumbs/<name> (cached thumbnails).
   */
  async serve(folder: string | null, host: string, request: Request): Promise<Response> {
    const url = new URL(request.url)
    const name = decodeURIComponent(url.pathname.replace(/^\//, ''))
    if (host === 'thumbs') {
      if (!/^[a-f0-9]{24}\.jpg$/.test(name)) return new Response('Forbidden', { status: 403 })
      return serveFile(join(this.thumbsDir, name), request)
    }
    if (!folder || !name) return new Response('Forbidden', { status: 403 })
    const full = resolve(folder, name)
    if (!isInside(folder, full) || !VIDEO_EXTENSIONS.includes(extname(full).toLowerCase())) return new Response('Forbidden', { status: 403 })
    return serveFile(full, request)
  }
}
