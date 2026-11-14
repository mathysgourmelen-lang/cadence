// Custom YouTube thumbnails: copies the picked image into the app library,
// re-encoding it as JPEG when it is too big or not a PNG/JPEG.

import { nativeImage } from 'electron'
import { copyFile, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { THUMB_MAX_BYTES } from './youtube'
import type { ChosenThumbnail } from '../shared/types'

export const THUMB_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'heic', 'gif', 'bmp', 'tiff']
const MAX_EDGE = 1920

export async function prepareThumbnail(libraryDir: string, sourcePath: string): Promise<ChosenThumbnail> {
  const ext = extname(sourcePath).slice(1).toLowerCase()
  if (!THUMB_EXTENSIONS.includes(ext)) throw new Error(`${basename(sourcePath)} is not an image. Use a PNG or JPEG.`)
  const st = await stat(sourcePath)
  if (!st.isFile()) throw new Error(`${basename(sourcePath)} is not a file.`)
  if (st.size > 60 * 1024 * 1024) throw new Error('That image is too large.')
  let img = nativeImage.createFromBuffer(await readFile(sourcePath))
  if (img.isEmpty()) img = nativeImage.createFromPath(sourcePath)
  if (img.isEmpty()) throw new Error(`Cadence couldn't read ${basename(sourcePath)}. Export it as a PNG or JPEG and try again.`)
  const { width, height } = img.getSize()
  if (width < 120 || height < 90) throw new Error('That image is too small for a thumbnail. Use at least 640 pixels wide.')

  const id = randomUUID()
  const direct = (ext === 'png' || ext === 'jpg' || ext === 'jpeg') && st.size <= THUMB_MAX_BYTES && Math.max(width, height) <= 4096
  if (direct) {
    const out = join(libraryDir, `${id}.ytthumb.${ext === 'png' ? 'png' : 'jpg'}`)
    await copyFile(sourcePath, out)
    return { path: out, width, height, sizeBytes: st.size }
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
  const sized = scale < 1 ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'best' }) : img
  let jpeg: Buffer = Buffer.alloc(0)
  for (const q of [92, 85, 78, 70, 60, 50]) {
    jpeg = sized.toJPEG(q)
    if (jpeg.length <= THUMB_MAX_BYTES) break
  }
  if (!jpeg.length || jpeg.length > THUMB_MAX_BYTES) throw new Error('Cadence couldn\'t make that image small enough (YouTube allows 2 MB).')
  const out = join(libraryDir, `${id}.ytthumb.jpg`)
  await writeFile(out, jpeg)
  const s = sized.getSize()
  return { path: out, width: s.width, height: s.height, sizeBytes: jpeg.length }
}
