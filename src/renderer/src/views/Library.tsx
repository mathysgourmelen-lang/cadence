import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Topbar } from '../App'
import { api, useApp } from '../state'
import { Icon, InstagramMark, YouTubeMark } from '../icons'
import { Segmented, Spinner, useFeedback } from '../ui'
import { captureFrame, cx, relative, shortDateTime } from '../util'
import { aspectLabel, formatBytes, formatDuration, validateInstagram, validateYouTube } from '../../../shared/validation'
import { isUpcoming, postStatus } from '../../../shared/status'
import type { Check, FolderListing, FolderVideo, MediaInfo, Post } from '../../../shared/types'

type Filter = 'all' | 'unused' | 'scheduled' | 'posted'
type Sort = 'newest' | 'oldest' | 'name' | 'longest'

function age(ms: number, now: number): string {
  const days = (now - ms) / 86400_000
  if (days < 1) return relative(ms, now)
  if (days < 7) return `${Math.floor(days)}d ago`
  const d = new Date(ms)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }) })
}

const TEXT_CHECKS = new Set(['caption', 'hashtags', 'mentions', 'title', 'description', 'tags'])

interface Fit {
  severity: 'ok' | 'warn' | 'error'
  detail: string
}

function fitOf(checks: Check[]): Fit {
  const relevant = checks.filter((c) => !TEXT_CHECKS.has(c.id))
  const err = relevant.find((c) => c.severity === 'error')
  if (err) return { severity: 'error', detail: err.detail ?? err.label }
  const warn = relevant.find((c) => c.severity === 'warn')
  if (warn) return { severity: 'warn', detail: warn.detail ?? warn.label }
  return { severity: 'ok', detail: 'Ready to post' }
}

function fits(media: MediaInfo): { ig: Fit; yt: Fit } {
  return { ig: fitOf(validateInstagram(media, '').checks), yt: fitOf(validateYouTube(media, '', '', []).checks) }
}

interface Usage {
  kind: 'posted' | 'scheduled' | 'draft'
  label: string
  post: Post
}

function usageOf(posts: Post[]): Map<string, Usage> {
  const m = new Map<string, Usage>()
  const rank = { posted: 3, scheduled: 2, draft: 1 }
  for (const p of posts) {
    const st = postStatus(p)
    let u: Usage | null = null
    if (st === 'published' || st === 'partial' || p.instagram.state === 'published' || p.youtube.state === 'published') {
      u = { kind: 'posted', label: 'Posted', post: p }
    } else if (isUpcoming(p) && st !== 'draft') {
      u = { kind: 'scheduled', label: p.scheduledAt ? shortDateTime(new Date(p.scheduledAt)) : 'Scheduled', post: p }
    } else if (st === 'draft') {
      u = { kind: 'draft', label: 'Draft', post: p }
    }
    if (!u) continue
    const prev = m.get(p.video.originalPath)
    if (!prev || rank[u.kind] > rank[prev.kind]) m.set(p.video.originalPath, u)
  }
  return m
}

export default function Library() {
  const { snap, go, now } = useApp()
  const { toast } = useFeedback()
  const [listing, setListing] = useState<FolderListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('newest')
  const [selected, setSelected] = useState<string[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const folder = snap!.settings.libraryFolder

  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      setListing(await api.listFolder())
    } catch (e) {
      toast('err', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    return api.onFolderChanged(() => void load(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder])

  // Make thumbnails for videos that don't have one yet, one at a time.
  useEffect(() => {
    if (!listing) return
    let alive = true
    const todo = listing.videos.filter((v) => !v.thumbUrl && !v.error && v.media && !thumbs[v.path])
    ;(async () => {
      for (const v of todo) {
        if (!alive) return
        try {
          const dataUrl = await captureFrame(api.folderUrl(v.relPath), Math.min(1, (v.media?.durationSec ?? 3) / 3), 300)
          const url = (await api.saveFolderThumb(v.path, dataUrl)) ?? dataUrl
          if (alive) setThumbs((t) => ({ ...t, [v.path]: url }))
        } catch {
          /* some codecs (e.g. ProRes) can't be decoded by the preview; keep the placeholder */
        }
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing])

  const usage = useMemo(() => usageOf(snap!.posts), [snap])

  const videos = useMemo(() => {
    if (!listing) return []
    const q = query.trim().toLowerCase()
    const list = listing.videos.filter((v) => {
      if (q && !v.relPath.toLowerCase().includes(q)) return false
      const u = usage.get(v.path)
      if (filter === 'unused') return !u
      if (filter === 'scheduled') return u?.kind === 'scheduled' || u?.kind === 'draft'
      if (filter === 'posted') return u?.kind === 'posted'
      return true
    })
    const by: Record<Sort, (a: FolderVideo, b: FolderVideo) => number> = {
      newest: (a, b) => b.mtimeMs - a.mtimeMs,
      oldest: (a, b) => a.mtimeMs - b.mtimeMs,
      name: (a, b) => a.relPath.localeCompare(b.relPath, undefined, { numeric: true }),
      longest: (a, b) => (b.media?.durationSec ?? 0) - (a.media?.durationSec ?? 0)
    }
    return list.sort(by[sort])
  }, [listing, query, filter, sort, usage])

  const counts = useMemo(() => {
    const all = listing?.videos ?? []
    return {
      all: all.length,
      unused: all.filter((v) => !usage.has(v.path)).length,
      scheduled: all.filter((v) => ['scheduled', 'draft'].includes(usage.get(v.path)?.kind ?? '')).length,
      posted: all.filter((v) => usage.get(v.path)?.kind === 'posted').length
    }
  }, [listing, usage])

  const choose = async () => {
    try {
      setListing(await api.chooseFolder())
      setSelected([])
    } catch (e) {
      toast('err', (e as Error).message)
    }
  }

  const toggle = (v: FolderVideo, e?: MouseEvent) => {
    if (v.error) return
    if (e?.shiftKey && selected.length) {
      // Shift-click selects a range, like Finder.
      const last = videos.findIndex((x) => x.path === selected[selected.length - 1])
      const here = videos.findIndex((x) => x.path === v.path)
      const [a, b] = last < here ? [last, here] : [here, last]
      const range = videos.slice(a, b + 1).filter((x) => !x.error).map((x) => x.path)
      setSelected((s) => [...new Set([...s, ...range])])
      return
    }
    setSelected((s) => (s.includes(v.path) ? s.filter((p) => p !== v.path) : [...s, v.path]))
  }

  const createPosts = (paths: string[]) => {
    if (!paths.length) return
    if (paths.length > 100) {
      toast('err', 'You can add up to 100 videos at once.')
      return
    }
    go('compose', { compose: { paths } })
    setSelected([])
  }

  const folderName = folder?.split('/').filter(Boolean).pop()

  return (
    <>
      <Topbar
        title="Library"
        subtitle={
          folder ? (
            <span className="row" style={{ gap: 6 }}>
              <Icon.Folder size={14} />
              <span className="ellipsis" style={{ maxWidth: 360 }} title={folder}>
                {folderName}
              </span>
              {listing?.exists && <span className="faint">· {listing.videos.length} videos</span>}
            </span>
          ) : undefined
        }
      >
        {folder && (
          <>
            <button className="btn icon" title="Show in Finder" onClick={() => api.reveal(folder)}>
              <Icon.External size={16} />
            </button>
            <button className="btn icon" title="Refresh" onClick={() => load()}>
              <Icon.Retry size={16} />
            </button>
            <button className="btn" onClick={choose}>
              <Icon.Folder size={16} /> Change folder
            </button>
          </>
        )}
      </Topbar>

      <div className="page">
        {!folder ? (
          <div className="lib-hero card">
            <div className="lib-hero-art">
              <Icon.Library size={40} />
            </div>
            <h2>Pick your video folder</h2>
            <p>
              Choose the folder where you export your edits (for example <b>Movies › Exports</b>). Cadence shows every MP4 and MOV inside it, checks which ones
              are ready for Reels and Shorts, and remembers which ones you've already posted.
            </p>
            <button className="btn primary lg" onClick={choose}>
              <Icon.Folder size={16} /> Choose folder
            </button>
            <div className="faint" style={{ fontSize: 12, marginTop: 14 }}>
              Your videos stay where they are. New files show up automatically.
            </div>
          </div>
        ) : listing && !listing.exists && !loading ? (
          <div className="notice warn">
            <Icon.Alert size={16} />
            <div className="grow">
              Cadence can't find <b>{folder}</b>. It may have been moved, renamed, or be on a drive that isn't connected.
            </div>
            <button className="btn sm" onClick={choose}>
              Choose again
            </button>
          </div>
        ) : (
          <>
            <div className="lib-toolbar">
              <div className="search">
                <Icon.Search size={15} />
                <input className="input" placeholder="Search videos" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <Segmented
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: `All ${counts.all}` },
                  { value: 'unused', label: `Not posted ${counts.unused}` },
                  { value: 'scheduled', label: `In queue ${counts.scheduled}` },
                  { value: 'posted', label: `Posted ${counts.posted}` }
                ]}
              />
              <div className="grow" />
              <select className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ width: 150 }}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="name">Name</option>
                <option value="longest">Longest first</option>
              </select>
            </div>

            {listing?.truncated && (
              <div className="notice" style={{ marginBottom: 16 }}>
                <Icon.Alert size={16} />
                <div className="grow">This folder has a lot of videos. Cadence shows the 2,000 most recent.</div>
              </div>
            )}

            {loading && !listing ? (
              <div className="empty">
                <Spinner />
              </div>
            ) : !videos.length ? (
              <div className="empty">
                <div>
                  <div className="empty-art" style={{ margin: '0 auto' }}>
                    <Icon.Film size={36} />
                  </div>
                  <h3>{listing?.videos.length ? 'No videos match' : 'No videos in this folder yet'}</h3>
                  <p>{listing?.videos.length ? 'Try another filter or search.' : 'Export an MP4 or MOV into this folder and it will appear here.'}</p>
                </div>
              </div>
            ) : (
              <div className="lib-grid">
                {videos.map((v) => (
                  <VideoCard
                    key={v.path}
                    v={v}
                    thumb={v.thumbUrl ?? thumbs[v.path]}
                    usage={usage.get(v.path)}
                    selected={selected.includes(v.path)}
                    now={now}
                    onToggle={(e) => toggle(v, e)}
                    onOpen={() => (v.error ? undefined : createPosts([v.path]))}
                    onShowPost={(id) => go('queue', { highlight: id })}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {selected.length > 0 && (
        <div className="select-bar">
          <span className="count">{selected.length}</span>
          <span>selected</span>
          <button className="btn ghost sm" onClick={() => setSelected([])}>
            Clear
          </button>
          <button className="btn primary" onClick={() => createPosts(videos.filter((v) => selected.includes(v.path)).map((v) => v.path))}>
            <Icon.Plus size={15} /> {selected.length === 1 ? 'Create post' : `Create ${selected.length} posts`}
          </button>
        </div>
      )}
    </>
  )
}

function FitChip({ mark, label, fit }: { mark: ReactNode; label: string; fit: Fit }) {
  return (
    <span className={cx('fit', fit.severity)} title={`${label}: ${fit.detail}`}>
      {mark}
      {fit.severity === 'ok' ? <Icon.Check size={12} /> : fit.severity === 'warn' ? <Icon.Alert size={12} /> : <Icon.X size={12} />}
    </span>
  )
}

function VideoCard({
  v,
  thumb,
  usage,
  selected,
  now,
  onToggle,
  onOpen,
  onShowPost
}: {
  v: FolderVideo
  thumb?: string
  usage?: Usage
  selected: boolean
  now: number
  onToggle: (e: MouseEvent) => void
  onOpen: () => void
  onShowPost: (id: string) => void
}) {
  const [hover, setHover] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const f = v.media ? fits(v.media) : null
  const vertical = v.media ? v.media.height >= v.media.width : true

  return (
    <div
      className={cx('lib-card', selected && 'selected', v.error && 'broken')}
      onClick={onToggle}
      onDoubleClick={onOpen}
      onMouseEnter={() => {
        timer.current = setTimeout(() => setHover(true), 450)
      }}
      onMouseLeave={() => {
        clearTimeout(timer.current)
        setHover(false)
      }}
    >
      <div className="lib-thumb" style={thumb ? { ['--bg-img' as string]: `url("${thumb}")` } : undefined}>
        {thumb ? <img src={thumb} alt="" style={{ objectFit: vertical ? 'cover' : 'contain' }} draggable={false} /> : <div className="lib-ph">{v.error ? <Icon.Error size={28} /> : <Icon.Film size={28} />}</div>}
        {hover && !v.error && <video src={api.folderUrl(v.relPath)} autoPlay muted loop playsInline style={{ objectFit: vertical ? 'cover' : 'contain' }} />}
        <button
          className={cx('lib-check', selected && 'on')}
          aria-label={selected ? 'Deselect' : 'Select'}
          onClick={(e) => {
            e.stopPropagation()
            onToggle(e)
          }}
        >
          {selected && <Icon.Check size={13} />}
        </button>
        {usage && (
          <span
            className={cx('lib-status', usage.kind)}
            onClick={(e) => {
              e.stopPropagation()
              onShowPost(usage.post.id)
            }}
            title="Show this post"
          >
            {usage.kind === 'posted' ? <Icon.Check size={11} /> : usage.kind === 'scheduled' ? <Icon.Clock size={11} /> : <Icon.Edit size={11} />}
            {usage.label}
          </span>
        )}
        {v.media && <span className="lib-dur">{formatDuration(v.media.durationSec)}</span>}
        <button
          className="lib-use"
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
          disabled={!!v.error}
        >
          <Icon.Plus size={14} /> Post this
        </button>
      </div>
      <div className="lib-meta">
        <div className="name ellipsis" title={v.relPath}>
          {v.name}
        </div>
        <div className="sub ellipsis">
          {v.error ? (
            <span style={{ color: 'var(--err)' }}>{v.error}</span>
          ) : (
            <>
              {v.media && `${aspectLabel(v.media.width, v.media.height)} · `}
              {formatBytes(v.sizeBytes)} · {age(v.mtimeMs, now)}
            </>
          )}
        </div>
        {f && (
          <div className="fits">
            <FitChip mark={<InstagramMark size={13} />} label="Instagram Reel" fit={f.ig} />
            <FitChip mark={<YouTubeMark size={13} />} label="YouTube Short" fit={f.yt} />
            {v.relPath.includes('/') && (
              <span className="faint ellipsis" style={{ fontSize: 11, marginLeft: 'auto', maxWidth: 90 }} title={v.relPath}>
                {v.relPath.split('/').slice(0, -1).join('/')}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
