import { useEffect, useRef, useState } from 'react'
import { Icon } from '../icons'
import { Segmented } from '../ui'

export type PreviewMode = 'reel' | 'short'

function CaptionText({ text }: { text: string }) {
  const parts = text.split(/(#[\p{L}\p{N}_]+|@[A-Za-z0-9_.]+)/u)
  return (
    <>
      {parts.map((p, i) =>
        /^[#@]/.test(p) ? (
          <span key={i} className="tag">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  )
}

export default function PhonePreview({
  src,
  poster,
  mode,
  onMode,
  username,
  channel,
  caption,
  title,
  seekTo,
  showModeSwitch
}: {
  src?: string
  poster?: string
  mode: PreviewMode
  onMode: (m: PreviewMode) => void
  username: string
  channel: string
  caption: string
  title: string
  /** When set, pause and show this frame (used by the cover picker). */
  seekTo: number | null
  showModeSwitch: boolean
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(true)
  const [paused, setPaused] = useState(false)
  const [safe, setSafe] = useState(false)

  useEffect(() => {
    const v = ref.current
    if (!v || seekTo == null) return
    v.pause()
    setPaused(true)
    const go = () => {
      v.currentTime = seekTo
    }
    if (v.readyState >= 1) go()
    else v.addEventListener('loadedmetadata', go, { once: true })
  }, [seekTo, src])

  useEffect(() => {
    setPaused(false)
  }, [src])

  const toggle = () => {
    const v = ref.current
    if (!v) return
    if (v.paused) {
      void v.play()
      setPaused(false)
    } else {
      v.pause()
      setPaused(true)
    }
  }

  return (
    <div className="preview-col">
      {showModeSwitch && (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Segmented
            value={mode}
            onChange={onMode}
            options={[
              { value: 'reel', label: 'Reel preview' },
              { value: 'short', label: 'Short preview' }
            ]}
          />
        </div>
      )}
      <div className="phone-frame">
        <div className="phone-screen" onClick={toggle}>
          <div className="phone-island" />
          {src ? (
            <video ref={ref} src={src} poster={poster} autoPlay={seekTo == null} loop muted={muted} playsInline />
          ) : (
            <div className="phone-placeholder">
              <Icon.Film size={40} />
            </div>
          )}
          {safe && <div className="safe-zone" title="Keep text and faces inside this area so the app's buttons don't cover them" />}
          <div className="phone-ui">
            {mode === 'reel' ? (
              <>
                <div className="top">
                  <span>Reels</span>
                </div>
                <div className="side">
                  <div>
                    <Icon.Heart size={22} />
                    1.2K
                  </div>
                  <div>
                    <Icon.Comment size={22} />
                    48
                  </div>
                  <div>
                    <Icon.Share size={20} />
                  </div>
                  <div>
                    <Icon.More size={20} />
                  </div>
                </div>
                <div className="bottom">
                  <div className="user">
                    <div className="avatar">{username.slice(0, 1).toUpperCase()}</div>
                    {username}
                    <span className="follow">Follow</span>
                  </div>
                  <div className="cap">
                    <CaptionText text={caption || 'Your caption appears here…'} />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="top">
                  <span>Shorts</span>
                </div>
                <div className="side">
                  <div>
                    <Icon.ThumbUp size={22} />
                    3.4K
                  </div>
                  <div>
                    <Icon.Comment size={22} />
                    112
                  </div>
                  <div>
                    <Icon.Share size={20} />
                    Share
                  </div>
                </div>
                <div className="bottom">
                  <div className="user">
                    <div className="avatar">{channel.slice(0, 1).toUpperCase()}</div>@{channel.replace(/\s+/g, '').toLowerCase()}
                    <span className="yt-sub">Subscribe</span>
                  </div>
                  <div className="yt-title">{title || 'Your title appears here…'}</div>
                </div>
              </>
            )}
          </div>
          {src && (
            <button
              className="phone-ctrl"
              onClick={(e) => {
                e.stopPropagation()
                setMuted((m) => !m)
              }}
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? <Icon.Mute size={15} /> : <Icon.Volume size={15} />}
            </button>
          )}
          {src && paused && seekTo == null && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
              <div style={{ width: 56, height: 56, borderRadius: 28, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', backdropFilter: 'blur(8px)' }}>
                <Icon.Play size={26} />
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className={`chip ${safe ? 'on' : ''}`} onClick={() => setSafe((s) => !s)}>
          Safe zone
        </button>
      </div>
    </div>
  )
}
