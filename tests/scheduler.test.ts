import { beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateV1, Store, type Cipher } from '../src/main/store'
import { Scheduler } from '../src/main/scheduler'
import { ApiError } from '../src/main/http'
import { applyAction, PostError, reschedule, savePost } from '../src/main/posts'
import type { MediaInfo, PostDraftInput, VideoRef } from '../src/shared/types'

const cipher: Cipher = { encrypt: (s) => Buffer.from(s), decrypt: (b) => b.toString() }

const media: MediaInfo = {
  brand: 'isom',
  isQuickTime: false,
  durationSec: 20,
  width: 1080,
  height: 1920,
  rotation: 0,
  videoCodec: 'avc1',
  audioCodec: 'mp4a',
  audioSampleRate: 48000,
  audioChannels: 2,
  fps: 30,
  bitrate: 4e6,
  fastStart: true,
  hasEditList: false,
  isFragmented: false,
  sizeBytes: 1000
}

class FakeIG {
  calls: string[] = []
  statuses: string[] = []
  failPublish: ApiError | null = null
  failCreate: ApiError | null = null
  containerStatusOverride: string | null = null
  async createReelContainer() {
    this.calls.push('create')
    if (this.failCreate) throw this.failCreate
    return { id: `C${this.calls.length}`, uploadUri: 'https://up/x' }
  }
  async uploadVideo(_c: unknown, _u: string, _f: string, _s: number, p?: (f: number) => void) {
    this.calls.push('upload')
    p?.(0.5)
    p?.(1)
  }
  async containerStatus() {
    this.calls.push('status')
    if (this.containerStatusOverride) return { statusCode: this.containerStatusOverride }
    return { statusCode: this.statuses.shift() ?? 'FINISHED' }
  }
  publishedAs: string[] = []
  async publish(creds: { igUserId: string; accessToken: string }) {
    this.calls.push('publish')
    this.publishedAs.push(`${creds.igUserId}/${creds.accessToken}`)
    if (this.failPublish) throw this.failPublish
    return 'M1'
  }
  async permalink() {
    return 'https://instagram.com/reel/1'
  }
  async recentMedia() {
    return [{ id: 'M9', permalink: 'https://instagram.com/reel/9', caption: 'cap' }]
  }
}

class FakeYT {
  calls: string[] = []
  lastMeta: any
  videoPrivacy = 'public'
  failUploadOnce: ApiError | null = null
  uploadedAs: string[] = []
  async startUpload(t: { refreshToken: string }, meta: unknown) {
    this.calls.push('start')
    this.uploadedAs.push(t.refreshToken)
    this.lastMeta = meta
    return 'https://session/1'
  }
  thumbFail: Error | null = null
  async setThumbnail(_t: unknown, videoId: string, path: string) {
    this.calls.push(`thumb:${videoId}:${path.split('/').pop()}`)
    if (this.thumbFail) throw this.thumbFail
  }
  async queryUpload() {
    this.calls.push('query')
    return { offset: 500 }
  }
  async uploadFile(_t: unknown, _u: string, _f: string, _s: number, _p: unknown, offset = 0) {
    this.calls.push(`upload@${offset}`)
    if (this.failUploadOnce) {
      const e = this.failUploadOnce
      this.failUploadOnce = null
      throw e
    }
    return { id: 'V1', status: { privacyStatus: this.videoPrivacy } }
  }
}

let clock = Date.parse('2030-05-01T10:00:00Z')
let store: Store
let ig: FakeIG
let yt: FakeYT
let sched: Scheduler
let video: VideoRef
const notes: string[] = []

function setup(settings: Partial<Store['settings']> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cadence-sched-'))
  store = new Store(dir, cipher)
  store.setSettings({ instagramLeadMinutes: 10, ...settings })
  store.setAccounts({
    instagram: [{ id: 'IG', username: 'max' }],
    youtube: [{ id: 'UC1', channelTitle: 'Max' }],
    youtubeClientId: 'cid',
    youtubeHasSecret: true
  })
  store.setSecrets({ instagram: { accounts: { IG: { accessToken: 'tok' } } }, youtube: { clientSecret: 's', accounts: { UC1: { refreshToken: 'r' } } } })
  const file = join(dir, 'library', 'v.mp4')
  writeFileSync(file, Buffer.alloc(1000))
  video = { fileName: 'v.mp4', originalPath: '/x/v.mp4', libraryPath: file, sizeBytes: 1000, media }
  ig = new FakeIG()
  yt = new FakeYT()
  notes.length = 0
  sched = new Scheduler({
    store,
    instagram: () => ig as never,
    youtube: yt as never,
    now: () => clock,
    notify: (t) => notes.push(t),
    sleep: async () => {
      clock += 10_000
    },
    pollIntervalMs: 10_000
  })
}

function input(over: Partial<PostDraftInput> = {}): PostDraftInput {
  return {
    scheduledAt: new Date(clock + 3600_000).toISOString(),
    video,
    schedule: true,
    instagram: { enabled: true, caption: 'cap', shareToFeed: true, coverOffsetMs: null },
    youtube: { enabled: false, title: 'T', description: '', tags: [], privacy: 'public', madeForKids: false, categoryId: '22', mode: 'native' },
    ...over
  }
}

async function step() {
  await sched.tick()
  await sched.idle()
}

beforeEach(() => {
  clock = Date.parse('2030-05-01T10:00:00Z')
  setup()
})

describe('Instagram scheduling', () => {
  it('does nothing before the lead time, uploads early, publishes exactly on time', async () => {
    const p = savePost(store, input(), clock)
    await step()
    expect(ig.calls).toEqual([])

    clock += 50 * 60_000 + 1 // 9:59 before... = 10 min before the post
    await step()
    expect(ig.calls).toEqual(['create', 'upload', 'status'])
    expect(store.getPost(p.id)!.instagram.state).toBe('ready')
    expect(store.getPost(p.id)!.instagram.containerId).toBe('C1')

    clock = Date.parse(p.scheduledAt!) - 1000
    await step()
    expect(ig.calls).not.toContain('publish')

    clock = Date.parse(p.scheduledAt!)
    await step()
    const t = store.getPost(p.id)!.instagram
    expect(t.state).toBe('published')
    expect(t.url).toBe('https://instagram.com/reel/1')
    expect(ig.calls.filter((c) => c === 'publish').length).toBe(1)
    expect(notes).toContain('Reel published')
  })

  it('waits for processing (IN_PROGRESS) before publishing a "post now"', async () => {
    ig.statuses = ['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED']
    const p = savePost(store, input({ scheduledAt: null }), clock)
    await step()
    expect(ig.calls).toEqual(['create', 'upload', 'status', 'status', 'status', 'publish'])
    expect(store.getPost(p.id)!.instagram.state).toBe('published')
  })

  it('fails without retrying when Instagram reports a processing ERROR', async () => {
    ig.statuses = ['ERROR']
    const p = savePost(store, input({ scheduledAt: null }), clock)
    await step()
    const t = store.getPost(p.id)!.instagram
    expect(t.state).toBe('failed')
    expect(t.error).toMatch(/could not process/)
    expect(notes).toContain('Instagram post failed')
  })

  it('retries transient errors with backoff, then gives up after 6 attempts', async () => {
    ig.failCreate = new ApiError('Network error', { retriable: true })
    const p = savePost(store, input({ scheduledAt: null }), clock)
    for (let i = 0; i < 10; i++) {
      await step()
      const t = store.getPost(p.id)!.instagram
      if (t.state === 'failed') break
      expect(t.state).toBe('scheduled')
      clock = Date.parse(t.nextAttemptAt!) + 1
    }
    const t = store.getPost(p.id)!.instagram
    expect(t.state).toBe('failed')
    expect(t.attempts).toBe(6)
    expect(ig.calls.filter((c) => c === 'create').length).toBe(6)
  })

  it('never double-posts: a lost publish response is verified before retrying', async () => {
    const p = savePost(store, input({ scheduledAt: null }), clock)
    ig.failPublish = new ApiError('Network error: socket hang up', { retriable: true })
    await step()
    expect(store.getPost(p.id)!.instagram.state).toBe('publishing')
    // Meta actually published it.
    ig.failPublish = null
    ig.containerStatusOverride = 'PUBLISHED'
    clock = Date.parse(store.getPost(p.id)!.instagram.nextAttemptAt!) + 1
    await step()
    const t = store.getPost(p.id)!.instagram
    expect(t.state).toBe('published')
    expect(t.url).toBe('https://instagram.com/reel/9')
    expect(ig.calls.filter((c) => c === 'publish').length).toBe(1)
  })

  it('recovers after a crash mid-publish (state "publishing" on startup)', async () => {
    const p = savePost(store, input({ scheduledAt: null }), clock)
    store.updatePost(p.id, (x) => {
      x.instagram.state = 'publishing'
      x.instagram.containerId = 'C7'
    })
    ig.containerStatusOverride = 'FINISHED'
    await step()
    expect(ig.calls).toEqual(['status', 'publish'])
    expect(store.getPost(p.id)!.instagram.state).toBe('published')
  })

  it('re-uploads when the container expired before posting time', async () => {
    const p = savePost(store, input({ scheduledAt: new Date(clock + 48 * 3600_000).toISOString() }), clock)
    store.updatePost(p.id, (x) => {
      x.instagram.state = 'ready'
      x.instagram.containerId = 'OLD'
      x.instagram.containerCreatedAt = new Date(clock - 24 * 3600_000).toISOString()
    })
    await step()
    expect(store.getPost(p.id)!.instagram.state).toBe('scheduled')
    expect(store.getPost(p.id)!.instagram.containerId).toBeUndefined()
  })

  it('stops on an auth error and does not retry', async () => {
    ig.failCreate = new ApiError('Instagram sign-in expired', { retriable: false, authError: true })
    const p = savePost(store, input({ scheduledAt: null }), clock)
    await step()
    expect(store.getPost(p.id)!.instagram.state).toBe('failed')
    expect(ig.calls).toEqual(['create'])
  })

  it('honours pause', async () => {
    store.setSettings({ paused: true })
    savePost(store, input({ scheduledAt: null }), clock)
    await step()
    expect(ig.calls).toEqual([])
  })

  it('marks posts missed while the Mac was off when the policy is "ask"', async () => {
    setup({ missedPolicy: 'ask' })
    const p = savePost(store, input(), clock)
    clock += 5 * 3600_000
    sched.recoverMissed()
    await step()
    expect(store.getPost(p.id)!.instagram.state).toBe('missed')
    expect(ig.calls).toEqual([])
    applyAction(store, p.id, 'postNow', undefined, clock)
    await step()
    expect(store.getPost(p.id)!.instagram.state).toBe('published')
  })

  it('posts late posts right away with the default policy', async () => {
    const p = savePost(store, input(), clock)
    clock += 5 * 3600_000
    sched.recoverMissed()
    await step()
    expect(store.getPost(p.id)!.instagram.state).toBe('published')
  })

  it('refuses to upload an invalid video', async () => {
    const bad = { ...video, media: { ...media, durationSec: 1 } }
    const p = savePost(store, input({ video: bad, schedule: false }), clock)
    applyAction(store, p.id, 'postNow', undefined, clock)
    await step()
    expect(store.getPost(p.id)!.instagram.state).toBe('failed')
    expect(ig.calls).toEqual([])
  })
})

describe('YouTube scheduling', () => {
  const ytOnly = (over: Partial<PostDraftInput['youtube']> = {}, at: string | null = new Date(clock + 24 * 3600_000).toISOString()) =>
    input({
      scheduledAt: at,
      instagram: { enabled: false, caption: '', shareToFeed: true, coverOffsetMs: null },
      youtube: { enabled: true, title: 'My Short', description: 'd', tags: [], privacy: 'public', madeForKids: false, categoryId: '22', mode: 'native', ...over }
    })

  it('native mode uploads immediately with publishAt, then marks published at the time', async () => {
    const p = savePost(store, ytOnly(), clock)
    await step()
    expect(yt.calls).toEqual(['start', 'upload@0'])
    expect(yt.lastMeta.publishAt).toBe(p.scheduledAt)
    let t = store.getPost(p.id)!.youtube
    expect(t.state).toBe('scheduled_remote')
    expect(t.url).toBe('https://www.youtube.com/shorts/V1')
    expect(store.quotaUsed()).toBe(1)

    clock = Date.parse(p.scheduledAt!)
    await step()
    t = store.getPost(p.id)!.youtube
    expect(t.state).toBe('published')
  })

  it('unlisted videos wait and upload at the time (publishAt only works for public)', async () => {
    const p = savePost(store, ytOnly({ privacy: 'unlisted' }), clock)
    await step()
    expect(yt.calls).toEqual([])
    clock = Date.parse(p.scheduledAt!)
    await step()
    expect(yt.lastMeta.publishAt).toBeUndefined()
    expect(yt.lastMeta.privacy).toBe('unlisted')
    expect(store.getPost(p.id)!.youtube.state).toBe('published')
  })

  it('resumes an interrupted upload from the saved session', async () => {
    yt.failUploadOnce = new ApiError('Network error', { retriable: true })
    const p = savePost(store, ytOnly({}, null), clock)
    await step()
    let t = store.getPost(p.id)!.youtube
    expect(t.state).toBe('uploading')
    expect(t.uploadUrl).toBe('https://session/1')
    clock = Date.parse(t.nextAttemptAt!) + 1
    await step()
    expect(yt.calls).toEqual(['start', 'upload@0', 'query', 'upload@500'])
    t = store.getPost(p.id)!.youtube
    expect(t.state).toBe('published')
  })

  it('flags uploads that YouTube kept private', async () => {
    yt.videoPrivacy = 'private'
    const p = savePost(store, ytOnly({}, null), clock)
    await step()
    const t = store.getPost(p.id)!.youtube
    expect(t.state).toBe('published')
    expect(t.log.some((l) => l.level === 'error' && /private/.test(l.message))).toBe(true)
  })

  it('sets the custom thumbnail after the upload, and a refused thumbnail never fails the post', async () => {
    const thumb = join(store.libraryDir, 'abc.ytthumb.png')
    writeFileSync(thumb, Buffer.alloc(10))
    const p = savePost(store, ytOnly({ thumbnailPath: thumb }, null), clock)
    yt.thumbFail = new ApiError('YouTube only allows custom thumbnails on verified channels.', { retriable: false })
    await step()
    expect(yt.calls).toEqual(['start', 'upload@0', 'thumb:V1:abc.ytthumb.png'])
    const t = store.getPost(p.id)!.youtube
    expect(t.state).toBe('published')
    expect(t.log.some((l) => l.level === 'error' && /thumbnail wasn't set: YouTube only allows/.test(l.message))).toBe(true)
  })

  it('rejects a thumbnail outside the app library', () => {
    expect(() => savePost(store, ytOnly({ thumbnailPath: '/etc/passwd' }, null), clock)).toThrow(/thumbnail/i)
  })

  it('posts to both platforms independently', async () => {
    const p = savePost(store, input({ scheduledAt: null, youtube: { enabled: true, title: 'T', description: '', tags: [], privacy: 'public', madeForKids: false, categoryId: '22', mode: 'native' } }), clock)
    await step()
    const post = store.getPost(p.id)!
    expect(post.instagram.state).toBe('published')
    expect(post.youtube.state).toBe('published')
  })
})

describe('Saving and editing posts', () => {
  it('validates before scheduling', () => {
    expect(() => savePost(store, input({ instagram: { enabled: false, caption: '', shareToFeed: true, coverOffsetMs: null } }), clock)).toThrow(PostError)
    expect(() => savePost(store, input({ scheduledAt: new Date(clock - 3600_000).toISOString() }), clock)).toThrow(/past/)
    expect(() => savePost(store, input({ instagram: { enabled: true, caption: 'x'.repeat(2300), shareToFeed: true, coverOffsetMs: null } }), clock)).toThrow(/Caption/)
    store.setAccounts({ instagram: [] })
    expect(() => savePost(store, input(), clock)).toThrow(/Connect Instagram/)
  })

  it('saves drafts without account checks', () => {
    store.setAccounts({ instagram: [] })
    const p = savePost(store, input({ schedule: false }), clock)
    expect(p.instagram.state).toBe('draft')
  })

  it('keeps an uploaded reel when only the time moves, re-uploads when the caption changes', () => {
    const p = savePost(store, input(), clock)
    store.updatePost(p.id, (x) => {
      x.instagram.state = 'ready'
      x.instagram.containerId = 'C1'
    })
    const later = new Date(clock + 7200_000).toISOString()
    let q = savePost(store, { ...input({ scheduledAt: later }), id: p.id }, clock)
    expect(q.instagram.state).toBe('ready')
    expect(q.instagram.containerId).toBe('C1')
    q = savePost(store, { ...input({ scheduledAt: later, instagram: { enabled: true, caption: 'new', shareToFeed: true, coverOffsetMs: null } }), id: p.id }, clock)
    expect(q.instagram.state).toBe('scheduled')
    expect(q.instagram.containerId).toBeUndefined()
  })

  it('blocks edits while uploading and after publishing', () => {
    const p = savePost(store, input(), clock)
    store.updatePost(p.id, (x) => (x.instagram.state = 'uploading'))
    expect(() => savePost(store, { ...input({ instagram: { enabled: true, caption: 'changed', shareToFeed: true, coverOffsetMs: null } }), id: p.id }, clock)).toThrow(/uploading/)
    expect(() => applyAction(store, p.id, 'cancel', undefined, clock)).toThrow(/uploading/)
    store.updatePost(p.id, (x) => (x.instagram.state = 'published'))
    expect(() => reschedule(store, p.id, new Date(clock + 9e6).toISOString(), clock)).not.toThrow()
  })

  it('refuses to reschedule a Short already scheduled on YouTube', () => {
    const p = savePost(store, input({ instagram: { enabled: false, caption: '', shareToFeed: true, coverOffsetMs: null }, youtube: { enabled: true, title: 'T', description: '', tags: [], privacy: 'public', madeForKids: false, categoryId: '22', mode: 'native' } }), clock)
    store.updatePost(p.id, (x) => (x.youtube.state = 'scheduled_remote'))
    expect(() => reschedule(store, p.id, new Date(clock + 9e6).toISOString(), clock)).toThrow(/YouTube Studio/)
  })

  it('persists to disk and reloads', async () => {
    const p = savePost(store, input(), clock)
    await store.flush()
    const again = new Store(store.dataDir, cipher)
    expect(again.getPost(p.id)?.instagram.caption).toBe('cap')
    expect(again.getSecrets().instagram?.accounts.IG?.accessToken).toBe('tok')
  })
})

describe('Multiple accounts', () => {
  function addSecondAccounts() {
    store.setAccounts({
      ...store.accounts,
      instagram: [...store.accounts.instagram, { id: 'IG2', username: 'cooks' }],
      youtube: [...store.accounts.youtube, { id: 'UC2', channelTitle: 'Cooks' }]
    })
    store.setIgSecret('IG2', { accessToken: 'tok2' })
    store.setYtSecret('UC2', { refreshToken: 'r2' })
  }
  const ytOn = { enabled: true, title: 'T', description: '', tags: [], privacy: 'public' as const, madeForKids: false, categoryId: '22', mode: 'atTime' as const }

  it('posts each reel and Short with its own account', async () => {
    addSecondAccounts()
    savePost(store, input({ scheduledAt: null, instagram: { enabled: true, accountId: 'IG2', caption: 'a', shareToFeed: true, coverOffsetMs: null }, youtube: { ...ytOn, accountId: 'UC2' } }), clock)
    savePost(store, input({ scheduledAt: null, instagram: { enabled: true, accountId: 'IG', caption: 'b', shareToFeed: true, coverOffsetMs: null }, youtube: { ...ytOn, accountId: 'UC1' } }), clock)
    await step()
    await step()
    expect(ig.publishedAs.sort()).toEqual(['IG/tok', 'IG2/tok2'])
    expect(yt.uploadedAs.sort()).toEqual(['r', 'r2'])
  })

  it('defaults to the first account and refuses one that was removed', () => {
    addSecondAccounts()
    expect(savePost(store, input(), clock).instagram.accountId).toBe('IG')
    expect(() => savePost(store, input({ instagram: { enabled: true, accountId: 'GONE', caption: 'x', shareToFeed: true, coverOffsetMs: null } }), clock)).toThrow(/no longer connected/)
  })

  it('fails only the posts of an account whose sign-in is gone', async () => {
    addSecondAccounts()
    const a = savePost(store, input({ scheduledAt: null, instagram: { enabled: true, accountId: 'IG2', caption: 'a', shareToFeed: true, coverOffsetMs: null } }), clock)
    const b = savePost(store, input({ scheduledAt: null }), clock)
    store.setIgSecret('IG2', undefined)
    await step()
    await step()
    expect(store.getPost(a.id)!.instagram.state).toBe('failed')
    expect(store.getPost(b.id)!.instagram.state).toBe('published')
  })
})

describe('Upgrading from one account per platform', () => {
  it('moves the old account, its sign-in, posts and view history over', () => {
    const raw = {
      accounts: {
        instagram: { connected: true, igUserId: '1784', username: 'max', appId: 'app' },
        youtube: { connected: true, channelId: 'UCx', channelTitle: 'Max', clientId: 'cid', hasSecret: true, quotaUsedToday: 0 }
      },
      posts: [{ id: 'p1', instagram: { state: 'scheduled' }, youtube: { state: 'scheduled' } }],
      insights: { history: [{ day: '2026-11-01', instagram: 10, youtube: 20 }] }
    }
    const secrets = { instagram: { appSecret: 'as', accessToken: 't', userToken: 'u' }, youtube: { clientSecret: 'cs', refreshToken: 'r' } }
    const out = migrateV1(raw, secrets)
    expect(out.state.accounts!.instagram).toMatchObject([{ id: '1784', username: 'max' }])
    expect(out.state.accounts!.youtube).toMatchObject([{ id: 'UCx', channelTitle: 'Max' }])
    expect(out.state.accounts!.instagramAppId).toBe('app')
    expect(out.state.accounts!.youtubeClientId).toBe('cid')
    expect(out.state.posts![0].instagram.accountId).toBe('1784')
    expect(out.state.posts![0].youtube.accountId).toBe('UCx')
    expect(out.state.insights!.history).toEqual([{ day: '2026-11-01', values: { 'instagram:1784': 10, 'youtube:UCx': 20 } }])
    expect(out.secrets).toEqual({
      instagram: { appSecret: 'as', accounts: { '1784': { accessToken: 't', userToken: 'u' } } },
      youtube: { clientSecret: 'cs', accounts: { UCx: { refreshToken: 'r', accessToken: undefined, accessTokenExpiresAt: undefined } } }
    })
  })

  it('upgrades a saved data folder on first launch and keeps a backup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadence-v1-'))
    writeFileSync(
      join(dir, 'state.json'),
      JSON.stringify({ posts: [], settings: {}, accounts: { instagram: { connected: true, igUserId: '9', username: 'old' }, youtube: { connected: false, quotaUsedToday: 0 } } })
    )
    const s = new Store(dir, cipher)
    expect(s.accounts.instagram).toMatchObject([{ id: '9', username: 'old' }])
    expect(s.accounts.youtube).toEqual([])
    await s.flush()
    expect(existsSync(join(dir, 'state.json.v1-backup'))).toBe(true)
    expect(new Store(dir, cipher).accounts.instagram[0].id).toBe('9')
  })
})
