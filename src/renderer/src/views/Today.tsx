import { useEffect, useMemo } from 'react'
import { Topbar } from '../App'
import { api, useApp } from '../state'
import { Icon, InstagramMark, YouTubeMark } from '../icons'
import { Avatar } from '../ui'
import { cx, timeLabel } from '../util'
import type { Platform } from '../../../shared/types'
import { calendarItems } from '../../../shared/calendar'
import { isEditable } from '../../../shared/status'

interface TodayEntry {
  key: string
  at: Date
  title: string
  done: boolean
  url?: string
  postId?: string
}

interface TodayAccount {
  key: string
  platform: Platform
  id: string
  name: string
  pic?: string
  entries: TodayEntry[]
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** One card per account: green once it has a post live today, red until then. */
export default function TodayView() {
  const { snap, go, now } = useApp()
  const today = new Date(now)

  const accounts = useMemo<TodayAccount[]>(() => {
    const s = snap!
    const list: TodayAccount[] = [
      ...s.accounts.instagram.map((a) => ({ key: `instagram:${a.id}`, platform: 'instagram' as const, id: a.id, name: `@${a.username}`, pic: a.profilePictureUrl, entries: [] as TodayEntry[] })),
      ...s.accounts.youtube.map((a) => ({ key: `youtube:${a.id}`, platform: 'youtube' as const, id: a.id, name: a.channelTitle, pic: a.thumbnailUrl, entries: [] as TodayEntry[] }))
    ]
    const byKey = new Map(list.map((a) => [a.key, a]))
    for (const it of calendarItems(s.posts, s.insights, s.analytics)) {
      if (it.kind === 'outside') {
        const at = new Date(it.at)
        if (sameDay(at, today)) byKey.get(`${it.item.platform}:${it.item.accountId}`)?.entries.push({ key: it.item.key, at, title: it.item.title || 'Untitled', done: true, url: it.item.url })
        continue
      }
      const p = it.post
      for (const [platform, t] of [['instagram', p.instagram], ['youtube', p.youtube]] as const) {
        if (!t.enabled || !t.accountId) continue
        const acct = byKey.get(`${platform}:${t.accountId}`)
        if (!acct) continue
        const title = (platform === 'youtube' ? p.youtube.title : p.instagram.caption.split('\n')[0]) || p.video.fileName
        if (t.state === 'published') {
          const at = new Date(t.publishedAt ?? it.at)
          if (sameDay(at, today)) acct.entries.push({ key: `${p.id}:${platform}`, at, title, done: true, url: t.url, postId: p.id })
        } else if (p.scheduledAt && t.state !== 'canceled' && t.state !== 'failed' && t.state !== 'draft') {
          const at = new Date(p.scheduledAt)
          if (sameDay(at, today) && (at.getTime() > now || !isEditable(t.state))) acct.entries.push({ key: `${p.id}:${platform}`, at, title, done: false, postId: p.id })
        }
      }
    }
    for (const a of list) a.entries.sort((x, y) => x.at.getTime() - y.at.getTime())
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, today.toDateString(), Math.floor(now / 60_000)])

  // Posts made in the Instagram or YouTube app only show up after Cadence reads
  // the accounts again, so refresh when the numbers are more than 15 minutes old.
  useEffect(() => {
    const ins = snap!.insights
    const fetched = Object.values(ins.accounts).map((a) => Date.parse(a?.fetchedAt ?? '') || 0)
    const newest = fetched.length ? Math.max(...fetched) : 0
    if (accounts.length && !ins.refreshing && Date.now() - newest > 15 * 60_000) void api.refreshInsights().catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const posted = accounts.filter((a) => a.entries.some((e) => e.done)).length

  return (
    <>
      <Topbar
        title="Today"
        subtitle={accounts.length ? `${posted} of ${accounts.length} account${accounts.length === 1 ? '' : 's'} posted today` : today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
      >
        <button className="btn" disabled={snap!.insights.refreshing} onClick={() => void api.refreshInsights().catch(() => undefined)}>
          <Icon.Retry size={15} /> {snap!.insights.refreshing ? 'Checking…' : 'Check now'}
        </button>
      </Topbar>
      <div className="page">
        {!accounts.length ? (
          <div className="empty">
            <h3>No accounts yet</h3>
            <p>Connect Instagram or YouTube to see which accounts have posted today.</p>
            <button className="btn primary" onClick={() => go('accounts')}>
              Connect an account
            </button>
          </div>
        ) : (
          <div className="today-grid">
            {accounts.map((a) => {
              const done = a.entries.filter((e) => e.done)
              const ok = done.length > 0
              const next = a.entries.find((e) => !e.done)
              return (
                <div key={a.key} className={cx('card today-card', ok ? 'ok' : 'no')}>
                  <div className="today-tab">
                    {ok ? <Icon.Check size={14} /> : <Icon.X size={14} />}
                    {ok ? (done.length > 1 ? `Posted ${done.length} times today` : 'Posted today') : 'Not posted today'}
                  </div>
                  <div className="row today-head">
                    <Avatar src={a.pic} name={a.name} size={38} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="ellipsis today-name">{a.name}</div>
                      <div className="faint row" style={{ gap: 5, fontSize: 12 }}>
                        {a.platform === 'instagram' ? <InstagramMark size={14} /> : <YouTubeMark size={14} />}
                        {a.platform === 'instagram' ? 'Instagram' : 'YouTube'}
                      </div>
                    </div>
                  </div>
                  <div className="today-list">
                    {a.entries.map((e) => (
                      <button
                        key={e.key}
                        className={cx('today-entry', e.done && 'done')}
                        onClick={() => (e.url ? void api.openExternal(e.url) : e.postId ? go('queue', { highlight: e.postId }) : undefined)}
                        title={e.done ? 'Click to open' : 'Scheduled. Click to see it in the Queue.'}
                      >
                        <span className="t">{timeLabel(e.at)}</span>
                        <span className="ellipsis grow">{e.title}</span>
                        <span className="faint small">{e.done ? 'live' : 'scheduled'}</span>
                      </button>
                    ))}
                    {!a.entries.length && <div className="faint small today-none">Nothing posted or scheduled yet today.</div>}
                  </div>
                  {!ok && !next && (
                    <button className="btn sm" onClick={() => go('compose')}>
                      <Icon.Plus size={14} /> New post
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
