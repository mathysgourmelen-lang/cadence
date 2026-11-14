import { useEffect, useMemo, useRef, useState } from 'react'
import { Topbar } from '../App'
import { api, useApp } from '../state'
import { Icon, InstagramMark, YouTubeMark } from '../icons'
import { Avatar, Segmented, Spinner, useFeedback } from '../ui'
import { cx, relative } from '../util'
import { accountKey, type AccountInsights, type AccountKey, type InsightsPoint, type MediaStat } from '../../../shared/types'

type Platform = 'instagram' | 'youtube'
type Range = 7 | 30 | 90

export function compact(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n < 1000) return String(n)
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '')}K`
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1).replace(/\.?0+$/, '')}M`
  return `${(n / 1e9).toFixed(2).replace(/\.?0+$/, '')}B`
}

export const full = (n: number) => n.toLocaleString()

/** A shortened number (62K) that shows the exact figure on hover. */
export function Num({ v, unit, prefix = '' }: { v: number | null | undefined; unit?: string; prefix?: string }) {
  const exact = v != null && Math.abs(v) >= 1000 ? `${prefix}${full(v)}${unit ? ` ${unit}` : ''}` : undefined
  return (
    <data value={v ?? undefined} className={exact ? 'num-exact' : undefined} data-exact={exact}>
      {v != null ? prefix : ''}
      {compact(v)}
    </data>
  )
}

/** One floating label for every <Num>, so it is never clipped by a card or table. */
export function ExactNumberTip() {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  useEffect(() => {
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-exact]') as HTMLElement | null
      if (!el) return setTip(null)
      const r = el.getBoundingClientRect()
      setTip({ x: r.left + r.width / 2, y: r.top, text: el.dataset.exact! })
    }
    const hide = () => setTip(null)
    document.addEventListener('mouseover', over)
    document.addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('mouseover', over)
      document.removeEventListener('scroll', hide, true)
    }
  }, [])
  return tip ? (
    <div className="exact-tip" style={{ left: tip.x, top: tip.y }}>
      {tip.text}
    </div>
  ) : null
}

function dayDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Points for one account within the range, oldest first. */
function series(history: InsightsPoint[], key: AccountKey, range: Range, now: number): { day: string; v: number }[] {
  const from = now - range * 86400_000
  return history.filter((p) => p.values?.[key] != null && dayDate(p.day).getTime() >= from - 86400_000).map((p) => ({ day: p.day, v: p.values[key]! }))
}

function gain(points: { v: number }[]): number | null {
  if (points.length < 2) return null
  return Math.max(0, points[points.length - 1].v - points[0].v)
}

interface Acct {
  key: AccountKey
  platform: Platform
  name: string
  avatar?: string
  data?: AccountInsights
  error?: string
  points: { day: string; v: number }[]
}

export default function ViewsTab() {
  const { snap, go, now } = useApp()
  const { toast } = useFeedback()
  const ins = snap!.insights
  const { instagram: igAcc, youtube: ytAcc } = snap!.accounts
  const [range, setRange] = useState<Range>(30)
  const asked = useRef(false)

  const refresh = async (manual: boolean) => {
    try {
      await api.refreshInsights()
      if (manual) toast('ok', 'View counts updated.')
    } catch (e) {
      toast('err', (e as Error).message)
    }
  }

  const fetched = Math.max(0, ...Object.values(ins.accounts).map((a) => Date.parse(a?.fetchedAt ?? '') || 0))
  const noAccounts = !igAcc.length && !ytAcc.length

  // Refresh on open when the numbers are more than 15 minutes old.
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    if (!noAccounts && Date.now() - fetched > 15 * 60_000) void refresh(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const accts: Acct[] = useMemo(
    () => [
      ...igAcc.map((a) => {
        const key = accountKey('instagram', a.id)
        return { key, platform: 'instagram' as const, name: `@${a.username}`, avatar: a.profilePictureUrl, data: ins.accounts[key], error: ins.errors[key], points: series(ins.history, key, range, now) }
      }),
      ...ytAcc.map((a) => {
        const key = accountKey('youtube', a.id)
        return { key, platform: 'youtube' as const, name: a.channelTitle, avatar: a.thumbnailUrl, data: ins.accounts[key], error: ins.errors[key], points: series(ins.history, key, range, now) }
      })
    ],
    [igAcc, ytAcc, ins, range, now]
  )

  const totals = accts.map((a) => a.data?.totalViews).filter((v): v is number => v != null)
  const total = totals.length ? totals.reduce((a, b) => a + b, 0) : null
  const gains = accts.map((a) => gain(a.points)).filter((g): g is number => g != null)
  const totalGain = gains.length ? gains.reduce((a, b) => a + b, 0) : null

  return (
    <>
      <Topbar title="Views" subtitle={fetched ? `Updated ${relative(fetched, now)}` : undefined}>
        {!noAccounts && (
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
        <button className="btn" onClick={() => refresh(true)} disabled={ins.refreshing || noAccounts}>
          {ins.refreshing ? <Spinner /> : <Icon.Retry size={16} />} Refresh
        </button>
      </Topbar>

      <div className="page">
        {noAccounts ? (
          <div className="empty">
            <div>
              <div className="empty-art" style={{ margin: '0 auto' }}>
                <Icon.Eye size={36} />
              </div>
              <h3>Connect an account to see your views</h3>
              <p>Cadence adds up the views on every Reel and Short and tracks how they grow day by day.</p>
              <button className="btn primary lg" onClick={() => go('accounts')}>
                Connect accounts
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="views-hero card">
              <div>
                <div className="k">
                  <Icon.Eye size={15} /> Total views, {accts.length > 1 ? `all ${accts.length} accounts` : 'all accounts'}
                </div>
                <div className="v" title={total != null ? full(total) : undefined}>
                  {total != null ? full(total) : ins.refreshing ? '…' : '—'}
                </div>
                <div className="s">
                  {totalGain != null ? (
                    <>
                      <Icon.TrendUp size={14} /> <span>
                        <Num v={totalGain} prefix="+" unit="views" /> in the last {range} days
                      </span>
                    </>
                  ) : (
                    'Growth appears here after Cadence has checked for a couple of days.'
                  )}
                </div>
              </div>
              <div className="views-split">
                {accts.map((a) => (
                  <SplitRow
                    key={a.key}
                    mark={a.platform === 'instagram' ? <InstagramMark size={16} /> : <YouTubeMark size={16} />}
                    label={a.name}
                    value={a.data?.totalViews}
                    total={total}
                    color={a.platform === 'instagram' ? 'var(--ig)' : 'var(--yt)'}
                  />
                ))}
              </div>
            </div>

            <div className="views-accounts">
              {accts.map((a) => (
                <AccountCard
                  key={a.key}
                  platform={a.platform}
                  connected
                  name={a.name}
                  avatar={a.avatar}
                  data={a.data}
                  error={a.error}
                  points={a.points}
                  range={range}
                  refreshing={ins.refreshing}
                  followersLabel={a.platform === 'instagram' ? 'followers' : 'subscribers'}
                  postsLabel={a.platform === 'instagram' ? 'posts' : 'videos'}
                  onConnect={() => go('accounts')}
                  onGuide={() => go('guide', { guideAnchor: a.platform })}
                />
              ))}
              {!igAcc.length && (
                <AccountCard platform="instagram" connected={false} name="Instagram" points={[]} range={range} refreshing={false} followersLabel="" postsLabel="" onConnect={() => go('accounts')} onGuide={() => undefined} />
              )}
              {!ytAcc.length && (
                <AccountCard platform="youtube" connected={false} name="YouTube" points={[]} range={range} refreshing={false} followersLabel="" postsLabel="" onConnect={() => go('accounts')} onGuide={() => undefined} />
              )}
            </div>

            <div className="views-lists">
              {accts.map((a) => (
                <TopList
                  key={a.key}
                  title={accts.length > 2 ? `Top posts · ${a.name}` : a.platform === 'instagram' ? 'Top Instagram posts' : 'Top YouTube videos'}
                  mark={a.platform === 'instagram' ? <InstagramMark size={16} /> : <YouTubeMark size={16} />}
                  items={(a.data?.top ?? []).slice(0, accts.length > 2 ? 6 : 12)}
                  loading={ins.refreshing && !a.data}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}

function SplitRow({ mark, label, value, total, color }: { mark: React.ReactNode; label: string; value?: number | null; total: number | null; color: string }) {
  const share = value != null && total ? value / total : 0
  return (
    <div className="split-row">
      <div className="row" style={{ gap: 8 }}>
        {mark}
        <span className="ellipsis grow">{label}</span>
        <b>
          <Num v={value} unit="views" />
        </b>
      </div>
      <div className="split-bar">
        <span style={{ width: `${Math.max(share * 100, value ? 2 : 0)}%`, background: color }} />
      </div>
    </div>
  )
}

function AccountCard(props: {
  platform: Platform
  connected: boolean
  name: string
  avatar?: string
  data?: AccountInsights
  error?: string
  points: { day: string; v: number }[]
  range: Range
  refreshing: boolean
  followersLabel: string
  postsLabel: string
  onConnect: () => void
  onGuide: () => void
}) {
  const { platform, connected, data, points } = props
  const color = platform === 'instagram' ? 'var(--ig)' : 'var(--yt)'
  const mark = platform === 'instagram' ? <InstagramMark size={18} /> : <YouTubeMark size={18} />
  if (!connected) {
    return (
      <div className="card acct-card disconnected">
        <div className="row">
          {mark}
          <b>{props.name}</b>
        </div>
        <p className="muted" style={{ margin: '10px 0 14px', fontSize: 13 }}>
          Connect {platform === 'instagram' ? 'Instagram' : 'YouTube'} to include its views.
        </p>
        <button className="btn sm" onClick={props.onConnect}>
          Connect
        </button>
      </div>
    )
  }
  const g = gain(points)
  const avg = data?.totalViews != null && data.countedPosts ? Math.round(data.totalViews / data.countedPosts) : null
  return (
    <div className="card acct-card">
      <div className="row">
        <Avatar src={props.avatar} name={props.name} size={30} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="ellipsis" style={{ fontWeight: 650 }}>
            {props.name}
          </div>
          <div className="faint row" style={{ gap: 5, fontSize: 12 }}>
            {mark} {platform === 'instagram' ? 'Instagram' : 'YouTube'}
          </div>
        </div>
        {g != null && (
          <span className="pill ok">
            <Icon.TrendUp size={12} /> <Num v={g} prefix="+" unit={`views gained in the last ${props.range} days`} />
          </span>
        )}
      </div>

      <div className="acct-total">
        <div className="v">
          {data ? <Num v={data.totalViews} unit="views" /> : props.refreshing ? <Spinner /> : '—'}
        </div>
        <div className="faint">total views</div>
      </div>

      <Sparkline points={points} color={color} range={props.range} />

      <div className="acct-facts">
        <div>
          <b>
            <Num v={data?.followers} unit={props.followersLabel} />
          </b>
          <span>{props.followersLabel}</span>
        </div>
        <div>
          <b>
            <Num v={data?.postCount} unit={props.postsLabel} />
          </b>
          <span>{props.postsLabel}</span>
        </div>
        <div>
          <b>
            <Num v={avg} unit="views per post" />
          </b>
          <span>avg views per post</span>
        </div>
      </div>

      {props.error && (
        <div className="notice err" style={{ marginTop: 12 }}>
          <Icon.Error size={15} />
          <div className="grow" style={{ fontSize: 12.5 }}>
            {props.error}
          </div>
        </div>
      )}
      {data?.note && (
        <div className="acct-note">
          {data.note}
          {data.totalViews == null && (
            <button className="link" onClick={props.onGuide}>
              {' '}
              How to fix
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Single-series area chart of the account's total views over time, with a hover readout. */
function Sparkline({ points, color, range }: { points: { day: string; v: number }[]; color: string; range: Range }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 320
  const H = 74
  const PAD = 4
  if (points.length < 2) {
    return <div className="spark-empty">The trend line fills in as Cadence checks your views each day.</div>
  }
  const min = Math.min(...points.map((p) => p.v))
  const max = Math.max(...points.map((p) => p.v))
  const span = max - min || 1
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2)
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2 - 6)
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`
  const id = `sg-${color.replace(/\W/g, '')}`
  const h = hover != null ? points[hover] : null
  return (
    <div className="spark">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Total views over the last ${range} days, from ${full(points[0].v)} to ${full(points[points.length - 1].v)}`}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const i = Math.round(((e.clientX - r.left) / r.width) * (points.length - 1))
          setHover(Math.max(0, Math.min(points.length - 1, i)))
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.28" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${id})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--border-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      </svg>
      {h && hover != null && (
        <div className="spark-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <b>{full(h.v)}</b>
          <span>{dayDate(h.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
        </div>
      )}
      {h && hover != null && <span className="spark-dot" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(h.v) / H) * 100}%`, background: color }} />}
    </div>
  )
}

function TopList({ title, mark, items, loading }: { title: string; mark: React.ReactNode; items: MediaStat[]; loading: boolean }) {
  const max = Math.max(1, ...items.map((m) => m.views ?? 0))
  return (
    <div className="card top-list">
      <div className="row" style={{ marginBottom: 6 }}>
        {mark}
        <h3>{title}</h3>
      </div>
      {loading ? (
        <div style={{ padding: 30, display: 'grid', placeItems: 'center' }}>
          <Spinner />
        </div>
      ) : !items.length ? (
        <div className="faint" style={{ padding: '18px 0', fontSize: 13 }}>
          No view counts yet.
        </div>
      ) : (
        items.map((m, i) => (
          <a
            key={m.id}
            className="top-row"
            href={m.url}
            onClick={(e) => {
              e.preventDefault()
              if (m.url) void api.openExternal(m.url)
            }}
          >
            <span className="rank">{i + 1}</span>
            <Thumb src={m.thumbnailUrl} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="ellipsis title">
                {m.title}
                {m.viaCadence && <span className="pill accent" style={{ marginLeft: 6, height: 18, fontSize: 10.5 }}>via Cadence</span>}
              </div>
              <div className="bar">
                <span style={{ width: `${((m.views ?? 0) / max) * 100}%` }} />
              </div>
              <div className="faint meta">
                {m.publishedAt && new Date(m.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                {m.likes != null && (
                  <>
                    {' · '}
                    <Num v={m.likes} unit="likes" /> likes
                  </>
                )}
                {m.comments != null && (
                  <>
                    {' · '}
                    <Num v={m.comments} unit="comments" /> comments
                  </>
                )}
              </div>
            </div>
            <div className={cx('views')}>
              <Num v={m.views} unit="views" />
              <span>views</span>
            </div>
          </a>
        ))
      )}
    </div>
  )
}

function Thumb({ src }: { src?: string }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken)
    return (
      <div className="top-thumb ph">
        <Icon.Film size={16} />
      </div>
    )
  return <img className="top-thumb" src={src} alt="" onError={() => setBroken(true)} referrerPolicy="no-referrer" />
}
