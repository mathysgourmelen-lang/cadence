import { useEffect, useMemo, useState } from 'react'
import { Topbar } from '../App'
import { api, progressKey, useApp } from '../state'
import { Icon, InstagramMark, YouTubeMark } from '../icons'
import { MenuButton, Modal, Progress, useFeedback, type MenuEntry } from '../ui'
import { accountLabel, cx, dayLabel, relative, startOfDay, timeLabel } from '../util'
import { MiniCalendar } from './DateTimePicker'
import type { Platform, Post, TargetBase } from '../../../shared/types'
import { IN_FLIGHT, isEditable, isUpcoming, postStatus, stateLabel } from '../../../shared/status'
import { DAILY_UPLOADS } from './quota'

export default function Queue() {
  const { snap, go, now, highlight } = useApp()
  const posts = useMemo(
    () =>
      snap!.posts
        .filter(isUpcoming)
        .sort((a, b) => (a.scheduledAt ?? '0').localeCompare(b.scheduledAt ?? '0')),
    [snap]
  )
  const drafts = posts.filter((p) => postStatus(p) === 'draft')
  const scheduled = posts.filter((p) => postStatus(p) !== 'draft')

  const groups = useMemo(() => {
    const m = new Map<string, Post[]>()
    for (const p of scheduled) {
      const d = p.scheduledAt ? startOfDay(new Date(p.scheduledAt)) : startOfDay(new Date())
      const k = d.toISOString()
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(p)
    }
    return [...m.entries()]
  }, [scheduled])

  const next = scheduled.find((p) => p.scheduledAt && Date.parse(p.scheduledAt) > now)
  const weekEnd = now + 7 * 86400_000
  const thisWeek = scheduled.filter((p) => p.scheduledAt && Date.parse(p.scheduledAt) < weekEnd).length
  const inFlight = posts.filter((p) => postStatus(p) === 'in_progress').length
  const quota = snap!.accounts.youtubeQuotaUsedToday

  useEffect(() => {
    if (!highlight) return
    document.getElementById(`post-${highlight}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlight])

  return (
    <>
      <Topbar title="Queue" subtitle={posts.length ? `${scheduled.length} scheduled${drafts.length ? ` · ${drafts.length} drafts` : ''}` : undefined}>
        <button className="btn" onClick={() => go('calendar')}>
          <Icon.Calendar size={16} /> Calendar
        </button>
        <button className="btn primary" onClick={() => go('compose')}>
          <Icon.Plus size={16} /> New post
        </button>
      </Topbar>
      <div className="page">
        <div className="stats">
          <div className="card stat hero">
            <div className="k">
              <Icon.Clock size={14} /> Next post
            </div>
            <div className="v">{next ? relative(Date.parse(next.scheduledAt!), now).replace('in ', '') : '—'}</div>
            <div className="s ellipsis">{next ? `${dayLabel(new Date(next.scheduledAt!))} at ${timeLabel(new Date(next.scheduledAt!))}` : 'Nothing scheduled yet'}</div>
          </div>
          <div className="card stat">
            <div className="k">
              <Icon.Calendar size={14} /> Next 7 days
            </div>
            <div className="v">{thisWeek}</div>
            <div className="s">posts scheduled</div>
          </div>
          <div className="card stat">
            <div className="k">
              <Icon.Upload size={14} /> In progress
            </div>
            <div className="v">{inFlight}</div>
            <div className="s">{snap!.settings.paused ? 'Scheduling is paused' : inFlight ? 'uploading now' : 'all quiet'}</div>
          </div>
          <div className="card stat">
            <div className="k">
              <YouTubeMark size={14} /> YouTube uploads today
            </div>
            <div className="v">
              {quota}
              <span className="faint" style={{ fontSize: 14, fontWeight: 600 }}>
                {' '}
                / {DAILY_UPLOADS}
              </span>
            </div>
            <div style={{ marginTop: 8 }}>
              <Progress value={Math.min(1, quota / DAILY_UPLOADS)} />
            </div>
          </div>
        </div>

        {snap!.settings.paused && (
          <div className="notice warn" style={{ marginBottom: 18 }}>
            <Icon.Pause size={16} />
            <div className="grow">Scheduling is paused. Nothing will upload or publish until you resume.</div>
            <button className="btn sm" onClick={() => api.updateSettings({ paused: false })}>
              Resume
            </button>
          </div>
        )}

        {!posts.length && (
          <div className="empty">
            <div>
              <div className="empty-art" style={{ margin: '0 auto' }}>
                <Icon.Calendar size={38} />
              </div>
              <h3>Your queue is empty</h3>
              <p>Drop in a few videos, write captions once, and Cadence posts them for you at the right time.</p>
              <button className="btn primary lg" onClick={() => go('compose')}>
                <Icon.Plus size={16} /> Create your first post
              </button>
            </div>
          </div>
        )}

        {groups.map(([k, list]) => (
          <section className="day-group" key={k}>
            <div className="day-head">
              <h3>{dayLabel(new Date(k))}</h3>
              <span className="count">
                {list.length} post{list.length > 1 ? 's' : ''}
              </span>
            </div>
            {list.map((p) => (
              <PostRow key={p.id} post={p} highlight={highlight === p.id} />
            ))}
          </section>
        ))}

        {drafts.length > 0 && (
          <section className="day-group">
            <div className="day-head">
              <h3>Drafts</h3>
              <span className="count">Not scheduled</span>
            </div>
            {drafts.map((p) => (
              <PostRow key={p.id} post={p} highlight={highlight === p.id} />
            ))}
          </section>
        )}
      </div>
    </>
  )
}

export function TargetLine({ post, platform }: { post: Post; platform: Platform }) {
  const { progress, now, snap } = useApp()
  const t: TargetBase = platform === 'instagram' ? post.instagram : post.youtube
  const several = snap!.accounts[platform].length > 1
  const who = accountLabel(snap!.accounts, platform, (platform === 'instagram' ? post.instagram : post.youtube).accountId)
  const mark = platform === 'instagram' ? <InstagramMark size={16} /> : <YouTubeMark size={16} />
  if (!t.enabled)
    return (
      <div className="target off">
        {mark}
        <span className="faint small">Off</span>
      </div>
    )
  const live = progress[progressKey(post.id, platform)]
  const pct = t.state === 'uploading' ? (live ?? t.progress ?? 0) : undefined
  const kind =
    t.state === 'published'
      ? 'ok'
      : t.state === 'failed'
        ? 'err'
        : t.state === 'missed'
          ? 'warn'
          : t.state === 'scheduled_remote' || t.state === 'ready'
            ? 'info'
            : IN_FLIGHT.includes(t.state)
              ? 'accent'
              : ''
  let label = stateLabel(t.state)
  if (t.state === 'uploading' && pct != null) label = `Uploading ${Math.round(pct * 100)}%`
  if (t.state === 'ready') label = 'Uploaded, posts on time'
  const retry = t.nextAttemptAt && Date.parse(t.nextAttemptAt) > now ? `Retrying ${relative(Date.parse(t.nextAttemptAt), now)}` : null
  return (
    <div className="target" title={t.error}>
      {mark}
      <div className="tstate">
        <div className="row" style={{ gap: 6 }}>
          <span className={cx('pill', kind)}>{label}</span>
          {several && who && <span className="target-acct ellipsis">{who}</span>}
          {retry && <span className="faint small ellipsis">{retry}</span>}
        </div>
        {t.state === 'uploading' && <Progress value={pct} />}
        {(t.state === 'processing' || t.state === 'publishing') && <Progress indeterminate />}
      </div>
      {t.url && (
        <button className="btn ghost icon sm" onClick={() => api.openExternal(t.url!)} aria-label="Open">
          <Icon.External size={14} />
        </button>
      )}
    </div>
  )
}

export function usePostActions(post: Post) {
  const { go } = useApp()
  const { toast, confirm } = useFeedback()
  const [rescheduling, setRescheduling] = useState(false)
  const status = postStatus(post)
  const targets = [post.instagram, post.youtube].filter((t) => t.enabled)
  const busy = targets.some((t) => IN_FLIGHT.includes(t.state))
  const editable = targets.some((t) => isEditable(t.state))
  const failed = targets.some((t) => t.state === 'failed')
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) toast('ok', ok)
    } catch (e) {
      toast('err', (e as Error).message)
    }
  }
  const items: MenuEntry[] = [
    { label: 'Edit', icon: <Icon.Edit size={15} />, disabled: !editable, onClick: () => go('compose', { compose: { postId: post.id } }) },
    { label: 'Reschedule…', icon: <Icon.Calendar size={15} />, disabled: busy || !editable, onClick: () => setRescheduling(true) },
    {
      label: 'Post now',
      icon: <Icon.Send size={15} />,
      disabled: busy || !targets.some((t) => ['draft', 'scheduled', 'missed', 'ready', 'canceled'].includes(t.state)),
      onClick: async () => {
        if (await confirm({ title: 'Post this now?', body: `${post.video.fileName} will start uploading right away.`, confirm: 'Post now' }))
          void run(() => api.postAction(post.id, 'postNow'), 'Posting now…')
      }
    },
    ...(failed ? [{ label: 'Retry', icon: <Icon.Retry size={15} />, onClick: () => void run(() => api.postAction(post.id, 'retry'), 'Retrying…') }] : []),
    { separator: true },
    ...(status === 'draft'
      ? []
      : [
          {
            label: 'Move to drafts',
            icon: <Icon.Pause size={15} />,
            disabled: busy || !editable,
            onClick: () => void run(() => api.postAction(post.id, 'unschedule'), 'Moved to drafts.')
          }
        ]),
    { label: 'Show in Finder', icon: <Icon.Folder size={15} />, onClick: () => void api.reveal(post.video.originalPath) },
    {
      label: 'Delete',
      icon: <Icon.Trash size={15} />,
      danger: true,
      disabled: busy,
      onClick: async () => {
        const hasRemote = post.youtube.enabled && post.youtube.state === 'scheduled_remote'
        if (
          await confirm({
            title: 'Delete this post?',
            body: hasRemote
              ? 'The Short is already uploaded to YouTube and will still publish at its time. Delete it in YouTube Studio if you don\'t want it.'
              : 'It will be removed from Cadence. Anything already published stays online.',
            confirm: 'Delete',
            danger: true
          })
        )
          void run(() => api.deletePost(post.id), 'Deleted.')
      }
    }
  ]
  const modal = (
    <RescheduleModal
      open={rescheduling}
      post={post}
      onClose={() => setRescheduling(false)}
      onSave={(iso) =>
        void run(async () => {
          await api.reschedule(post.id, iso)
          setRescheduling(false)
        }, 'Rescheduled.')
      }
    />
  )
  return { items, modal }
}

function PostRow({ post, highlight }: { post: Post; highlight: boolean }) {
  const { go, now } = useApp()
  const { items, modal } = usePostActions(post)
  const at = post.scheduledAt ? new Date(post.scheduledAt) : null
  const caption = post.instagram.enabled ? post.instagram.caption : post.youtube.description
  const title = post.youtube.enabled && post.youtube.title ? post.youtube.title : post.video.fileName
  const status = postStatus(post)
  const error = [post.instagram, post.youtube].find((t) => t.enabled && t.error && (t.state === 'failed' || t.nextAttemptAt))?.error
  return (
    <div id={`post-${post.id}`} className={cx('post-row', highlight && 'highlight')} onDoubleClick={() => go('compose', { compose: { postId: post.id } })}>
      <div>
        <div className="time">{at ? timeLabel(at) : 'Draft'}</div>
        <div className="rel">{status === 'draft' ? 'not scheduled' : at ? relative(at.getTime(), now) : 'now'}</div>
      </div>
      {post.video.thumbnailPath ? <img className="thumb" src={api.mediaUrl(post.video.thumbnailPath)} alt="" /> : <div className="thumb" />}
      <div style={{ minWidth: 0 }}>
        <div className="title ellipsis">{title}</div>
        <div className="cap">{caption || <span className="faint">No caption</span>}</div>
        {error && (
          <div className="small ellipsis" style={{ color: 'var(--err)', marginTop: 4 }} title={error}>
            {error}
          </div>
        )}
        {status === 'missed' && (
          <div className="small" style={{ color: 'var(--warn)', marginTop: 4 }}>
            Your Mac was off at posting time. Post it now or reschedule.
          </div>
        )}
      </div>
      <div className="targets">
        <TargetLine post={post} platform="instagram" />
        <TargetLine post={post} platform="youtube" />
      </div>
      <MenuButton items={items} />
      {modal}
    </div>
  )
}

function RescheduleModal({ open, post, onClose, onSave }: { open: boolean; post: Post; onClose: () => void; onSave: (iso: string) => void }) {
  const initial = post.scheduledAt && Date.parse(post.scheduledAt) > Date.now() ? new Date(post.scheduledAt) : new Date(Date.now() + 3600_000)
  const [day, setDay] = useState(initial)
  const [time, setTime] = useState(`${String(initial.getHours()).padStart(2, '0')}:${String(initial.getMinutes()).padStart(2, '0')}`)
  const combined = new Date(day)
  const [h, m] = time.split(':').map(Number)
  combined.setHours(h || 0, m || 0, 0, 0)
  const past = combined.getTime() < Date.now()
  return (
    <Modal open={open} onClose={onClose} width={340}>
      <h2>Reschedule</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        {post.video.fileName}
      </p>
      <div className="card" style={{ marginBottom: 12 }}>
        <MiniCalendar value={day} onPick={setDay} />
      </div>
      <input className="input time-input" type="time" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} />
      {past && <div className="small" style={{ color: 'var(--err)', marginTop: 8 }}>That time is in the past.</div>}
      <div className="actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={past} onClick={() => onSave(combined.toISOString())}>
          Save
        </button>
      </div>
    </Modal>
  )
}
