// Creating, editing and acting on posts. Kept free of Electron so it can be tested.

import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import type { Store } from './store'
import { addLog } from './scheduler'
import type { InstagramTarget, Platform, Post, PostDraftInput, TargetBase, YouTubeTarget } from '../shared/types'
import { IN_FLIGHT, isEditable } from '../shared/status'
import { validateInstagram, validateYouTube } from '../shared/validation'

export class PostError extends Error {}

function newTarget(): TargetBase {
  return { enabled: false, state: 'draft', attempts: 0, log: [] }
}

export function savePost(store: Store, input: PostDraftInput, now = Date.now()): Post {
  if (!input.instagram.enabled && !input.youtube.enabled) throw new PostError('Turn on Instagram, YouTube, or both.')
  if (input.schedule && input.scheduledAt && Number.isNaN(Date.parse(input.scheduledAt))) throw new PostError('The date and time are not valid.')
  if (input.schedule && input.scheduledAt && Date.parse(input.scheduledAt) < now - 60_000) {
    throw new PostError('That time is in the past. Pick a future time or choose "Post now".')
  }

  if (input.schedule) {
    if (input.instagram.enabled) {
      const v = validateInstagram(input.video.media, input.instagram.caption)
      if (!v.canPost) throw new PostError(`Instagram: ${firstError(v.checks)}`)
      if (!store.accounts.instagram.connected) throw new PostError('Connect Instagram in Accounts before scheduling a reel.')
    }
    if (input.youtube.enabled) {
      const v = validateYouTube(input.video.media, input.youtube.title, input.youtube.description, input.youtube.tags)
      if (!v.canPost) throw new PostError(`YouTube: ${firstError(v.checks)}`)
      if (!store.accounts.youtube.connected) throw new PostError('Connect YouTube in Accounts before scheduling a Short.')
    }
  }

  const existing = input.id ? store.getPost(input.id) : undefined
  const nowIso = new Date(now).toISOString()
  const post: Post = existing
    ? structuredClone(existing)
    : {
        id: randomUUID(),
        createdAt: nowIso,
        updatedAt: nowIso,
        scheduledAt: null,
        video: input.video,
        instagram: { ...newTarget(), caption: '', shareToFeed: true, coverOffsetMs: null } as InstagramTarget,
        youtube: {
          ...newTarget(),
          title: '',
          description: '',
          tags: [],
          privacy: 'public',
          madeForKids: false,
          categoryId: '22',
          mode: 'native'
        } as YouTubeTarget
      }

  const timeChanged = (post.scheduledAt ?? null) !== (input.scheduledAt ?? null)
  post.video = { ...post.video, ...input.video }
  post.scheduledAt = input.scheduledAt

  // Instagram
  {
    const t = post.instagram
    const textChanged =
      t.caption !== input.instagram.caption || t.shareToFeed !== input.instagram.shareToFeed || t.coverOffsetMs !== input.instagram.coverOffsetMs
    if (t.enabled && !isEditable(t.state)) {
      if (textChanged || timeChanged || !input.instagram.enabled) {
        throw new PostError(`The Instagram post is ${t.state === 'published' ? 'already published' : 'uploading right now'} and can't be changed.`)
      }
    } else {
      // A reel already uploaded for this post can be kept if only the time moved.
      const keepContainer = t.state === 'ready' && !textChanged && input.schedule && input.instagram.enabled
      Object.assign(t, input.instagram)
      if (!keepContainer) {
        resetTarget(t, input.instagram.enabled && input.schedule ? 'scheduled' : 'draft')
        t.containerId = undefined
        t.containerCreatedAt = undefined
      }
    }
  }
  // YouTube
  {
    const t = post.youtube
    if (input.youtube.enabled || t.enabled) {
      if (t.enabled && !isEditable(t.state)) {
        const changed =
          t.title !== input.youtube.title ||
          t.description !== input.youtube.description ||
          t.tags.join('\u0000') !== input.youtube.tags.join('\u0000') ||
          t.privacy !== input.youtube.privacy ||
          t.madeForKids !== input.youtube.madeForKids ||
          t.categoryId !== input.youtube.categoryId ||
          t.mode !== input.youtube.mode ||
          !input.youtube.enabled ||
          timeChanged
        if (changed) {
          throw new PostError(
            t.state === 'scheduled_remote' || t.state === 'published'
              ? 'This Short is already on YouTube. Edit it in YouTube Studio instead.'
              : 'The Short is uploading right now and can\'t be changed.'
          )
        }
      } else {
        Object.assign(t, input.youtube)
        resetTarget(t, input.youtube.enabled && input.schedule ? 'scheduled' : 'draft')
        t.uploadUrl = undefined
      }
    }
  }

  store.upsertPost(post)
  return post
}

function resetTarget(t: TargetBase, state: TargetBase['state']): void {
  t.state = state
  t.attempts = 0
  t.error = undefined
  t.nextAttemptAt = undefined
  t.progress = undefined
  if (state === 'scheduled') addLog(t, 'Scheduled.')
}

function firstError(checks: { severity: string; label: string; detail?: string }[]): string {
  const c = checks.find((x) => x.severity === 'error')
  return c ? `${c.label}: ${c.detail ?? ''}` : 'Not valid.'
}

export type PostAction = 'postNow' | 'cancel' | 'retry' | 'unschedule'

export function applyAction(store: Store, id: string, action: PostAction, platform?: Platform, now = Date.now()): Post {
  const post = store.getPost(id)
  if (!post) throw new PostError('That post no longer exists.')
  const platforms: Platform[] = platform ? [platform] : ['instagram', 'youtube']
  const updated = store.updatePost(id, (p) => {
    for (const pl of platforms) {
      const t: TargetBase = pl === 'instagram' ? p.instagram : p.youtube
      if (!t.enabled) continue
      switch (action) {
        case 'postNow':
          if (['draft', 'scheduled', 'missed', 'failed', 'canceled'].includes(t.state)) {
            if (pl === 'instagram') p.instagram.containerId = undefined
            resetTarget(t, 'scheduled')
            addLog(t, 'Posting now.')
          } else if (t.state === 'ready') {
            t.nextAttemptAt = undefined
          }
          break
        case 'retry':
          if (t.state === 'failed') {
            if (pl === 'instagram') p.instagram.containerId = undefined
            resetTarget(t, 'scheduled')
          } else if (t.nextAttemptAt) t.nextAttemptAt = undefined
          break
        case 'cancel':
          if (IN_FLIGHT.includes(t.state)) throw new PostError('It is uploading right now. Wait a moment, then cancel.')
          if (t.state === 'scheduled_remote' || t.state === 'published') break
          t.state = 'canceled'
          t.nextAttemptAt = undefined
          addLog(t, 'Canceled.')
          break
        case 'unschedule':
          if (isEditable(t.state)) resetTarget(t, 'draft')
          break
      }
    }
    if (action === 'postNow') {
      // "Post now" means now: drop a future time so nothing waits for it.
      if (!p.scheduledAt || Date.parse(p.scheduledAt) > now) p.scheduledAt = new Date(now).toISOString()
    }
  })
  return updated!
}

export function reschedule(store: Store, id: string, iso: string, now = Date.now()): Post {
  const post = store.getPost(id)
  if (!post) throw new PostError('That post no longer exists.')
  if (Number.isNaN(Date.parse(iso))) throw new PostError('Invalid time.')
  if (Date.parse(iso) < now - 60_000) throw new PostError('That time is in the past.')
  for (const t of [post.instagram, post.youtube]) {
    if (t.enabled && !isEditable(t.state) && t.state !== 'published') {
      throw new PostError(t.state === 'scheduled_remote' ? 'The Short is already scheduled on YouTube. Change its time in YouTube Studio.' : 'It is uploading right now.')
    }
  }
  return store.updatePost(id, (p) => {
    p.scheduledAt = new Date(iso).toISOString()
    for (const t of [p.instagram, p.youtube]) {
      if (t.enabled && (t.state === 'missed' || t.state === 'failed' || t.state === 'canceled')) resetTarget(t, 'scheduled')
    }
  })!
}

export async function deletePost(store: Store, id: string): Promise<void> {
  const post = store.getPost(id)
  if (!post) return
  for (const t of [post.instagram, post.youtube]) {
    if (t.enabled && IN_FLIGHT.includes(t.state)) throw new PostError('It is uploading right now. Wait for it to finish, then delete.')
  }
  store.deletePost(id)
  await unlink(post.video.libraryPath).catch(() => undefined)
  if (post.video.thumbnailPath) await unlink(post.video.thumbnailPath).catch(() => undefined)
}
