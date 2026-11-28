import { useEffect, useState } from 'react'
import { Topbar } from '../App'
import { api, useApp } from '../state'
import { Icon, InstagramMark, YouTubeMark } from '../icons'
import { Avatar, Progress, Spinner, useFeedback } from '../ui'
import { cx } from '../util'
import type { InstagramAccount, InstagramPageChoice, Post, YouTubeAccount } from '../../../shared/types'
import { DAILY_UPLOADS } from './quota'

export default function Accounts() {
  const { snap } = useApp()
  const none = !snap!.accounts.instagram.length && !snap!.accounts.youtube.length
  return (
    <>
      <Topbar title="Accounts" subtitle="Connect as many accounts as you like. Your keys stay on this Mac, encrypted in the Keychain." />
      <div className="page">
        {none && (
          <div className="notice" style={{ marginBottom: 18, maxWidth: 1100 }}>
            <Icon.Sparkle size={16} />
            <div>
              <b>Welcome to Cadence.</b> Connect Instagram, YouTube or both. Each takes about 10 minutes the first time, and the Setup Guide walks you through every click.
            </div>
          </div>
        )}
        <div className="accounts-grid" style={{ maxWidth: 1100 }}>
          <InstagramCard />
          <YouTubeCard />
        </div>
      </div>
    </>
  )
}

/** Posts still waiting to go out on this account. */
function pendingFor(posts: Post[], platform: 'instagram' | 'youtube', id: string): number {
  return posts.filter((p) => {
    const t = platform === 'instagram' ? p.instagram : p.youtube
    return t.enabled && t.accountId === id && ['scheduled', 'missed', 'uploading', 'processing', 'ready', 'publishing'].includes(t.state)
  }).length
}

function InstagramCard() {
  const { snap, go } = useApp()
  const { toast } = useFeedback()
  const accounts = snap!.accounts.instagram
  const savedApp = snap!.accounts.instagramAppId
  const [adding, setAdding] = useState(false)
  const [changeApp, setChangeApp] = useState(false)
  const [appId, setAppId] = useState(savedApp ?? '')
  const [appSecret, setAppSecret] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [choices, setChoices] = useState<(InstagramPageChoice & { connected: boolean })[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])

  const needApp = !savedApp || changeApp
  const showForm = (adding || !accounts.length) && !choices

  async function connect() {
    setBusy(true)
    try {
      const list = await api.instagramConnect(needApp ? { appId, appSecret, token } : { token })
      if (list.length === 1) await choose([list[0].igUserId])
      else {
        setChoices(list)
        const fresh = list.filter((c) => !c.connected).map((c) => c.igUserId)
        setPicked(fresh.length ? fresh : list.map((c) => c.igUserId))
      }
    } catch (e) {
      toast('err', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function choose(ids: string[]) {
    setBusy(true)
    try {
      const all = await api.instagramChoose(ids)
      const names = all.filter((a) => ids.includes(a.id)).map((a) => `@${a.username}`)
      setChoices(null)
      setToken('')
      setAppSecret('')
      setAdding(false)
      setChangeApp(false)
      toast('ok', `Connected ${names.join(', ')}.`)
    } catch (e) {
      toast('err', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card account-card">
      <div className="glow" style={{ background: 'radial-gradient(circle, #d6249f, #fd5949)' }} />
      <div className="ac-head">
        <InstagramMark size={38} />
        <div className="grow">
          <h3>Instagram</h3>
          <div className="faint small">Reels via the Instagram Graph API</div>
        </div>
        {accounts.length > 0 && (
          <span className={cx('pill', accounts.some((a) => a.problem) ? 'err' : 'ok')}>
            {accounts.some((a) => a.problem) ? 'Needs attention' : `${accounts.length} connected`}
          </span>
        )}
      </div>

      {accounts.map((a) => (
        <IgRow key={a.id} a={a} onReconnect={() => (setAdding(true), setChoices(null))} />
      ))}

      {accounts.length > 0 && !adding && !choices && (
        <button className="btn add-account" onClick={() => setAdding(true)}>
          <Icon.Plus size={15} /> Add Instagram account
        </button>
      )}

      {showForm && (
        <div className={cx(accounts.length > 0 && 'add-form')}>
          {accounts.length > 0 ? (
            <p className="muted small" style={{ marginTop: 0 }}>
              Each Instagram account needs its own Facebook Page. In Graph API Explorer, generate a new token and tick every Page you want (or "Opt in to all current and future Pages"), then paste it here. You'll pick the accounts next.
            </p>
          ) : (
            <ol className="steps-mini">
              <li>Switch your Instagram to a Business or Creator account and link it to a Facebook Page.</li>
              <li>Create a Meta app and add the permissions listed in the guide.</li>
              <li>Generate a token in Graph API Explorer and paste it below.</li>
            </ol>
          )}
          {needApp ? (
            <>
              <div className="field">
                <label>Meta App ID</label>
                <input className="input mono" placeholder="1234567890123456" value={appId} onChange={(e) => setAppId(e.target.value)} />
              </div>
              <div className="field">
                <label>App Secret</label>
                <input className="input mono" type="password" placeholder="32 characters, from App settings → Basic" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} />
              </div>
            </>
          ) : (
            <div className="saved-app">
              <span className="faint small">
                Meta app <span className="mono">{savedApp}</span>
              </span>
              <button className="btn ghost sm" onClick={() => setChangeApp(true)}>
                Change
              </button>
            </div>
          )}
          <div className="field">
            <label>Access token from Graph API Explorer</label>
            <textarea className="input mono" style={{ minHeight: 76 }} placeholder="EAAG…" value={token} onChange={(e) => setToken(e.target.value)} />
            <div className="help">Cadence swaps it for long-lived Page tokens that don't expire.</div>
          </div>
          <div className="row">
            <button className="btn ghost" onClick={() => go('guide', { guideAnchor: 'instagram' })}>
              <Icon.Guide size={16} /> Guide
            </button>
            <div className="grow" />
            {accounts.length > 0 && (
              <button className="btn ghost" onClick={() => (setAdding(false), setChangeApp(false))}>
                Cancel
              </button>
            )}
            <button className="btn primary" disabled={busy || !token || (needApp && (!appId || !appSecret))} onClick={connect}>
              {busy ? <Spinner /> : <Icon.Link size={16} />} Continue
            </button>
          </div>
        </div>
      )}

      {choices && (
        <div className={cx(accounts.length > 0 && 'add-form')}>
          <div className="label" style={{ marginBottom: 10 }}>
            Choose the accounts to post to
          </div>
          {choices.map((c) => {
            const on = picked.includes(c.igUserId)
            return (
              <button
                key={c.igUserId}
                className={cx('connected-box choice', on && 'on')}
                disabled={busy}
                onClick={() => setPicked((p) => (on ? p.filter((x) => x !== c.igUserId) : [...p, c.igUserId]))}
              >
                <span className={cx('check-dot', on && 'on')}>{on && <Icon.Check size={12} />}</span>
                <Avatar src={c.profilePictureUrl} name={c.username} size={36} />
                <div className="grow">
                  <div style={{ fontWeight: 650 }}>@{c.username}</div>
                  <div className="faint small">
                    {c.pageName}
                    {c.connected && ' · already connected, will refresh its sign-in'}
                  </div>
                </div>
              </button>
            )
          })}
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn ghost sm" onClick={() => setChoices(null)}>
              Back
            </button>
            <div className="grow" />
            <button className="btn primary" disabled={busy || !picked.length} onClick={() => choose(picked)}>
              {busy ? <Spinner /> : <Icon.Check size={16} />} Connect {picked.length === 1 ? '1 account' : `${picked.length} accounts`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function IgRow({ a, onReconnect }: { a: InstagramAccount; onReconnect: () => void }) {
  const { snap } = useApp()
  const { confirm } = useFeedback()
  const [limit, setLimit] = useState<{ used: number; total: number } | null>(null)
  useEffect(() => {
    api
      .instagramLimit(a.id)
      .then(setLimit)
      .catch(() => setLimit(null))
  }, [a.id])
  const pending = pendingFor(snap!.posts, 'instagram', a.id)
  return (
    <div className="acct-row">
      <div className="connected-box">
        <Avatar src={a.profilePictureUrl} name={a.username} size={42} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="ellipsis" style={{ fontWeight: 650 }}>
            @{a.username}
          </div>
          <div className="faint small ellipsis">
            {a.pageName ? `Page: ${a.pageName}` : 'Facebook Page linked'}
            {limit && ` · ${limit.used}/${limit.total} posts in 24 h`}
          </div>
        </div>
        {a.problem && (
          <button className="btn sm" onClick={onReconnect}>
            Reconnect
          </button>
        )}
        <button
          className="btn sm ghost danger"
          onClick={async () => {
            const ok = await confirm({
              title: `Remove @${a.username}?`,
              body: pending ? `${pending} scheduled reel${pending === 1 ? '' : 's'} for this account will fail until you connect it again or pick another account.` : 'You can connect it again any time.',
              confirm: 'Remove',
              danger: true
            })
            if (ok) await api.instagramDisconnect(a.id)
          }}
        >
          Remove
        </button>
      </div>
      {a.problem && (
        <div className="notice err">
          <Icon.Alert size={16} />
          <div>{a.problem}</div>
        </div>
      )}
    </div>
  )
}

function YouTubeCard() {
  const { snap, go } = useApp()
  const { toast } = useFeedback()
  const accounts = snap!.accounts.youtube
  const savedClient = snap!.accounts.youtubeClientId
  const used = snap!.accounts.youtubeQuotaUsedToday
  const [editClient, setEditClient] = useState(false)
  const [clientId, setClientId] = useState(savedClient ?? '')
  const [clientSecret, setClientSecret] = useState('')
  const [busy, setBusy] = useState(false)

  const hasClient = !!savedClient && !!snap!.accounts.youtubeHasSecret
  const showForm = !hasClient || editClient

  async function signIn(args: { clientId?: string; clientSecret?: string }) {
    setBusy(true)
    try {
      const a = await api.youtubeConnect(args)
      setClientSecret('')
      setEditClient(false)
      toast('ok', `Connected ${a.channelTitle}.`)
    } catch (e) {
      toast('err', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card account-card">
      <div className="glow" style={{ background: 'radial-gradient(circle, #ff2d40, #ff7a59)' }} />
      <div className="ac-head">
        <YouTubeMark size={38} />
        <div className="grow">
          <h3>YouTube</h3>
          <div className="faint small">Shorts via the YouTube Data API</div>
        </div>
        {accounts.length > 0 && (
          <span className={cx('pill', accounts.some((a) => a.problem) ? 'err' : 'ok')}>
            {accounts.some((a) => a.problem) ? 'Needs attention' : `${accounts.length} connected`}
          </span>
        )}
      </div>

      {accounts.map((a) => (
        <YtRow key={a.id} a={a} busy={busy} onReconnect={() => signIn({})} />
      ))}

      {accounts.length > 0 && (
        <div style={{ margin: '4px 0 14px' }}>
          <div className="row small" style={{ marginBottom: 6 }}>
            <span className="muted grow">Uploads today, all channels (YouTube allows {DAILY_UPLOADS} per Cloud project, resets at midnight Pacific)</span>
            <span style={{ fontWeight: 650 }}>
              {used} / {DAILY_UPLOADS}
            </span>
          </div>
          <Progress value={used / DAILY_UPLOADS} />
        </div>
      )}

      {busy && (
        <div className="notice" style={{ marginBottom: 14 }}>
          <Spinner />
          <div>Finish signing in in your browser. Pick the Google account, or the Brand Account, that owns the channel, then allow access.</div>
        </div>
      )}

      {hasClient && !editClient && (
        <>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn add-account grow" disabled={busy} onClick={() => signIn({})}>
              <Icon.Plus size={15} /> {accounts.length ? 'Add another channel' : 'Sign in with Google'}
            </button>
          </div>
          <div className="saved-app" style={{ marginTop: 10 }}>
            <span className="faint small ellipsis">
              OAuth client <span className="mono">{savedClient!.slice(0, 18)}…</span>
            </span>
            {!accounts.length && (
              <button className="btn ghost sm" onClick={() => setEditClient(true)}>
                Change
              </button>
            )}
          </div>
          {accounts.length > 0 && (
            <p className="faint small" style={{ marginBottom: 0 }}>
              Signing in with another Google account? While your Google Cloud app is in Testing, add that account under Audience → Test users first.
            </p>
          )}
        </>
      )}

      {showForm && (
        <div className={cx(accounts.length > 0 && 'add-form')}>
          <ol className="steps-mini">
            <li>Create a Google Cloud project and enable the YouTube Data API v3 and YouTube Analytics API.</li>
            <li>Set up the consent screen and create an OAuth client of type "Desktop app".</li>
            <li>Paste the Client ID and secret, then sign in with Google. Add more channels with the same client.</li>
          </ol>
          <div className="field">
            <label>OAuth Client ID</label>
            <input className="input mono" placeholder="…apps.googleusercontent.com" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </div>
          <div className="field">
            <label>Client secret</label>
            <input className="input mono" type="password" placeholder="GOCSPX-…" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
          </div>
          <div className="row">
            <button className="btn ghost" onClick={() => go('guide', { guideAnchor: 'youtube' })}>
              <Icon.Guide size={16} /> Guide
            </button>
            <div className="grow" />
            {editClient && (
              <button className="btn ghost" onClick={() => setEditClient(false)}>
                Cancel
              </button>
            )}
            <button className="btn primary" disabled={busy || !clientId || !clientSecret} onClick={() => signIn({ clientId, clientSecret })}>
              {busy ? <Spinner /> : <Icon.Link size={16} />} Sign in with Google
            </button>
          </div>
        </div>
      )}

      {accounts.length > 0 && (
        <div className="notice" style={{ marginTop: 14 }}>
          <Icon.Lock size={16} />
          <div>
            If YouTube keeps an upload <b>private</b> because your Google Cloud project hasn't been audited, Cadence flags it in the post's log.{' '}
            <a href="#" onClick={(e) => (e.preventDefault(), go('guide', { guideAnchor: 'audit' }))}>
              How to get approved
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

function YtRow({ a, busy, onReconnect }: { a: YouTubeAccount; busy: boolean; onReconnect: () => void }) {
  const { snap } = useApp()
  const { confirm } = useFeedback()
  const pending = pendingFor(snap!.posts, 'youtube', a.id)
  const views = snap!.insights.accounts[`youtube:${a.id}`]
  return (
    <div className="acct-row">
      <div className="connected-box">
        <Avatar src={a.thumbnailUrl} name={a.channelTitle} size={42} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="ellipsis" style={{ fontWeight: 650 }}>
            {a.channelTitle}
          </div>
          <div className="faint small ellipsis">
            {views?.followers != null ? `${views.followers.toLocaleString()} subscribers` : 'Channel connected'}
            {pending > 0 && ` · ${pending} queued`}
          </div>
        </div>
        {(a.problem || !a.canComment) && (
          <button className="btn sm" disabled={busy} onClick={onReconnect} title="Sign in again and choose this channel">
            Reconnect
          </button>
        )}
        <button
          className="btn sm ghost danger"
          onClick={async () => {
            const ok = await confirm({
              title: `Remove ${a.channelTitle}?`,
              body: pending ? `${pending} Short${pending === 1 ? '' : 's'} not uploaded yet will fail until you connect this channel again or pick another one.` : 'You can connect it again any time.',
              confirm: 'Remove',
              danger: true
            })
            if (ok) await api.youtubeDisconnect(a.id)
          }}
        >
          Remove
        </button>
      </div>
      {a.problem && (
        <div className="notice err">
          <Icon.Alert size={16} />
          <div>{a.problem}</div>
        </div>
      )}
      {!a.problem && !a.canComment && (
        <div className="notice warn">
          <Icon.Comment size={16} />
          <div>Reconnect once to let Cadence post the comments you add to your Shorts. Pick this channel and tick every box on the Google screen.</div>
        </div>
      )}
    </div>
  )
}
