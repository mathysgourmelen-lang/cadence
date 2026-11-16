import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons'
import { cx } from './util'

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={cx('switch', on && 'on')} onClick={() => onChange(!on)} />
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  full
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  full?: boolean
}) {
  return (
    <div className={cx('segmented', full && 'full')} role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={cx(o.value === value && 'on')} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ToggleRow({ title, desc, on, onChange }: { title: ReactNode; desc?: ReactNode; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="toggle-row">
      <div className="text">
        <div className="title">{title}</div>
        {desc && <div className="desc">{desc}</div>}
      </div>
      <Switch on={on} onChange={onChange} label={typeof title === 'string' ? title : undefined} />
    </div>
  )
}

export function Avatar({ src, name, size = 28 }: { src?: string; name?: string; size?: number }) {
  const [broken, setBroken] = useState(false)
  const initials = (name ?? '?').replace(/^@/, '').slice(0, 1).toUpperCase()
  if (src && !broken) return <img className="avatar" src={src} width={size} height={size} style={{ width: size, height: size }} onError={() => setBroken(true)} alt="" />
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.42, background: 'var(--brand)', color: 'var(--on-brand)' }}>
      {initials}
    </div>
  )
}

export function Progress({ value, indeterminate }: { value?: number; indeterminate?: boolean }) {
  return (
    <div className={cx('progress', indeterminate && 'indeterminate')}>
      <div style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
    </div>
  )
}

// ---------- Popover ----------

export function Popover({
  anchor,
  open,
  onClose,
  children,
  align = 'start',
  className
}: {
  anchor: HTMLElement | null
  open: boolean
  onClose: () => void
  children: ReactNode
  align?: 'start' | 'end'
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !anchor) return
    const place = () => {
      const r = anchor.getBoundingClientRect()
      const el = ref.current
      const w = el?.offsetWidth ?? 220
      const h = el?.offsetHeight ?? 200
      let left = align === 'end' ? r.right - w : r.left
      let top = r.bottom + 6
      if (top + h > window.innerHeight - 10) top = Math.max(10, r.top - h - 6)
      left = Math.min(Math.max(10, left), window.innerWidth - w - 10)
      setPos({ top, left })
    }
    place()
    const id = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('resize', place)
    }
  }, [open, anchor, align])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor?.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, anchor])

  if (!open) return null
  return createPortal(
    <div ref={ref} className={cx('popover', className)} style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}>
      {children}
    </div>,
    document.body
  )
}

export interface MenuEntry {
  label?: string
  icon?: ReactNode
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
  separator?: boolean
}

export function MenuButton({ items, label = 'More' }: { items: MenuEntry[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={btn} className="btn ghost icon sm" aria-label={label} onClick={() => setOpen((o) => !o)}>
        <Icon.More />
      </button>
      <Popover anchor={btn.current} open={open} onClose={() => setOpen(false)} align="end">
        {items.map((it, i) =>
          it.separator ? (
            <div key={i} className="menu-sep" />
          ) : (
            <button
              key={i}
              className={cx('menu-item', it.danger && 'danger')}
              disabled={it.disabled}
              onClick={() => {
                setOpen(false)
                it.onClick?.()
              }}
            >
              {it.icon}
              {it.label}
            </button>
          )
        )}
      </Popover>
    </>
  )
}

// ---------- Modal ----------

export function Modal({ open, onClose, children, width }: { open: boolean; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { width: `min(${width}px, calc(100vw - 40px))` } : undefined} role="dialog" aria-modal>
        {children}
      </div>
    </div>,
    document.body
  )
}

// ---------- Toasts & confirm ----------

interface Toast {
  id: number
  kind: 'ok' | 'err' | 'info'
  text: string
  action?: { label: string; run: () => void }
}

interface ConfirmOpts {
  title: string
  body?: ReactNode
  confirm?: string
  danger?: boolean
}

interface FeedbackCtx {
  toast: (kind: Toast['kind'], text: string, action?: Toast['action']) => void
  confirm: (opts: ConfirmOpts) => Promise<boolean>
}

const Ctx = createContext<FeedbackCtx>({ toast: () => undefined, confirm: async () => false })

export function useFeedback(): FeedbackCtx {
  return useContext(Ctx)
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirmState, setConfirm] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  const nextId = useRef(1)

  const toast = useCallback((kind: Toast['kind'], text: string, action?: Toast['action']) => {
    const id = nextId.current++
    setToasts((t) => [...t.slice(-3), { id, kind, text, action }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 7000 : 4200)
  }, [])

  const confirm = useCallback((opts: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirm({ ...opts, resolve })), [])

  const close = (v: boolean) => {
    confirmState?.resolve(v)
    setConfirm(null)
  }

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={cx('toast', t.kind)}>
            <div className="ti">{t.kind === 'ok' ? <Icon.Check size={16} /> : t.kind === 'err' ? <Icon.Alert size={16} /> : <Icon.Sparkle size={16} />}</div>
            <div className="grow selectable">{t.text}</div>
            {t.action && (
              <button className="btn sm" onClick={t.action.run}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
      <Modal open={!!confirmState} onClose={() => close(false)} width={420}>
        {confirmState && (
          <>
            <h2>{confirmState.title}</h2>
            {confirmState.body && <div className="muted">{confirmState.body}</div>}
            <div className="actions">
              <button className="btn" onClick={() => close(false)}>
                Cancel
              </button>
              <button className={cx('btn', confirmState.danger ? 'danger solid' : 'primary')} onClick={() => close(true)} autoFocus>
                {confirmState.confirm ?? 'OK'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </Ctx.Provider>
  )
}

export function Spinner() {
  return <span className="spinner" />
}
