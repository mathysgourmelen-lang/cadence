// "Retention replay": finds the local video file of a YouTube Short so it can be
// played next to its retention graph. YouTube's API doesn't let apps download
// videos, so the file must come from the Mac.

import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type { Store } from './store'
import type { FolderLibrary } from './folder'
import type { ReplaySource } from '../shared/types'

/** YouTube reports whole seconds; files have fractions. */
const DURATION_SLACK = 1.05

const words = (s: string) => new Set(s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2))

/** The file already known for a video, without searching. */
export function knownReplayFile(store: Store, videoId: string): { path: string; source: ReplaySource['source'] } | null {
  const post = store.posts.find((p) => p.youtube.videoId === videoId && existsSync(p.video.libraryPath))
  if (post) return { path: post.video.libraryPath, source: 'cadence' }
  const saved = store.replayFiles[videoId]
  if (saved && existsSync(saved.path)) return saved
  return null
}

/** Looks for the video: posted through Cadence, picked before, or one clear match in the Library folder. */
export async function findReplayFile(store: Store, folderLib: FolderLibrary, videoId: string, durationSec?: number, title?: string): Promise<ReplaySource> {
  const known = knownReplayFile(store, videoId)
  if (known) return { found: true, name: basename(known.path), source: known.source }
  const folder = store.settings.libraryFolder
  if (!durationSec || !folder) return { found: false }
  const listing = await folderLib.list(folder)
  const same = listing.videos.filter((v) => v.media && Math.abs(v.media.durationSec - durationSec) <= DURATION_SLACK)
  let match = same.length === 1 ? same[0] : undefined
  if (!match && same.length > 1 && title) {
    // Several files of the same length: take the one whose name shares the most words with the title.
    const t = words(title)
    const scored = same.map((v) => ({ v, s: [...words(v.name)].filter((w) => t.has(w)).length })).sort((a, b) => b.s - a.s)
    if (scored[0].s > 0 && scored[0].s > scored[1].s) match = scored[0].v
  }
  if (!match) return { found: false, candidates: same.length }
  store.setReplayFile(videoId, { path: match.path, source: 'folder' })
  return { found: true, name: match.name, source: 'folder' }
}
