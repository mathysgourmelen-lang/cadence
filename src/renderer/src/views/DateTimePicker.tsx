import { useRef, useState } from 'react'
import { Icon } from '../icons'
import { Popover } from '../ui'
import { addDays, atTime, cx, formatHHMM, hhmm, sameDay, startOfDay } from '../util'

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export function MiniCalendar({ value, onPick, busyDays, allowPast = false }: { value: Date; onPick: (d: Date) => void; busyDays?: Set<string>; allowPast?: boolean }) {
  const [month, setMonth] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1))
  const today = startOfDay(new Date())
  const first = new Date(month)
  const offset = (first.getDay() + 6) % 7 // Monday first
  const start = addDays(first, -offset)
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i))
  const dows = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
  return (
    <div className="mini-cal">
      <div className="mc-head">
        <button className="btn ghost icon sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">
          <Icon.ChevronLeft size={16} />
        </button>
        <span>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
        <button className="btn ghost icon sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">
          <Icon.ChevronRight size={16} />
        </button>
      </div>
      <div className="mc-grid">
        {dows.map((d) => (
          <div key={d} className="mc-dow">
            {d}
          </div>
        ))}
        {days.map((d) => (
          <button
            key={d.toISOString()}
            className={cx('mc-day', d.getMonth() !== month.getMonth() && 'out', sameDay(d, today) && 'today', sameDay(d, value) && 'sel', !allowPast && d < today && 'past')}
            onClick={() => onPick(d)}
          >
            {d.getDate()}
            {busyDays?.has(dayKey(d)) && <span className="has" />}
          </button>
        ))}
      </div>
    </div>
  )
}

export function DateTimePicker({
  value,
  onChange,
  defaultTimes,
  busyDays
}: {
  value: Date
  onChange: (d: Date) => void
  defaultTimes: string[]
  busyDays?: Set<string>
}) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const now = new Date()
  const time = hhmm(value)
  const setDay = (d: Date) => {
    const n = atTime(d, time)
    onChange(n)
  }
  const sat = addDays(startOfDay(now), (6 - now.getDay() + 7) % 7 || 7)

  return (
    <div>
      <div className="when-grid">
        <button ref={btn} className="picker-btn" onClick={() => setOpen((o) => !o)}>
          <Icon.Calendar size={16} />
          <span className="grow">{value.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: value.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })}</span>
          <Icon.ChevronDown size={14} />
        </button>
        <div className="picker-btn" style={{ padding: '0 6px 0 12px' }}>
          <Icon.Clock size={16} />
          <input
            className="input time-input"
            style={{ border: 0, background: 'transparent', boxShadow: 'none', height: 36, padding: '0 6px' }}
            type="time"
            value={time}
            onChange={(e) => e.target.value && onChange(atTime(value, e.target.value))}
          />
        </div>
      </div>
      <Popover anchor={btn.current} open={open} onClose={() => setOpen(false)}>
        <MiniCalendar
          value={value}
          busyDays={busyDays}
          onPick={(d) => {
            setDay(d)
            setOpen(false)
          }}
        />
      </Popover>
      <div className="quick-times">
        {[
          { label: 'Today', d: startOfDay(now) },
          { label: 'Tomorrow', d: addDays(startOfDay(now), 1) },
          { label: 'Saturday', d: sat },
          { label: 'Next week', d: addDays(startOfDay(now), 7) }
        ].map((q) => (
          <button key={q.label} className={cx('chip', sameDay(q.d, value) && 'on')} onClick={() => setDay(q.d)}>
            {q.label}
          </button>
        ))}
        <span style={{ width: 8 }} />
        {defaultTimes.map((t) => {
          const d = atTime(value, t)
          const past = d.getTime() < now.getTime()
          return (
            <button key={t} className={cx('chip', time === t && 'on')} disabled={past} style={past ? { opacity: 0.35 } : undefined} onClick={() => onChange(d)}>
              {formatHHMM(t)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
