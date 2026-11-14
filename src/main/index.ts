import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  powerMonitor,
  powerSaveBlocker,
  protocol,
  safeStorage,
  shell,
  Tray,
  type MenuItemConstructorOptions
} from 'electron'
import { join } from 'node:path'
import { Store, type Cipher } from './store'
import { saveYtTokens, Scheduler, ytTokensFor } from './scheduler'
import { InstagramClient, type InstagramCredentials } from './instagram'
import { YouTubeClient, type YouTubeTokens } from './youtube'
import { ApiError } from './http'
import { prepareThumbnail, THUMB_EXTENSIONS } from './ytthumb'
import { cleanLibrary, importVideo, saveThumbnail, serveLibraryFile } from './media'
import { FolderLibrary } from './folder'
import { instagramInsights, recordHistory, youtubeInsights } from './insights'
import { instagramAnalytics, youtubeAnalytics, youtubeRetention } from './analytics'

type IgAnalyticsData = Awaited<ReturnType<typeof instagramAnalytics>>
type YtAnalyticsData = Awaited<ReturnType<typeof youtubeAnalytics>>
import { applyAction, deletePost, PostError, reschedule, savePost, type PostAction } from './posts'
import {
  accountKey,
  type AccountInsights,
  type AccountKey,
  type AnalyticsState,
  type AppSnapshot,
  type InsightsState,
  type InstagramPageChoice,
  type Platform,
  type PostDraftInput,
  type Settings
} from '../shared/types'
import { isUpcoming } from '../shared/status'

const isDev = !!process.env.ELECTRON_RENDERER_URL

protocol.registerSchemesAsPrivileged([
  { scheme: 'cadence-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: false } }
])

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let store: Store
let folderLib: FolderLibrary
let insightsRun: Promise<void> | null = null
let analyticsRun: Promise<void> | null = null
const retentionCache = new Map<string, { at: number; points: import('../shared/types').RetentionPoint[] }>()
let scheduler: Scheduler
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let blockerId: number | null = null
const youtube = new YouTubeClient()
let pendingIgChoices: (InstagramPageChoice & { pageToken: string })[] = []
let pendingIgApp: { appId: string; appSecret: string; userToken: string } | null = null

const keychainCipher: Cipher = {
  encrypt: (s) => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s) : Buffer.from(`plain:${s}`)),
  decrypt: (b) => {
    const str = b.toString('utf8', 0, 6)
    if (str === 'plain:') return b.toString('utf8').slice(6)
    return safeStorage.decryptString(b)
  }
}

function instagram(): InstagramClient {
  return new InstagramClient(store.settings.graphApiVersion || 'v24.0')
}

function snapshot(): AppSnapshot {
  return { posts: store.posts, settings: store.settings, accounts: store.accounts, insights: store.insights, analytics: store.analytics, version: app.getVersion() }
}

function friendly(err: unknown): string {
  if (err instanceof ApiError || err instanceof PostError) return err.message
  return (err as Error)?.message ?? String(err)
}

/** Wraps an IPC handler so errors reach the UI as { error } instead of an exception dump. */
function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R): void {
  ipcMain.handle(channel, async (_e, ...args: unknown[]) => {
    try {
      return { ok: true, value: await fn(...(args as A)) }
    } catch (err) {
      console.error(channel, err)
      return { ok: false, error: friendly(err) }
    }
  })
}

// ---------------- window ----------------

/** True when a post still needs Cadence open to go out (YouTube-scheduled Shorts don't). */
function needsAppRunning(p: import('../shared/types').Post): boolean {
  const ig = p.instagram.enabled && ['scheduled', 'uploading', 'processing', 'ready', 'publishing'].includes(p.instagram.state)
  const yt = p.youtube.enabled && ['scheduled', 'uploading'].includes(p.youtube.state)
  return ig || yt
}

function createWindow(show = true): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: 'Cadence',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    ...(process.platform === 'darwin'
      ? { vibrancy: 'sidebar' as const, visualEffectState: 'followWindow' as const, backgroundColor: '#00000000' }
      : { backgroundColor: '#0b0b0f' }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  })
  mainWindow.once('ready-to-show', () => {
    if (show) mainWindow?.show()
  })
  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      mainWindow?.hide()
      maybeExplainBackground()
    }
  })
  mainWindow.on('closed', () => (mainWindow = null))
  // Open links in the default browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(process.env.ELECTRON_RENDERER_URL ?? 'file://')) e.preventDefault()
  })
  if (isDev) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

function showWindow(route?: string): void {
  if (!mainWindow) createWindow(true)
  else {
    mainWindow.show()
    mainWindow.focus()
  }
  if (route) mainWindow?.webContents.send('navigate', route)
}

let explained = false
function maybeExplainBackground(): void {
  if (explained || store.settings.notifications === false) return
  explained = true
  if (store.posts.some(needsAppRunning) && Notification.isSupported()) {
    new Notification({ title: 'Cadence is still running', body: 'It stays in the menu bar so your posts go out on time.' }).show()
  }
}

// ---------------- tray ----------------

function trayIcon(): Electron.NativeImage {
  const img = nativeImage.createFromPath(join(__dirname, '../../resources/trayTemplate.png'))
  img.setTemplateImage(true)
  return img
}

function nextPostLabel(): string {
  const now = Date.now()
  const next = store.posts
    .filter((p) => isUpcoming(p) && p.scheduledAt && Date.parse(p.scheduledAt) > now)
    .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!))[0]
  if (!next) return 'Nothing scheduled'
  const d = new Date(next.scheduledAt!)
  return `Next: ${d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · ${next.video.fileName}`
}

function updateTray(): void {
  if (!tray) return
  const busy = scheduler?.isBusy()
  const template: MenuItemConstructorOptions[] = [
    { label: busy ? 'Uploading…' : nextPostLabel(), enabled: false },
    { type: 'separator' },
    { label: 'Open Cadence', click: () => showWindow() },
    { label: 'New Post…', click: () => showWindow('compose') },
    { label: 'Queue', click: () => showWindow('queue') },
    { type: 'separator' },
    {
      label: 'Pause Scheduling',
      type: 'checkbox',
      checked: store.settings.paused,
      click: (item) => {
        store.setSettings({ paused: item.checked })
        broadcast()
      }
    },
    { type: 'separator' },
    { label: 'Quit Cadence', click: () => app.quit() }
  ]
  tray.setContextMenu(Menu.buildFromTemplate(template))
  tray.setToolTip(`Cadence — ${nextPostLabel()}`)
}

// ---------------- app menu ----------------

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => showWindow('settings') },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Post…', accelerator: 'Cmd+N', click: () => showWindow('compose') },
        { label: 'Import Videos…', accelerator: 'Cmd+O', click: () => showWindow('import') },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Compose', accelerator: 'Cmd+1', click: () => showWindow('compose') },
        { label: 'Library', accelerator: 'Cmd+2', click: () => showWindow('library') },
        { label: 'Queue', accelerator: 'Cmd+3', click: () => showWindow('queue') },
        { label: 'Calendar', accelerator: 'Cmd+4', click: () => showWindow('calendar') },
        { label: 'History', accelerator: 'Cmd+5', click: () => showWindow('history') },
        { label: 'Views', accelerator: 'Cmd+6', click: () => showWindow('views') },
        { label: 'Analytics', accelerator: 'Cmd+7', click: () => showWindow('analytics') },
        { label: 'Accounts', accelerator: 'Cmd+8', click: () => showWindow('accounts') },
        { type: 'separator' },
        ...(isDev ? ([{ role: 'reload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[]) : []),
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------------- state broadcast ----------------

let broadcastTimer: NodeJS.Timeout | null = null
function broadcast(): void {
  if (broadcastTimer) return
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null
    mainWindow?.webContents.send('state', snapshot())
    updateTray()
  }, 50)
}

function applyAppearance(s: Settings): void {
  nativeTheme.themeSource = s.appearance
}

function applyLoginItem(s: Settings): void {
  if (process.platform !== 'darwin' || isDev) return
  try {
    app.setLoginItemSettings({ openAtLogin: s.launchAtLogin })
  } catch (err) {
    console.error('login item', err)
  }
}

function updatePowerBlocker(): void {
  const want = store.settings.keepAwake && !store.settings.paused && scheduler.needsAwake()
  if (want && blockerId === null) blockerId = powerSaveBlocker.start('prevent-app-suspension')
  if (!want && blockerId !== null) {
    powerSaveBlocker.stop(blockerId)
    blockerId = null
  }
}

function notify(title: string, body: string, postId?: string): void {
  if (!store.settings.notifications || !Notification.isSupported()) return
  const n = new Notification({ title, body })
  n.on('click', () => showWindow(postId ? `post:${postId}` : 'queue'))
  n.show()
}

// ---------------- account health ----------------

async function checkAccounts(): Promise<void> {
  for (const acc of store.accounts.instagram) {
    const sec = store.igSecret(acc.id)
    if (!sec) {
      store.patchIgAccount(acc.id, { problem: 'Cadence lost the sign-in for this account. Remove it and connect it again.' })
      continue
    }
    try {
      const prof = await instagram().getProfile({ igUserId: acc.id, accessToken: sec.accessToken })
      const problem = sec.userToken
        ? undefined
        : 'Cadence now uploads reels with a different token. Remove this account, then connect it again with a fresh token from Graph API Explorer.'
      store.patchIgAccount(acc.id, { username: prof.username || acc.username, profilePictureUrl: prof.profilePictureUrl ?? acc.profilePictureUrl, problem })
    } catch (err) {
      if (err instanceof ApiError && err.opts.authError) store.patchIgAccount(acc.id, { problem: err.message })
    }
  }
  for (const acc of store.accounts.youtube) {
    const tokens = ytTokensFor(store, acc.id)
    if (!tokens) {
      store.patchYtAccount(acc.id, { problem: 'Cadence lost the sign-in for this channel. Click Reconnect.' })
      continue
    }
    try {
      await youtube.accessToken(tokens)
      saveYtTokens(store, acc.id, tokens)
      store.patchYtAccount(acc.id, { problem: undefined })
    } catch (err) {
      if (err instanceof ApiError && err.opts.authError) store.patchYtAccount(acc.id, { problem: err.message })
    }
  }
}

// ---------------- views / insights ----------------

/** Runs one fetch per connected account, keyed like "instagram:<id>". */
async function perAccount<T>(
  ig: (creds: InstagramCredentials) => Promise<T>,
  yt: (tokens: YouTubeTokens) => Promise<T>
): Promise<{ key: AccountKey; platform: Platform; id: string; result: PromiseSettledResult<T> }[]> {
  const jobs: Promise<{ key: AccountKey; platform: Platform; id: string; result: PromiseSettledResult<T> }>[] = []
  const settle = (p: Promise<T>) => p.then((value) => ({ status: 'fulfilled', value }) as const, (reason) => ({ status: 'rejected', reason }) as const)
  for (const a of store.accounts.instagram) {
    const sec = store.igSecret(a.id)
    const job = sec ? ig({ igUserId: a.id, accessToken: sec.accessToken, userToken: sec.userToken }) : Promise.reject(new PostError('Not connected.'))
    jobs.push(settle(job).then((result) => ({ key: accountKey('instagram', a.id), platform: 'instagram' as const, id: a.id, result })))
  }
  for (const a of store.accounts.youtube) {
    const tokens = ytTokensFor(store, a.id)
    const job = tokens
      ? yt(tokens).finally(() => saveYtTokens(store, a.id, tokens))
      : Promise.reject(new PostError('Not connected. Click Reconnect in Accounts.'))
    jobs.push(settle(job).then((result) => ({ key: accountKey('youtube', a.id), platform: 'youtube' as const, id: a.id, result })))
  }
  return Promise.all(jobs)
}

/** Keys of the accounts that are connected right now. */
function liveKeys(): Set<string> {
  return new Set([...store.accounts.instagram.map((a) => accountKey('instagram', a.id)), ...store.accounts.youtube.map((a) => accountKey('youtube', a.id))])
}

/** Fetches view counts for every connected account. Concurrent calls share one run. */
function refreshInsights(): Promise<void> {
  if (insightsRun) return insightsRun
  insightsRun = (async () => {
    store.setInsights({ refreshing: true })
    const results = await perAccount(
      (creds) => instagramInsights(instagram(), creds, store.posts),
      (tokens) => youtubeInsights(youtube, tokens, store.posts)
    )
    const cur = store.insights
    const live = liveKeys()
    const accounts: InsightsState['accounts'] = {}
    const errors: InsightsState['errors'] = {}
    const today: Partial<Record<AccountKey, number>> = {}
    // Keep the last good numbers when a refresh fails; drop accounts that were removed.
    for (const [k, v] of Object.entries(cur.accounts) as [AccountKey, AccountInsights][]) if (live.has(k)) accounts[k] = v
    for (const r of results) {
      if (!live.has(r.key)) continue
      if (r.result.status === 'fulfilled') {
        accounts[r.key] = { ...r.result.value, platform: r.platform, accountId: r.id }
        if (r.result.value.totalViews != null) today[r.key] = r.result.value.totalViews
      } else {
        errors[r.key] = friendly(r.result.reason)
      }
    }
    store.setInsights({ accounts, errors, history: recordHistory(cur.history, today), refreshing: false })
  })().finally(() => {
    insightsRun = null
  })
  return insightsRun
}

/** Fetches watch time, skip rate and traffic data. Concurrent calls share one run. */
function refreshAnalytics(): Promise<void> {
  if (analyticsRun) return analyticsRun
  analyticsRun = (async () => {
    store.setAnalytics({ refreshing: true })
    const results = await perAccount<IgAnalyticsData | YtAnalyticsData>(
      (creds) =>
        instagramAnalytics(
          instagram(),
          creds,
          store.posts,
          new Map((store.analytics.instagram[creds.igUserId]?.reels ?? []).filter((r) => r.durationSec).map((r) => [r.id, r.durationSec!]))
        ),
      (tokens) => youtubeAnalytics(youtube, tokens, store.posts)
    )
    const cur = store.analytics
    const fetchedAt = new Date().toISOString()
    const igIds = new Set(store.accounts.instagram.map((a) => a.id))
    const ytIds = new Set(store.accounts.youtube.map((a) => a.id))
    const ig: AnalyticsState['instagram'] = Object.fromEntries(Object.entries(cur.instagram).filter(([id]) => igIds.has(id)))
    const yt: AnalyticsState['youtube'] = Object.fromEntries(Object.entries(cur.youtube).filter(([id]) => ytIds.has(id)))
    const errors: AnalyticsState['errors'] = {}
    for (const r of results) {
      if (r.result.status === 'rejected') {
        errors[r.key] = friendly(r.result.reason)
        continue
      }
      if (r.platform === 'instagram' && igIds.has(r.id)) ig[r.id] = { fetchedAt, ...(r.result.value as IgAnalyticsData) }
      if (r.platform === 'youtube' && ytIds.has(r.id)) yt[r.id] = { fetchedAt, ...(r.result.value as YtAnalyticsData) }
    }
    store.setAnalytics({ instagram: ig, youtube: yt, errors, refreshing: false })
  })().finally(() => {
    analyticsRun = null
  })
  return analyticsRun
}

/** Removes an account's cached numbers. */
function forgetAccountData(platform: Platform, id: string): void {
  const key = accountKey(platform, id)
  const ins = store.insights
  const accounts = { ...ins.accounts }
  const errors = { ...ins.errors }
  delete accounts[key]
  delete errors[key]
  store.setInsights({ accounts, errors })
  const an = store.analytics
  const igA = { ...an.instagram }
  const ytA = { ...an.youtube }
  const aErr = { ...an.errors }
  if (platform === 'instagram') delete igA[id]
  else delete ytA[id]
  delete aErr[key]
  store.setAnalytics({ instagram: igA, youtube: ytA, errors: aErr })
}

// ---------------- IPC ----------------

function registerIpc(): void {
  handle('state:get', () => snapshot())

  handle('youtube:pickThumbnail', async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose a YouTube thumbnail',
      buttonLabel: 'Use as Thumbnail',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: THUMB_EXTENSIONS }]
    })
    if (res.canceled || !res.filePaths[0]) return null
    return prepareThumbnail(store.libraryDir, res.filePaths[0]).catch((e) => {
      throw new PostError((e as Error).message)
    })
  })

  handle('youtube:thumbnailFromPath', async (path: string) =>
    prepareThumbnail(store.libraryDir, String(path)).catch((e) => {
      throw new PostError((e as Error).message)
    })
  )

  handle('videos:pick', async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose videos',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'm4v'] }]
    })
    if (res.canceled) return []
    return Promise.all(res.filePaths.map((p) => importVideo(store.libraryDir, p)))
  })

  handle('videos:import', async (paths: string[]) => {
    if (!Array.isArray(paths)) return []
    return Promise.all(paths.slice(0, 100).map((p) => importVideo(store.libraryDir, String(p))))
  })

  handle('videos:thumbnail', async (videoPath: string, dataUrl: string) => saveThumbnail(store.libraryDir, videoPath, dataUrl))

  handle('posts:save', async (input: PostDraftInput) => {
    const p = savePost(store, input)
    scheduler.kick()
    return p
  })

  handle('posts:saveMany', async (inputs: PostDraftInput[]) => {
    // Validate all first so a batch is all-or-nothing.
    const out = []
    for (const input of inputs) out.push(savePost(store, input))
    scheduler.kick()
    return out
  })

  handle('posts:delete', async (id: string) => deletePost(store, id))

  handle('posts:action', async (id: string, action: PostAction, platform?: Platform) => {
    const p = applyAction(store, id, action, platform)
    scheduler.kick()
    return p
  })

  handle('posts:reschedule', async (id: string, iso: string) => {
    const p = reschedule(store, id, iso)
    scheduler.kick()
    return p
  })

  handle('settings:update', async (patch: Partial<Settings>) => {
    const s = store.setSettings(patch)
    if ('appearance' in patch) applyAppearance(s)
    if ('launchAtLogin' in patch) applyLoginItem(s)
    if ('paused' in patch && !s.paused) scheduler.kick()
    return s
  })

  // Instagram: step 1, exchange the token and list linked accounts.
  // App ID and secret can be left out once saved: every account uses the same Meta app.
  handle('instagram:connect', async (args: { appId?: string; appSecret?: string; token: string }) => {
    const appId = (args.appId ?? '').trim() || store.accounts.instagramAppId || ''
    const appSecret = (args.appSecret ?? '').trim() || store.getSecrets().instagram?.appSecret || ''
    const token = args.token.trim()
    if (!/^\d{5,20}$/.test(appId)) throw new PostError('The App ID should be a long number. Find it at the top of your Meta app dashboard.')
    if (!/^[a-f0-9]{32}$/i.test(appSecret)) throw new PostError('The App Secret should be 32 letters and numbers. Find it in App settings → Basic.')
    if (token.length < 50) throw new PostError('That access token looks too short. Copy the whole token from Graph API Explorer.')
    const client = instagram()
    const longToken = await client.exchangeToken(appId, appSecret, token)
    const choices = await client.listInstagramAccounts(longToken)
    if (!choices.length) {
      const pages = client.lastPageNames
      throw new PostError(
        pages.length
          ? `Your token can see the Facebook Page${pages.length > 1 ? 's' : ''} ${pages.map((n) => `"${n}"`).join(', ')}, but no Instagram professional account is linked to ${pages.length > 1 ? 'them' : 'it'}. In the Instagram app go to Edit profile → Page → Connect, pick this Page, then generate a new token. (Setup Guide, step 2.2)`
          : 'Your token can\'t see any Facebook Page. Generate the token again and, in the Facebook window, tick your Page (or "Opt in to all current and future Pages"). Also check that pages_show_list is in the permission list.'
      )
    }
    pendingIgChoices = choices
    pendingIgApp = { appId, appSecret, userToken: longToken }
    return choices.map(({ pageToken: _t, ...c }) => ({ ...c, connected: !!store.igAccount(c.igUserId) }))
  })

  // Instagram: step 2, save the chosen accounts (already-connected ones get the fresh token).
  handle('instagram:choose', async (ids: string[] | string) => {
    const wanted = new Set(Array.isArray(ids) ? ids : [ids])
    const picked = pendingIgChoices.filter((x) => wanted.has(x.igUserId))
    if (!picked.length || !pendingIgApp) throw new PostError('Please start the connection again.')
    const app = pendingIgApp
    const profiles = await Promise.all(picked.map((c) => instagram().getProfile({ igUserId: c.igUserId, accessToken: c.pageToken })))
    store.setSecrets({ instagram: { accounts: store.getSecrets().instagram?.accounts ?? {}, appSecret: app.appSecret } })
    store.setAccounts({ instagramAppId: app.appId })
    picked.forEach((c, i) => {
      store.setIgSecret(c.igUserId, { accessToken: c.pageToken, userToken: app.userToken })
      store.upsertIgAccount({
        id: c.igUserId,
        username: profiles[i].username || c.username,
        pageName: c.pageName,
        profilePictureUrl: profiles[i].profilePictureUrl ?? c.profilePictureUrl,
        connectedAt: store.igAccount(c.igUserId)?.connectedAt ?? new Date().toISOString(),
        problem: undefined
      })
    })
    pendingIgChoices = []
    pendingIgApp = null
    scheduler.kick()
    void refreshInsights().catch(() => {})
    return store.accounts.instagram
  })

  handle('instagram:disconnect', async (id: string) => {
    store.setIgSecret(String(id), undefined)
    store.setAccounts({ instagram: store.accounts.instagram.filter((a) => a.id !== id) })
    forgetAccountData('instagram', String(id))
  })

  handle('instagram:limit', async (id?: string) => {
    const acc = store.igAccount(id ?? store.accounts.instagram[0]?.id)
    const sec = store.igSecret(acc?.id)
    if (!acc || !sec) return null
    return instagram().publishingLimit({ igUserId: acc.id, accessToken: sec.accessToken })
  })

  // YouTube: sign in one channel. Client ID and secret can be left out once saved.
  handle('youtube:connect', async (args: { clientId?: string; clientSecret?: string }) => {
    const savedId = store.accounts.youtubeClientId
    const clientId = (args.clientId ?? '').trim() || savedId || ''
    const clientSecret = (args.clientSecret ?? '').trim() || store.getSecrets().youtube?.clientSecret || ''
    if (!clientId.endsWith('.apps.googleusercontent.com')) {
      throw new PostError('The Client ID should end with ".apps.googleusercontent.com". Copy it from Google Cloud → Credentials.')
    }
    if (clientSecret.length < 10) throw new PostError('Paste the Client secret from the same OAuth client.')
    const others = store.accounts.youtube
    if (savedId && clientId !== savedId && others.length) {
      throw new PostError('Your other channels are signed in with a different Client ID. Use the same one, or remove those channels first.')
    }
    const tokens = await youtube.authorize(clientId, clientSecret, (url) => void shell.openExternal(url))
    const ch = await youtube.channel(tokens)
    store.setSecrets({ youtube: { accounts: store.getSecrets().youtube?.accounts ?? {}, clientSecret } })
    store.setAccounts({ youtubeClientId: clientId, youtubeHasSecret: true })
    store.setYtSecret(ch.id, { refreshToken: tokens.refreshToken, accessToken: tokens.accessToken, accessTokenExpiresAt: tokens.accessTokenExpiresAt })
    store.upsertYtAccount({
      id: ch.id,
      channelTitle: ch.title,
      thumbnailUrl: ch.thumbnailUrl,
      connectedAt: store.ytAccount(ch.id)?.connectedAt ?? new Date().toISOString(),
      problem: undefined
    })
    mainWindow?.show()
    mainWindow?.focus()
    scheduler.kick()
    void refreshInsights().catch(() => {})
    return store.ytAccount(ch.id)!
  })

  handle('youtube:disconnect', async (id: string) => {
    store.setYtSecret(String(id), undefined)
    store.setAccounts({ youtube: store.accounts.youtube.filter((a) => a.id !== id) })
    forgetAccountData('youtube', String(id))
    retentionCache.clear()
  })

  handle('folder:list', async () => {
    folderLib.watch(store.settings.libraryFolder)
    return folderLib.list(store.settings.libraryFolder)
  })

  handle('folder:choose', async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose your video folder',
      buttonLabel: 'Use This Folder',
      defaultPath: store.settings.libraryFolder ?? app.getPath('videos'),
      properties: ['openDirectory', 'createDirectory']
    })
    if (!res.canceled && res.filePaths[0]) store.setSettings({ libraryFolder: res.filePaths[0] })
    folderLib.watch(store.settings.libraryFolder)
    return folderLib.list(store.settings.libraryFolder)
  })

  handle('folder:thumb', async (path: string, dataUrl: string) => folderLib.saveThumb(store.settings.libraryFolder, String(path), String(dataUrl)))

  handle('insights:refresh', async () => {
    await refreshInsights()
    return store.insights
  })

  handle('analytics:refresh', async () => {
    await refreshAnalytics()
    return store.analytics
  })

  handle('analytics:retention', async (videoId: string, channelId?: string) => {
    const hit = retentionCache.get(String(videoId))
    if (hit && Date.now() - hit.at < 30 * 60_000) return hit.points
    const id = channelId ?? store.accounts.youtube.find((a) => store.analytics.youtube[a.id]?.videos.some((v) => v.id === videoId))?.id ?? store.accounts.youtube[0]?.id
    const tokens = ytTokensFor(store, id)
    if (!tokens || !id) throw new PostError('Connect YouTube to see retention.')
    const v = store.analytics.youtube[id]?.videos.find((x) => x.id === videoId)
    const points = await youtubeRetention(youtube, tokens, String(videoId), v?.publishedAt)
    saveYtTokens(store, id, tokens)
    retentionCache.set(String(videoId), { at: Date.now(), points })
    return points
  })

  handle('shell:open', async (url: string) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) await shell.openExternal(url)
  })

  handle('shell:reveal', async (path: string) => {
    if (typeof path === 'string') shell.showItemInFolder(path)
  })

  handle('shell:dataFolder', async () => {
    await shell.openPath(store.dataDir)
  })
}

// ---------------- lifecycle ----------------

app.on('second-instance', () => showWindow())

app.whenReady().then(async () => {
  app.setName('Cadence')
  store = new Store(join(app.getPath('userData'), 'data'), keychainCipher)
  applyAppearance(store.settings)
  applyLoginItem(store.settings)

  folderLib = new FolderLibrary(join(store.dataDir, 'thumbs'), () => mainWindow?.webContents.send('folder:changed'))
  protocol.handle('cadence-media', (req) => {
    const host = new URL(req.url).host
    if (host === 'folder' || host === 'thumbs') return folderLib.serve(store.settings.libraryFolder, host, req)
    return serveLibraryFile(store.libraryDir, req)
  })
  // Keep view counts fresh in the background so the Views tab has a daily history.
  const insightsTick = () => {
    const a = store.accounts
    const last = Math.max(0, ...Object.values(store.insights.accounts).map((x) => Date.parse(x?.fetchedAt ?? '') || 0))
    if ((a.instagram.length || a.youtube.length) && Date.now() - last > 3 * 3600 * 1000) void refreshInsights().catch(() => undefined)
  }
  setTimeout(insightsTick, 30_000)
  setInterval(insightsTick, 30 * 60 * 1000)

  scheduler = new Scheduler({
    store,
    instagram,
    youtube,
    notify,
    onProgress: (postId, platform, progress) => mainWindow?.webContents.send('progress', { postId, platform, progress })
  })

  store.on('change', broadcast)
  registerIpc()
  buildMenu()

  tray = new Tray(trayIcon())
  tray.on('click', () => tray?.popUpContextMenu())
  updateTray()

  const openedAtLogin = process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin
  createWindow(!openedAtLogin)

  scheduler.start()
  setInterval(updatePowerBlocker, 30_000)
  setInterval(updateTray, 60_000)
  updatePowerBlocker()

  powerMonitor.on('shutdown', () => {
    quitting = true
  })
  powerMonitor.on('resume', () => {
    scheduler.recoverMissed()
    scheduler.kick()
  })

  if (!process.env.CADENCE_SKIP_ACCOUNT_CHECK) void checkAccounts()
  void cleanLibrary(store.libraryDir, store.posts)

  app.on('activate', () => showWindow())
})

app.on('before-quit', (e) => {
  if (quitting) return
  if (scheduler?.isBusy()) {
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      buttons: ['Keep Running', 'Quit Anyway'],
      defaultId: 0,
      cancelId: 0,
      message: 'An upload is in progress',
      detail: 'If you quit now, Cadence will resume or restart the upload next time it opens.'
    })
    if (choice === 0) {
      e.preventDefault()
      return
    }
  } else if (store?.posts.some(needsAppRunning)) {
    const choice = dialog.showMessageBoxSync({
      type: 'question',
      buttons: ['Keep in Menu Bar', 'Quit'],
      defaultId: 0,
      cancelId: 0,
      message: 'You have scheduled posts',
      detail: 'Cadence needs to be running to post them. Instagram reels only go out while Cadence is open. Quit anyway?'
    })
    if (choice === 0) {
      e.preventDefault()
      mainWindow?.hide()
      return
    }
  }
  quitting = true
  scheduler?.stop()
  e.preventDefault()
  void store.flush().finally(() => app.exit(0))
})

app.on('window-all-closed', () => {
  // Keep running in the menu bar.
})
