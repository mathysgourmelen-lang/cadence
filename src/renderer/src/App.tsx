import type { ReactNode } from 'react'
import { ExactNumberTip } from './views/Views'
import { useApp, type Route, isDemo } from './state'
import { Icon, InstagramMark, Logo, YouTubeMark } from './icons'
import { Avatar } from './ui'
import { cx, relative } from './util'
import { isUpcoming, postStatus } from '../../shared/status'
import Compose from './views/Compose'
import Queue from './views/Queue'
import CalendarView from './views/Calendar'
import History from './views/History'
import Accounts from './views/Accounts'
import SettingsView from './views/Settings'
import Guide from './views/Guide'
import Library from './views/Library'
import ViewsTab from './views/Views'
import Analytics from './views/Analytics'
import TodayView from './views/Today'
import OverviewTab from './views/Overview'
import { calendarItems } from '../../shared/calendar'
import { useMemo } from 'react'

const NAV: { route: Route; label: string; icon: (p: { size?: number }) => ReactNode }[] = [
  { route: 'today', label: 'Today', icon: Icon.Check },
  { route: 'library', label: 'Library', icon: Icon.Library },
  { route: 'queue', label: 'Queue', icon: Icon.Queue },
  { route: 'calendar', label: 'Calendar', icon: Icon.Calendar },
  { route: 'history', label: 'History', icon: Icon.History },
  { route: 'views', label: 'Views', icon: Icon.Eye },
  { route: 'analytics', label: 'Analytics', icon: Icon.Chart }
]

const SETUP: { route: Route; label: string; icon: (p: { size?: number }) => ReactNode }[] = [
  { route: 'accounts', label: 'Accounts', icon: Icon.Accounts },
  { route: 'settings', label: 'Settings', icon: Icon.Settings },
  { route: 'overview', label: 'Overview', icon: Icon.TrendUp }
]

export default function App() {
  const { snap, route, go, now } = useApp()
  const notPosted = useNotPostedToday()
  if (!snap) return <div className="app" />

  const upcoming = snap.posts.filter(isUpcoming)
  const failed = snap.posts.filter((p) => ['failed', 'partial', 'missed'].includes(postStatus(p)))
  const next = upcoming
    .filter((p) => p.scheduledAt && Date.parse(p.scheduledAt) > now)
    .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!))[0]
  const { instagram: ig, youtube: yt } = snap.accounts
  const chips: { key: string; connected: boolean; name: string; pic?: string; problem?: string; mark?: ReactNode }[] = [
    ...(ig.length
      ? ig.map((a) => ({ key: `i${a.id}`, connected: true, name: `@${a.username}`, pic: a.profilePictureUrl, problem: a.problem }))
      : [{ key: 'i', connected: false, name: 'Instagram', mark: <InstagramMark size={22} /> }]),
    ...(yt.length
      ? yt.map((a) => ({ key: `y${a.id}`, connected: true, name: a.channelTitle, pic: a.thumbnailUrl, problem: a.problem }))
      : [{ key: 'y', connected: false, name: 'YouTube', mark: <YouTubeMark size={22} /> }])
  ]

  return (
    <div className={cx('app', isDemo && 'demo')}>
      <ExactNumberTip />
      <aside className="sidebar">
        <div className="brand">
          <Logo size={30} />
          <div>
            <div className="brand-name">Cadence</div>
            <div className="brand-sub">Reels &amp; Shorts scheduler</div>
          </div>
        </div>

        <button className="btn primary compose-btn" onClick={() => go('compose')}>
          <Icon.Plus size={16} /> New Post
        </button>

        <nav className="nav">
          <button className={cx('nav-item', route === 'compose' && 'active')} onClick={() => go('compose')}>
            <Icon.Compose /> Compose
          </button>
          {NAV.map((n) => (
            <button key={n.route} className={cx('nav-item', route === n.route && 'active')} onClick={() => go(n.route)}>
              <n.icon size={18} /> {n.label}
              {n.route === 'queue' && upcoming.length > 0 && <span className="badge">{upcoming.length}</span>}
              {n.route === 'today' && notPosted != null && <span className={cx('badge', notPosted > 0 ? 'no' : 'done')}>{notPosted > 0 ? notPosted : <Icon.Check size={11} />}</span>}
              {n.route === 'history' && failed.length > 0 && <span className="badge hot">{failed.length}</span>}
            </button>
          ))}
          <div className="nav-section">Setup</div>
          {SETUP.map((n) => (
            <button key={n.route} className={cx('nav-item', route === n.route && 'active')} onClick={() => go(n.route)}>
              <n.icon size={18} /> {n.label}
              {n.route === 'accounts' && [...ig, ...yt].some((a) => a.problem) && <span className="badge hot">!</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          {snap.settings.paused ? (
            <div className="next-card" style={{ borderColor: 'var(--warn)' }}>
              <div className="label">Scheduling</div>
              <div className="value" style={{ color: 'var(--warn)' }}>
                Paused
              </div>
              <div className="sub">Nothing will be posted.</div>
            </div>
          ) : (
            <div className="next-card">
              <div className="label">Next post</div>
              <div className="value">{next ? relative(Date.parse(next.scheduledAt!), now) : '—'}</div>
              <div className="sub">{next ? next.video.fileName : 'Nothing scheduled'}</div>
            </div>
          )}
          {chips.slice(0, chips.length > 3 ? 2 : 3).map((c) => (
            <div key={c.key} className="account-chip" onClick={() => go('accounts')}>
              {c.connected ? <Avatar src={c.pic} name={c.name} size={22} /> : c.mark}
              <span className="name">{c.name}</span>
              <span className={cx('dot', c.connected ? (c.problem ? 'err' : 'ok') : '')} title={c.problem} />
            </div>
          ))}
          {chips.length > 3 && (
            <div className="account-chip" onClick={() => go('accounts')}>
              <span className="more-dot">+{chips.length - 2}</span>
              <span className="name">more accounts</span>
              <span className={cx('dot', chips.slice(2).some((c) => c.problem) ? 'err' : 'ok')} />
            </div>
          )}
        </div>
      </aside>

      <main className="main">
        {route === 'compose' && <Compose />}
        {route === 'today' && <TodayView />}
        {route === 'library' && <Library />}
        {route === 'queue' && <Queue />}
        {route === 'views' && <ViewsTab />}
        {route === 'analytics' && <Analytics />}
        {route === 'calendar' && <CalendarView />}
        {route === 'history' && <History />}
        {route === 'accounts' && <Accounts />}
        {route === 'settings' && <SettingsView />}
        {route === 'overview' && <OverviewTab />}
        {route === 'guide' && <Guide />}
      </main>
    </div>
  )
}

export function Topbar({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="topbar">
      <h1>{title}</h1>
      {subtitle && <span className="subtitle">{subtitle}</span>}
      <div className="spacer" />
      {children}
    </header>
  )
}

/** How many connected accounts have no post live today (null when none are connected). */
function useNotPostedToday(): number | null {
  const { snap, now } = useApp()
  const day = new Date(now).toDateString()
  return useMemo(() => {
    const s = snap
    if (!s) return null
    const keys = [...s.accounts.instagram.map((a) => `instagram:${a.id}`), ...s.accounts.youtube.map((a) => `youtube:${a.id}`)]
    if (!keys.length) return null
    const posted = new Set<string>()
    for (const it of calendarItems(s.posts, s.insights, s.analytics)) {
      if (it.kind === 'outside') {
        if (new Date(it.at).toDateString() === day) posted.add(`${it.item.platform}:${it.item.accountId}`)
        continue
      }
      for (const [platform, t] of [['instagram', it.post.instagram], ['youtube', it.post.youtube]] as const) {
        if (t.enabled && t.state === 'published' && t.accountId && new Date(t.publishedAt ?? it.at).toDateString() === day) posted.add(`${platform}:${t.accountId}`)
      }
    }
    return keys.filter((k) => !posted.has(k)).length
  }, [snap, day])
}
