import { useEffect, useMemo, useRef, useState } from 'react'
import { Topbar } from '../App'
import { api, useApp } from '../state'
import { Icon } from '../icons'
import { Segmented, Spinner, useFeedback } from '../ui'
import { cx, relative } from '../util'
import { buildOverview, OVERVIEW_METRICS, type OverviewMetric, type OverviewPost } from '../../../shared/overview'
import { accountKey, type AccountKey, type InsightsPoint, type AppSnapshot } from '../../../shared/types'
import { compact, full } from './Views'

type Scope = 'all' | 'instagram' | 'youtube'

const COLOR: Record<OverviewMetric, string> = {
  views: 'var(--ov-views)',
  posts: 'var(--ov-posts)',
  likes: 'var(--ov-likes)',
  comments: 'var(--ov-comments)',
  shares: 'var(--ov-shares)',
  saves: 'var(--ov-saves)',
  watchHours: 'var(--ov-watch)',
  subscribers: 'var(--ov-subs)'
}

const fmt = (m: OverviewMetric, v: number) => (m === 'watchHours' ? (v < 10 ? v.toFixed(1) : full(Math.round(v))) : full(Math.round(v)))
const short = (m: OverviewMetric, v: number) => (m === 'watchHours' && v < 10 ? v.toFixed(1) : compact(Math.round(v)))

/** Every published post Cadence knows about, with the richest stats available for it. */
export function overviewPosts(snap: AppSnapshot): OverviewPost[] {
  const out: OverviewPost[] = []
  for (const [id, ig] of Object.entries(snap.analytics.instagram)) {
    const account = accountKey('instagram', id)
    for (const r of ig?.reels ?? [])
      if (r.publishedAt)
        out.push({ id: r.id, account, publishedAt: r.publishedAt, likes: r.likes, comments: r.comments, shares: r.shares, saves: r.saves, watchHours: r.totalWatchSec != null ? r.totalWatchSec / 3600 : null })
  }
  for (const [id, yt] of Object.entries(snap.analytics.youtube)) {
    const account = accountKey('youtube', id)
    for (const v of yt?.videos ?? [])
      if (v.publishedAt)
        out.push({ id: v.id, account, publishedAt: v.publishedAt, likes: v.likes, comments: v.comments, shares: v.shares, watchHours: v.watchMinutes != null ? v.watchMinutes / 60 : null, subscribers: v.subscribersGained })
  }
  // Fall back to the view-count lists for posts the analytics haven't covered (buildOverview keeps the first copy).
  for (const [key, acc] of Object.entries(snap.insights.accounts)) {
    for (const m of [...(acc?.recent ?? []), ...(acc?.top ?? [])])
      if (m.publishedAt) out.push({ id: m.id, account: key as AccountKey, publishedAt: m.publishedAt, likes: m.likes, comments: m.comments })
  }
  return out
}

type Range = 7 | 30 | 90

export default function OverviewTab() {
  const { snap, go, now } = useApp()
  const { toast } = useFeedback()
  const s = snap!
  const [range, setRange] = useState<Range>(30)
  const asked = useRef(false)
  const accounts = useMemo(
    () => [...s.accounts.instagram.map((a) => accountKey('instagram', a.id)), ...s.accounts.youtube.map((a) => accountKey('youtube', a.id))],
    [s.accounts]
  )
  const posts = useMemo(() => overviewPosts(s), [s.analytics, s.insights])
  const busy = s.insights.refreshing || s.analytics.refreshing
  const fetched = Math.max(
    0,
    ...[...Object.values(s.insights.accounts), ...Object.values(s.analytics.instagram), ...Object.values(s.analytics.youtube)].map((x) => Date.parse(x?.fetchedAt ?? '') || 0)
  )

  const refresh = async (manual: boolean) => {
    try {
      await Promise.all([api.refreshInsights(), api.refreshAnalytics()])
      if (manual) toast('ok', 'Stats updated.')
    } catch (e) {
      toast('err', (e as Error).message)
    }
  }

  // Refresh on open when the numbers are more than 30 minutes old.
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    if (accounts.length && Date.now() - fetched > 30 * 60_000) void refresh(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <Topbar title="Overview" subtitle={fetched ? `Updated ${relative(fetched, now)}` : undefined}>
        {accounts.length > 0 && (
          <Segmented
            value={String(range)}
            onChange={(v) => setRange(Number(v) as Range)}
            options={[
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
              { value: '90', label: '90 days' }
            ]}
          />
        )}
        <button className="btn" onClick={() => refresh(true)} disabled={busy || !accounts.length}>
          {busy ? <Spinner /> : <Icon.Retry size={16} />} Refresh
        </button>
      </Topbar>
      <div className="page">
        {!accounts.length ? (
          <div className="empty">
            <div>
              <div className="empty-art" style={{ margin: '0 auto' }}>
                <Icon.TrendUp size={36} />
              </div>
              <h3>Connect an account to see your stats</h3>
              <p>The overview puts views, likes, comments, shares, watch time and more from every account on one graph.</p>
              <button className="btn primary lg" onClick={() => go('accounts')}>
                Connect accounts
              </button>
            </div>
          </div>
        ) : (
          <OverviewChart history={s.insights.history} posts={posts} accounts={accounts} range={range} now={now} />
        )}
      </div>
    </>
  )
}

/** Every stat, every account, one timeline. Each line is scaled to its own peak so they all fit. */
function OverviewChart({
  history,
  posts,
  accounts,
  range,
  now
}: {
  history: InsightsPoint[]
  posts: OverviewPost[]
  accounts: AccountKey[]
  range: number
  now: number
}) {
  const hasIg = accounts.some((k) => k.startsWith('instagram:'))
  const hasYt = accounts.some((k) => k.startsWith('youtube:'))
  const [scope, setScope] = useState<Scope>('all')
  const [off, setOff] = useState<Set<OverviewMetric>>(new Set())
  const [hover, setHover] = useState<number | null>(null)
  const [focus, setFocus] = useState<OverviewMetric | null>(null)

  const keys = useMemo(() => (scope === 'all' ? accounts : accounts.filter((k) => k.startsWith(`${scope}:`))), [scope, accounts])
  const ov = useMemo(() => buildOverview({ history, posts, accounts: keys, rangeDays: range, now }), [history, posts, keys, range, now])
  const shown = ov.available.filter((m) => !off.has(m))
  const lines = shown.filter((m) => m !== 'posts')
  const n = ov.days.length

  const W = 1000
  const H = 380
  const TOP = 14
  const BOTTOM = 8
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W)
  const peak = (m: OverviewMetric) => Math.max(...ov.days.map((d) => d[m])) || 1
  const y = (m: OverviewMetric, v: number) => H - BOTTOM - (v / peak(m)) * (H - TOP - BOTTOM)
  // Views are a daily series; the per-post stats only exist on days something went live,
  // so their lines join those days instead of dropping to zero in between.
  const pts = (m: OverviewMetric) =>
    ov.days.flatMap((d, i) => (m === 'views' || d.posts > 0 ? [[x(i), y(m, d[m])] as [number, number]] : []))
  const path = (m: OverviewMetric) => smooth(pts(m), TOP, H - BOTTOM)
  const hasPoint = (m: OverviewMetric, i: number) => m === 'views' || ov.days[i].posts > 0
  const barW = Math.max(2, Math.min(18, (W / n) * 0.5))
  const postPeak = peak('posts')

  const ticks = useMemo(() => {
    const step = Math.max(1, Math.round((n - 1) / 5))
    const out: number[] = []
    for (let i = 0; i < n; i += step) out.push(i)
    if (out[out.length - 1] !== n - 1 && n - 1 - out[out.length - 1] > step / 2) out.push(n - 1)
    return out
  }, [n])
  const label = (day: string) => {
    const [yy, mm, dd] = day.split('-').map(Number)
    return new Date(yy, mm - 1, dd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  const toggle = (m: OverviewMetric) =>
    setOff((s) => {
      const next = new Set(s)
      if (next.has(m)) next.delete(m)
      else next.add(m)
      return next
    })

  const h = hover != null ? ov.days[hover] : null

  return (
    <div className="card ov-card">
      <div className="ov-head">
        <div>
          <h3>All your stats</h3>
          <div className="faint ov-sub">{scope === 'all' ? 'Every account' : scope === 'instagram' ? 'Instagram' : 'YouTube'}, day by day over the last {range} days. Click a stat to hide or show it.</div>
        </div>
        {hasIg && hasYt && (
          <Segmented
            value={scope}
            onChange={(v) => setScope(v)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'instagram', label: 'Instagram' },
              { value: 'youtube', label: 'YouTube' }
            ]}
          />
        )}
      </div>

      {!ov.available.length ? (
        <div className="spark-empty ov-empty">Nothing to plot yet. The graph fills in as Cadence checks your views and you post.</div>
      ) : (
        <>
          <div className="ov-legend" role="group" aria-label="Stats to show">
            {OVERVIEW_METRICS.filter((m) => ov.available.includes(m.key)).map((m) => (
              <button
                key={m.key}
                type="button"
                className={cx('ov-chip', !off.has(m.key) && 'on')}
                aria-pressed={!off.has(m.key)}
                title={m.hint}
                onClick={() => toggle(m.key)}
                onMouseEnter={() => setFocus(m.key)}
                onMouseLeave={() => setFocus(null)}
                onFocus={() => setFocus(m.key)}
                onBlur={() => setFocus(null)}
                style={{ '--c': COLOR[m.key] } as React.CSSProperties}
              >
                <i className={cx('ov-key', m.key === 'posts' && 'bar')} />
                <span>{m.label}</span>
                <b>{short(m.key, ov.totals[m.key])}</b>
              </button>
            ))}
          </div>

          <div className="ov-plot">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`Daily ${shown.map((m) => OVERVIEW_METRICS.find((o) => o.key === m)!.label.toLowerCase()).join(', ')} over the last ${range} days`}
              onMouseMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1))
                setHover(Math.max(0, Math.min(n - 1, i)))
              }}
              onMouseLeave={() => setHover(null)}
            >
              {[0.25, 0.5, 0.75, 1].map((f) => (
                <line key={f} className="ov-grid" x1={0} x2={W} y1={H - BOTTOM - f * (H - TOP - BOTTOM)} y2={H - BOTTOM - f * (H - TOP - BOTTOM)} vectorEffect="non-scaling-stroke" />
              ))}
              {shown.includes('posts') &&
                ov.days.map((d, i) =>
                  d.posts ? (
                    <rect
                      key={d.day}
                      className="ov-bar ov-line"
                      opacity={focus && focus !== 'posts' ? 0.25 : 1}
                      x={x(i) - barW / 2}
                      width={barW}
                      y={H - BOTTOM - (d.posts / postPeak) * (H - TOP - BOTTOM) * 0.35}
                      height={(d.posts / postPeak) * (H - TOP - BOTTOM) * 0.35}
                      rx={2}
                    />
                  ) : null
                )}
              {lines.includes('views') && (
                <>
                  <defs>
                    <linearGradient id="ov-views-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor={COLOR.views} stopOpacity="0.26" />
                      <stop offset="1" stopColor={COLOR.views} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={`${path('views')} L${x(n - 1)},${H - BOTTOM} L${x(0)},${H - BOTTOM} Z`} fill="url(#ov-views-fill)" opacity={focus && focus !== 'views' ? 0.25 : 1} className="ov-line" />
                </>
              )}
              {lines.map((m) => (
                <path
                  key={m}
                  d={path(m)}
                  fill="none"
                  stroke={COLOR[m]}
                  strokeWidth={m === 'views' ? 2.5 : 1.75}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  opacity={focus && focus !== m ? 0.12 : m === 'views' ? 1 : 0.9}
                  className="ov-line"
                />
              ))}
              {hover != null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--border-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
            </svg>
            {hover != null &&
              lines.filter((m) => hasPoint(m, hover)).map((m) => (
                <span key={m} className="spark-dot" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(m, ov.days[hover][m]) / H) * 100}%`, background: COLOR[m] }} />
              ))}
            {h && hover != null && (
              <div className={cx('ov-tip', hover > n * 0.6 && 'left')} style={{ left: `${(x(hover) / W) * 100}%` }}>
                <div className="ov-tip-day">{label(h.day)}</div>
                {shown.map((m) => (
                  <div key={m} className={cx('ov-tip-row', !hasPoint(m, hover) && 'none')}>
                    <i style={{ background: COLOR[m] }} />
                    <span>{OVERVIEW_METRICS.find((o) => o.key === m)!.label}</span>
                    <b>{hasPoint(m, hover) ? fmt(m, h[m]) : '—'}</b>
                  </div>
                ))}
                {!h.posts && <div className="ov-tip-note">No posts went live this day</div>}
              </div>
            )}
          </div>
          <div className="ov-axis">
            {ticks.map((i) => (
              <span key={i} style={{ left: `${(x(i) / W) * 100}%` }}>
                {label(ov.days[i].day)}
              </span>
            ))}
          </div>
          <div className="faint ov-foot">Each line is scaled to its own best day. Point at a stat to pick out its line. Likes, comments and the rest count on the day the post went live.</div>
        </>
      )}
    </div>
  )
}

/** A smooth curve through the points (Catmull-Rom), kept inside the plot. */
function smooth(p: [number, number][], top: number, bottom: number): string {
  if (!p.length) return ''
  if (p.length === 1) return `M${p[0][0] - 0.5},${p[0][1]} L${p[0][0] + 0.5},${p[0][1]}`
  const c = (v: number) => Math.min(bottom, Math.max(top, v)).toFixed(1)
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i]
    const p1 = p[i]
    const p2 = p[i + 1]
    const p3 = p[i + 2] ?? p2
    const t = 0.18
    d += ` C${(p1[0] + (p2[0] - p0[0]) * t).toFixed(1)},${c(p1[1] + (p2[1] - p0[1]) * t)} ${(p2[0] - (p3[0] - p1[0]) * t).toFixed(1)},${c(p2[1] - (p3[1] - p1[1]) * t)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}
