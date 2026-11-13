import { useEffect, useState } from 'react'
import { Topbar } from '../App'
import { api, useApp } from '../state'
import { Icon, InstagramMark, YouTubeMark } from '../icons'
import { Avatar, Progress, Spinner, useFeedback } from '../ui'
import type { InstagramPageChoice } from '../../../shared/types'
import { DAILY_UPLOADS } from './quota'

export default function Accounts() {
  const { snap } = useApp()
  const neither = !snap!.accounts.instagram.connected && !snap!.accounts.youtube.connected
  return (
    <>
      <Topbar title="Accounts" subtitle="Connect once. Your keys stay on this Mac, encrypted in the Keychain." />
      <div className="page">
        {neither && (
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

function InstagramCard() {
  const { snap, go } = useApp()
  const { toast, confirm } = useFeedback()
  const acc = snap!.accounts.instagram
  const [appId, setAppId] = useState(acc.appId ?? '')
  const [appSecret, setAppSecret] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [choices, setChoices] = useState<InstagramPageChoice[] | null>(null)
  const [limit, setLimit] = useState<{ used: number; total: number } | null>(null)
  const [reconnecting, setReconnecting] = useState(false)

  useEffect(() => {
    if (acc.connected) api.instagramLimit().then(setLimit).catch(() => setLimit(null))
  }, [acc.connected])

  async function connect() {
    setBusy(true)
    try {
      const list = await api.instagramConnect({ appId, appSecret, token })
      if (list.length === 1) await choose(list[0].igUserId)
      else setChoices(list)
    } catch (e) {
      toast('err', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function choose(id: string) {
    setBusy(true)
    try {
      const a = await api.instagramChoose(id)
      setChoices(null)
      setToken('')
      setAppSecret('')
      setReconnecting(false)
      toast('ok', `Connected @${a.username}.`)
    } catch (e) {
      toast('err', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const showForm = !acc.connected || reconnecting

  return (
    <div className="card account-card">
      <div className="glow" style={{ background: 'radial-gradient(circle, #d6249f, #fd5949)' }} />
      <div className="ac-head">
        <InstagramMark size={38} />
        <div className="grow">
          <h3>Instagram</h3>
          <div className="faint small">Reels via the Instagram Graph API</div>
        </div>
        {acc.connected && !acc.problem && <span className="pill ok">Connected</span>}
        {acc.problem && <span className="pill err">Needs attention</span>}
      </div>

      {acc.connected && (
        <div className="connected-box" style={{ marginBottom: 14 }}>
          <Avatar src={acc.profilePictureUrl} name={acc.username} size={44} />
          <div className="grow">
            <div style={{ fontWeight: 650 }}>@{acc.username}</div>
            <div className="faint small">Facebook Page: {acc.pageName}</div>
          </div>
          <button className="btn sm" onClick={() => setReconnecting((r) => !r)}>
            {reconnecting ? 'Cancel' : 'Reconnect'}
          </button>
          <button
            className="btn sm ghost danger"
            onClick={async () => {
              if (await confirm({ title: 'Disconnect Instagram?', body: 'Scheduled reels will fail until you connect again.', confirm: 'Disconnect', danger: true })) await api.instagramDisconnect()
            }}
          >
            Disconnect
          </button>
        </div>
      )}

      {acc.problem && (
        <div className="notice err" style={{ marginBottom: 14 }}>
          <Icon.Alert size={16} />
          <div>{acc.problem}</div>
        </div>
      )}

      {acc.connected && limit && !reconnecting && (
        <div style={{ marginBottom: 6 }}>
          <div className="row small" style={{ marginBottom: 6 }}>
            <span className="muted grow">Posts published by apps in the last 24 hours</span>
            <span style={{ fontWeight: 650 }}>
              {limit.used} / {limit.total}
            </span>
          </div>
          <Progress value={limit.used / Math.max(1, limit.total)} />
        </div>
      )}

      {showForm && !choices && (
        <>
          <ol className="steps-mini">
            <li>Switch your Instagram to a Business or Creator account and link it to a Facebook Page.</li>
            <li>Create a Meta app and add the permissions listed in the guide.</li>
            <li>Generate a token in Graph API Explorer and paste it below.</li>
          </ol>
          <div className="field">
            <label>Meta App ID</label>
            <input className="input mono" placeholder="1234567890123456" value={appId} onChange={(e) => setAppId(e.target.value)} />
          </div>
          <div className="field">
            <label>App Secret</label>
            <input className="input mono" type="password" placeholder="32 characters, from App settings → Basic" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} />
          </div>
          <div className="field">
            <label>Access token from Graph API Explorer</label>
            <textarea className="input mono" style={{ minHeight: 76 }} placeholder="EAAG…" value={token} onChange={(e) => setToken(e.target.value)} />
            <div className="help">Cadence swaps it for a long-lived token that doesn't expire, so you only do this once.</div>
          </div>
          <div className="row">
            <button className="btn ghost" onClick={() => go('guide', { guideAnchor: 'instagram' })}>
              <Icon.Guide size={16} /> Step-by-step guide
            </button>
            <div className="grow" />
            <button className="btn primary" disabled={busy || !appId || !appSecret || !token} onClick={connect}>
              {busy ? <Spinner /> : <Icon.Link size={16} />} Connect Instagram
            </button>
          </div>
        </>
      )}

      {choices && (
        <>
          <div className="label" style={{ marginBottom: 10 }}>
            Choose the account to post to
          </div>
          {choices.map((c) => (
            <button key={c.igUserId} className="connected-box" style={{ width: '100%', marginBottom: 8, textAlign: 'left' }} disabled={busy} onClick={() => choose(c.igUserId)}>
              <Avatar src={c.profilePictureUrl} name={c.username} size={36} />
              <div className="grow">
                <div style={{ fontWeight: 650 }}>@{c.username}</div>
                <div className="faint small">{c.pageName}</div>
              </div>
              <Icon.ChevronRight size={16} />
            </button>
          ))}
          <button className="btn ghost sm" onClick={() => setChoices(null)}>
            Back
          </button>
        </>
      )}
    </div>
  )
}

function YouTubeCard() {
  const { snap, go } = useApp()
  const { toast, confirm } = useFeedback()
  const acc = snap!.accounts.youtube
  const [clientId, setClientId] = useState(acc.clientId ?? '')
  const [clientSecret, setClientSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)

  async function connect() {
    setBusy(true)
    try {
      const a = await api.youtubeConnect({ clientId, clientSecret })
      setClientSecret('')
      setReconnecting(false)
      toast('ok', `Connected ${a.channelTitle}.`)
    } catch (e) {
      toast('err', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const showForm = !acc.connected || reconnecting
  const uploadsLeft = Math.max(0, DAILY_UPLOADS - acc.quotaUsedToday)

  return (
    <div className="card account-card">
      <div className="glow" style={{ background: 'radial-gradient(circle, #ff2d40, #ff7a59)' }} />
      <div className="ac-head">
        <YouTubeMark size={38} />
        <div className="grow">
          <h3>YouTube</h3>
          <div className="faint small">Shorts via the YouTube Data API</div>
        </div>
        {acc.connected && !acc.problem && <span className="pill ok">Connected</span>}
        {acc.problem && <span className="pill err">Needs attention</span>}
      </div>

      {acc.connected && (
        <div className="connected-box" style={{ marginBottom: 14 }}>
          <Avatar src={acc.thumbnailUrl} name={acc.channelTitle} size={44} />
          <div className="grow">
            <div style={{ fontWeight: 650 }}>{acc.channelTitle}</div>
            <div className="faint small">
              {uploadsLeft} upload{uploadsLeft === 1 ? '' : 's'} left today
            </div>
          </div>
          <button className="btn sm" onClick={() => setReconnecting((r) => !r)}>
            {reconnecting ? 'Cancel' : 'Reconnect'}
          </button>
          <button
            className="btn sm ghost danger"
            onClick={async () => {
              if (await confirm({ title: 'Disconnect YouTube?', body: 'Shorts that are not uploaded yet will fail until you connect again.', confirm: 'Disconnect', danger: true })) await api.youtubeDisconnect()
            }}
          >
            Disconnect
          </button>
        </div>
      )}

      {acc.problem && (
        <div className="notice err" style={{ marginBottom: 14 }}>
          <Icon.Alert size={16} />
          <div>{acc.problem}</div>
        </div>
      )}

      {acc.connected && !reconnecting && (
        <>
          <div className="row small" style={{ marginBottom: 6 }}>
            <span className="muted grow">Uploads today (YouTube allows {DAILY_UPLOADS}, resets at midnight Pacific)</span>
            <span style={{ fontWeight: 650 }}>
              {acc.quotaUsedToday} / {DAILY_UPLOADS}
            </span>
          </div>
          <Progress value={acc.quotaUsedToday / DAILY_UPLOADS} />
          <div className="notice" style={{ marginTop: 14 }}>
            <Icon.Lock size={16} />
            <div>
              If YouTube keeps an upload <b>private</b> because your Google Cloud project hasn't been audited, Cadence flags it in the post's log.{' '}
              <a href="#" onClick={(e) => (e.preventDefault(), go('guide', { guideAnchor: 'audit' }))}>
                How to get approved
              </a>
            </div>
          </div>
        </>
      )}

      {showForm && (
        <>
          <ol className="steps-mini" style={{ marginTop: acc.connected ? 14 : 0 }}>
            <li>Create a Google Cloud project and enable the YouTube Data API v3.</li>
            <li>Set up the consent screen and create an OAuth client of type "Desktop app".</li>
            <li>Paste the Client ID and secret, then sign in with Google.</li>
          </ol>
          <div className="field">
            <label>OAuth Client ID</label>
            <input className="input mono" placeholder="…apps.googleusercontent.com" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </div>
          <div className="field">
            <label>Client secret</label>
            <input className="input mono" type="password" placeholder="GOCSPX-…" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
          </div>
          {busy && (
            <div className="notice" style={{ marginBottom: 14 }}>
              <Spinner />
              <div>Finish signing in in your browser. Choose the Google account that owns your channel and allow access.</div>
            </div>
          )}
          <div className="row">
            <button className="btn ghost" onClick={() => go('guide', { guideAnchor: 'youtube' })}>
              <Icon.Guide size={16} /> Step-by-step guide
            </button>
            <div className="grow" />
            <button className="btn primary" disabled={busy || !clientId || !clientSecret} onClick={connect}>
              {busy ? <Spinner /> : <Icon.Link size={16} />} Sign in with Google
            </button>
          </div>
        </>
      )}
    </div>
  )
}
