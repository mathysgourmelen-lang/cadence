import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Topbar } from '../App'
import { api, useApp } from '../state'
import { Icon, InstagramMark, YouTubeMark } from '../icons'
import { Avatar, Modal, Segmented, Spinner, useFeedback } from '../ui'
import { cx, relative } from '../util'
import { full, Num } from './Views'
import { TRAFFIC_LABELS } from '../../../shared/traffic'
import { accountKey, type ReelAnalytics, type RetentionPoint, type TimingSample, type YtVideoAnalytics } from '../../../shared/types'
import { analyzeTiming, BLOCK_HOURS, BLOCKS, blockLabel, MIN_SAMPLES, suggestedTimes, type Bucket } from '../../../shared/bestTime'
import { formatHHMM, timezoneName } from '../util'
import { analyzeLength, lengthLabel, MIN_LENGTH_SAMPLES, shortLengthLabel, type LengthBand, type LengthSample } from '../../../shared/videoLength'

type Platform = 'instagram' | 'youtube'

function secs(v: number | null | undefined): string {
  if (v == null) return '—'
  if (v < 60) return `${v.toFixed(v < 10 ? 1 : 0)}s`
  const m = Math.floor(v / 60)
  const s = Math.round(v % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function hours(sec: number | null | undefined): string {
  if (sec == null) return '—'
  const h = sec / 3600
  if (h < 1) return `${Math.round(sec / 60)} min`
  return `${h < 10 ? h.toFixed(1) : Math.round(h).toLocaleString()} h`
}

const pct = (v: number | null | undefined, digits = 0) => (v == null ? '—' : `${v.toFixed(digits)}%`)

function avg(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}
function sum(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x))
  return v.length ? v.reduce((a, b) => a + b, 0) : null
}

function dateShort(iso?: string): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''
}

export default function Analytics() {
  const { snap, go, now } = useApp()
  const { toast } = useFeedback()
  const a = snap!.analytics
  const { instagram: igAcc, youtube: ytAcc } = snap!.accounts
  const [platform, setPlatform] = useState<Platform>(igAcc.length || !ytAcc.length ? 'instagram' : 'youtube')
  const [igSel, setIgSel] = useState<string | undefined>(igAcc[0]?.id)
  const [ytSel, setYtSel] = useState<string | undefined>(ytAcc[0]?.id)
  const asked = useRef(false)

  // Keep the selection valid when accounts are added or removed.
  const igId = igAcc.some((x) => x.id === igSel) ? igSel : igAcc[0]?.id
  const ytId = ytAcc.some((x) => x.id === ytSel) ? ytSel : ytAcc[0]?.id
  const ig = igId ? a.instagram[igId] : undefined
  const yt = ytId ? a.youtube[ytId] : undefined

  const refresh = async (manual: boolean) => {
    try {
      await api.refreshAnalytics()
      if (manual) toast('ok', 'Analytics updated.')
    } catch (e) {
      toast('err', (e as Error).message)
    }
  }

  useEffect(() => {
    if (asked.current) return
    asked.current = true
    const all = [...Object.values(a.instagram), ...Object.values(a.youtube)]
    const last = Math.max(0, ...all.map((x) => Date.parse(x?.fetchedAt ?? '') || 0))
    if ((igAcc.length || ytAcc.length) && Date.now() - last > 30 * 60_000) void refresh(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Views-tab data covers far more posts (up to 1,000 reels / 200 Shorts); fall back to the Analytics list.
  const timingFor = (p: Platform, id: string): TimingSample[] => {
    const fromInsights = snap!.insights.accounts[accountKey(p, id)]?.timing
    if (fromInsights?.length) return fromInsights
    const rows: { publishedAt?: string; views: number | null }[] = (p === 'instagram' ? a.instagram[id]?.reels : a.youtube[id]?.videos) ?? []
    return rows.filter((r) => r.publishedAt && r.views != null).map((r) => [r.publishedAt!, r.views!] as TimingSample)
  }

  const fetched = Date.parse((platform === 'instagram' ? ig?.fetchedAt : yt?.fetchedAt) ?? '') || 0
  const noAccounts = !igAcc.length && !ytAcc.length

  return (
    <>
      <Topbar title="Analytics" subtitle={fetched ? `Updated ${relative(fetched, now)}` : undefined}>
        {!noAccounts && (
          <Segmented
            value={platform}
            onChange={setPlatform}
            options={[
              { value: 'instagram', label: 'Instagram Reels' },
              { value: 'youtube', label: 'YouTube' }
            ]}
          />
        )}
        <button className="btn" onClick={() => refresh(true)} disabled={a.refreshing || noAccounts}>
          {a.refreshing ? <Spinner /> : <Icon.Retry size={16} />} Refresh
        </button>
      </Topbar>
      <div className="page">
        {noAccounts ? (
          <div className="empty">
            <div>
              <div className="empty-art" style={{ margin: '0 auto' }}>
                <Icon.Chart size={36} />
              </div>
              <h3>Connect an account to see analytics</h3>
              <p>Watch time, skip rate and audience retention for every Reel and Short.</p>
              <button className="btn primary lg" onClick={() => go('accounts')}>
                Connect accounts
              </button>
            </div>
          </div>
        ) : platform === 'instagram' ? (
          igId ? (
            <>
              {igAcc.length > 1 && (
                <AccountSwitch value={igId} onChange={setIgSel} options={igAcc.map((x) => ({ id: x.id, label: `@${x.username}`, avatar: x.profilePictureUrl }))} />
              )}
              <InstagramPanel
                key={igId}
                timing={timingFor('instagram', igId)}
                reels={ig?.reels}
                unavailable={ig?.unavailable ?? []}
                error={a.errors[accountKey('instagram', igId)]}
                loading={a.refreshing}
                onGuide={() => go('guide', { guideAnchor: 'instagram' })}
              />
            </>
          ) : (
            <ConnectCard name="Instagram" onConnect={() => go('accounts')} />
          )
        ) : ytId ? (
          <>
            {ytAcc.length > 1 && (
              <AccountSwitch value={ytId} onChange={setYtSel} options={ytAcc.map((x) => ({ id: x.id, label: x.channelTitle, avatar: x.thumbnailUrl }))} />
            )}
            <YouTubePanel
              key={ytId}
              channelId={ytId}
              timing={timingFor('youtube', ytId)}
              videos={yt?.videos}
              traffic={yt?.traffic ?? []}
              error={a.errors[accountKey('youtube', ytId)]}
              loading={a.refreshing}
              onGuide={() => go('guide', { guideAnchor: 'youtube' })}
            />
          </>
        ) : (
          <ConnectCard name="YouTube" onConnect={() => go('accounts')} />
        )}
      </div>
    </>
  )
}

function AccountSwitch({ value, onChange, options }: { value: string; onChange: (id: string) => void; options: { id: string; label: string; avatar?: string }[] }) {
  return (
    <div className="acct-switch" role="tablist" aria-label="Account">
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={o.id === value} className={cx('acct-chip', o.id === value && 'on')} onClick={() => onChange(o.id)}>
          <Avatar src={o.avatar} name={o.label.replace(/^@/, '')} size={20} />
          <span className="ellipsis">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

function ConnectCard({ name, onConnect }: { name: string; onConnect: () => void }) {
  return (
    <div className="empty">
      <div>
        <h3>{name} isn't connected</h3>
        <p>Connect it in Accounts to see its analytics here.</p>
        <button className="btn primary" onClick={onConnect}>
          Connect {name}
        </button>
      </div>
    </div>
  )
}

function Kpi({ icon, label, value, sub, hint }: { icon: ReactNode; label: string; value: ReactNode; sub?: string; hint?: string }) {
  return (
    <div className="card stat" title={hint}>
      <div className="k">
        {icon} {label}
      </div>
      <div className="v">{value}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  )
}

function ErrorNote({ error, onGuide }: { error?: string; onGuide: () => void }) {
  if (!error) return null
  return (
    <div className="notice err" style={{ marginBottom: 16 }}>
      <Icon.Error size={16} />
      <div className="grow">{error}</div>
      <button className="btn sm" onClick={onGuide}>
        Setup guide
      </button>
    </div>
  )
}

// ---------------- generic sortable table ----------------

interface Col<T> {
  key: string
  label: string
  hint?: string
  value: (r: T) => number | null
  render: (r: T) => ReactNode
}

function SortTable<T extends { id: string; title: string; thumbnailUrl?: string; publishedAt?: string; viaCadence?: boolean }>({
  rows,
  cols,
  initial,
  onOpen
}: {
  rows: T[]
  cols: Col<T>[]
  initial: string
  onOpen: (r: T) => void
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: initial, dir: -1 })
  const sorted = useMemo(() => {
    if (sort.key === 'date') return [...rows].sort((a, b) => sort.dir * (a.publishedAt ?? '').localeCompare(b.publishedAt ?? ''))
    const col = cols.find((c) => c.key === sort.key)!
    return [...rows].sort((a, b) => {
      const x = col.value(a)
      const y = col.value(b)
      if (x == null && y == null) return 0
      if (x == null) return 1
      if (y == null) return -1
      return sort.dir * (x - y)
    })
  }, [rows, cols, sort])
  const head = (key: string, label: string, hint?: string) => (
    <th
      key={key}
      title={hint}
      className={cx(sort.key === key && 'on')}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : -1 }))}
    >
      {label}
      {sort.key === key && <span className="dir">{sort.dir === -1 ? '↓' : '↑'}</span>}
    </th>
  )
  return (
    <div className="card table-card">
      <table className="an-table">
        <thead>
          <tr>
            {head('date', 'Post')}
            {cols.map((c) => head(c.key, c.label, c.hint))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} onClick={() => onOpen(r)}>
              <td>
                <div className="an-post">
                  <Thumb src={r.thumbnailUrl} />
                  <div style={{ minWidth: 0 }}>
                    <div className="ellipsis t">{r.title}</div>
                    <div className="faint d">
                      {dateShort(r.publishedAt)}
                      {r.viaCadence && <span className="pill accent mini">via Cadence</span>}
                    </div>
                  </div>
                </div>
              </td>
              {cols.map((c) => (
                <td key={c.key} className="num">
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Thumb({ src }: { src?: string }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken)
    return (
      <div className="an-thumb ph">
        <Icon.Film size={14} />
      </div>
    )
  return <img className="an-thumb" src={src} alt="" onError={() => setBroken(true)} referrerPolicy="no-referrer" />
}

/** A value with a thin bar underneath, for comparing a column at a glance. */
function Meter({ value, max, text }: { value: number | null; max: number; text: ReactNode }) {
  return (
    <div className="meter">
      <span>{text}</span>
      {value != null && (
        <i>
          <b style={{ width: `${Math.min(100, (value / (max || 1)) * 100)}%` }} />
        </i>
      )}
    </div>
  )
}

// ---------------- Instagram ----------------

function InstagramPanel({
  timing,
  reels,
  unavailable,
  error,
  loading,
  onGuide
}: {
  timing: TimingSample[]
  reels?: ReelAnalytics[]
  unavailable: string[]
  error?: string
  loading: boolean
  onGuide: () => void
}) {
  const [open, setOpen] = useState<ReelAnalytics | null>(null)
  if (!reels) {
    return (
      <>
        <ErrorNote error={error} onGuide={onGuide} />
        {loading && (
          <div className="empty">
            <Spinner />
          </div>
        )}
      </>
    )
  }
  const avgWatch = avg(reels.map((r) => r.avgWatchSec))
  const skip = avg(reels.map((r) => r.skipRate))
  const total = sum(reels.map((r) => r.totalWatchSec))
  const shares = sum(reels.map((r) => r.shares))
  const saves = sum(reels.map((r) => r.saves))
  const withSkip = reels.filter((r) => r.skipRate != null)
  const bestHook = withSkip.length ? withSkip.reduce((a, b) => (b.skipRate! < a.skipRate! ? b : a)) : null
  const withWatch = reels.filter((r) => r.avgWatchSec != null)
  const longest = withWatch.length ? withWatch.reduce((a, b) => (b.avgWatchSec! > a.avgWatchSec! ? b : a)) : null
  const maxWatch = Math.max(0, ...reels.map((r) => r.avgWatchSec ?? 0))
  const maxViews = Math.max(0, ...reels.map((r) => r.views ?? 0))

  const allCols: Col<ReelAnalytics>[] = [
    { key: 'views', label: 'Views', value: (r) => r.views, render: (r) => <Meter value={r.views} max={maxViews} text={<Num v={r.views} unit="views" />} /> },
    { key: 'reach', label: 'Reach', hint: 'Accounts that saw the reel at least once', value: (r) => r.reach, render: (r) => <Num v={r.reach} unit="accounts reached" /> },
    { key: 'avgWatch', label: 'Avg watch', hint: 'Average time each play lasted', value: (r) => r.avgWatchSec, render: (r) => <Meter value={r.avgWatchSec} max={maxWatch} text={secs(r.avgWatchSec)} /> },
    {
      key: 'skip',
      label: 'Skip rate',
      hint: 'Share of views that swiped away in the first 3 seconds. Lower is better.',
      value: (r) => r.skipRate,
      render: (r) => <Meter value={r.skipRate} max={100} text={pct(r.skipRate)} />
    },
    { key: 'watch', label: 'Watch time', hint: 'Total time watched, including replays', value: (r) => r.totalWatchSec, render: (r) => hours(r.totalWatchSec) },
    { key: 'shares', label: 'Shares', value: (r) => r.shares, render: (r) => <Num v={r.shares} unit="shares" /> },
    { key: 'saves', label: 'Saves', value: (r) => r.saves, render: (r) => <Num v={r.saves} unit="saves" /> }
  ]
  const cols = allCols.filter((c) => !(c.key === 'skip' && unavailable.includes('reels_skip_rate')) && !(c.key === 'watch' && unavailable.includes('ig_reels_video_view_total_time')))

  return (
    <>
      <ErrorNote error={error} onGuide={onGuide} />
      <div className="stats">
        <Kpi icon={<Icon.Clock size={14} />} label="Avg watch time" value={secs(avgWatch)} sub={`per play, last ${reels.length} reels`} />
        <Kpi
          icon={<Icon.TrendUp size={14} />}
          label="Avg skip rate"
          value={unavailable.includes('reels_skip_rate') ? 'n/a' : pct(skip)}
          sub="left in the first 3 seconds"
          hint="Lower is better. Strong hooks keep people past the first 3 seconds."
        />
        <Kpi icon={<Icon.Eye size={14} />} label="Total watch time" value={hours(total)} sub="including replays" />
        <Kpi icon={<Icon.Share size={14} />} label="Shares · Saves" value={<><Num v={shares} unit="shares" /> · <Num v={saves} unit="saves" /></>} sub="the strongest reach signals" />
      </div>

      {(bestHook || longest) && (
        <div className="an-highlights">
          {bestHook && (
            <div className="card hl" onClick={() => setOpen(bestHook)}>
              <span className="tag">Best hook</span>
              <div className="ellipsis">{bestHook.title}</div>
              <b>{pct(bestHook.skipRate)} skipped</b>
            </div>
          )}
          {longest && (
            <div className="card hl" onClick={() => setOpen(longest)}>
              <span className="tag">Watched longest</span>
              <div className="ellipsis">{longest.title}</div>
              <b>{secs(longest.avgWatchSec)} per play</b>
            </div>
          )}
        </div>
      )}

      <BestTimeCard samples={timing} noun="reels" />
      <LengthCard
        noun="reels"
        total={reels.length}
        samples={reels
          .filter((r) => r.durationSec && r.publishedAt && r.views != null)
          .map((r) => ({ publishedAt: r.publishedAt!, durationSec: r.durationSec!, views: r.views!, watchedPct: r.avgWatchSec != null ? (r.avgWatchSec / r.durationSec!) * 100 : null }))}
      />

      {unavailable.length > 0 && (
        <div className="notice" style={{ marginBottom: 16 }}>
          <Icon.Alert size={16} />
          <div className="grow">
            Instagram didn't return {unavailable.map((m) => METRIC_NAMES[m] ?? m).join(' and ')} for your account yet. Meta lists these as still in development. They'll appear here when
            Instagram starts sending them.
          </div>
        </div>
      )}

      {reels.length ? (
        <SortTable rows={reels} cols={cols} initial="date" onOpen={setOpen} />
      ) : (
        <div className="empty">
          <p>No reels found on this account yet.</p>
        </div>
      )}
      <p className="an-foot">
        Instagram's API doesn't provide a retention graph, so it isn't shown for reels. Numbers can lag up to 48 hours behind the Instagram app.
      </p>

      <Modal open={!!open} onClose={() => setOpen(null)} width={560}>
        {open && <ReelDetail r={open} onClose={() => setOpen(null)} />}
      </Modal>
    </>
  )
}

const METRIC_NAMES: Record<string, string> = {
  reels_skip_rate: 'skip rate',
  ig_reels_video_view_total_time: 'total watch time',
  views: 'views'
}

function DetailHead({ title, date, thumb, url, onClose }: { title: string; date?: string; thumb?: string; url?: string; onClose: () => void }) {
  return (
    <div className="an-detail-head">
      <Thumb src={thumb} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="ellipsis" style={{ fontWeight: 650, fontSize: 15 }}>
          {title}
        </div>
        <div className="faint" style={{ fontSize: 12.5 }}>
          {date && new Date(date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      </div>
      {url && (
        <button className="btn sm" onClick={() => api.openExternal(url)}>
          <Icon.External size={14} /> Open
        </button>
      )}
      <button className="btn icon sm ghost" onClick={onClose} aria-label="Close">
        <Icon.X size={16} />
      </button>
    </div>
  )
}

function ReelDetail({ r, onClose }: { r: ReelAnalytics; onClose: () => void }) {
  const watchedShare = r.avgWatchSec != null && r.durationSec ? (r.avgWatchSec / r.durationSec) * 100 : null
  const facts: [string, ReactNode, string?][] = [
    ['Views', <Num v={r.views} unit="views" />],
    ['Reach', <Num v={r.reach} unit="accounts reached" />, 'Unique accounts'],
    ['Avg watch time', secs(r.avgWatchSec), r.durationSec ? `of ${secs(r.durationSec)}` : undefined],
    ['Skip rate', pct(r.skipRate), 'Left in the first 3 s'],
    ['Watch time', hours(r.totalWatchSec), 'Including replays'],
    ['Likes', <Num v={r.likes} unit="likes" />],
    ['Comments', <Num v={r.comments} unit="comments" />],
    ['Shares', <Num v={r.shares} unit="shares" />],
    ['Saves', <Num v={r.saves} unit="saves" />]
  ]
  return (
    <div className="an-detail">
      <DetailHead title={r.title} date={r.publishedAt} thumb={r.thumbnailUrl} url={r.url} onClose={onClose} />
      {r.skipRate != null && (
        <div className="hook-bar">
          <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5 }}>
            <span>Stayed past 3 seconds</span>
            <b>{pct(100 - r.skipRate)}</b>
          </div>
          <div className="bar2">
            <span style={{ width: `${100 - r.skipRate}%` }} />
          </div>
        </div>
      )}
      {watchedShare != null && (
        <div className="hook-bar">
          <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5 }}>
            <span>Average play covers this much of the reel</span>
            <b>{pct(watchedShare)}</b>
          </div>
          <div className="bar2">
            <span style={{ width: `${Math.min(100, watchedShare)}%` }} />
          </div>
        </div>
      )}
      <div className="an-facts">
        {facts.map(([k, v, s]) => (
          <div key={k}>
            <span>{k}</span>
            <b>{v}</b>
            {s && <i>{s}</i>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------- YouTube ----------------

function YouTubePanel({
  channelId,
  timing,
  videos,
  traffic,
  error,
  loading,
  onGuide
}: {
  channelId: string
  timing: TimingSample[]
  videos?: YtVideoAnalytics[]
  traffic: { source: string; views: number }[]
  error?: string
  loading: boolean
  onGuide: () => void
}) {
  const [open, setOpen] = useState<YtVideoAnalytics | null>(null)
  if (!videos) {
    return (
      <>
        <ErrorNote error={error} onGuide={onGuide} />
        {loading && (
          <div className="empty">
            <Spinner />
          </div>
        )}
      </>
    )
  }
  const avgPct = avg(videos.map((v) => v.avgViewPct))
  const avgDur = avg(videos.map((v) => v.avgViewSec))
  const minutes = sum(videos.map((v) => v.watchMinutes))
  const subs = sum(videos.map((v) => v.subscribersGained))
  const maxViews = Math.max(0, ...videos.map((v) => v.views ?? 0))
  const maxPct = Math.max(100, ...videos.map((v) => v.avgViewPct ?? 0))
  const trafficTotal = traffic.reduce((n, t) => n + t.views, 0)

  const allCols: Col<YtVideoAnalytics>[] = [
    { key: 'views', label: 'Views', value: (v) => v.views, render: (v) => <Meter value={v.views} max={maxViews} text={<Num v={v.views} unit="views" />} /> },
    {
      key: 'engaged',
      label: 'Engaged',
      hint: 'Engaged views: plays that went past the first moments (YouTube\'s older way of counting views)',
      value: (v) => v.engagedViews,
      render: (v) => <Num v={v.engagedViews} unit="engaged views" />
    },
    {
      key: 'pct',
      label: 'Avg % viewed',
      hint: 'How much of the video an average play covered. Over 100% means people rewatched (looping Shorts).',
      value: (v) => v.avgViewPct,
      render: (v) => <Meter value={v.avgViewPct} max={maxPct} text={pct(v.avgViewPct)} />
    },
    { key: 'dur', label: 'Avg duration', value: (v) => v.avgViewSec, render: (v) => secs(v.avgViewSec) },
    { key: 'watch', label: 'Watch time', value: (v) => v.watchMinutes, render: (v) => hours(v.watchMinutes != null ? v.watchMinutes * 60 : null) },
    { key: 'likes', label: 'Likes', value: (v) => v.likes, render: (v) => <Num v={v.likes} unit="likes" /> },
    { key: 'subs', label: 'Subs', hint: 'Subscribers gained from this video\'s page', value: (v) => v.subscribersGained, render: (v) => <Num v={v.subscribersGained} unit="subscribers" /> }
  ]
  const cols = allCols.filter((c) => c.key !== 'engaged' || videos.some((v) => v.engagedViews != null))

  return (
    <>
      <ErrorNote error={error} onGuide={onGuide} />
      <div className="stats">
        <Kpi
          icon={<Icon.Eye size={14} />}
          label="Avg % viewed"
          value={pct(avgPct)}
          sub={`last ${videos.length} uploads`}
          hint="Over 100% means viewers rewatched. Shorts loop, so strong ones often exceed 100%."
        />
        <Kpi icon={<Icon.Clock size={14} />} label="Avg view duration" value={secs(avgDur)} sub="per play" />
        <Kpi icon={<Icon.Chart size={14} />} label="Watch time" value={hours(minutes != null ? minutes * 60 : null)} sub="across these videos" />
        <Kpi icon={<Icon.Users size={14} />} label="Subscribers gained" value={subs != null ? <Num v={subs} prefix="+" unit="subscribers" /> : '—'} sub="from these videos" />
      </div>

      <BestTimeCard samples={timing} noun="Shorts" />
      <LengthCard
        noun="Shorts"
        total={videos.length}
        samples={videos
          .filter((v) => v.durationSec && v.publishedAt)
          .map((v) => ({ publishedAt: v.publishedAt!, durationSec: v.durationSec!, views: v.views, watchedPct: v.avgViewPct }))}
      />

      {traffic.length > 0 && (
        <div className="card traffic">
          <div className="row" style={{ marginBottom: 10 }}>
            <h3>Where views came from</h3>
            <span className="faint" style={{ fontSize: 12 }}>
              last 28 days
            </span>
          </div>
          {traffic.slice(0, 7).map((t) => (
            <div className="t-row" key={t.source}>
              <span className="ellipsis">{TRAFFIC_LABELS[t.source] ?? t.source.replace(/_/g, ' ').toLowerCase()}</span>
              <i>
                <b style={{ width: `${(t.views / (traffic[0].views || 1)) * 100}%` }} />
              </i>
              <span className="num">{pct((t.views / (trafficTotal || 1)) * 100, t.views / trafficTotal < 0.1 ? 1 : 0)}</span>
            </div>
          ))}
        </div>
      )}

      {videos.length ? (
        <SortTable rows={videos} cols={cols} initial="date" onOpen={setOpen} />
      ) : (
        <div className="empty">
          <p>No uploads found on this channel yet.</p>
        </div>
      )}
      <p className="an-foot">
        Click a video to see its audience retention graph. YouTube's API doesn't share the Shorts "stayed to watch vs swiped away" number, so Cadence shows average % viewed and the
        retention graph instead. Data can lag 2 to 3 days behind YouTube Studio.
      </p>

      <Modal open={!!open} onClose={() => setOpen(null)} width={720}>
        {open && <VideoDetail v={open} channelId={channelId} onClose={() => setOpen(null)} />}
      </Modal>
    </>
  )
}

function VideoDetail({ v, channelId, onClose }: { v: YtVideoAnalytics; channelId: string; onClose: () => void }) {
  const [points, setPoints] = useState<RetentionPoint[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    api
      .retention(v.id, channelId)
      .then((p) => alive && setPoints(p))
      .catch((e) => alive && setErr((e as Error).message))
    return () => {
      alive = false
    }
  }, [v.id, channelId])
  const rel = points ? avg(points.map((p) => p.relative)) : null
  const facts: [string, ReactNode][] = [
    ['Views', <Num v={v.views} unit="views" />],
    ['Engaged views', <Num v={v.engagedViews} unit="engaged views" />],
    ['Avg % viewed', pct(v.avgViewPct)],
    ['Avg duration', `${secs(v.avgViewSec)}${v.durationSec ? ` of ${secs(v.durationSec)}` : ''}`],
    ['Watch time', hours(v.watchMinutes != null ? v.watchMinutes * 60 : null)],
    ['Likes', <Num v={v.likes} unit="likes" />],
    ['Comments', <Num v={v.comments} unit="comments" />],
    ['Shares', <Num v={v.shares} unit="shares" />],
    ['Subscribers', v.subscribersGained != null ? <Num v={v.subscribersGained} prefix="+" unit="subscribers" /> : '—']
  ]
  return (
    <div className="an-detail">
      <DetailHead title={v.title} date={v.publishedAt} thumb={v.thumbnailUrl} url={v.url} onClose={onClose} />
      <div className="ret-head">
        <h3>Audience retention</h3>
        {rel != null && (
          <span className={cx('pill', rel >= 0.55 ? 'ok' : rel <= 0.45 ? 'warn' : '')} title="Compared with YouTube videos of similar length">
            {rel >= 0.55 ? 'Above typical' : rel <= 0.45 ? 'Below typical' : 'About typical'} for this length
          </span>
        )}
      </div>
      {err ? (
        <div className="notice err">
          <Icon.Error size={15} />
          <div className="grow">{err}</div>
        </div>
      ) : !points ? (
        <div style={{ height: 220, display: 'grid', placeItems: 'center' }}>
          <Spinner />
        </div>
      ) : points.length < 2 ? (
        <div className="spark-empty" style={{ height: 120 }}>
          Not enough views yet for YouTube to share a retention graph.
        </div>
      ) : (
        <RetentionChart points={points} durationSec={v.durationSec} />
      )}
      <div className="an-facts">
        {facts.map(([k, val]) => (
          <div key={k}>
            <span>{k}</span>
            <b>{val}</b>
          </div>
        ))}
      </div>
    </div>
  )
}

/** One series: share of viewers still watching across the video's length. */
function RetentionChart({ points, durationSec }: { points: RetentionPoint[]; durationSec?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 640
  const H = 220
  const L = 40
  const B = 24
  const T = 10
  const maxY = Math.max(1, ...points.map((p) => p.watch))
  const top = Math.ceil(maxY * 4) / 4
  const x = (at: number) => L + ((at - points[0].at) / (1 - points[0].at || 1)) * (W - L - 8)
  const y = (w: number) => T + (1 - w / top) * (H - T - B)
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(p.watch).toFixed(1)}`).join(' ')
  const area = `${line} L${x(points[points.length - 1].at).toFixed(1)},${y(0)} L${x(points[0].at).toFixed(1)},${y(0)} Z`
  const ticks = Array.from({ length: Math.round(top / 0.25) + 1 }, (_, i) => i * 0.25)
  const xLabel = (at: number) => {
    if (!durationSec) return `${Math.round(at * 100)}%`
    const t = at * durationSec
    return t < 60 ? `${Math.round(t)}s` : secs(t)
  }
  const h = hover != null ? points[hover] : null
  return (
    <div className="ret-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Audience retention: ${Math.round(points[points.length - 1].watch * 100)}% of viewers reach the end`}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - r.left) / r.width) * W
          let best = 0
          for (let i = 1; i < points.length; i++) if (Math.abs(x(points[i].at) - px) < Math.abs(x(points[best].at) - px)) best = i
          setHover(best)
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="retg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--yt)" stopOpacity="0.25" />
            <stop offset="1" stopColor="var(--yt)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - 8} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="axis">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const at = points[0].at + f * (1 - points[0].at)
          return (
            <text key={f} x={x(at)} y={H - 6} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} className="axis">
              {xLabel(f === 0 ? 0 : at)}
            </text>
          )
        })}
        <path d={area} fill="url(#retg)" />
        <path d={line} fill="none" stroke="var(--yt)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {h && (
          <>
            <line x1={x(h.at)} x2={x(h.at)} y1={T} y2={H - B} stroke="var(--border-strong)" strokeWidth="1" />
            <circle cx={x(h.at)} cy={y(h.watch)} r="4.5" fill="var(--yt)" stroke="var(--surface-solid)" strokeWidth="2" />
          </>
        )}
      </svg>
      {h && hover != null && (
        <div className="spark-tip" style={{ left: `${(x(h.at) / W) * 100}%`, top: 0 }}>
          <b>{Math.round(h.watch * 100)}% watching</b>
          <span>at {xLabel(h.at)}</span>
        </div>
      )}
    </div>
  )
}

// ---------- Best time to post ----------

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_LONG = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
/** Monday first. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

function liftText(lift: number): string {
  if (lift >= 1.05) return `${lift >= 10 ? Math.round(lift) : lift.toFixed(1)}× your typical views`
  if (lift <= 0.95) return `${Math.round((1 - lift) * 100)}% fewer views than typical`
  return 'about typical'
}

function cellStyle(c: Bucket): React.CSSProperties | undefined {
  if (!c.n) return undefined
  const strength = Math.min(1, Math.abs(Math.log2(c.lift))) // full colour at 2x / 0.5x
  const pctMix = Math.round(14 + strength * 76) * (c.n === 1 ? 0.55 : 1)
  const hue = c.lift >= 1 ? 'var(--accent)' : 'var(--bt-cool)'
  return { background: `color-mix(in srgb, ${hue} ${pctMix}%, var(--bt-neutral))` }
}

function BestTimeCard({ samples, noun }: { samples: TimingSample[]; noun: string }) {
  const { snap } = useApp()
  const { toast } = useFeedback()
  const best = useMemo(() => analyzeTiming(samples), [samples])
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const times = suggestedTimes(best)
  const current = [...snap!.settings.defaultTimes].sort()
  const alreadySet = times.length > 0 && times.join() === current.join()
  const top = best.bestBlocks[0]
  const enough = best.n >= MIN_SAMPLES
  const hourCols = Array.from({ length: BLOCKS }, (_, i) => i * BLOCK_HOURS)

  const useTimes = async () => {
    try {
      await api.updateSettings({ defaultTimes: times })
      toast('ok', `New posts will now default to ${times.map(formatHHMM).join(', ')}.`)
    } catch (e) {
      toast('err', (e as Error).message)
    }
  }

  const show = (e: React.MouseEvent, text: string) => {
    const host = (e.currentTarget as HTMLElement).closest('.bt-card')!.getBoundingClientRect()
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setTip({ x: r.left - host.left + r.width / 2, y: r.top - host.top, text })
  }
  const describe = (label: string, c: Bucket) => (c.n ? `${label} · ${c.n} ${c.n === 1 ? 'post' : 'posts'} · ${liftText(c.lift)}` : `${label} · no posts yet`)

  return (
    <div className="card bt-card" onMouseLeave={() => setTip(null)}>
      <div className="bt-head">
        <div>
          <h3>Best time to post</h3>
          <div className="faint small">
            From {best.n} {noun} older than 2 days · {timezoneName()}
          </div>
        </div>
        {enough && times.length > 0 && (
          <button className={cx('btn sm', !alreadySet && 'primary')} disabled={alreadySet} onClick={useTimes} title="Compose suggests these times for new posts">
            {alreadySet ? (
              <>
                <Icon.Check size={14} /> These are your posting times
              </>
            ) : (
              <>Use {times.map(formatHHMM).join(', ')} as my times</>
            )}
          </button>
        )}
      </div>

      <div className="bt-body">
        <div className="bt-summary">
          {!enough ? (
            <p className="muted">
              Cadence needs at least {MIN_SAMPLES} {noun} older than 2 days to spot a pattern{best.n ? `, and has ${best.n} so far` : ''}. Keep posting at different times and check back.
            </p>
          ) : top ? (
            <>
              <div className="bt-eyebrow">Your best window</div>
              <div className="bt-big">{blockLabel(top.start)}</div>
              <div className="bt-lift">
                {liftText(top.lift)} <span className="faint">· {top.n} posts</span>
              </div>
              {best.bestBlocks.length > 1 && (
                <div className="bt-also">
                  Also good:{' '}
                  {best.bestBlocks.slice(1).map((b, i) => (
                    <span key={b.start}>
                      {i > 0 && ', '}
                      <b>{blockLabel(b.start)}</b> ({b.lift.toFixed(1)}×)
                    </span>
                  ))}
                </div>
              )}
              {best.bestDays.length > 0 && (
                <div className="bt-also">
                  Best days: <b>{best.bestDays.map((d) => DAY_LONG[d.day]).join(' and ')}</b>
                </div>
              )}
              {best.worstBlock && (
                <div className="bt-also">
                  Weakest: <b>{blockLabel(best.worstBlock.start)}</b> ({liftText(best.worstBlock.lift)})
                </div>
              )}
            </>
          ) : (
            <p className="muted">No time of day clearly beats the others yet. Your {noun} do about the same whenever you post them.</p>
          )}
          <p className="bt-note">
            Each post is compared with the ones you posted around the same time, so a growing account doesn't skew the result.
          </p>
        </div>

        <div className="bt-grid-wrap">
          <div className="bt-grid" role="table" aria-label="Views compared with typical, by weekday and time of day">
            <span />
            {hourCols.map((h) => (
              <span key={h} className="bt-col">
                {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}
              </span>
            ))}
            {DAY_ORDER.map((d) => (
              <Fragment key={d}>
                <span className="bt-row">{DAY_NAMES[d]}</span>
                {best.cells[d].map((c, b) => (
                  <span
                    key={b}
                    className={cx('bt-cell', !c.n && 'bt-none', top && enough && b === top.start / BLOCK_HOURS && 'best-col')}
                    style={cellStyle(c)}
                    onMouseEnter={(e) => show(e, describe(`${DAY_NAMES[d]} ${blockLabel(b * BLOCK_HOURS)}`, c))}
                  />
                ))}
              </Fragment>
            ))}
            <span className="bt-row all">All</span>
            {best.blocks.map((c) => (
              <span key={c.start} className={cx('bt-cell all', !c.n && 'bt-none')} style={cellStyle(c)} onMouseEnter={(e) => show(e, describe(`Any day ${blockLabel(c.start)}`, c))} />
            ))}
          </div>
          <div className="bt-legend">
            <span>Fewer views</span>
            <span className="bt-ramp" />
            <span>More views</span>
          </div>
        </div>
      </div>
      {tip && (
        <div className="bt-tip" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      )}
    </div>
  )
}

// ---------------- best video length ----------------

function LengthCard({ samples, noun, total }: { samples: LengthSample[]; noun: string; total: number }) {
  const a = useMemo(() => analyzeLength(samples), [samples])
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const enough = a.n >= MIN_LENGTH_SAMPLES
  const maxLog = Math.max(0.5, ...a.bands.map((b) => (b.lift ? Math.abs(Math.log2(b.lift)) : 0)))
  const maxPct = Math.max(100, ...a.bands.map((b) => b.watchedPct ?? 0))
  const isBest = (b: LengthBand) => enough && a.best?.from === b.from

  const show = (e: React.MouseEvent, b: LengthBand) => {
    const host = (e.currentTarget as HTMLElement).closest('.len-card')!.getBoundingClientRect()
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const parts = [lengthLabel(b), `${b.n} ${b.n === 1 ? noun.replace(/s$/, '') : noun}`]
    if (b.lift != null) parts.push(liftText(b.lift))
    if (b.watchedPct != null) parts.push(`${Math.round(b.watchedPct)}% watched`)
    if (b.medianViews != null) parts.push(`typically ${full(b.medianViews)} views`)
    setTip({ x: r.left - host.left + r.width / 2, y: r.top - host.top, text: b.n ? parts.join(' · ') : `${lengthLabel(b)} · no ${noun} yet` })
  }

  return (
    <div className="card bt-card len-card" onMouseLeave={() => setTip(null)}>
      <div className="bt-head">
        <div>
          <h3>Best video length</h3>
          <div className="faint small">
            From {a.n} {noun} older than 2 days
            {samples.length < total && ` · length known for ${samples.length} of ${total}`}
          </div>
        </div>
      </div>

      <div className="bt-body">
        <div className="bt-summary">
          {!enough ? (
            <p className="muted">
              Cadence needs at least {MIN_LENGTH_SAMPLES} {noun} older than 2 days to compare lengths{a.n ? `, and has ${a.n} so far` : ''}. Try a few different lengths and check back.
            </p>
          ) : a.best ? (
            <>
              <div className="bt-eyebrow">Your sweet spot</div>
              <div className="bt-big">{lengthLabel(a.best)}</div>
              <div className="bt-lift">
                {liftText(a.best.lift!)} <span className="faint">· {a.best.n} {noun}</span>
              </div>
              {a.best.watchedPct != null && (
                <div className="bt-also">
                  People watch <b>{Math.round(a.best.watchedPct)}%</b> of these on average.
                </div>
              )}
            </>
          ) : (
            <p className="muted">No length clearly beats the others yet. Your {noun} do about the same whatever their length.</p>
          )}
          {enough && a.mostWatched && a.mostWatched.from !== a.best?.from && (
            <div className="bt-also">
              Watched the most: <b>{lengthLabel(a.mostWatched)}</b> ({Math.round(a.mostWatched.watchedPct!)}% on average)
            </div>
          )}
          {enough && a.worst && (
            <div className="bt-also">
              Weakest: <b>{lengthLabel(a.worst)}</b> ({liftText(a.worst.lift!)})
            </div>
          )}
          <p className="bt-note">
            Views are compared with the {noun} you posted around the same time, so a growing account doesn't skew the result. % watched can pass 100% when people rewatch.
          </p>
        </div>

        {a.bands.length > 0 && (
          <div className="len-chart" style={{ gridTemplateColumns: `92px repeat(${a.bands.length}, minmax(0, 1fr))` }}>
            <span className="len-axis">
              Views
              <small>vs typical</small>
            </span>
            {a.bands.map((b) => {
              const log = b.lift ? Math.log2(b.lift) : 0
              const h = Math.max(b.n ? 3 : 0, (Math.abs(log) / maxLog) * 50)
              return (
                <span key={b.from} className={cx('len-col views', isBest(b) && 'best')} onMouseEnter={(e) => show(e, b)}>
                  <span className="len-mid" />
                  {b.n > 0 && <span className={cx('len-bar', log >= 0 ? 'up' : 'down')} style={log >= 0 ? { bottom: '50%', height: `${h}%` } : { top: '50%', height: `${h}%` }} />}
                  {b.lift != null && (
                    <span className="len-val" style={log >= 0 ? { bottom: `calc(50% + ${h}% + 3px)` } : { top: `calc(50% + ${h}% + 3px)` }}>
                      {b.lift.toFixed(1)}×
                    </span>
                  )}
                </span>
              )
            })}

            <span className="len-axis">
              Watched
              <small>avg % of video</small>
            </span>
            {a.bands.map((b) => (
              <span key={b.from} className={cx('len-col watched', isBest(b) && 'best')} onMouseEnter={(e) => show(e, b)}>
                {b.watchedPct != null && (
                  <>
                    <span className="len-bar pct" style={{ height: `${(b.watchedPct / maxPct) * 78}%` }} />
                    <span className="len-val" style={{ bottom: `calc(${(b.watchedPct / maxPct) * 78}% + 3px)` }}>
                      {Math.round(b.watchedPct)}%
                    </span>
                  </>
                )}
              </span>
            ))}

            <span />
            {a.bands.map((b) => (
              <span key={b.from} className={cx('len-label', isBest(b) && 'best')}>
                {shortLengthLabel(b)}
                <small>{b.n ? `${b.n} ${b.n === 1 ? noun.replace(/s$/, '') : noun}` : '–'}</small>
              </span>
            ))}
          </div>
        )}
      </div>
      {tip && (
        <div className="bt-tip" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      )}
    </div>
  )
}
