import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { CadenceApi } from '../../preload/api'
import type { AppSnapshot, Platform } from '../../shared/types'
import { mockApi } from './mock'

export const api: CadenceApi = typeof window !== 'undefined' && window.cadence ? window.cadence : mockApi
export const isDemo = typeof window !== 'undefined' && !window.cadence

export type Route = 'compose' | 'library' | 'queue' | 'calendar' | 'history' | 'views' | 'analytics' | 'accounts' | 'settings' | 'guide'

export interface ComposeRequest {
  /** Edit an existing post. */
  postId?: string
  /** Pre-fill the date (from the calendar). */
  date?: string
  /** Open the file picker right away. */
  pick?: boolean
  /** Import these files (from the Library tab). */
  paths?: string[]
  nonce: number
}

interface AppCtx {
  snap: AppSnapshot | null
  progress: Record<string, number>
  route: Route
  go: (r: Route, opts?: { compose?: Omit<ComposeRequest, 'nonce'>; highlight?: string; guideAnchor?: string }) => void
  composeRequest: ComposeRequest | null
  highlight: string | null
  guideAnchor: string | null
  now: number
}

const Ctx = createContext<AppCtx>(null as unknown as AppCtx)

export function useApp(): AppCtx {
  return useContext(Ctx)
}

export function progressKey(postId: string, platform: Platform): string {
  return `${postId}:${platform}`
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<AppSnapshot | null>(null)
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [route, setRoute] = useState<Route>('queue')
  const [composeRequest, setComposeRequest] = useState<ComposeRequest | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [guideAnchor, setGuideAnchor] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    let alive = true
    api.getState().then((s) => {
      if (!alive) return
      setSnap(s)
      // First run: land on Accounts until something is connected, else on the queue.
      if (!s.accounts.instagram.connected && !s.accounts.youtube.connected) setRoute('accounts')
      else if (!s.posts.length) setRoute('compose')
    })
    const offState = api.onState((s) => setSnap(s))
    const offProg = api.onProgress((e) => setProgress((p) => ({ ...p, [progressKey(e.postId, e.platform)]: e.progress })))
    const offNav = api.onNavigate((r) => {
      if (r.startsWith('post:')) {
        setHighlight(r.slice(5))
        setRoute('queue')
      } else if (r === 'import') {
        setComposeRequest({ pick: true, nonce: Date.now() })
        setRoute('compose')
      } else setRoute(r as Route)
    })
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => {
      alive = false
      offState()
      offProg()
      offNav()
      clearInterval(t)
    }
  }, [])

  // Apply appearance (light/dark/system) to the document.
  useEffect(() => {
    if (!snap) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const mode = snap.settings.appearance
      const dark = mode === 'dark' || (mode === 'system' && mq.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [snap?.settings.appearance])

  const go: AppCtx['go'] = (r, opts) => {
    if (opts?.compose) setComposeRequest({ ...opts.compose, nonce: Date.now() })
    setHighlight(opts?.highlight ?? null)
    setGuideAnchor(opts?.guideAnchor ?? null)
    setRoute(r)
  }

  return <Ctx.Provider value={{ snap, progress, route, go, composeRequest, highlight, guideAnchor, now }}>{children}</Ctx.Provider>
}
