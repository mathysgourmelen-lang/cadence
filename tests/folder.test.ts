import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FolderLibrary } from '../src/main/folder'
import { hasFfmpeg, makeFixtures } from './fixtures'

const run = hasFfmpeg() ? describe : describe.skip

run('FolderLibrary', () => {
  const fx = makeFixtures()
  const root = mkdtempSync(join(tmpdir(), 'cadence-folder-'))
  const folder = join(root, 'Exports')
  mkdirSync(join(folder, 'Raw'), { recursive: true })
  mkdirSync(join(folder, '.hidden'))
  mkdirSync(join(folder, 'Old.fcpbundle'))
  copyFileSync(fx.vertical, join(folder, 'reel.mp4'))
  copyFileSync(fx.landscape, join(folder, 'Raw', 'wide.mp4'))
  copyFileSync(fx.vertical, join(folder, '.hidden', 'skip.mp4'))
  copyFileSync(fx.vertical, join(folder, 'Old.fcpbundle', 'skip.mp4'))
  writeFileSync(join(folder, 'notes.txt'), 'hello')
  writeFileSync(join(folder, 'broken.mov'), 'not a video at all, just text')
  const thumbs = join(root, 'thumbs')
  const lib = new FolderLibrary(thumbs, () => undefined)

  it('lists videos in the folder and subfolders with their metadata', async () => {
    const l = await lib.list(folder)
    expect(l.exists).toBe(true)
    expect(l.videos.map((v) => v.relPath).sort()).toEqual(['Raw/wide.mp4', 'broken.mov', 'reel.mp4'])
    const reel = l.videos.find((v) => v.name === 'reel.mp4')!
    expect(reel.media).toMatchObject({ width: 1080, height: 1920 })
    expect(l.videos.find((v) => v.name === 'broken.mov')!.error).toBeTruthy()
  })

  it('reports a missing folder', async () => {
    const l = await lib.list(join(root, 'nope'))
    expect(l.exists).toBe(false)
    expect((await lib.list(null)).folder).toBeNull()
  })

  it('saves thumbnails and reports them on the next listing', async () => {
    const path = join(folder, 'reel.mp4')
    const url = await lib.saveThumb(folder, path, 'data:image/jpeg;base64,' + Buffer.from('jpegbytes').toString('base64'))
    expect(url).toMatch(/^cadence-media:\/\/thumbs\/[a-f0-9]{24}\.jpg$/)
    const l = await lib.list(folder)
    expect(l.videos.find((v) => v.name === 'reel.mp4')!.thumbUrl).toBe(url)
    // Files outside the folder are refused.
    expect(await lib.saveThumb(folder, fx.vertical, 'data:image/jpeg;base64,AAAA')).toBeUndefined()
  })

  it('serves only videos inside the folder and valid thumbnail names', async () => {
    const ok = await lib.serve(folder, 'folder', new Request(`cadence-media://folder/${encodeURIComponent('Raw/wide.mp4')}`, { headers: { range: 'bytes=0-9' } }))
    expect(ok.status).toBe(206)
    const escape = await lib.serve(folder, 'folder', new Request(`cadence-media://folder/${encodeURIComponent('../../etc/passwd.mp4')}`))
    expect(escape.status).toBe(403)
    const txt = await lib.serve(folder, 'folder', new Request(`cadence-media://folder/notes.txt`))
    expect(txt.status).toBe(403)
    const badThumb = await lib.serve(folder, 'thumbs', new Request(`cadence-media://thumbs/${encodeURIComponent('../state.json')}`))
    expect(badThumb.status).toBe(403)
  })
})
