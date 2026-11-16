import { useState, type CSSProperties } from 'react'
import { Topbar } from '../App'
import { api, useApp } from '../state'
import { Icon, InstagramMark, YouTubeMark } from '../icons'
import { Segmented, ToggleRow, useFeedback } from '../ui'
import { THEMES } from '../../../shared/themes'
import { cx, formatHHMM, uid } from '../util'
import type { Settings } from '../../../shared/types'
import { YOUTUBE_CATEGORIES } from '../../../shared/defaults'

export default function SettingsView() {
  const { snap } = useApp()
  const { toast } = useFeedback()
  const s = snap!.settings
  const [newTime, setNewTime] = useState('15:00')
  const [snipName, setSnipName] = useState('')
  const [snipText, setSnipText] = useState('')

  const set = (patch: Partial<Settings>) => api.updateSettings(patch).catch((e) => toast('err', e.message))

  return (
    <>
      <Topbar title="Settings" subtitle={`Cadence ${snap!.version}`} />
      <div className="page">
        <div className="settings-grid">
          <div className="card card-pad theme-card">
            <div className="section-title">
              <Icon.Sparkle size={17} /> Theme
            </div>
            <div className="theme-grid" role="radiogroup" aria-label="Theme">
              {THEMES.map((t) => {
                const on = s.appearance === t.value
                return (
                  <button
                    key={t.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={cx('theme-tile', on && 'on')}
                    onClick={() => set({ appearance: t.value })}
                  >
                    <span
                      className="theme-swatch"
                      aria-hidden
                      style={{ '--sw-bg': t.swatch.bg, '--sw-side': t.swatch.side, '--sw-card': t.swatch.card, '--sw-text': t.swatch.text, '--sw-accent': t.swatch.accent } as CSSProperties}
                    >
                      <i className="sw-side" />
                      <i className="sw-card">
                        <i className="sw-line" />
                        <i className="sw-line short" />
                        <i className="sw-pill" />
                      </i>
                      {on && (
                        <span className="sw-check">
                          <Icon.Check size={11} />
                        </span>
                      )}
                    </span>
                    <span className="theme-name">{t.label}</span>
                    <span className="theme-desc">{t.desc}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="card card-pad">
            <div className="section-title">
              <Icon.Settings size={17} /> General
            </div>
            <ToggleRow title="Open at login" desc="Starts quietly in the menu bar, so scheduled posts go out after a restart." on={s.launchAtLogin} onChange={(v) => set({ launchAtLogin: v })} />
            <ToggleRow title="Keep Mac awake before posts" desc="Stops idle sleep while uploads run or a post is due soon. A closed lid still sleeps." on={s.keepAwake} onChange={(v) => set({ keepAwake: v })} />
            <ToggleRow title="Notifications" desc="When a post goes live or something fails." on={s.notifications} onChange={(v) => set({ notifications: v })} />
            <ToggleRow title="Pause all scheduling" desc="Nothing uploads or publishes while paused." on={s.paused} onChange={(v) => set({ paused: v })} />
          </div>

          <div className="card card-pad">
            <div className="section-title">
              <Icon.Clock size={17} /> Timing
            </div>
            <div className="field">
              <label>Favorite posting times</label>
              <div className="row wrap" style={{ gap: 6 }}>
                {[...s.defaultTimes].sort().map((t) => (
                  <span key={t} className="chip on">
                    {formatHHMM(t)}
                    <button
                      className="btn ghost icon sm"
                      style={{ width: 18, height: 18, color: 'inherit' }}
                      aria-label={`Remove ${t}`}
                      onClick={() => s.defaultTimes.length > 1 && set({ defaultTimes: s.defaultTimes.filter((x) => x !== t) })}
                    >
                      <Icon.X size={12} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <input className="input time-input" type="time" style={{ width: 130 }} value={newTime} onChange={(e) => setNewTime(e.target.value)} />
                <button className="btn sm" onClick={() => newTime && !s.defaultTimes.includes(newTime) && set({ defaultTimes: [...s.defaultTimes, newTime] })}>
                  <Icon.Plus size={14} /> Add time
                </button>
              </div>
              <div className="help">Used for quick picks and for spreading a batch across days.</div>
            </div>
            <div className="field">
              <label>If the Mac was off at posting time</label>
              <Segmented
                full
                value={s.missedPolicy}
                onChange={(v) => set({ missedPolicy: v })}
                options={[
                  { value: 'post', label: 'Post as soon as it\'s back' },
                  { value: 'ask', label: 'Ask me first' }
                ]}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>
                <InstagramMark size={14} /> Upload reels this many minutes early
              </label>
              <Segmented
                value={String(s.instagramLeadMinutes)}
                onChange={(v) => set({ instagramLeadMinutes: Number(v) })}
                options={['5', '10', '20', '30'].map((v) => ({ value: v, label: `${v} min` }))}
              />
              <div className="help">Instagram needs time to process a video. Uploading early means the reel publishes exactly on time.</div>
            </div>
          </div>

          <div className="card card-pad">
            <div className="section-title">
              <YouTubeMark size={17} /> YouTube defaults
            </div>
            <div className="field">
              <label>Visibility</label>
              <Segmented
                value={s.youtubeDefaultPrivacy}
                onChange={(v) => set({ youtubeDefaultPrivacy: v })}
                options={[
                  { value: 'public', label: 'Public' },
                  { value: 'unlisted', label: 'Unlisted' },
                  { value: 'private', label: 'Private' }
                ]}
              />
            </div>
            <div className="field">
              <label>Scheduling method</label>
              <Segmented
                full
                value={s.youtubeDefaultMode}
                onChange={(v) => set({ youtubeDefaultMode: v })}
                options={[
                  { value: 'native', label: 'Let YouTube publish' },
                  { value: 'atTime', label: 'Upload at post time' }
                ]}
              />
              <div className="help">
                "Let YouTube publish" uploads early as a scheduled video, so it goes live even if your Mac is off. Recommended.
              </div>
            </div>
            <div className="field">
              <label>Category</label>
              <select className="input" value={s.youtubeDefaultCategory} onChange={(e) => set({ youtubeDefaultCategory: e.target.value })}>
                {YOUTUBE_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <ToggleRow title="Made for kids by default" on={s.youtubeMadeForKids} onChange={(v) => set({ youtubeMadeForKids: v })} />
            <ToggleRow title={<>Share reels to main feed by default</>} on={s.instagramShareToFeed} onChange={(v) => set({ instagramShareToFeed: v })} />
          </div>

          <div className="card card-pad">
            <div className="section-title">
              <Icon.Sparkle size={17} /> Caption snippets
              <span className="hint">One click to add to any caption</span>
            </div>
            {s.snippets.map((sn) => (
              <div key={sn.id} className="toggle-row">
                <div className="text">
                  <div className="title">{sn.name}</div>
                  <div className="desc ellipsis">{sn.text}</div>
                </div>
                <button className="btn ghost icon sm" aria-label="Delete snippet" onClick={() => set({ snippets: s.snippets.filter((x) => x.id !== sn.id) })}>
                  <Icon.Trash size={14} />
                </button>
              </div>
            ))}
            <div className="field" style={{ marginTop: 10 }}>
              <input className="input" placeholder="Name, e.g. Core hashtags" value={snipName} onChange={(e) => setSnipName(e.target.value)} />
            </div>
            <div className="field">
              <textarea className="input" style={{ minHeight: 64 }} placeholder="#reels #creator …" value={snipText} onChange={(e) => setSnipText(e.target.value)} />
            </div>
            <button
              className="btn sm"
              disabled={!snipName.trim() || !snipText.trim()}
              onClick={() => {
                set({ snippets: [...s.snippets, { id: uid(), name: snipName.trim(), text: snipText.trim() }] })
                setSnipName('')
                setSnipText('')
              }}
            >
              <Icon.Plus size={14} /> Add snippet
            </button>
          </div>

          <div className="card card-pad">
            <div className="section-title">
              <Icon.Folder size={17} /> Advanced
            </div>
            <div className="field">
              <label>Meta Graph API version</label>
              <input className="input mono" style={{ width: 140 }} value={s.graphApiVersion} onChange={(e) => /^v\d+\.\d+$/.test(e.target.value) && set({ graphApiVersion: e.target.value })} />
              <div className="help">Only change this if Meta tells you the version is no longer supported (e.g. v25.0).</div>
            </div>
            <div className="row">
              <button className="btn sm" onClick={() => api.openDataFolder()}>
                <Icon.Folder size={14} /> Open data folder
              </button>
            </div>
            <div className="help" style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text-3)' }}>
              Cadence keeps a copy of each scheduled video (an instant APFS clone) so moving or renaming the original won't break a post. Copies are removed when you delete a post.
            </div>
          </div>

          <div className="card card-pad">
            <div className="section-title">
              <Icon.Lock size={17} /> Privacy
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              Cadence has no servers. Videos go straight from this Mac to Instagram and YouTube. Your tokens and secrets are encrypted with the macOS Keychain and never leave this computer.
            </p>
            <p className="muted small" style={{ margin: '10px 0 0' }}>
              No analytics, no tracking, no account with us.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
