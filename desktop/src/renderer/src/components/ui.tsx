import { useEffect, useMemo, type ReactNode } from 'react'
import { marked } from 'marked'
import { Loader2, X } from 'lucide-react'

const PALETTE = ['#5876f0', '#22b07d', '#e0843b', '#b05ad6', '#d6495c', '#1f9bb5', '#c79a1e', '#6a7f3d']
export function Avatar({ name, size = 36 }: { name: string; size?: number }): React.JSX.Element {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0
  const color = PALETTE[Math.abs(h) % PALETTE.length]
  return (
    <span className="avatar" style={{ width: size, height: size, background: `linear-gradient(135deg, ${color}, ${color}bb)`, fontSize: size * 0.42 }}>
      {(name.trim()[0] || '?').toUpperCase()}
    </span>
  )
}

export function Markdown({ text }: { text: string }): React.JSX.Element {
  const html = useMemo(() => {
    const raw = marked.parse(text || '', { async: false }) as string
    // Strip anything that could run code; AI output is treated as untrusted.
    return raw.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '').replace(/javascript:/gi, '')
  }, [text])
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
}

export function Ring({ value, size = 84, stroke = 8, color = 'var(--blue)', label }: {
  value: number; size?: number; stroke?: number; color?: string; label?: ReactNode
}): React.JSX.Element {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c} style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
      </svg>
      <div className="ring-label">{label}</div>
    </div>
  )
}

export function Bar({ value, max = 100, tone = '' }: { value: number; max?: number; tone?: '' | 'gold' | 'good' }): React.JSX.Element {
  return <div className={`bar ${tone}`}><i style={{ width: `${Math.min(100, (value / Math.max(1, max)) * 100)}%` }} /></div>
}

export function Spinner({ size = 16 }: { size?: number }): React.JSX.Element {
  return <Loader2 size={size} className="spin" />
}

// Score trend (0–100), oldest to newest, with the 80 "would impress" line.
export function Sparkline({ values }: { values: number[] }): React.JSX.Element {
  const w = 100
  const h = 40
  const x = (i: number): number => (values.length < 2 ? w / 2 : (i / (values.length - 1)) * w)
  const y = (v: number): number => h - (Math.max(0, Math.min(100, v)) / 100) * h
  const pts = values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`Scores: ${values.join(', ')}`}>
      <line x1={0} x2={w} y1={y(80)} y2={y(80)} stroke="var(--good)" strokeOpacity={0.35} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      <polyline points={pts} fill="none" stroke="var(--blue)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }): React.JSX.Element {
  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer">
        <button className="icon-btn" style={{ position: 'absolute', top: 18, right: 18 }} onClick={onClose} aria-label="Close"><X size={18} /></button>
        {children}
      </aside>
    </>
  )
}

export function Modal({ onClose, children }: { onClose: () => void; children: ReactNode }): React.JSX.Element {
  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal">{children}</div>
    </>
  )
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }): React.JSX.Element {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <div style={{ marginBottom: action ? 14 : 0 }}>{children}</div>}
      {action}
    </div>
  )
}

export const scoreTone = (n: number): string => (n >= 80 ? 'var(--good)' : n >= 60 ? 'var(--gold)' : 'var(--bad)')
export const fmtDate = (iso?: string): string =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''
export const daysAgo = (iso?: string): number => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : 0)
export const usd = (n: number): string => `$${n < 1 ? n.toFixed(2) : n.toFixed(2)}`
