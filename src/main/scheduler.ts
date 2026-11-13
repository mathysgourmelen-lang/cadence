// The background scheduler. Every few seconds it looks at each post and decides
// what to do next for Instagram and YouTube, based on the target's state and time.
// All network work runs as jobs; a job's state is saved before each step so that a
// crash or a closed laptop never causes a double post.

import { existsSync } from 'node:fs'
import { ApiError } from './http'
import type { InstagramClient, InstagramCredentials } from './instagram'
import { UPLOAD_QUOTA_COST, type YouTubeClient, type YouTubeTokens } from './youtube'
import type { Store } from './store'
import type { InstagramTarget, Platform, Post, TargetBase, YouTubeTarget } from '../shared/types'
import { validateInstagram, validateYouTube } from '../shared/validation'

export interface SchedulerDeps {
  store: Store
  instagram: () => InstagramClient
  youtube: YouTubeClient
  now?: () => number
  notify?: (title: string, body: string, postId?: string) => void
  onProgress?: (postId: string, platform: Platform, progress: number) => void
  /** Poll interval for Instagram processing status. */
  pollIntervalMs?: number
  /** Give up waiting for Instagram processing after this long. */
  processingTimeoutMs?: number
  tickMs?: number
  maxConcurrent?: number
  sleep?: (ms: number) => Promise<void>
}

const MAX_ATTEMPTS = 6
const CONTAINER_MAX_AGE_MS = 23 * 3600 * 1000
/** A post this late when the app (re)starts counts as "missed". */
const MISSED_AFTER_MS = 5 * 60 * 1000

export function backoffMs(attempt: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 30 * 60 * 1000)
}

export function youtubeUsesPublishAt(t: YouTubeTarget): boolean {
  return t.mode === 'native' && t.privacy === 'public'
}

export class Scheduler {
  private readonly store: Store
  private readonly now: () => number
  private readonly running = new Map<string, Promise<void>>()
  private timer?: NodeJS.Timeout
  private ticking = false
  private readonly pollMs: number
  private readonly processingTimeoutMs: number
  private readonly maxConcurrent: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly deps: SchedulerDeps) {
    this.store = deps.store
    this.now = deps.now ?? (() => Date.now())
    this.pollMs = deps.pollIntervalMs ?? 10_000
    this.processingTimeoutMs = deps.processingTimeoutMs ?? 30 * 60 * 1000
    this.maxConcurrent = deps.maxConcurrent ?? 2
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  start(): void {
    this.recoverMissed()
    this.timer = setInterval(() => void this.tick(), this.deps.tickMs ?? 5_000)
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  /** Waits for all running jobs (used by tests and on quit). */
  async idle(): Promise<void> {
    while (this.running.size) await Promise.allSettled([...this.running.values()])
  }

  isBusy(): boolean {
    return this.running.size > 0
  }

  /** True when the Mac should stay awake: work is running or due soon. */
  needsAwake(withinMs = 20 * 60 * 1000): boolean {
    if (this.running.size) return true
    const now = this.now()
    const lead = this.store.settings.instagramLeadMinutes * 60_000
    return this.store.posts.some((p) => {
      const at = p.scheduledAt ? Date.parse(p.scheduledAt) : now
      const ig = p.instagram.enabled && ['scheduled', 'ready', 'uploading', 'processing', 'publishing'].includes(p.instagram.state)
      const yt = p.youtube.enabled && ['scheduled', 'uploading'].includes(p.youtube.state)
      return (ig && at - lead - now < withinMs) || (yt && (youtubeUsesPublishAt(p.youtube) || at - now < withinMs))
    })
  }

  /**
   * Called at startup and when the Mac wakes. Posts whose time passed while the app
   * was not running are marked "missed" if the user asked to confirm them.
   */
  recoverMissed(): void {
    if (this.store.settings.missedPolicy !== 'ask') return
    const now = this.now()
    for (const p of this.store.posts) {
      if (!p.scheduledAt) continue
      const late = now - Date.parse(p.scheduledAt) > MISSED_AFTER_MS
      if (!late) continue
      this.store.updatePost(p.id, (post) => {
        if (post.instagram.enabled && (post.instagram.state === 'scheduled' || post.instagram.state === 'ready') && !this.running.has(key(post.id, 'instagram'))) {
          post.instagram.state = 'missed'
          addLog(post.instagram, 'The Mac was off or asleep at posting time. Waiting for you to confirm.')
        }
        const yt = post.youtube
        if (yt.enabled && yt.state === 'scheduled' && !this.running.has(key(post.id, 'youtube'))) {
          yt.state = 'missed'
          addLog(yt, 'The Mac was off or asleep at posting time. Waiting for you to confirm.')
        }
      })
    }
  }

  kick(): void {
    setTimeout(() => void this.tick(), 0)
  }

  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      if (this.store.settings.paused) return
      const now = this.now()
      // Earliest scheduled first.
      const posts = [...this.store.posts].sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''))
      for (const post of posts) {
        this.consider(post, 'instagram', now)
        this.consider(post, 'youtube', now)
      }
    } finally {
      this.ticking = false
    }
  }

  private consider(post: Post, platform: Platform, now: number): void {
    const k = key(post.id, platform)
    if (this.running.has(k)) return
    const t = platform === 'instagram' ? post.instagram : post.youtube
    if (!t.enabled) return
    if (t.nextAttemptAt && Date.parse(t.nextAttemptAt) > now) return
    const job = platform === 'instagram' ? this.nextInstagramJob(post, now) : this.nextYouTubeJob(post, now)
    if (!job) return
    // Publishing an already-uploaded reel is quick and time sensitive: it skips the queue.
    const urgent = platform === 'instagram' && (post.instagram.state === 'ready' || post.instagram.state === 'publishing')
    if (!urgent && this.uploadingCount() >= this.maxConcurrent) return
    const p = job()
      .catch((err) => console.error('job crashed', k, err))
      .finally(() => {
        this.running.delete(k)
        this.kick()
      })
    this.running.set(k, p)
  }

  private uploadingCount(): number {
    let n = 0
    for (const k of this.running.keys()) {
      const [id, platform] = k.split(':')
      const post = this.store.getPost(id)
      const t = post && (platform === 'instagram' ? post.instagram : post.youtube)
      if (t && (t.state === 'uploading' || t.state === 'processing')) n++
    }
    return n
  }

  // ---------------- Instagram ----------------

  private nextInstagramJob(post: Post, now: number): (() => Promise<void>) | null {
    const t = post.instagram
    const at = post.scheduledAt ? Date.parse(post.scheduledAt) : now
    const lead = Math.max(1, this.store.settings.instagramLeadMinutes) * 60_000
    switch (t.state) {
      case 'scheduled':
        return now >= at - lead ? () => this.igPrepare(post.id) : null
      case 'uploading': // orphaned by a restart: start over with a fresh container
        return () => this.igPrepare(post.id)
      case 'processing':
        return () => this.igWaitProcessing(post.id)
      case 'ready': {
        if (t.containerCreatedAt && now - Date.parse(t.containerCreatedAt) > CONTAINER_MAX_AGE_MS) {
          return async () => {
            this.store.updatePost(post.id, (p) => {
              p.instagram.state = 'scheduled'
              p.instagram.containerId = undefined
              addLog(p.instagram, 'The uploaded video expired on Instagram\'s side before posting time. Uploading again.')
            })
          }
        }
        return now >= at ? () => this.igPublish(post.id) : null
      }
      case 'publishing': // orphaned: verify before publishing again
        return () => this.igVerifyThenPublish(post.id)
      default:
        return null
    }
  }

  private igCreds(): InstagramCredentials {
    const acc = this.store.accounts.instagram
    const sec = this.store.getSecrets().instagram
    if (!acc.connected || !acc.igUserId || !sec?.accessToken) {
      throw new ApiError('Instagram is not connected. Connect it in Accounts, then retry.', { retriable: false, authError: true })
    }
    return { igUserId: acc.igUserId, accessToken: sec.accessToken }
  }

  private async igPrepare(postId: string): Promise<void> {
    const post = this.store.getPost(postId)
    if (!post) return
    try {
      const creds = this.igCreds()
      const file = post.video.libraryPath
      if (!existsSync(file)) throw new ApiError(`The video file is missing: ${post.video.fileName}`, { retriable: false })
      const v = validateInstagram(post.video.media, post.instagram.caption)
      if (!v.canPost) {
        const errs = v.checks.filter((c) => c.severity === 'error').map((c) => `${c.label}: ${c.detail}`)
        throw new ApiError(`This video can't be posted to Instagram. ${errs.join(' ')}`, { retriable: false })
      }

      this.setIg(postId, (t) => {
        t.state = 'uploading'
        t.progress = 0
        t.error = undefined
        addLog(t, 'Creating the reel on Instagram.')
      })
      const container = await this.deps.instagram().createReelContainer(creds, {
        caption: post.instagram.caption,
        shareToFeed: post.instagram.shareToFeed,
        coverOffsetMs: post.instagram.coverOffsetMs
      })
      if (!this.stillActive(postId, 'instagram')) return
      this.setIg(postId, (t) => {
        t.containerId = container.id
        t.containerCreatedAt = new Date(this.now()).toISOString()
        addLog(t, 'Uploading the video.')
      })
      let lastEmit = 0
      await this.deps.instagram().uploadVideo(creds, container.uploadUri, file, post.video.sizeBytes, (f) => {
        const n = this.now()
        if (n - lastEmit > 250 || f >= 1) {
          lastEmit = n
          this.deps.onProgress?.(postId, 'instagram', f)
        }
      })
      if (!this.stillActive(postId, 'instagram')) return
      this.setIg(postId, (t) => {
        t.state = 'processing'
        t.progress = 1
        addLog(t, 'Upload complete. Instagram is processing the video.')
      })
      await this.igWaitProcessing(postId)
    } catch (err) {
      this.fail(postId, 'instagram', err, 'scheduled')
    }
  }

  private async igWaitProcessing(postId: string): Promise<void> {
    try {
      const creds = this.igCreds()
      const start = this.now()
      for (;;) {
        const post = this.store.getPost(postId)
        if (!post || post.instagram.state !== 'processing') return
        const id = post.instagram.containerId
        if (!id) {
          this.setIg(postId, (t) => (t.state = 'scheduled'))
          return
        }
        const st = await this.deps.instagram().containerStatus(creds, id)
        if (st.statusCode === 'FINISHED') {
          this.setIg(postId, (t) => {
            t.state = 'ready'
            t.attempts = 0
            t.nextAttemptAt = undefined
            addLog(t, 'Instagram finished processing. Ready to post.')
          })
          const p = this.store.getPost(postId)
          const at = p?.scheduledAt ? Date.parse(p.scheduledAt) : this.now()
          if (p && this.now() >= at) await this.igPublish(postId)
          return
        }
        if (st.statusCode === 'PUBLISHED') {
          this.setIg(postId, (t) => markPublished(t, this.now()))
          return
        }
        if (st.statusCode === 'ERROR') {
          throw new ApiError(`Instagram could not process this video${st.status ? ` (${st.status})` : ''}. Check the format: H.264, AAC audio, 23–60 fps.`, {
            retriable: false
          })
        }
        if (st.statusCode === 'EXPIRED') {
          this.setIg(postId, (t) => {
            t.state = 'scheduled'
            t.containerId = undefined
            addLog(t, 'The upload expired on Instagram. Uploading again.')
          })
          return
        }
        if (this.now() - start > this.processingTimeoutMs) {
          throw new ApiError('Instagram is taking unusually long to process the video. Uploading again.', { retriable: true, code: 'processing_timeout' })
        }
        await this.sleep(this.pollMs)
      }
    } catch (err) {
      // A network hiccup while polling keeps waiting; a stuck container starts over.
      const restart = err instanceof ApiError && err.opts.code === 'processing_timeout'
      this.fail(postId, 'instagram', err, restart ? 'scheduled' : 'processing')
    }
  }

  private async igPublish(postId: string): Promise<void> {
    const post = this.store.getPost(postId)
    if (!post || !post.instagram.containerId) return
    try {
      const creds = this.igCreds()
      // Save "publishing" first so a crash during the call is detected on restart.
      this.setIg(postId, (t) => {
        t.state = 'publishing'
        addLog(t, 'Publishing the reel.')
      })
      await this.store.flush()
      const mediaId = await this.deps.instagram().publish(creds, post.instagram.containerId)
      const permalink = await this.deps.instagram().permalink(creds, mediaId)
      this.setIg(postId, (t) => {
        markPublished(t, this.now())
        t.mediaId = mediaId
        t.url = permalink
        addLog(t, 'Published on Instagram.')
      })
      this.deps.notify?.('Reel published', `${post.video.fileName} is live on Instagram.`, postId)
    } catch (err) {
      if (err instanceof ApiError && err.opts.code === 2207027) {
        // Not ready after all: go back to waiting.
        this.setIg(postId, (t) => (t.state = 'processing'))
        return
      }
      // Retry through "publishing" so the next attempt first checks whether it went out.
      this.fail(postId, 'instagram', err, 'publishing')
    }
  }

  private async igVerifyThenPublish(postId: string): Promise<void> {
    const post = this.store.getPost(postId)
    if (!post) return
    try {
      const creds = this.igCreds()
      const id = post.instagram.containerId
      if (!id) {
        this.setIg(postId, (t) => (t.state = 'scheduled'))
        return
      }
      const st = await this.deps.instagram().containerStatus(creds, id)
      if (st.statusCode === 'PUBLISHED') {
        // It went out before the interruption. Find its link without posting again.
        let url: string | undefined
        let mediaId: string | undefined
        try {
          const recent = await this.deps.instagram().recentMedia(creds, 5)
          const match = recent.find((m) => (m.caption ?? '') === post.instagram.caption) ?? recent[0]
          url = match?.permalink
          mediaId = match?.id
        } catch {
          /* link is optional */
        }
        this.setIg(postId, (t) => {
          markPublished(t, this.now())
          t.url = url
          t.mediaId = mediaId
          addLog(t, 'Confirmed published on Instagram.')
        })
        return
      }
      if (st.statusCode === 'FINISHED') {
        this.setIg(postId, (t) => (t.state = 'ready'))
        await this.igPublish(postId)
        return
      }
      this.setIg(postId, (t) => {
        t.state = 'scheduled'
        t.containerId = undefined
      })
    } catch (err) {
      // Could not verify: stay in "publishing" and retry later rather than risk a double post.
      this.fail(postId, 'instagram', err, 'publishing')
    }
  }

  private setIg(postId: string, fn: (t: InstagramTarget) => void): void {
    this.store.updatePost(postId, (p) => fn(p.instagram))
  }

  // ---------------- YouTube ----------------

  private nextYouTubeJob(post: Post, now: number): (() => Promise<void>) | null {
    const t = post.youtube
    const at = post.scheduledAt ? Date.parse(post.scheduledAt) : now
    switch (t.state) {
      case 'scheduled':
        if (youtubeUsesPublishAt(t) || now >= at) return () => this.ytUpload(post.id)
        return null
      case 'uploading':
        return () => this.ytUpload(post.id)
      case 'scheduled_remote':
        return now >= at
          ? async () => {
              this.store.updatePost(post.id, (p) => {
                markPublished(p.youtube, at)
                addLog(p.youtube, 'YouTube published the Short at its scheduled time.')
              })
            }
          : null
      default:
        return null
    }
  }

  private ytTokens(): YouTubeTokens {
    const acc = this.store.accounts.youtube
    const sec = this.store.getSecrets().youtube
    if (!acc.connected || !acc.clientId || !sec?.clientSecret || !sec.refreshToken) {
      throw new ApiError('YouTube is not connected. Connect it in Accounts, then retry.', { retriable: false, authError: true })
    }
    return {
      clientId: acc.clientId,
      clientSecret: sec.clientSecret,
      refreshToken: sec.refreshToken,
      accessToken: sec.accessToken,
      accessTokenExpiresAt: sec.accessTokenExpiresAt
    }
  }

  private saveYtTokens(tokens: YouTubeTokens): void {
    const sec = this.store.getSecrets().youtube
    if (sec && (sec.accessToken !== tokens.accessToken || sec.accessTokenExpiresAt !== tokens.accessTokenExpiresAt)) {
      this.store.setSecrets({ youtube: { ...sec, accessToken: tokens.accessToken, accessTokenExpiresAt: tokens.accessTokenExpiresAt } })
    }
  }

  private async ytUpload(postId: string): Promise<void> {
    const post = this.store.getPost(postId)
    if (!post) return
    let tokens: YouTubeTokens | undefined
    try {
      tokens = this.ytTokens()
      const t = post.youtube
      const file = post.video.libraryPath
      if (!existsSync(file)) throw new ApiError(`The video file is missing: ${post.video.fileName}`, { retriable: false })
      const v = validateYouTube(post.video.media, t.title, t.description, t.tags)
      if (!v.canPost) {
        const errs = v.checks.filter((c) => c.severity === 'error').map((c) => `${c.label}: ${c.detail}`)
        throw new ApiError(`This video can't be posted to YouTube. ${errs.join(' ')}`, { retriable: false })
      }

      const now = this.now()
      const at = post.scheduledAt ? Date.parse(post.scheduledAt) : now
      // YouTube needs publishAt in the future; within 2 minutes we just publish now.
      const publishAt = youtubeUsesPublishAt(t) && at - now > 2 * 60_000 ? new Date(at).toISOString() : undefined
      const mime = /\.mov$/i.test(file) || post.video.media.isQuickTime ? 'video/quicktime' : 'video/mp4'

      this.setYt(postId, (y) => {
        y.state = 'uploading'
        y.error = undefined
        y.progress = y.progress ?? 0
      })

      let uploadUrl = t.uploadUrl
      let offset = 0
      if (uploadUrl) {
        try {
          const q = await this.deps.youtube.queryUpload(tokens, uploadUrl, post.video.sizeBytes)
          if (q.video) {
            this.ytDone(postId, q.video, publishAt)
            return
          }
          offset = q.offset
          this.setYt(postId, (y) => addLog(y, `Resuming the upload at ${Math.round((offset / post.video.sizeBytes) * 100)}%.`))
        } catch (err) {
          if (err instanceof ApiError && err.opts.code === 'session_expired') uploadUrl = undefined
          else throw err
        }
      }
      if (!uploadUrl) {
        uploadUrl = await this.deps.youtube.startUpload(
          tokens,
          {
            title: t.title,
            description: t.description,
            tags: t.tags,
            categoryId: t.categoryId,
            privacy: t.privacy,
            madeForKids: t.madeForKids,
            publishAt
          },
          post.video.sizeBytes,
          mime
        )
        this.store.addQuota(UPLOAD_QUOTA_COST)
        const u = uploadUrl
        this.setYt(postId, (y) => {
          y.uploadUrl = u
          addLog(y, publishAt ? `Uploading. YouTube will publish it at ${new Date(publishAt).toLocaleString()}.` : 'Uploading the Short.')
        })
      }
      let lastEmit = 0
      const video = await this.deps.youtube.uploadFile(
        tokens,
        uploadUrl,
        file,
        post.video.sizeBytes,
        (f) => {
          const n = this.now()
          if (n - lastEmit > 250 || f >= 1) {
            lastEmit = n
            this.deps.onProgress?.(postId, 'youtube', f)
          }
        },
        offset
      )
      this.ytDone(postId, video, publishAt)
    } catch (err) {
      if (err instanceof ApiError && err.opts.code === 'session_expired') {
        this.setYt(postId, (y) => (y.uploadUrl = undefined))
      }
      // An interrupted upload resumes from where it stopped (state stays "uploading").
      const p = this.store.getPost(postId)
      this.fail(postId, 'youtube', err, p?.youtube.uploadUrl ? 'uploading' : 'scheduled')
    } finally {
      if (tokens) this.saveYtTokens(tokens)
    }
  }

  private ytDone(postId: string, video: any, publishAt: string | undefined): void {
    const id: string | undefined = video?.id
    const post = this.store.getPost(postId)
    this.setYt(postId, (y) => {
      y.videoId = id
      y.url = id ? `https://www.youtube.com/shorts/${id}` : undefined
      y.uploadUrl = undefined
      y.progress = 1
      y.attempts = 0
      y.nextAttemptAt = undefined
      const locked = video?.status?.privacyStatus === 'private' && !publishAt && y.privacy !== 'private'
      if (publishAt) {
        y.state = 'scheduled_remote'
        addLog(y, 'Uploaded. YouTube will publish it at the scheduled time.')
      } else {
        markPublished(y, this.now())
        addLog(y, 'Uploaded to YouTube.')
      }
      if (locked) {
        addLog(
          y,
          'YouTube kept this video private. That happens until your Google Cloud project passes YouTube\'s API audit (see the setup guide).',
          'error'
        )
      }
    })
    if (post) {
      this.deps.notify?.(
        publishAt ? 'Short scheduled on YouTube' : 'Short uploaded',
        publishAt ? `${post.video.fileName} will go live at ${new Date(publishAt).toLocaleString()}.` : `${post.video.fileName} is on YouTube.`,
        postId
      )
    }
  }

  private setYt(postId: string, fn: (t: YouTubeTarget) => void): void {
    this.store.updatePost(postId, (p) => fn(p.youtube))
  }

  // ---------------- shared ----------------

  private stillActive(postId: string, platform: Platform): boolean {
    const p = this.store.getPost(postId)
    if (!p) return false
    const t = platform === 'instagram' ? p.instagram : p.youtube
    return t.enabled && t.state !== 'canceled'
  }

  private fail(postId: string, platform: Platform, err: unknown, retryState: TargetBase['state']): void {
    const e = err instanceof ApiError ? err : new ApiError((err as Error)?.message ?? String(err), { retriable: true })
    const post = this.store.getPost(postId)
    if (!post) return
    const now = this.now()
    let gaveUp = false
    this.store.updatePost(postId, (p) => {
      const t: TargetBase = platform === 'instagram' ? p.instagram : p.youtube
      if (t.state === 'canceled') return
      t.attempts = (t.attempts ?? 0) + 1
      t.progress = undefined
      t.error = e.message
      if (e.retriable && t.attempts < MAX_ATTEMPTS) {
        const wait = Math.max(backoffMs(t.attempts), e.opts.retryAfter ? e.opts.retryAfter.getTime() - now : 0)
        t.state = retryState
        t.nextAttemptAt = new Date(now + wait).toISOString()
        addLog(t, `${e.message} Retrying ${wait >= 3600_000 ? 'later' : `in ${Math.round(wait / 60_000) || 1} min`}.`, 'error')
      } else {
        t.state = 'failed'
        t.nextAttemptAt = undefined
        addLog(t, e.message, 'error')
        gaveUp = true
      }
    })
    if (gaveUp) {
      this.deps.notify?.(
        platform === 'instagram' ? 'Instagram post failed' : 'YouTube upload failed',
        `${post.video.fileName}: ${e.message}`,
        postId
      )
    }
  }
}

function key(postId: string, platform: Platform): string {
  return `${postId}:${platform}`
}

export function addLog(t: TargetBase, message: string, level: 'info' | 'error' = 'info'): void {
  t.log = [...(t.log ?? []), { at: new Date().toISOString(), message, level }].slice(-60)
}

function markPublished(t: TargetBase, at: number): void {
  t.state = 'published'
  t.publishedAt = new Date(at).toISOString()
  t.error = undefined
  t.nextAttemptAt = undefined
  t.progress = undefined
}
