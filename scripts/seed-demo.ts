// Seeds a realistic demo state for screenshots: `npx tsx scripts/seed-demo.ts <dataDir> <videosDir>`
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { mkdirSync, rmSync } from 'node:fs'
import { Store } from '../src/main/store'
import { importVideo } from '../src/main/media'
import type { Post } from '../src/shared/types'

const [dataDir, videos] = process.argv.slice(2)
rmSync(dataDir, { recursive: true, force: true })
const store = new Store(dataDir, { encrypt: (s) => Buffer.from(`plain:${s}`), decrypt: (b) => b.toString().slice(6) })
const IG1 = '17841400000000000'
const IG2 = '17841400000000001'
const YT1 = 'UC123'
const YT2 = 'UC456'
store.setAccounts({
  instagram: [
    { id: IG1, username: 'max.creates', pageName: 'Max Creates' },
    { id: IG2, username: 'max.cooks', pageName: 'Max Cooks' }
  ],
  youtube: [
    { id: YT1, channelTitle: 'Max Creates' },
    { id: YT2, channelTitle: 'Max Cooks' }
  ],
  instagramAppId: '1234567890',
  youtubeClientId: 'x.apps.googleusercontent.com',
  youtubeHasSecret: true
})
store.setSecrets({
  instagram: { appSecret: 'demo', accounts: { [IG1]: { accessToken: 'demo', userToken: 'demo' }, [IG2]: { accessToken: 'demo', userToken: 'demo' } } },
  youtube: { clientSecret: 'demo', accounts: { [YT1]: { refreshToken: 'demo' }, [YT2]: { refreshToken: 'demo' } } }
})
store.setSettings({ snippets: [{ id: 's1', name: 'Core tags', text: '#reels #creator #dailyvlog' }, { id: 's2', name: 'Link in bio', text: 'Full video → link in bio 🔗' }] })
store.addQuota(3)

const H = 3600_000
function at(hours: number, minute = 0) {
  const d = new Date(Date.now() + hours * H)
  d.setMinutes(minute, 0, 0)
  return d.toISOString()
}

async function add(file: string, when: string, cap: string, title: string, ig: Partial<Post['instagram']>, yt: Partial<Post['youtube']>) {
  const r = await importVideo(store.libraryDir, join(videos, file))
  if (!r.ok) throw new Error(r.error)
  const v = r.video!
  const thumb = v.libraryPath.replace(/\.mp4$/, '.thumb.jpg')
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1', '-i', v.libraryPath, '-frames:v', '1', '-vf', 'scale=360:-1', thumb])
  v.thumbnailPath = thumb
  const now = new Date().toISOString()
  const p: Post = {
    id: `demo-${file}-${store.posts.length}`,
    createdAt: now,
    updatedAt: now,
    scheduledAt: when,
    video: v,
    instagram: { enabled: true, accountId: IG1, state: 'scheduled', attempts: 0, log: [], caption: cap, shareToFeed: true, coverOffsetMs: null, ...ig },
    youtube: { enabled: true, accountId: YT1, state: 'scheduled', attempts: 0, log: [], title, description: cap, tags: ['shorts'], privacy: 'public', madeForKids: false, categoryId: '22', mode: 'atTime', ...yt }
  }
  store.upsertPost(p)
}

;(async () => {
  await add('morning-routine.mp4', at(3, 30), 'My 5am routine that actually stuck ☀️ Save this for tomorrow morning.\n\n#morningroutine #productivity', 'My 5am routine that actually stuck ☀️', {}, { state: 'scheduled_remote', mode: 'native', url: 'https://youtube.com/shorts/x' })
  await add('desk-setup.mp4', at(27), 'Desk setup tour 2026, everything linked in bio 🖥️ #desksetup #workspace', 'Desk setup tour 2026 🖥️', {}, { state: 'scheduled_remote', mode: 'native' })
  await add('latte-art.mp4', at(51, 15), 'Latte art in slow motion never gets old ☕️ #coffee #latteart', 'Latte art in slow motion ☕️', { accountId: IG2 }, { enabled: false })
  await add('tokyo.mp4', at(98), 'Golden hour in Shibuya 🌆 #tokyo #travel', 'Golden hour in Shibuya', { enabled: false }, {})
  await add('latte-art.mp4', at(75), '15-minute garlic pasta 🍝 #recipe #pasta', '15-minute garlic pasta 🍝', { accountId: IG2 }, { accountId: YT2 })
  await add('morning-routine.mp4', at(-22), 'Studio vlog #12 🎙️', 'Studio vlog #12', { state: 'published', url: 'https://instagram.com/reel/x', publishedAt: at(-22) }, { state: 'published', url: 'https://youtube.com/shorts/y', publishedAt: at(-22), videoId: 'vid0abcdef' })
  await add('desk-setup.mp4', at(-46), 'Sunset from 120m up 🚁', 'Sunset from 120m up', { state: 'failed', error: 'Instagram could not process this video (ERROR). Check the format: H.264, AAC audio, 23–60 fps.', attempts: 1 }, { state: 'published', url: 'https://youtube.com/shorts/z', publishedAt: at(-46) })
  // Library folder + view counts for the Library and Views tabs.
  store.setSettings({ libraryFolder: videos })
  const thumbs = join(dataDir, 'thumbs')
  mkdirSync(thumbs, { recursive: true })
  const thumbUrl = (file: string, i: number) => {
    const name = `${String(i).padStart(2, '0')}${'ab'.repeat(11)}.jpg`
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1', '-i', join(videos, file), '-frames:v', '1', '-vf', 'scale=200:-1', join(thumbs, name)])
    return `cadence-media://thumbs/${name}`
  }
  const files = ['morning-routine.mp4', 'desk-setup.mp4', 'latte-art.mp4', 'tokyo.mp4']
  const t = files.map(thumbUrl)
  const day = (n: number) => {
    const d = new Date(Date.now() - n * 86400_000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const m = (id: string, title: string, views: number, daysAgo: number, thumb: string, via = false) => ({
    id,
    title,
    views,
    likes: Math.round(views * 0.061),
    comments: Math.round(views * 0.0042),
    publishedAt: new Date(Date.now() - daysAgo * 86400_000).toISOString(),
    thumbnailUrl: thumb,
    url: 'https://example.com',
    viaCadence: via || undefined
  })
  const igTop = [
    m('i0', 'Morning coffee ritual ☕️', 8_420, 0.04, t[2]),
    m('i1', 'My 5am routine that actually stuck ☀️', 412_380, 9, t[0], true),
    m('i2', 'Desk setup tour 2026, everything linked in bio 🖥️', 188_940, 21, t[1]),
    m('i3', 'Latte art in slow motion never gets old ☕️', 96_410, 3, t[2], true),
    m('i4', 'Golden hour in Shibuya 🌆', 54_200, 34, t[3]),
    m('i5', 'Studio vlog #12 🎙️', 21_870, 1, t[0], true)
  ]
  const ytTop = [
    m('y0', 'One-minute desk reset', 12_960, 0.06, t[1]),
    m('y1', 'My 5am routine that actually stuck ☀️', 1_204_330, 9, t[0], true),
    m('y2', 'Golden hour in Shibuya', 342_515, 30, t[3]),
    m('y3', 'Desk setup tour 2026 🖥️', 120_204, 21, t[1]),
    m('y4', 'Sunset from 120m up', 88_017, 2, t[1], true),
    m('y5', 'Latte art in slow motion ☕️', 40_660, 3, t[2])
  ]
  const fetchedAt = new Date().toISOString()
  // Posting history with a clear pattern: evenings and weekends do best.
  const demoTiming = (n: number, base: number, seed: number): [string, number][] => {
    let r = seed
    const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280)
    const hours = [8, 9, 12, 13, 15, 18, 19, 20, 21, 22]
    return Array.from({ length: n }, (_, i) => {
      const d = new Date(Date.now() - (3 + i * 1.4) * 86400_000)
      const h = hours[Math.floor(rand() * hours.length)]
      d.setHours(h, Math.floor(rand() * 60), 0, 0)
      const growth = 1 + (n - i) / n
      const timeBoost = h >= 18 && h < 21 ? 2.4 : h >= 21 ? 1.5 : h >= 12 && h < 15 ? 1.15 : h < 12 ? 0.55 : 0.9
      const dayBoost = d.getDay() === 0 || d.getDay() === 6 ? 1.35 : 1
      return [d.toISOString(), Math.round(base * growth * timeBoost * dayBoost * (0.6 + rand() * 0.8))]
    })
  }
  const k = (p: 'instagram' | 'youtube', id: string) => `${p}:${id}` as const
  const scale = <T extends { id: string; views: number }>(xs: T[], f: number) => xs.filter((x) => !/^[iy]0$/.test(x.id) || x.id === 'i0').map((x) => ({ ...x, id: `${x.id}b`, views: Math.round(x.views * f) }))
  store.setInsights({
    refreshing: false,
    errors: {},
    history: Array.from({ length: 91 }, (_, i) => ({
      day: day(90 - i),
      values: {
        [k('instagram', IG1)]: Math.round(1_210_000 + i * 6_100 + Math.sin(i / 3) * 4_000 + (i > 70 ? (i - 70) * 9_000 : 0)),
        [k('instagram', IG2)]: Math.round(240_000 + i * 2_300 + Math.sin(i / 5) * 1_500),
        [k('youtube', YT1)]: Math.round(3_550_000 + i * 14_500 + Math.cos(i / 4) * 9_000 + (i > 78 ? (i - 78) * 30_000 : 0)),
        [k('youtube', YT2)]: Math.round(610_000 + i * 4_800 + Math.cos(i / 6) * 3_000)
      }
    })),
    accounts: {
      [k('instagram', IG1)]: { platform: 'instagram' as const, accountId: IG1, fetchedAt, totalViews: 1_982_640, followers: 48_213, postCount: 212, countedPosts: 212, top: igTop, recent: igTop, timing: demoTiming(140, 6_000, 7) },
      [k('instagram', IG2)]: { platform: 'instagram' as const, accountId: IG2, fetchedAt, totalViews: 451_200, followers: 9_870, postCount: 64, countedPosts: 64, top: scale(igTop, 0.22), recent: scale(igTop, 0.22), timing: demoTiming(60, 1_500, 3) },
      [k('youtube', YT1)]: { platform: 'youtube' as const, accountId: YT1, fetchedAt, totalViews: 5_216_904, followers: 61_480, postCount: 148, countedPosts: 148, top: ytTop, recent: ytTop, timing: demoTiming(110, 14_000, 11) },
      [k('youtube', YT2)]: { platform: 'youtube' as const, accountId: YT2, fetchedAt, totalViews: 1_045_330, followers: 12_040, postCount: 57, countedPosts: 57, top: scale(ytTop, 0.18), recent: scale(ytTop, 0.18), timing: demoTiming(50, 3_000, 5) }
    }
  })
  const titles = ['My 5am routine that actually stuck ☀️', 'Desk setup tour 2026 🖥️', 'Latte art in slow motion ☕️', 'Golden hour in Shibuya 🌆', 'Studio vlog #12 🎙️', 'Sunset from 120m up 🚁', '3 habits that changed my mornings', 'What I eat in a day', 'Room makeover in 30 seconds', 'Coffee shop tour, Tokyo']
  // 40 posts with a length pattern: 15-20 s does best, a minute or more does worst.
  const LENS = [12, 17, 24, 8, 19, 35, 16, 52, 27, 14, 75, 18, 42, 22, 9, 17]
  const lenBoost = (d: number) => (d >= 15 && d < 20 ? 1.9 : d < 10 ? 0.8 : d < 15 ? 1.2 : d < 30 ? 1 : d < 45 ? 0.7 : 0.45)
  const lenWatch = (d: number) => (d < 10 ? 128 : d < 15 ? 96 : d < 20 ? 88 : d < 30 ? 71 : d < 45 ? 58 : 41)
  const reels = Array.from({ length: 40 }, (_, i) => {
    const title = titles[i % titles.length]
    const dur = LENS[i % LENS.length]
    const views = Math.round((90_000 - i * 1_200) * lenBoost(dur) * (0.75 + ((i * 37) % 11) / 20))
    const watchPct = lenWatch(dur) * (0.9 + ((i * 13) % 5) / 25)
    return {
      id: `r${i}`,
      title,
      url: 'https://example.com',
      thumbnailUrl: t[i % 4],
      publishedAt: new Date(Date.now() - (i * 2.5 + 1) * 86400_000).toISOString(),
      views,
      reach: Math.round(views * 0.71),
      avgWatchSec: Math.round(((dur * watchPct) / 100) * 10) / 10,
      totalWatchSec: Math.round((views * dur * watchPct) / 100),
      skipRate: Math.round((22 + ((i * 17) % 31)) * 10) / 10,
      likes: Math.round(views * 0.058),
      comments: Math.round(views * 0.004),
      shares: Math.round(views * 0.011),
      saves: Math.round(views * 0.016),
      durationSec: dur,
      viaCadence: i % 3 === 0 || undefined
    }
  })
  const ytVideos = Array.from({ length: 40 }, (_, i) => {
    const title = titles[i % titles.length]
    const dur = LENS[(i + 5) % LENS.length]
    const views = Math.round((260_000 - i * 3_500) * lenBoost(dur) * (0.75 + ((i * 29) % 11) / 20))
    const pct = Math.round(lenWatch(dur) * (0.92 + ((i * 7) % 5) / 30) * 10) / 10
    return {
      id: `vid${i}abcdef`,
      title,
      url: 'https://example.com',
      thumbnailUrl: t[(i + 1) % 4],
      publishedAt: new Date(Date.now() - (i * 2.5 + 2) * 86400_000).toISOString(),
      durationSec: dur,
      views,
      engagedViews: Math.round(views * 0.62),
      avgViewSec: Math.round((dur * pct) / 100),
      avgViewPct: pct,
      watchMinutes: Math.round((views * dur * pct) / 100 / 60),
      likes: Math.round(views * 0.045),
      comments: Math.round(views * 0.002),
      shares: Math.round(views * 0.004),
      subscribersGained: Math.round(views * 0.0021),
      viaCadence: i % 2 === 0 || undefined
    }
  })
  const traffic = [
    { source: 'SHORTS', views: 812_400 },
    { source: 'SUBSCRIBER', views: 96_300 },
    { source: 'YT_SEARCH', views: 41_800 },
    { source: 'RELATED_VIDEO', views: 22_600 },
    { source: 'EXT_URL', views: 9_400 },
    { source: 'NO_LINK_OTHER', views: 5_100 }
  ]
  store.setAnalytics({
    refreshing: false,
    errors: {},
    instagram: {
      [IG1]: { fetchedAt, reels, unavailable: [] },
      [IG2]: { fetchedAt, reels: reels.slice(0, 6).map((r) => ({ ...r, id: `${r.id}b`, views: Math.round(r.views! * 0.2) })), unavailable: [] }
    },
    youtube: {
      [YT1]: { fetchedAt, videos: ytVideos, traffic },
      [YT2]: { fetchedAt, videos: ytVideos.slice(0, 5).map((v) => ({ ...v, id: `${v.id}b`, views: Math.round(v.views * 0.2) })), traffic: traffic.map((t) => ({ ...t, views: Math.round(t.views * 0.2) })) }
    }
  })
  await store.flush()
  console.log('seeded', store.posts.length)
})()
