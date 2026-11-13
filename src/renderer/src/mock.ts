// In-browser stand-in for the Electron bridge. Used only by `npm run demo`
// (UI development and screenshots), never in the real app.

import type { CadenceApi } from '../../preload/api'
import type { AppSnapshot, MediaInfo, Post, Settings, VideoRef } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/defaults'

const media = (over: Partial<MediaInfo> = {}): MediaInfo => ({
  brand: 'isom',
  isQuickTime: false,
  durationSec: 27.4,
  width: 1080,
  height: 1920,
  rotation: 0,
  videoCodec: 'avc1',
  audioCodec: 'mp4a',
  audioSampleRate: 48000,
  audioChannels: 2,
  fps: 30,
  bitrate: 8_000_000,
  fastStart: true,
  hasEditList: false,
  isFragmented: false,
  sizeBytes: 27_400_000,
  ...over
})

const video = (name: string, i: number, over: Partial<MediaInfo> = {}): VideoRef => ({
  fileName: name,
  originalPath: `/Users/max/Movies/${name}`,
  libraryPath: `/demo/clip${(i % 3) + 1}.mp4`,
  thumbnailPath: `/demo/thumb${(i % 3) + 1}.jpg`,
  sizeBytes: media(over).sizeBytes,
  media: media(over)
})

function hoursFromNow(h: number, minute = 0): string {
  const d = new Date(Date.now() + h * 3600_000)
  d.setMinutes(minute, 0, 0)
  return d.toISOString()
}

function post(i: number, name: string, at: string | null, ig: Partial<Post['instagram']>, yt: Partial<Post['youtube']>, caption: string, title: string): Post {
  return {
    id: `demo-${i}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    scheduledAt: at,
    video: video(name, i),
    instagram: { enabled: true, state: 'scheduled', attempts: 0, log: [], caption, shareToFeed: true, coverOffsetMs: null, ...ig },
    youtube: {
      enabled: true,
      state: 'scheduled',
      attempts: 0,
      log: [],
      title,
      description: caption,
      tags: ['shorts'],
      privacy: 'public',
      madeForKids: false,
      categoryId: '22',
      mode: 'native',
      ...yt
    }
  }
}

const settings: Settings = { ...DEFAULT_SETTINGS, snippets: [{ id: 's1', name: 'Core tags', text: '#reels #creator #fyp' }, { id: 's2', name: 'Link in bio', text: 'Full video → link in bio 🔗' }] }

const day = (n: number) => {
  const d = new Date(Date.now() - n * 86400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const stat = (id: string, title: string, views: number, daysAgo: number, thumb: number) => ({
  id,
  title,
  views,
  likes: Math.round(views * 0.06),
  comments: Math.round(views * 0.004),
  publishedAt: new Date(Date.now() - daysAgo * 86400_000).toISOString(),
  thumbnailUrl: `/demo/thumb${thumb}.jpg`,
  url: 'https://example.com'
})
const igTop = [stat('i1', '5am routine that actually stuck ☀️', 412_300, 9, 1), stat('i2', 'Desk setup tour 2026 🖥️', 188_900, 21, 2), stat('i3', 'Latte art in slow motion ☕️', 96_400, 3, 3)]
const ytTop = [stat('y1', 'My 5am routine that actually stuck ☀️', 1_204_000, 9, 1), stat('y2', 'Golden hour in Shibuya', 342_500, 30, 3), stat('y3', 'Desk setup tour 2026 🖥️', 120_200, 21, 2)]

let state: AppSnapshot = {
  version: '1.0.0',
  analytics: { refreshing: false },
  insights: {
    refreshing: false,
    history: Array.from({ length: 30 }, (_, i) => ({ day: day(29 - i), instagram: 1_480_000 + i * 9_800 + (i % 4) * 2_100, youtube: 3_900_000 + i * 31_000 + (i % 3) * 7_000 })),
    instagram: { fetchedAt: new Date().toISOString(), totalViews: 1_772_400, followers: 48_210, postCount: 212, countedPosts: 212, top: igTop, recent: igTop },
    youtube: { fetchedAt: new Date().toISOString(), totalViews: 4_830_000, followers: 61_400, postCount: 148, countedPosts: 148, top: ytTop, recent: ytTop }
  },
  settings,
  accounts: {
    instagram: { connected: true, username: 'max.creates', pageName: 'Max Creates', igUserId: '1784', appId: '123', hasSecret: true },
    youtube: { connected: true, channelTitle: 'Max Creates', channelId: 'UC1', clientId: 'x.apps.googleusercontent.com', hasSecret: true, quotaUsedToday: 3200 }
  },
  posts: [
    post(1, 'morning-routine-v3.mp4', hoursFromNow(1, 30), { state: 'ready' }, { state: 'scheduled_remote', url: 'https://youtube.com' }, 'My 5am routine that actually stuck ☀️ Save this for tomorrow morning.\n\n#morningroutine #productivity #habits', 'My 5am routine that actually stuck ☀️'),
    post(2, 'desk-setup-tour.mp4', hoursFromNow(4), { state: 'uploading', progress: 0.62 }, { state: 'uploading', progress: 0.38 }, 'Desk setup tour 2026 — everything linked in bio 🖥️ #desksetup #workspace', 'Desk setup tour 2026 🖥️'),
    post(3, 'coffee-art-slowmo.mp4', hoursFromNow(26), {}, {}, 'Latte art in slow motion never gets old ☕️ #coffee #latteart', 'Latte art in slow motion ☕️'),
    post(4, 'city-walk-tokyo.mp4', hoursFromNow(50), {}, { enabled: false }, 'Golden hour in Shibuya 🌆 #tokyo #travel', 'Golden hour in Shibuya'),
    post(5, 'gym-progress.mp4', hoursFromNow(74), { enabled: false }, {}, '6 months of training in 30 seconds 💪', '6 months of training in 30 seconds 💪'),
    post(6, 'recipe-pasta.mp4', hoursFromNow(122), {}, {}, '15-minute garlic pasta 🍝 #recipe #pasta', '15-minute garlic pasta 🍝'),
    post(7, 'studio-vlog-12.mp4', hoursFromNow(-20), { state: 'published', url: 'https://instagram.com', publishedAt: hoursFromNow(-20) }, { state: 'published', url: 'https://youtube.com', publishedAt: hoursFromNow(-20) }, 'Studio vlog #12 🎙️', 'Studio vlog #12 🎙️'),
    post(8, 'sunset-drone.mp4', hoursFromNow(-44), { state: 'failed', error: 'Instagram could not process this video (ERROR). Check the format: H.264, AAC audio, 23–60 fps.' }, { state: 'published', url: 'https://youtube.com', publishedAt: hoursFromNow(-44) }, 'Sunset from 120m up 🚁', 'Sunset from 120m up 🚁'),
    post(9, 'q-and-a.mp4', hoursFromNow(-70), { state: 'published', url: 'https://instagram.com', publishedAt: hoursFromNow(-70) }, { enabled: false }, 'Answering your questions 💬', 'Q&A')
  ]
}

const listeners = new Set<(s: AppSnapshot) => void>()
const emit = () => listeners.forEach((l) => l(structuredClone(state)))
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms))

export const mockApi: CadenceApi = {
  async getState() {
    return structuredClone(state)
  },
  onState(cb) {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
  onProgress() {
    return () => undefined
  },
  onNavigate() {
    return () => undefined
  },
  async pickVideos() {
    await delay()
    return [
      { ok: true, video: { ...video('new-reel-01.mp4', 0), thumbnailPath: undefined } },
      { ok: true, video: { ...video('new-reel-02.mp4', 1), thumbnailPath: undefined } },
      { ok: true, video: { ...video('landscape-clip.mp4', 2, { width: 1920, height: 1080, durationSec: 212 }), thumbnailPath: undefined } }
    ]
  },
  async importFiles() {
    return this.pickVideos()
  },
  async saveThumbnail() {
    return undefined
  },
  async savePost(input) {
    await delay()
    const p = post(Date.now(), input.video.fileName, input.scheduledAt, { ...input.instagram, state: input.schedule ? 'scheduled' : 'draft' }, { ...input.youtube, state: input.schedule ? 'scheduled' : 'draft' }, input.instagram.caption, input.youtube.title)
    p.video = input.video
    state = { ...state, posts: [...state.posts.filter((x) => x.id !== input.id), p] }
    emit()
    return p
  },
  async savePosts(inputs) {
    const out = []
    for (const i of inputs) out.push(await this.savePost(i))
    return out
  },
  async deletePost(id) {
    state = { ...state, posts: state.posts.filter((p) => p.id !== id) }
    emit()
  },
  async postAction(id) {
    return state.posts.find((p) => p.id === id)!
  },
  async reschedule(id, iso) {
    state = { ...state, posts: state.posts.map((p) => (p.id === id ? { ...p, scheduledAt: iso } : p)) }
    emit()
    return state.posts.find((p) => p.id === id)!
  },
  async updateSettings(patch) {
    state = { ...state, settings: { ...state.settings, ...patch } }
    emit()
    return state.settings
  },
  async instagramConnect() {
    await delay(800)
    return [{ pageId: '1', pageName: 'Max Creates', igUserId: '1784', username: 'max.creates' }]
  },
  async instagramChoose() {
    return state.accounts.instagram
  },
  async instagramDisconnect() {
    state = { ...state, accounts: { ...state.accounts, instagram: { connected: false } } }
    emit()
  },
  async instagramLimit() {
    return { used: 4, total: 100 }
  },
  async youtubeConnect() {
    await delay(1500)
    return state.accounts.youtube
  },
  async youtubeDisconnect() {
    state = { ...state, accounts: { ...state.accounts, youtube: { connected: false, quotaUsedToday: 0 } } }
    emit()
  },
  async importPaths() {
    return this.pickVideos()
  },
  async listFolder() {
    const names = ['morning-routine-v3.mp4', 'desk-setup-tour.mp4', 'coffee-art-slowmo.mp4', 'city-walk-tokyo.mp4', 'gym-progress.mp4', 'Raw/landscape-vlog.mp4']
    return {
      folder: state.settings.libraryFolder ?? '/Users/max/Movies/Exports',
      exists: true,
      truncated: false,
      scannedAt: new Date().toISOString(),
      videos: names.map((n, i) => ({
        path: `/Users/max/Movies/Exports/${n}`,
        relPath: n,
        name: n.split('/').pop()!,
        sizeBytes: 20_000_000 + i * 3_000_000,
        mtimeMs: Date.now() - i * 86400_000,
        media: media(n.includes('landscape') ? { width: 1920, height: 1080, durationSec: 212 } : { durationSec: 12 + i * 7 }),
        thumbUrl: `/demo/thumb${(i % 3) + 1}.jpg`
      }))
    }
  },
  async chooseFolder() {
    state = { ...state, settings: { ...state.settings, libraryFolder: '/Users/max/Movies/Exports' } }
    emit()
    return this.listFolder()
  },
  async saveFolderThumb() {
    return undefined
  },
  onFolderChanged() {
    return () => undefined
  },
  folderUrl(rel) {
    return `/demo/clip${(rel.length % 3) + 1}.mp4`
  },
  async refreshAnalytics() {
    return state.analytics
  },
  async retention() {
    return Array.from({ length: 100 }, (_, i) => ({ at: (i + 1) / 100, watch: Math.max(0.2, 1.05 - i * 0.006 - (i < 5 ? 0.1 : 0)), relative: 0.62 }))
  },
  async refreshInsights() {
    await delay(900)
    return state.insights
  },
  async openExternal(url) {
    window.open(url, '_blank')
  },
  async reveal() {},
  async openDataFolder() {},
  platform: 'darwin',
  mediaUrl(path) {
    return path
  }
}
