import { useMemo, useState } from 'react'
import { Topbar } from '../App'
import { api, useApp } from '../state'
import { Icon, InstagramMark, YouTubeMark } from '../icons'
import { Avatar, MenuButton, Modal, Segmented, useFeedback, type MenuEntry } from '../ui'
import { accountLabel, cx, shortDateTime } from '../util'
import type { AccountsState, Platform, Post } from '../../../shared/types'
import { isUpcoming, postStatus } from '../../../shared/status'
import { TargetLine } from './Queue'

type Filter = 'all' | 'published' | 'problems'

interface Channel {
  key: string
  platform: Platform
  id: string
  label: string
  avatar?: string
}

function channels(accounts: AccountsState): Channel[] {
  return [
    ...accounts.instagram.map((a) => ({ key: `instagram:${a.id}`, platform: 'instagram' as const, id: a.id, label: `@${a.username}`, avatar: a.profilePictureUrl })),
    ...accounts.youtube.map((a) => ({ key: `youtube:${a.id}`, platform: 'youtube' as const, id: a.id, label: a.channelTitle, avatar: a.thumbnailUrl }))
  ]
}

/** Whether the post went (or was meant to go) to this channel. Posts from before multi-account count for the first account. */
function onChannel(p: Post, c: Channel, accounts: AccountsState): boolean {
  const t = p[c.platform]
  if (!t.enabled) return false
  return (t.accountId ?? accounts[c.platform][0]?.id) === c.id
}

export default function History() {
  const { snap, highlight } = useApp()
  const [filter, setFilter] = useState<Filter>('all')
  const [channel, setChannel] = useState<string>('all')
  const [logPost, setLogPost] = useState<Post | null>(null)
  const { toast, confirm } = useFeedback()

  const all = useMemo(
    () =>
      snap!.posts
        .filter((p) => !isUpcoming(p) || ['failed', 'partial', 'missed'].includes(postStatus(p)))
        .sort((a, b) => (b.scheduledAt ?? b.updatedAt).localeCompare(a.scheduledAt ?? a.updatedAt)),
    [snap]
  )
  const chans = useMemo(() => channels(snap!.accounts), [snap])
  const chan = chans.find((c) => c.key === channel)
  const inChannel = chan ? all.filter((p) => onChannel(p, chan, snap!.accounts)) : all
  const list = inChannel.filter((p) => {
    const s = postStatus(p)
    if (filter === 'published') return s === 'published'
    if (filter === 'problems') return s === 'failed' || s === 'partial' || s === 'missed'
    return true
  })
  const problems = inChannel.filter((p) => ['failed', 'partial', 'missed'].includes(postStatus(p))).length

  const actions = (p: Post): MenuEntry[] => [
    { label: 'Activity log', icon: <Icon.History size={15} />, onClick: () => setLogPost(p) },
    ...(p.instagram.url ? [{ label: 'Open on Instagram', icon: <InstagramMark size={15} />, onClick: () => void api.openExternal(p.instagram.url!) }] : []),
    ...(p.youtube.url ? [{ label: 'Open on YouTube', icon: <YouTubeMark size={15} />, onClick: () => void api.openExternal(p.youtube.url!) }] : []),
    ...([p.instagram, p.youtube].some((t) => t.enabled && t.state === 'failed')
      ? [
          {
            label: 'Retry failed',
            icon: <Icon.Retry size={15} />,
            onClick: () =>
              void api
                .postAction(p.id, 'retry')
                .then(() => toast('ok', 'Retrying now…'))
                .catch((e) => toast('err', e.message))
          }
        ]
      : []),
    ...(postStatus(p) === 'missed'
      ? [
          {
            label: 'Post now',
            icon: <Icon.Send size={15} />,
            onClick: () =>
              void api
                .postAction(p.id, 'postNow')
                .then(() => toast('ok', 'Posting now…'))
                .catch((e) => toast('err', e.message))
          }
        ]
      : []),
    { separator: true },
    {
      label: 'Remove from history',
      icon: <Icon.Trash size={15} />,
      danger: true,
      onClick: async () => {
        if (await confirm({ title: 'Remove from history?', body: 'Published videos stay online. This only removes the record and the copy in Cadence\'s library.', confirm: 'Remove', danger: true }))
          void api.deletePost(p.id).catch((e) => toast('err', e.message))
      }
    }
  ]

  return (
    <>
      <Topbar title="History" subtitle={`${inChannel.length} post${inChannel.length === 1 ? '' : 's'}${chan ? ` on ${chan.label}` : ''}`}>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'published', label: 'Published' },
            { value: 'problems', label: <>Needs attention{problems ? <span className="pill err" style={{ height: 18 }}>{problems}</span> : null}</> }
          ]}
        />
      </Topbar>
      <div className="page">
        {chans.length > 1 && (
          <div className="acct-switch history-channels" role="tablist" aria-label="Channel">
            <button role="tab" aria-selected={!chan} className={cx('acct-chip', !chan && 'on')} onClick={() => setChannel('all')}>
              <span className="ellipsis">All channels</span>
              <span className="chan-count">{all.length}</span>
            </button>
            {chans.map((c) => (
              <button key={c.key} role="tab" aria-selected={chan?.key === c.key} className={cx('acct-chip', chan?.key === c.key && 'on')} onClick={() => setChannel(c.key)}>
                {c.platform === 'instagram' ? <InstagramMark size={14} /> : <YouTubeMark size={14} />}
                <Avatar src={c.avatar} name={c.label.replace(/^@/, '')} size={20} />
                <span className="ellipsis">{c.label}</span>
                <span className="chan-count">{all.filter((p) => onChannel(p, c, snap!.accounts)).length}</span>
              </button>
            ))}
          </div>
        )}
        {!list.length && (
          <div className="empty">
            <div>
              <div className="empty-art" style={{ margin: '0 auto' }}>
                <Icon.History size={38} />
              </div>
              <h3>{filter === 'problems' ? 'Nothing needs attention' : 'Nothing here yet'}</h3>
              <p>{filter === 'problems' ? 'Every post went out fine.' : chan ? `Nothing has been posted to ${chan.label} yet.` : 'Published posts show up here with links to view them.'}</p>
            </div>
          </div>
        )}
        {list.map((p) => (
          <div key={p.id} id={`post-${p.id}`} className={cx('post-row', highlight === p.id && 'highlight')}>
            <div>
              <div className="time" style={{ fontSize: 13.5 }}>
                {p.scheduledAt ? shortDateTime(new Date(p.scheduledAt)) : '—'}
              </div>
            </div>
            {p.video.thumbnailPath ? <img className="thumb" src={api.mediaUrl(p.video.thumbnailPath)} alt="" /> : <div className="thumb" />}
            <div style={{ minWidth: 0 }}>
              <div className="title ellipsis">{p.youtube.enabled && p.youtube.title ? p.youtube.title : p.video.fileName}</div>
              <div className="cap">{p.instagram.enabled ? p.instagram.caption : p.youtube.description}</div>
              {[p.instagram, p.youtube]
                .filter((t) => t.enabled && t.state === 'failed' && t.error)
                .map((t, i) => (
                  <div key={i} className="small selectable" style={{ color: 'var(--err)', marginTop: 4 }}>
                    {t.error}
                  </div>
                ))}
            </div>
            <div className="targets">
              <TargetLine post={p} platform="instagram" />
              <TargetLine post={p} platform="youtube" />
            </div>
            <MenuButton items={actions(p)} />
          </div>
        ))}
      </div>
      <Modal open={!!logPost} onClose={() => setLogPost(null)} width={620}>
        {logPost && (
          <>
            <h2>Activity log</h2>
            <p className="muted small" style={{ marginTop: 0 }}>
              {logPost.video.fileName}
            </p>
            {(['instagram', 'youtube'] as const).map((pl) => {
              const t = logPost[pl]
              if (!t.enabled) return null
              return (
                <div key={pl} style={{ marginTop: 14 }}>
                  <div className="row" style={{ marginBottom: 6, fontWeight: 650 }}>
                    {pl === 'instagram' ? <InstagramMark size={16} /> : <YouTubeMark size={16} />} {pl === 'instagram' ? 'Instagram' : 'YouTube'}
                    {accountLabel(snap!.accounts, pl, t.accountId) && <span className="faint">· {accountLabel(snap!.accounts, pl, t.accountId)}</span>}
                  </div>
                  <div className="card selectable" style={{ padding: 10, maxHeight: 220, overflow: 'auto', fontSize: 12 }}>
                    {t.log.length ? (
                      t.log.map((l, i) => (
                        <div key={i} className="row" style={{ alignItems: 'flex-start', padding: '3px 0', color: l.level === 'error' ? 'var(--err)' : undefined }}>
                          <span className="faint" style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                            {new Date(l.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                          </span>
                          <span>{l.message}</span>
                        </div>
                      ))
                    ) : (
                      <span className="faint">No activity yet.</span>
                    )}
                  </div>
                </div>
              )
            })}
            <div className="actions">
              <button className="btn" onClick={() => setLogPost(null)}>
                Close
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  )
}
