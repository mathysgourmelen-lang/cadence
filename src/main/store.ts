// Persistent state: posts, settings and account info in a JSON file, secrets in a
// separate file encrypted with the macOS Keychain (Electron safeStorage).
// Writes are atomic (write to temp file, then rename) and serialized.

import { mkdirSync, readFileSync, existsSync, renameSync, copyFileSync } from 'node:fs'
import { writeFile, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { AccountsState, AnalyticsState, InsightsState, Post, Settings } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/defaults'
export { DEFAULT_SETTINGS }

export interface Cipher {
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

export interface Secrets {
  instagram?: { accessToken: string; userToken?: string; appSecret?: string }
  youtube?: {
    clientSecret: string
    refreshToken?: string
    accessToken?: string
    accessTokenExpiresAt?: number
  }
}

export interface PersistedState {
  schema: 1
  posts: Post[]
  settings: Settings
  accounts: AccountsState
  quota: { day: string; used: number }
  insights?: InsightsState
  analytics?: AnalyticsState
}

export const DEFAULT_ACCOUNTS: AccountsState = {
  instagram: { connected: false },
  youtube: { connected: false, quotaUsedToday: 0 }
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
    this.state = this.loadState()
    this.secrets = this.loadSecrets()
  }

  private loadState(): PersistedState {
    const fresh: PersistedState = {
      schema: 1,
      posts: [],
      settings: { ...DEFAULT_SETTINGS },
      accounts: structuredClone(DEFAULT_ACCOUNTS),
      quota: { day: pacificDay(), used: 0 }
    }
    if (!existsSync(this.statePath)) return fresh
    try {
      const raw = JSON.parse(readFileSync(this.statePath, 'utf8')) as Partial<PersistedState>
      return {
        schema: 1,
        posts: Array.isArray(raw.posts) ? raw.posts : [],
        settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
        accounts: {
          instagram: { ...DEFAULT_ACCOUNTS.instagram, ...(raw.accounts?.instagram ?? {}) },
          youtube: { ...DEFAULT_ACCOUNTS.youtube, ...(raw.accounts?.youtube ?? {}) }
        },
        quota: raw.quota ?? fresh.quota,
        insights: raw.insights ? { ...raw.insights, history: raw.insights.history ?? [], refreshing: false } : undefined,
        analytics: raw.analytics ? { ...raw.analytics, refreshing: false } : undefined
      }
    } catch (err) {
      // Keep a copy of the unreadable file instead of silently losing the queue.
      const backup = `${this.statePath}.corrupt-${Date.now()}`
      try {
        copyFileSync(this.statePath, backup)
      } catch {
        /* ignore */
      }
      console.error('state.json unreadable, backed up to', backup, err)
      return fresh
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
    return { ...this.state.accounts, youtube: { ...this.state.accounts.youtube, quotaUsedToday: this.state.quota.used } }
  }
  get insights(): InsightsState {
    return this.state.insights ?? { history: [], refreshing: false }
  }
  get analytics(): AnalyticsState {
    return this.state.analytics ?? { refreshing: false }
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
    this.state.accounts = {
      instagram: patch.instagram ?? this.state.accounts.instagram,
      youtube: patch.youtube ?? this.state.accounts.youtube
    }
    this.persist()
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
