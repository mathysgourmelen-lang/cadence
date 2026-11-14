import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { Topbar } from '../App'
import { api, useApp } from '../state'
import { Icon, InstagramMark, YouTubeMark } from '../icons'
import { useFeedback } from '../ui'
import { accountLabel, addDays, cx, sameDay, startOfDay, timeLabel } from '../util'
import type { Post } from '../../../shared/types'
import { isEditable, postStatus } from '../../../shared/status'
import { dayKey } from './DateTimePicker'
import { calendarItems, type CalendarItem, type OutsidePost } from '../../../shared/calendar'

export default function CalendarView() {
  const { snap, go } = useApp()
  const { toast } = useFeedback()
  const [month, setMonth] = useState(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1)
  })
  const [dropDay, setDropDay] = useState<string | null>(null)

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarItem[]>()
    for (const it of calendarItems(snap!.posts, snap!.insights, snap!.analytics)) {
      const k = dayKey(new Date(it.at))
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(it)
    }
    return m
  }, [snap])

  // Posts made in the Instagram or YouTube app only show up after Cadence reads
  // the accounts again, so refresh when the numbers are more than 30 minutes old.
  useEffect(() => {
    const ins = snap!.insights
    const connected = snap!.accounts.instagram.length + snap!.accounts.youtube.length > 0
    const fetched = Object.values(ins.accounts).map((a) => Date.parse(a?.fetchedAt ?? '') || 0)
    const newest = fetched.length ? Math.max(...fetched) : 0
    if (connected && !ins.refreshing && Date.now() - newest > 30 * 60_000) void api.refreshInsights().catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const offset = (month.getDay() + 6) % 7
  const start = addDays(month, -offset)
  const weeks = Math.ceil((offset + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) / 7)
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i))
  const today = new Date()
  const monthCount = days.filter((d) => d.getMonth() === month.getMonth()).reduce((n, d) => n + (byDay.get(dayKey(d))?.length ?? 0), 0)

  const canMove = (p: Post) => {
    const ts = [p.instagram, p.youtube].filter((t) => t.enabled)
    return ts.length > 0 && ts.every((t) => isEditable(t.state)) && postStatus(p) !== 'draft'
  }

  async function onDrop(e: DragEvent, day: Date) {
    e.preventDefault()
    setDropDay(null)
    const id = e.dataTransfer.getData('text/cadence-post')
    const p = snap!.posts.find((x) => x.id === id)
    if (!p || !p.scheduledAt) return
    const old = new Date(p.scheduledAt)
    const target = new Date(day)
    target.setHours(old.getHours(), old.getMinutes(), 0, 0)
    if (sameDay(old, target)) return
    if (target.getTime() < Date.now()) {
      toast('err', 'You can\'t move a post into the past.')
      return
    }
    try {
      await api.reschedule(p.id, target.toISOString())
      toast('ok', `Moved to ${target.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}, ${timeLabel(target)}.`)
    } catch (err) {
      toast('err', (err as Error).message)
    }
  }

  return (
    <>
      <Topbar title="Calendar" subtitle={`${monthCount} post${monthCount === 1 ? '' : 's'} this month`}>
        <button className="btn primary" onClick={() => go('compose')}>
          <Icon.Plus size={16} /> New post
        </button>
      </Topbar>
      <div className="page">
        <div className="cal-head">
          <h2>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
          <button className="btn icon" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
            <Icon.ChevronLeft size={16} />
          </button>
          <button className="btn icon" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
            <Icon.ChevronRight size={16} />
          </button>
          <button className="btn" onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}>
            Today
          </button>
          <div className="grow" />
          <span className="faint small">Drag a post to another day to reschedule it. Double-click to edit.</span>
        </div>
        <div className="cal-grid">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="cal-dow">
              {d}
            </div>
          ))}
          {days.map((d) => {
            const k = dayKey(d)
            const list = byDay.get(k) ?? []
            const past = startOfDay(d) < startOfDay(today)
            return (
              <div
                key={k}
                className={cx('cal-cell', d.getMonth() !== month.getMonth() && 'out', sameDay(d, today) && 'today', dropDay === k && 'drop')}
                onDragOver={(e) => {
                  if (past || !e.dataTransfer.types.includes('text/cadence-post')) return
                  e.preventDefault()
                  setDropDay(k)
                }}
                onDragLeave={() => setDropDay((x) => (x === k ? null : x))}
                onDrop={(e) => onDrop(e, d)}
              >
                <div className="cal-num">{d.getDate()}</div>
                {!past && (
                  <button className="btn ghost icon sm cal-add" aria-label="New post on this day" onClick={() => go('compose', { compose: { date: d.toISOString(), pick: true } })}>
                    <Icon.Plus size={14} />
                  </button>
                )}
                {list.slice(0, 4).map((it) => {
                  if (it.kind === 'outside') return <OutsideChip key={it.item.key} o={it.item} />
                  const p = it.post
                  const at = new Date(it.at)
                  const st = postStatus(p)
                  const movable = canMove(p)
                  return (
                    <div
                      key={p.id}
                      className={cx('cal-post', st === 'published' && 'published', (st === 'failed' || st === 'partial') && 'failed')}
                      draggable={movable}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/cadence-post', p.id)
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                      onDoubleClick={() => (st === 'published' ? go('history') : go('compose', { compose: { postId: p.id } }))}
                      onClick={() => go(st === 'published' || st === 'failed' ? 'history' : 'queue', { highlight: p.id })}
                      title={[timeLabel(at), p.video.fileName, p.instagram.enabled && accountLabel(snap!.accounts, 'instagram', p.instagram.accountId), p.youtube.enabled && accountLabel(snap!.accounts, 'youtube', p.youtube.accountId)].filter(Boolean).join(' · ')}
                      style={{ cursor: movable ? 'grab' : 'default' }}
                    >
                      {p.video.thumbnailPath ? <img className="thumb" src={api.mediaUrl(p.video.thumbnailPath)} alt="" /> : <div className="thumb" />}
                      <span className="ellipsis">{timeLabel(at)}</span>
                      <span className="marks">
                        {p.instagram.enabled && <InstagramMark size={12} />}
                        {p.youtube.enabled && <YouTubeMark size={12} />}
                      </span>
                    </div>
                  )
                })}
                {list.length > 4 && <div className="faint small" style={{ paddingLeft: 4 }}>+{list.length - 4} more</div>}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

/** A post made in the Instagram or YouTube app, read back from the account. */
function OutsideChip({ o }: { o: OutsidePost }) {
  const { snap } = useApp()
  const [broken, setBroken] = useState(false)
  const at = new Date(o.at)
  const app = o.platform === 'instagram' ? 'Instagram' : 'YouTube'
  return (
    <div
      className="cal-post published outside"
      onClick={() => o.url && void api.openExternal(o.url)}
      title={[timeLabel(at), o.title, accountLabel(snap!.accounts, o.platform, o.accountId), `Posted in the ${app} app. Click to open.`].filter(Boolean).join(' · ')}
      style={{ cursor: o.url ? 'pointer' : 'default' }}
    >
      {o.thumbnailUrl && !broken ? <img className="thumb" src={o.thumbnailUrl} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : <div className="thumb" />}
      <span className="ellipsis">{timeLabel(at)}</span>
      <span className="marks">{o.platform === 'instagram' ? <InstagramMark size={12} /> : <YouTubeMark size={12} />}</span>
    </div>
  )
}
