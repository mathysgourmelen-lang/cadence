import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Topbar } from '../App'
import { api, useApp } from '../state'
import { Icon, InstagramMark, YouTubeMark } from '../icons'
import { Modal, Segmented, Spinner, Switch, useFeedback } from '../ui'
import { DateTimePicker, dayKey } from './DateTimePicker'
import PhonePreview, { type PreviewMode } from './PhonePreview'
import { addDays, atTime, captureFrame, cx, firstLine, formatHHMM, parseTags, relative, startOfDay, timezoneName, uid } from '../util'
import type { Check, Post, PostDraftInput, Settings, VideoRef, YouTubePrivacy } from '../../../shared/types'
import {
  aspectLabel,
  charCount,
  codecName,
  countHashtags,
  countMentions,
  formatBytes,
  formatDuration,
  IG_LIMITS,
  utf8Bytes,
  validateInstagram,
  validateYouTube,
  YT_LIMITS
} from '../../../shared/validation'
import { YOUTUBE_CATEGORIES } from '../../../shared/defaults'
import { isEditable } from '../../../shared/status'

interface Draft {
  key: string
  postId?: string
  video: VideoRef
  ig: { enabled: boolean; caption: string; shareToFeed: boolean; coverOffsetMs: number | null }
  yt: {
    enabled: boolean
    title: string
    description: string
    tags: string
    privacy: YouTubePrivacy
    madeForKids: boolean
    categoryId: string
    mode: 'native' | 'atTime'
  }
  descSameAsCaption: boolean
  titleTouched: boolean
  when: 'now' | 'later'
  date: string
  igLocked?: boolean
  ytLocked?: boolean
}

// Drafts survive switching tabs (but not quitting the app).
let savedDrafts: Draft[] = []
let savedActive: string | null = null

function nextSlot(settings: Settings, after: Date): Date {
  const times = [...settings.defaultTimes].sort()
  for (let d = 0; d < 60; d++) {
    const day = addDays(startOfDay(after), d)
    for (const t of times) {
      const slot = atTime(day, t)
      if (slot.getTime() > after.getTime() + 5 * 60_000) return slot
    }
  }
  return new Date(after.getTime() + 3600_000)
}

function newDraft(video: VideoRef, settings: Settings, after: Date, ig: boolean, yt: boolean): Draft {
  return {
    key: uid(),
    video,
    ig: { enabled: ig, caption: '', shareToFeed: settings.instagramShareToFeed, coverOffsetMs: null },
    yt: {
      enabled: yt,
      title: '',
      description: '',
      tags: '',
      privacy: settings.youtubeDefaultPrivacy,
      madeForKids: settings.youtubeMadeForKids,
      categoryId: settings.youtubeDefaultCategory,
      mode: settings.youtubeDefaultMode
    },
    descSameAsCaption: true,
    titleTouched: false,
    when: 'later',
    date: nextSlot(settings, after).toISOString()
  }
}

function draftFromPost(p: Post): Draft {
  return {
    key: uid(),
    postId: p.id,
    video: p.video,
    ig: { enabled: p.instagram.enabled, caption: p.instagram.caption, shareToFeed: p.instagram.shareToFeed, coverOffsetMs: p.instagram.coverOffsetMs },
    yt: {
      enabled: p.youtube.enabled,
      title: p.youtube.title,
      description: p.youtube.description,
      tags: p.youtube.tags.join(', '),
      privacy: p.youtube.privacy,
      madeForKids: p.youtube.madeForKids,
      categoryId: p.youtube.categoryId,
      mode: p.youtube.mode
    },
    descSameAsCaption: p.youtube.description === p.instagram.caption,
    titleTouched: true,
    when: p.scheduledAt ? 'later' : 'now',
    date: p.scheduledAt ?? new Date(Date.now() + 3600_000).toISOString(),
    igLocked: p.instagram.enabled && !isEditable(p.instagram.state),
    ytLocked: p.youtube.enabled && !isEditable(p.youtube.state)
  }
}

function effectiveDescription(d: Draft): string {
  return d.descSameAsCaption && d.ig.enabled ? d.ig.caption : d.yt.description
}

function effectiveTitle(d: Draft): string {
  return d.titleTouched ? d.yt.title : firstLine(d.ig.caption).slice(0, YT_LIMITS.maxTitleChars)
}

function toInput(d: Draft, schedule: boolean): PostDraftInput {
  return {
    id: d.postId,
    scheduledAt: d.when === 'now' ? null : d.date,
    video: d.video,
    schedule,
    instagram: { ...d.ig },
    youtube: {
      enabled: d.yt.enabled,
      title: effectiveTitle(d),
      description: effectiveDescription(d),
      tags: parseTags(d.yt.tags),
      privacy: d.yt.privacy,
      madeForKids: d.yt.madeForKids,
      categoryId: d.yt.categoryId,
      mode: d.yt.mode
    }
  }
}

function draftChecks(d: Draft) {
  const input = toInput(d, true)
  return {
    ig: d.ig.enabled ? validateInstagram(d.video.media, d.ig.caption) : null,
    yt: d.yt.enabled ? validateYouTube(d.video.media, input.youtube.title, input.youtube.description, input.youtube.tags) : null
  }
}

function draftProblem(d: Draft, accounts: { ig: boolean; yt: boolean }): string | null {
  if (!d.ig.enabled && !d.yt.enabled) return 'Turn on Instagram or YouTube.'
  const c = draftChecks(d)
  const igErr = c.ig?.checks.find((x) => x.severity === 'error')
  if (igErr) return `Instagram: ${igErr.label} — ${igErr.detail}`
  const ytErr = c.yt?.checks.find((x) => x.severity === 'error')
  if (ytErr) return `YouTube: ${ytErr.label} — ${ytErr.detail}`
  if (d.ig.enabled && !accounts.ig) return 'Connect Instagram in Accounts first.'
  if (d.yt.enabled && !accounts.yt) return 'Connect YouTube in Accounts first.'
  if (d.when === 'later' && Date.parse(d.date) < Date.now() + 30_000) return 'The scheduled time is in the past.'
  return null
}

function statusDot(d: Draft): 'ok' | 'warn' | 'err' {
  const c = draftChecks(d)
  const all = [...(c.ig?.checks ?? []), ...(c.yt?.checks ?? [])]
  if (all.some((x) => x.severity === 'error')) return 'err'
  if (all.some((x) => x.severity === 'warn')) return 'warn'
  return 'ok'
}

export default function Compose() {
  const { snap, composeRequest, go, now } = useApp()
  const { toast, confirm } = useFeedback()
  const [drafts, setDrafts] = useState<Draft[]>(savedDrafts)
  const [active, setActive] = useState<string | null>(savedActive)
  const [importing, setImporting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [previewMode, setPreviewMode] = useState<PreviewMode>('reel')
  const [coverSeek, setCoverSeek] = useState<number | null>(null)
  const [spreadOpen, setSpreadOpen] = useState(false)
  const handledNonce = useRef<number | null>(null)
  const dragDepth = useRef(0)

  const settings = snap!.settings
  const accounts = { ig: snap!.accounts.instagram.connected, yt: snap!.accounts.youtube.connected }

  useEffect(() => {
    savedDrafts = drafts
    savedActive = active
  }, [drafts, active])

  const draft = drafts.find((d) => d.key === active) ?? drafts[0] ?? null

  const busyDays = useMemo(() => {
    const s = new Set<string>()
    for (const p of snap!.posts) if (p.scheduledAt) s.add(dayKey(new Date(p.scheduledAt)))
    return s
  }, [snap])

  // Requests from other screens (edit a post, new post on a calendar day, import).
  useEffect(() => {
    if (!composeRequest || handledNonce.current === composeRequest.nonce) return
    handledNonce.current = composeRequest.nonce
    if (composeRequest.postId) {
      const p = snap!.posts.find((x) => x.id === composeRequest.postId)
      if (p) {
        const existing = drafts.find((d) => d.postId === p.id)
        if (existing) setActive(existing.key)
        else {
          const d = draftFromPost(p)
          setDrafts((ds) => [...ds, d])
          setActive(d.key)
        }
      }
    }
    if (composeRequest.pick) void pick()
    if (composeRequest.paths?.length) void importPaths(composeRequest.paths)
    if (composeRequest.date) pendingDate.current = composeRequest.date
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeRequest])

  const pendingDate = useRef<string | null>(null)

  function update(key: string, fn: (d: Draft) => Draft) {
    setDrafts((ds) => ds.map((d) => (d.key === key ? fn(d) : d)))
  }

  async function addImported(results: Awaited<ReturnType<typeof api.pickVideos>>) {
    const errors = results.filter((r) => !r.ok)
    errors.forEach((e) => toast('err', e.error ?? 'Could not import a file.'))
    const ok = results.filter((r) => r.ok && r.video).map((r) => r.video!)
    if (!ok.length) return
    let after = drafts.length ? new Date(Math.max(Date.now(), ...drafts.map((d) => Date.parse(d.date)))) : new Date()
    if (pendingDate.current) {
      const day = new Date(pendingDate.current)
      after = new Date(Math.max(Date.now(), startOfDay(day).getTime() - 1))
      pendingDate.current = null
    }
    const created: Draft[] = []
    for (const v of ok) {
      const d = newDraft(v, settings, after, accounts.ig || !accounts.yt, accounts.yt || !accounts.ig)
      after = new Date(d.date)
      created.push(d)
    }
    setDrafts((ds) => [...ds, ...created])
    setActive(created[0].key)
    // Thumbnails in the background.
    for (const d of created) {
      if (d.video.thumbnailPath) continue
      captureFrame(api.mediaUrl(d.video.libraryPath), Math.min(1, d.video.media.durationSec / 3))
        .then((dataUrl) => api.saveThumbnail(d.video.libraryPath, dataUrl))
        .then((path) => path && update(d.key, (x) => ({ ...x, video: { ...x.video, thumbnailPath: path } })))
        .catch(() => undefined)
    }
  }

  async function pick() {
    setImporting(true)
    try {
      await addImported(await api.pickVideos())
    } catch (e) {
      toast('err', (e as Error).message)
    } finally {
      setImporting(false)
    }
  }

  async function importPaths(paths: string[]) {
    setImporting(true)
    try {
      await addImported(await api.importPaths(paths))
    } catch (e) {
      toast('err', (e as Error).message)
    } finally {
      setImporting(false)
    }
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault()
    dragDepth.current = 0
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (!files.length) return
    setImporting(true)
    try {
      await addImported(await api.importFiles(files))
    } catch (err) {
      toast('err', (err as Error).message)
    } finally {
      setImporting(false)
    }
  }

  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return
      dragDepth.current++
      setDragOver(true)
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (!dragDepth.current) setDragOver(false)
    },
    onDragOver: (e: DragEvent) => e.preventDefault(),
    onDrop
  }

  function removeDraft(key: string) {
    setDrafts((ds) => ds.filter((d) => d.key !== key))
    if (active === key) setActive(null)
  }

  async function save(list: Draft[], schedule: boolean) {
    if (!list.length) return
    if (schedule) {
      for (const d of list) {
        const problem = draftProblem(d, accounts)
        if (problem) {
          setActive(d.key)
          toast('err', list.length > 1 ? `${d.video.fileName}: ${problem}` : problem)
          return
        }
      }
      const nowPosts = list.filter((d) => d.when === 'now')
      if (nowPosts.length) {
        const ok = await confirm({
          title: nowPosts.length > 1 ? `Post ${nowPosts.length} videos now?` : 'Post this now?',
          body: 'It will start uploading right away and go live as soon as Instagram and YouTube finish processing.',
          confirm: 'Post now'
        })
        if (!ok) return
      }
    }
    setSaving(true)
    try {
      const inputs = list.map((d) => toInput(d, schedule))
      await (inputs.length === 1 ? api.savePost(inputs[0]) : api.savePosts(inputs))
      setDrafts((ds) => ds.filter((d) => !list.some((x) => x.key === d.key)))
      setActive(null)
      const n = list.length
      toast(
        'ok',
        schedule ? (list.every((d) => d.when === 'now') ? `Posting ${n > 1 ? `${n} videos` : 'now'}…` : `Scheduled ${n > 1 ? `${n} posts` : 'your post'}.`) : `Saved ${n > 1 ? `${n} drafts` : 'draft'}.`,
        { label: 'View queue', run: () => go('queue') }
      )
    } catch (e) {
      toast('err', (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!drafts.length) {
    return (
      <>
        <Topbar title="New post" subtitle="Drop in your vertical videos to get started" />
        <div className="page" {...dropHandlers}>
          <div className={cx('dropzone', dragOver && 'over')}>
            <div>
              <div className="hero-art">
                <div className="phone b" />
                <div className="phone c" />
                <div className="phone">{importing ? <Spinner /> : <Icon.Upload size={26} />}</div>
              </div>
              <h2>Drop your Reels &amp; Shorts here</h2>
              <p>Drag MP4 or MOV files from Finder, or choose them. Add as many as you like and schedule them all at once.</p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="btn primary lg" onClick={pick} disabled={importing}>
                  {importing ? <Spinner /> : <Icon.Folder size={17} />} Choose videos
                </button>
              </div>
              <p className="faint small" style={{ marginTop: 18 }}>
                Best results: 1080×1920 (9:16), H.264, under 3 minutes for Shorts and 15 minutes for Reels.
              </p>
            </div>
          </div>
        </div>
        {dragOver && <DropOverlay />}
      </>
    )
  }

  const d = draft!
  const checks = draftChecks(d)
  const title = effectiveTitle(d)
  const description = effectiveDescription(d)
  const chars = charCount(d.ig.caption)
  const tags = countHashtags(d.ig.caption)
  const mentions = countMentions(d.ig.caption)
  const scheduledDate = new Date(d.date)
  const mediaSrc = api.mediaUrl(d.video.libraryPath)
  const poster = d.video.thumbnailPath ? api.mediaUrl(d.video.thumbnailPath) : undefined
  const mode: PreviewMode = d.ig.enabled && d.yt.enabled ? previewMode : d.yt.enabled ? 'short' : 'reel'
  const set = (fn: (x: Draft) => Draft) => update(d.key, fn)
  const ytPublishAt = d.yt.mode === 'native' && d.yt.privacy === 'public'
  const anyScheduled = drafts.some((x) => x.when === 'later')

  return (
    <>
      <Topbar
        title={d.postId ? 'Edit post' : 'New post'}
        subtitle={drafts.length > 1 ? `${drafts.length} videos in this batch` : d.video.fileName}
      >
        {drafts.length > 1 && (
          <button className="btn" onClick={() => setSpreadOpen(true)}>
            <Icon.Wand size={16} /> Spread schedule
          </button>
        )}
      </Topbar>
      <div className="page" {...dropHandlers}>
        <div className="compose">
          {/* ---------- Tray ---------- */}
          <div className="tray">
            <div className="tray-list">
              {drafts.map((x) => (
                <div key={x.key} className={cx('tray-item', x.key === d.key && 'active')} onClick={() => setActive(x.key)}>
                  {x.video.thumbnailPath ? <img className="thumb" src={api.mediaUrl(x.video.thumbnailPath)} alt="" /> : <div className="thumb" />}
                  <div className="meta">
                    <div className="fname ellipsis">{x.video.fileName}</div>
                    <div className="sub">
                      {formatDuration(x.video.media.durationSec)} · {x.when === 'now' ? 'Post now' : new Date(x.date).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                    </div>
                    <div className="row" style={{ gap: 5, marginTop: 4 }}>
                      <span className={cx('dot', statusDot(x))} />
                      {x.ig.enabled && <InstagramMark size={13} />}
                      {x.yt.enabled && <YouTubeMark size={13} />}
                      {x.postId && <span className="pill" style={{ height: 17, fontSize: 10 }}>Editing</span>}
                    </div>
                  </div>
                  <button
                    className="btn ghost icon sm x"
                    aria-label="Remove"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeDraft(x.key)
                    }}
                  >
                    <Icon.X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button className="add-tile" onClick={pick} disabled={importing}>
              {importing ? <Spinner /> : <Icon.Plus size={16} />} Add videos
            </button>
          </div>

          {/* ---------- Editor ---------- */}
          <div>
            <div className="platform-toggles">
              <button className={cx('platform-card', 'ig', d.ig.enabled && 'on')} onClick={() => !d.igLocked && set((x) => ({ ...x, ig: { ...x.ig, enabled: !x.ig.enabled } }))}>
                <InstagramMark size={30} />
                <div className="grow">
                  <div className="pc-title">Instagram Reel</div>
                  <div className="pc-sub">{accounts.ig ? `@${snap!.accounts.instagram.username}` : 'Not connected'}</div>
                </div>
                <Switch on={d.ig.enabled} onChange={() => undefined} disabled={d.igLocked} />
              </button>
              <button className={cx('platform-card', 'yt', d.yt.enabled && 'on')} onClick={() => !d.ytLocked && set((x) => ({ ...x, yt: { ...x.yt, enabled: !x.yt.enabled } }))}>
                <YouTubeMark size={30} />
                <div className="grow">
                  <div className="pc-title">YouTube Short</div>
                  <div className="pc-sub">{accounts.yt ? snap!.accounts.youtube.channelTitle : 'Not connected'}</div>
                </div>
                <Switch on={d.yt.enabled} onChange={() => undefined} disabled={d.ytLocked} />
              </button>
            </div>

            {d.ig.enabled && (
              <div className="card editor-section">
                <div className="section-title">
                  <InstagramMark size={18} /> Caption
                  <span className="hint">
                    {tags > 0 && (
                      <span className={cx(tags > IG_LIMITS.maxHashtags && 'counter err')} style={{ marginRight: 10 }}>
                        {tags} / 30 #
                      </span>
                    )}
                    {mentions > 0 && (
                      <span className={cx(mentions > IG_LIMITS.maxMentions && 'counter err')} style={{ marginRight: 10 }}>
                        {mentions} / 20 @
                      </span>
                    )}
                    <span className={cx('counter', chars > IG_LIMITS.maxCaptionChars ? 'err' : chars > 2000 && 'warn')}>
                      {chars.toLocaleString()} / 2,200
                    </span>
                  </span>
                </div>
                {d.igLocked && <LockedNote text="This reel is already uploading or published, so its caption can't change." />}
                <textarea
                  className="input"
                  rows={6}
                  disabled={d.igLocked}
                  placeholder="Write a caption… Add #hashtags and @mentions."
                  value={d.ig.caption}
                  onChange={(e) => set((x) => ({ ...x, ig: { ...x.ig, caption: e.target.value } }))}
                />
                {settings.snippets.length > 0 && !d.igLocked && (
                  <div className="snippets">
                    {settings.snippets.map((s) => (
                      <button
                        key={s.id}
                        className="chip"
                        title={s.text}
                        onClick={() => set((x) => ({ ...x, ig: { ...x.ig, caption: x.ig.caption ? `${x.ig.caption.trimEnd()}\n\n${s.text}` : s.text } }))}
                      >
                        <Icon.Plus size={12} /> {s.name}
                      </button>
                    ))}
                  </div>
                )}
                <div className="divider" />
                <div className="toggle-row" style={{ paddingTop: 0 }}>
                  <div className="text">
                    <div className="title">Also share to main feed</div>
                    <div className="desc">Shows the reel on your profile grid as well as the Reels tab.</div>
                  </div>
                  <Switch on={d.ig.shareToFeed} disabled={d.igLocked} onChange={(v) => set((x) => ({ ...x, ig: { ...x.ig, shareToFeed: v } }))} />
                </div>
                <div className="toggle-row">
                  <div className="text">
                    <div className="title">Custom cover frame</div>
                    <div className="desc">
                      {d.ig.coverOffsetMs == null ? 'Instagram picks the first frame.' : `Using the frame at ${(d.ig.coverOffsetMs / 1000).toFixed(1)}s. It shows in the preview.`}
                    </div>
                  </div>
                  <Switch
                    on={d.ig.coverOffsetMs != null}
                    disabled={d.igLocked}
                    onChange={(v) => {
                      set((x) => ({ ...x, ig: { ...x.ig, coverOffsetMs: v ? Math.round(Math.min(1, x.video.media.durationSec / 3) * 1000) : null } }))
                      setCoverSeek(v ? Math.min(1, d.video.media.durationSec / 3) : null)
                    }}
                  />
                </div>
                {d.ig.coverOffsetMs != null && (
                  <div className="cover-strip" style={{ padding: '4px 0 2px' }}>
                    <span className="faint small">0s</span>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(0, Math.floor(d.video.media.durationSec * 10) - 1)}
                      value={Math.round(d.ig.coverOffsetMs / 100)}
                      disabled={d.igLocked}
                      onChange={(e) => {
                        const ms = Number(e.target.value) * 100
                        set((x) => ({ ...x, ig: { ...x.ig, coverOffsetMs: ms } }))
                        setCoverSeek(ms / 1000)
                      }}
                      onMouseUp={() => setTimeout(() => setCoverSeek(null), 1500)}
                    />
                    <span className="faint small">{formatDuration(d.video.media.durationSec)}</span>
                  </div>
                )}
              </div>
            )}

            {d.yt.enabled && (
              <div className="card editor-section">
                <div className="section-title">
                  <YouTubeMark size={18} /> YouTube details
                </div>
                {d.ytLocked && <LockedNote text="This Short is already on YouTube. Change it in YouTube Studio." />}
                <div className="field">
                  <label>
                    Title
                    <span className={cx('counter', charCount(title) > YT_LIMITS.maxTitleChars && 'err')}>{charCount(title)} / 100</span>
                  </label>
                  <input
                    className="input"
                    disabled={d.ytLocked}
                    placeholder={d.ig.enabled ? 'Taken from the first line of your caption' : 'Give your Short a title'}
                    value={title}
                    onChange={(e) => set((x) => ({ ...x, titleTouched: true, yt: { ...x.yt, title: e.target.value } }))}
                  />
                  {!d.titleTouched && d.ig.enabled && <div className="help">Filled from your caption's first line. Type to change it.</div>}
                </div>
                <div className="field">
                  <label>
                    Description
                    {d.ig.enabled && (
                      <span className="row" style={{ marginLeft: 'auto', gap: 8, fontWeight: 500 }}>
                        <span className="faint small">Same as caption</span>
                        <Switch
                          on={d.descSameAsCaption}
                          disabled={d.ytLocked}
                          onChange={(v) => set((x) => ({ ...x, descSameAsCaption: v, yt: { ...x.yt, description: v ? x.yt.description : x.yt.description || x.ig.caption } }))}
                        />
                      </span>
                    )}
                  </label>
                  {!(d.descSameAsCaption && d.ig.enabled) && (
                    <>
                      <textarea
                        className="input"
                        rows={4}
                        disabled={d.ytLocked}
                        placeholder="Describe your Short. #Shorts is optional, YouTube detects vertical videos automatically."
                        value={d.yt.description}
                        onChange={(e) => set((x) => ({ ...x, yt: { ...x.yt, description: e.target.value } }))}
                      />
                      <div className="help" style={{ textAlign: 'right' }}>
                        {utf8Bytes(d.yt.description).toLocaleString()} / 5,000 bytes
                      </div>
                    </>
                  )}
                </div>
                <div className="field">
                  <label>Tags</label>
                  <input
                    className="input"
                    disabled={d.ytLocked}
                    placeholder="comma, separated, tags"
                    value={d.yt.tags}
                    onChange={(e) => set((x) => ({ ...x, yt: { ...x.yt, tags: e.target.value } }))}
                  />
                </div>
                <div className="row wrap" style={{ gap: 14, alignItems: 'flex-end' }}>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Visibility</label>
                    <Segmented
                      value={d.yt.privacy}
                      onChange={(v) => !d.ytLocked && set((x) => ({ ...x, yt: { ...x.yt, privacy: v } }))}
                      options={[
                        { value: 'public', label: 'Public' },
                        { value: 'unlisted', label: 'Unlisted' },
                        { value: 'private', label: 'Private' }
                      ]}
                    />
                  </div>
                  <div className="field grow" style={{ marginBottom: 0, minWidth: 160 }}>
                    <label>Category</label>
                    <select className="input" disabled={d.ytLocked} value={d.yt.categoryId} onChange={(e) => set((x) => ({ ...x, yt: { ...x.yt, categoryId: e.target.value } }))}>
                      {YOUTUBE_CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="divider" />
                <div className="toggle-row" style={{ paddingTop: 0 }}>
                  <div className="text">
                    <div className="title">Made for kids</div>
                    <div className="desc">Required by YouTube. Turn on only if the video is directed at children.</div>
                  </div>
                  <Switch on={d.yt.madeForKids} disabled={d.ytLocked} onChange={(v) => set((x) => ({ ...x, yt: { ...x.yt, madeForKids: v } }))} />
                </div>
              </div>
            )}

            {/* ---------- When ---------- */}
            <div className="card editor-section">
              <div className="section-title">
                <Icon.Clock size={18} /> When
                <span className="hint">{timezoneName()}</span>
              </div>
              <div style={{ marginBottom: 14 }}>
                <Segmented
                  full
                  value={d.when}
                  onChange={(v) => set((x) => ({ ...x, when: v }))}
                  options={[
                    { value: 'later', label: (<><Icon.Calendar size={15} /> Schedule</>) },
                    { value: 'now', label: (<><Icon.Send size={15} /> Post now</>) }
                  ]}
                />
              </div>
              {d.when === 'later' ? (
                <>
                  <DateTimePicker value={scheduledDate} onChange={(v) => set((x) => ({ ...x, date: v.toISOString() }))} defaultTimes={settings.defaultTimes} busyDays={busyDays} />
                  <div className="faint small" style={{ marginTop: 12 }}>
                    Goes live {relative(scheduledDate.getTime(), now)}.
                  </div>
                  {d.yt.enabled && (
                    <div className="notice" style={{ marginTop: 12 }}>
                      <Icon.Sparkle size={16} />
                      <div>
                        {ytPublishAt ? (
                          <>
                            <b>YouTube:</b> Cadence uploads the Short right away and YouTube publishes it at this time, even if your Mac is off.
                          </>
                        ) : (
                          <>
                            <b>YouTube:</b> {d.yt.privacy !== 'public' ? `${d.yt.privacy === 'unlisted' ? 'Unlisted' : 'Private'} videos` : 'This Short'} upload at this time, so keep Cadence running.
                          </>
                        )}
                        {d.ig.enabled && (
                          <>
                            {' '}
                            <b>Instagram:</b> Cadence uploads the reel {settings.instagramLeadMinutes} minutes early and publishes it on the dot. Keep your Mac awake.
                          </>
                        )}
                      </div>
                    </div>
                  )}
                  {!d.yt.enabled && d.ig.enabled && (
                    <div className="notice" style={{ marginTop: 12 }}>
                      <Icon.Sparkle size={16} />
                      <div>
                        Cadence uploads the reel {settings.instagramLeadMinutes} minutes early and publishes it on the dot. Keep Cadence running and your Mac awake. It lives in the menu bar.
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="notice">
                  <Icon.Send size={16} />
                  <div>Uploads start as soon as you press Post. Reels usually go live within a few minutes, depending on the file size.</div>
                </div>
              )}
            </div>

            <div className="action-bar">
              <button className="btn ghost danger" onClick={() => removeDraft(d.key)}>
                <Icon.Trash size={15} /> {d.postId ? 'Discard changes' : 'Remove'}
              </button>
              <div className="grow" />
              <button className="btn" disabled={saving} onClick={() => save([d], false)}>
                Save draft
              </button>
              {drafts.length > 1 && (
                <button className="btn" disabled={saving} onClick={() => save(drafts, true)}>
                  {anyScheduled ? `Schedule all ${drafts.length}` : `Post all ${drafts.length}`}
                </button>
              )}
              <button className="btn primary lg" disabled={saving} onClick={() => save([d], true)}>
                {saving ? <Spinner /> : d.when === 'now' ? <Icon.Send size={16} /> : <Icon.Calendar size={16} />}
                {d.when === 'now' ? 'Post now' : d.postId ? 'Update schedule' : 'Schedule'}
              </button>
            </div>
          </div>

          {/* ---------- Preview & checks ---------- */}
          <div className="preview-col">
            <PhonePreview
              src={mediaSrc}
              poster={poster}
              mode={mode}
              onMode={setPreviewMode}
              username={snap!.accounts.instagram.username || 'yourname'}
              channel={snap!.accounts.youtube.channelTitle || 'Your Channel'}
              caption={d.ig.caption}
              title={title}
              seekTo={coverSeek}
              showModeSwitch={d.ig.enabled && d.yt.enabled}
              fill={d.video.media.height / Math.max(1, d.video.media.width) >= 1.7}
            />
            <div className="media-facts">
              <Fact k="Length" v={formatDuration(d.video.media.durationSec)} />
              <Fact k="Ratio" v={aspectLabel(d.video.media.width, d.video.media.height).split(' ')[0]} />
              <Fact k="Size" v={formatBytes(d.video.sizeBytes)} />
              <Fact k="Codec" v={d.video.media.videoCodec ? codecName(d.video.media.videoCodec).split(' ')[0] : '—'} />
            </div>
            {checks.ig && <ChecksCard title="Instagram checks" mark={<InstagramMark size={16} />} checks={checks.ig.checks} />}
            {checks.yt && <ChecksCard title="YouTube checks" mark={<YouTubeMark size={16} />} checks={checks.yt.checks} />}
          </div>
        </div>
      </div>
      {dragOver && <DropOverlay />}
      <SpreadModal
        open={spreadOpen}
        onClose={() => setSpreadOpen(false)}
        settings={settings}
        count={drafts.length}
        onApply={(slots) => {
          setDrafts((ds) => ds.map((x, i) => (slots[i] ? { ...x, when: 'later', date: slots[i].toISOString() } : x)))
          setSpreadOpen(false)
          toast('ok', `Spread ${Math.min(slots.length, drafts.length)} posts across your schedule.`)
        }}
      />
    </>
  )
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="fact">
      <div className="k">{k}</div>
      <div className="v ellipsis">{v}</div>
    </div>
  )
}

function LockedNote({ text }: { text: string }) {
  return (
    <div className="notice warn" style={{ marginBottom: 12 }}>
      <Icon.Lock size={16} />
      <div>{text}</div>
    </div>
  )
}

function DropOverlay() {
  return (
    <div className="drop-overlay">
      <div className="box">
        <Icon.Upload size={30} />
        <div style={{ marginTop: 10 }}>Drop to add videos</div>
      </div>
    </div>
  )
}

export function ChecksCard({ title, mark, checks }: { title: string; mark: React.ReactNode; checks: Check[] }) {
  const errors = checks.filter((c) => c.severity === 'error').length
  const warns = checks.filter((c) => c.severity === 'warn').length
  return (
    <div className="card checks">
      <div className="section-title" style={{ marginBottom: 6 }}>
        {mark} {title}
        <span className="hint">
          {errors ? <span className="pill err">{errors} to fix</span> : warns ? <span className="pill warn">{warns} warning{warns > 1 ? 's' : ''}</span> : <span className="pill ok">Ready</span>}
        </span>
      </div>
      {checks.map((c) => (
        <div key={c.id} className={cx('check', c.severity)}>
          <div className="ci">{c.severity === 'ok' ? <Icon.Check size={12} /> : c.severity === 'warn' ? <Icon.Alert size={12} /> : <Icon.X size={12} />}</div>
          <div className="grow">
            <div className="cl">{c.label}</div>
            {c.detail && <div className="cd">{c.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

function SpreadModal({
  open,
  onClose,
  settings,
  count,
  onApply
}: {
  open: boolean
  onClose: () => void
  settings: Settings
  count: number
  onApply: (slots: Date[]) => void
}) {
  const [start, setStart] = useState(() => startOfDay(new Date()).toISOString())
  const [times, setTimes] = useState<string[]>(() => [settings.defaultTimes[settings.defaultTimes.length > 2 ? 2 : 0] ?? '18:00'])
  const [every, setEvery] = useState(1)

  const slots = useMemo(() => {
    const out: Date[] = []
    const sorted = [...times].sort()
    if (!sorted.length) return out
    for (let day = 0; out.length < count && day < 400; day += every) {
      for (const t of sorted) {
        const s = atTime(addDays(new Date(start), day), t)
        if (s.getTime() > Date.now() + 5 * 60_000) out.push(s)
        if (out.length >= count) break
      }
    }
    return out
  }, [start, times, every, count])

  return (
    <Modal open={open} onClose={onClose} width={500}>
      <h2>Spread schedule</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Give each of the {count} videos its own slot, in the order they appear on the left.
      </p>
      <div className="field">
        <label>Starting</label>
        <div className="row wrap">
          {[0, 1, 2, 7].map((n) => {
            const d = addDays(startOfDay(new Date()), n)
            return (
              <button key={n} className={cx('chip', new Date(start).getTime() === d.getTime() && 'on')} onClick={() => setStart(d.toISOString())}>
                {n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === 7 ? 'In a week' : d.toLocaleDateString(undefined, { weekday: 'long' })}
              </button>
            )
          })}
        </div>
      </div>
      <div className="field">
        <label>Post at</label>
        <div className="row wrap">
          {settings.defaultTimes.map((t) => (
            <button key={t} className={cx('chip', times.includes(t) && 'on')} onClick={() => setTimes((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]))}>
              {formatHHMM(t)}
            </button>
          ))}
        </div>
        <div className="help">Pick one or more times per day. Change the list in Settings.</div>
      </div>
      <div className="field">
        <label>Every</label>
        <Segmented
          value={String(every)}
          onChange={(v) => setEvery(Number(v))}
          options={[
            { value: '1', label: 'Day' },
            { value: '2', label: '2 days' },
            { value: '3', label: '3 days' },
            { value: '7', label: 'Week' }
          ]}
        />
      </div>
      <div className="card" style={{ padding: 12, maxHeight: 170, overflow: 'auto' }}>
        {slots.map((s, i) => (
          <div key={i} className="row small" style={{ padding: '3px 0' }}>
            <span className="faint" style={{ width: 22 }}>
              {i + 1}.
            </span>
            {s.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </div>
        ))}
        {!slots.length && <div className="faint small">Pick at least one time.</div>}
      </div>
      <div className="actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!slots.length} onClick={() => onApply(slots)}>
          Apply to {Math.min(slots.length, count)} videos
        </button>
      </div>
    </Modal>
  )
}
