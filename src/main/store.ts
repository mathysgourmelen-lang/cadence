// Persistent state: posts, settings and account info in a JSON file, secrets in a
// separate file encrypted with the macOS Keychain (Electron safeStorage).
// Writes are atomic (write to temp file, then rename) and serialized.

import { mkdirSync, readFileSync, existsSync, renameSync, copyFileSync } from 'node:fs'
import { writeFile, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { accountKey, type AccountsState, type AnalyticsState, type InsightsState, type InstagramAccount, type Post, type Settings, type YouTubeAccount } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/defaults'
export { DEFAULT_SETTINGS }

export interface Cipher {
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

export interface IgSecret {
  /** Page access token. */
  accessToken: string
  /** Long-lived user token (rupload wants this one). */
  userToken?: string
}

export interface YtSecret {
  refreshToken: string
  accessToken?: string
  accessTokenExpiresAt?: number
}

export interface Secrets {
  instagram?: { appSecret?: string; accounts: Record<string, IgSecret> }
  youtube?: { clientSecret?: string; accounts: Record<string, YtSecret> }
}

export interface PersistedState {
  schema: 2
  posts: Post[]
  settings: Settings
  accounts: AccountsState
  quota: { day: string; used: number }
  insights?: InsightsState
  analytics?: AnalyticsState
}

export const DEFAULT_ACCOUNTS: AccountsState = {
  instagram: [],
  youtube: [],
  youtubeQuotaUsedToday: 0
}

const EMPTY_INSIGHTS: InsightsState = { accounts: {}, errors: {}, history: [], refreshing: false }
const EMPTY_ANALYTICS: AnalyticsState = { instagram: {}, youtube: {}, errors: {}, refreshing: false }

/**
 * Version 1 kept one Instagram account and one YouTube channel. Moves them into the
 * multi-account shape and tags every existing post with its account.
 */
export function migrateV1(raw: any, secrets: any): { state: Partial<PersistedState>; secrets: Secrets } {
  const oldIg = raw.accounts?.instagram ?? {}
  const oldYt = raw.accounts?.youtube ?? {}
  const igId: string | undefined = oldIg.connected ? oldIg.igUserId : undefined
  const ytId: string | undefined = oldYt.connected ? (oldYt.channelId ?? 'channel') : undefined
  const accounts: AccountsState = {
    instagram: igId
      ? [{ id: igId, username: oldIg.username ?? '', pageName: oldIg.pageName, profilePictureUrl: oldIg.profilePictureUrl, connectedAt: oldIg.connectedAt, problem: oldIg.problem }]
      : [],
    youtube: ytId ? [{ id: ytId, channelTitle: oldYt.channelTitle ?? 'YouTube channel', thumbnailUrl: oldYt.thumbnailUrl, connectedAt: oldYt.connectedAt, problem: oldYt.problem }] : [],
    instagramAppId: oldIg.appId,
    youtubeClientId: oldYt.clientId,
    youtubeHasSecret: !!oldYt.hasSecret,
    youtubeQuotaUsedToday: 0
  }
  const posts: Post[] = Array.isArray(raw.posts) ? raw.posts : []
  for (const p of posts) {
    if (p.instagram && !p.instagram.accountId && igId) p.instagram.accountId = igId
    if (p.youtube && !p.youtube.accountId && ytId) p.youtube.accountId = ytId
  }
  // Keep the view history (it can't be fetched again); everything else refreshes.
  const history = Array.isArray(raw.insights?.history)
    ? raw.insights.history.map((h: any) => {
        const values: Record<string, number> = {}
        if (igId && typeof h.instagram === 'number') values[accountKey('instagram', igId)] = h.instagram
        if (ytId && typeof h.youtube === 'number') values[accountKey('youtube', ytId)] = h.youtube
        return { day: h.day, values }
      })
    : []
  const out: Secrets = {}
  const si = secrets?.instagram
  if (si) out.instagram = { appSecret: si.appSecret, accounts: igId && si.accessToken ? { [igId]: { accessToken: si.accessToken, userToken: si.userToken } } : {} }
  const sy = secrets?.youtube
  if (sy) {
    out.youtube = {
      clientSecret: sy.clientSecret,
      accounts: ytId && sy.refreshToken ? { [ytId]: { refreshToken: sy.refreshToken, accessToken: sy.accessToken, accessTokenExpiresAt: sy.accessTokenExpiresAt } } : {}
    }
  }
  return { state: { posts, accounts, insights: { ...EMPTY_INSIGHTS, history } }, secrets: out }
}

export function pacificDay(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export class Store extends EventEmitter {
  readonly dataDir: string
  readonly libraryDir: string
  private readonly statePath: string
  private readonly secretsPath: string
  private state: PersistedState
  private secrets: Secrets
  private writeChain: Promise<void> = Promise.resolve()

  constructor(
    dataDir: string,
    private readonly cipher: Cipher
  ) {
    super()
    this.dataDir = dataDir
    this.libraryDir = join(dataDir, 'library')
    this.statePath = join(dataDir, 'state.json')
    this.secretsPath = join(dataDir, 'secrets.bin')
    mkdirSync(this.libraryDir, { recursive: true })
    const loaded = this.loadState()
    this.state = loaded.state
    this.secrets = this.loadSecrets()
    if (loaded.v1) {
      const m = migrateV1(loaded.v1, this.secrets)
      Object.assign(this.state, m.state)
      this.secrets = m.secrets
      this.persist()
      this.persistSecrets()
    }
  }

  private loadState(): { state: PersistedState; v1?: any } {
    const fresh: PersistedState = {
      schema: 2,
      posts: [],
      settings: { ...DEFAULT_SETTINGS },
      accounts: structuredClone(DEFAULT_ACCOUNTS),
      quota: { day: pacificDay(), used: 0 }
    }
    if (!existsSync(this.statePath)) return { state: fresh }
    try {
      const raw = JSON.parse(readFileSync(this.statePath, 'utf8')) as any
      const isV1 = raw.schema !== 2 && raw.accounts && !Array.isArray(raw.accounts.instagram)
      const state: PersistedState = {
        schema: 2,
        posts: Array.isArray(raw.posts) ? raw.posts : [],
        settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
        accounts: {
          ...DEFAULT_ACCOUNTS,
          ...(isV1 ? {} : (raw.accounts ?? {})),
          instagram: !isV1 && Array.isArray(raw.accounts?.instagram) ? raw.accounts.instagram : [],
          youtube: !isV1 && Array.isArray(raw.accounts?.youtube) ? raw.accounts.youtube : []
        },
        quota: raw.quota ?? fresh.quota,
        insights: !isV1 && raw.insights ? { ...EMPTY_INSIGHTS, ...raw.insights, refreshing: false } : undefined,
        analytics: !isV1 && raw.analytics ? { ...EMPTY_ANALYTICS, ...raw.analytics, refreshing: false } : undefined
      }
      if (isV1) {
        // Keep the old file in case anything goes wrong.
        try {
          copyFileSync(this.statePath, `${this.statePath}.v1-backup`)
        } catch {
          /* ignore */
        }
      }
      return { state, v1: isV1 ? raw : undefined }
    } catch (err) {
      // Keep a copy of the unreadable file instead of silently losing the queue.
      const backup = `${this.statePath}.corrupt-${Date.now()}`
      try {
        copyFileSync(this.statePath, backup)
      } catch {
        /* ignore */
      }
      console.error('state.json unreadable, backed up to', backup, err)
      return { state: fresh }
    }
  }

  private loadSecrets(): Secrets {
    if (!existsSync(this.secretsPath)) return {}
    try {
      return JSON.parse(this.cipher.decrypt(readFileSync(this.secretsPath))) as Secrets
    } catch (err) {
      console.error('Could not decrypt secrets; accounts need reconnecting.', err)
      try {
        renameSync(this.secretsPath, `${this.secretsPath}.unreadable-${Date.now()}`)
      } catch {
        /* ignore */
      }
      return {}
    }
  }

  // ---------- reads ----------

  get posts(): Post[] {
    return this.state.posts
  }
  get settings(): Settings {
    return this.state.settings
  }
  get accounts(): AccountsState {
    this.rollQuotaDay()
    return { ...this.state.accounts, youtubeQuotaUsedToday: this.state.quota.used }
  }
  get insights(): InsightsState {
    return this.state.insights ?? EMPTY_INSIGHTS
  }
  get analytics(): AnalyticsState {
    return this.state.analytics ?? EMPTY_ANALYTICS
  }
  igAccount(id: string | undefined): InstagramAccount | undefined {
    return id ? this.state.accounts.instagram.find((a) => a.id === id) : undefined
  }
  ytAccount(id: string | undefined): YouTubeAccount | undefined {
    return id ? this.state.accounts.youtube.find((a) => a.id === id) : undefined
  }
  getPost(id: string): Post | undefined {
    return this.state.posts.find((p) => p.id === id)
  }
  getSecrets(): Secrets {
    return this.secrets
  }

  // ---------- writes ----------

  upsertPost(post: Post): void {
    const i = this.state.posts.findIndex((p) => p.id === post.id)
    post.updatedAt = new Date().toISOString()
    if (i >= 0) this.state.posts[i] = post
    else this.state.posts.push(post)
    this.persist()
  }

  /** Applies a mutation to a post and saves. Returns the updated post. */
  updatePost(id: string, fn: (p: Post) => void): Post | undefined {
    const p = this.getPost(id)
    if (!p) return undefined
    fn(p)
    p.updatedAt = new Date().toISOString()
    this.persist()
    return p
  }

  deletePost(id: string): Post | undefined {
    const i = this.state.posts.findIndex((p) => p.id === id)
    if (i < 0) return undefined
    const [removed] = this.state.posts.splice(i, 1)
    this.persist()
    return removed
  }

  setSettings(patch: Partial<Settings>): Settings {
    this.state.settings = { ...this.state.settings, ...patch }
    this.persist()
    return this.state.settings
  }

  setAccounts(patch: Partial<AccountsState>): void {
    this.state.accounts = { ...this.state.accounts, ...patch }
    this.persist()
  }

  /** Adds or replaces one Instagram account. */
  upsertIgAccount(a: InstagramAccount): void {
    const list = this.state.accounts.instagram.filter((x) => x.id !== a.id)
    const i = this.state.accounts.instagram.findIndex((x) => x.id === a.id)
    list.splice(i < 0 ? list.length : i, 0, a)
    this.setAccounts({ instagram: list })
  }

  upsertYtAccount(a: YouTubeAccount): void {
    const list = this.state.accounts.youtube.filter((x) => x.id !== a.id)
    const i = this.state.accounts.youtube.findIndex((x) => x.id === a.id)
    list.splice(i < 0 ? list.length : i, 0, a)
    this.setAccounts({ youtube: list })
  }

  patchIgAccount(id: string, patch: Partial<InstagramAccount>): void {
    const a = this.igAccount(id)
    if (a) this.upsertIgAccount({ ...a, ...patch })
  }

  patchYtAccount(id: string, patch: Partial<YouTubeAccount>): void {
    const a = this.ytAccount(id)
    if (a) this.upsertYtAccount({ ...a, ...patch })
  }

  igSecret(id: string | undefined): IgSecret | undefined {
    return id ? this.secrets.instagram?.accounts?.[id] : undefined
  }

  ytSecret(id: string | undefined): YtSecret | undefined {
    return id ? this.secrets.youtube?.accounts?.[id] : undefined
  }

  setIgSecret(id: string, secret: IgSecret | undefined): void {
    const cur = this.secrets.instagram ?? { accounts: {} }
    const accounts = { ...cur.accounts }
    if (secret) accounts[id] = secret
    else delete accounts[id]
    this.setSecrets({ instagram: { ...cur, accounts } })
  }

  setYtSecret(id: string, secret: YtSecret | undefined): void {
    const cur = this.secrets.youtube ?? { accounts: {} }
    const accounts = { ...cur.accounts }
    if (secret) accounts[id] = secret
    else delete accounts[id]
    this.setSecrets({ youtube: { ...cur, accounts } })
  }

  setInsights(patch: Partial<InsightsState>): InsightsState {
    this.state.insights = { ...this.insights, ...patch }
    for (const k of Object.keys(patch) as (keyof InsightsState)[]) if (patch[k] === undefined) delete (this.state.insights as unknown as Record<string, unknown>)[k]
    this.persist()
    return this.state.insights
  }

  setAnalytics(patch: Partial<AnalyticsState>): AnalyticsState {
    this.state.analytics = { ...this.analytics, ...patch }
    for (const k of Object.keys(patch) as (keyof AnalyticsState)[]) if (patch[k] === undefined) delete (this.state.analytics as unknown as Record<string, unknown>)[k]
    this.persist()
    return this.state.analytics
  }

  setSecrets(patch: Partial<Secrets>): void {
    this.secrets = { ...this.secrets, ...patch }
    for (const k of Object.keys(patch) as (keyof Secrets)[]) if (patch[k] === undefined) delete this.secrets[k]
    this.persistSecrets()
  }

  private rollQuotaDay(): void {
    const today = pacificDay()
    if (this.state.quota.day !== today) this.state.quota = { day: today, used: 0 }
  }

  addQuota(units: number): void {
    this.rollQuotaDay()
    this.state.quota.used += units
    this.persist()
  }

  quotaUsed(): number {
    this.rollQuotaDay()
    return this.state.quota.used
  }

  private persist(): void {
    const data = JSON.stringify(this.state, null, 2)
    this.queueWrite(this.statePath, data)
    this.emit('change')
  }

  private persistSecrets(): void {
    this.queueWrite(this.secretsPath, this.cipher.encrypt(JSON.stringify(this.secrets)))
  }

  private queueWrite(path: string, data: string | Buffer): void {
    this.writeChain = this.writeChain
      .then(async () => {
        await mkdir(this.dataDir, { recursive: true })
        const tmp = `${path}.tmp-${process.pid}`
        await writeFile(tmp, data, { mode: 0o600 })
        await rename(tmp, path)
      })
      .catch((err) => console.error('Failed to save', path, err))
  }

  /** Resolves once all pending writes are on disk. */
  flush(): Promise<void> {
    return this.writeChain
  }
}
