import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Application, BootstrapState, SweepProgress } from '../../../shared/types'

export async function call<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const res = await window.desk.invoke(channel, ...args)
  if (!res.ok) throw new Error(res.error)
  return res.data as T
}
export const onEvent = (channel: string, cb: (payload: unknown) => void): (() => void) => window.desk.on(channel, cb)

export type Page = 'today' | 'jobs' | 'applications' | 'cvs' | 'prep' | 'practice' | 'coach' | 'settings'
type ToastKind = 'info' | 'good' | 'error'

interface DeskCtx {
  state: BootstrapState
  page: Page
  go: (p: Page, focus?: string) => void
  focus: string | null
  refresh: () => Promise<void>
  patch: (fn: (s: BootstrapState) => BootstrapState) => void
  toast: (msg: string, kind?: ToastKind) => void
  run: <T>(fn: () => Promise<T>, okMsg?: string) => Promise<T | undefined>
}

const Ctx = createContext<DeskCtx | null>(null)
export const useDesk = (): DeskCtx => {
  const c = useContext(Ctx)
  if (!c) throw new Error('useDesk outside provider')
  return c
}

export function DeskProvider({ children }: { children: (ready: boolean) => ReactNode }): React.JSX.Element {
  const [state, setState] = useState<BootstrapState | null>(null)
  const [page, setPage] = useState<Page>('today')
  const [focus, setFocus] = useState<string | null>(null)
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: ToastKind }[]>([])

  const refresh = useCallback(async () => setState(await call<BootstrapState>('state:get')), [])
  useEffect(() => { refresh() }, [refresh])

  // Things the main process does on its own: a notification click opening a
  // page, a background sweep finishing, a job description arriving.
  useEffect(() => {
    const offs = [
      onEvent('nav', (p) => {
        const { page: to, focus: f } = p as { page: Page; focus?: string }
        setPage(to); setFocus(f ?? null); refresh()
      }),
      onEvent('sweep:progress', (p) => { if (!(p as SweepProgress).running) refresh() }),
      onEvent('app:updated', (a) => {
        const app = a as Application
        setState((s) => (s ? { ...s, applications: s.applications.map((x) => (x.id === app.id ? app : x)) } : s))
      })
    ]
    return () => offs.forEach((off) => off())
  }, [refresh])

  const toast = useCallback((msg: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, msg, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6500 : 3800)
  }, [])

  const value = useMemo<DeskCtx | null>(() => state && {
    state,
    page,
    focus,
    go: (p, f) => { setPage(p); setFocus(f ?? null); refresh() }, // keeps streak, goals and spend current
    refresh,
    patch: (fn) => setState((s) => (s ? fn(s) : s)),
    toast,
    run: async (fn, okMsg) => {
      try {
        const out = await fn()
        if (okMsg) toast(okMsg, 'good')
        return out
      } catch (e) {
        toast((e as Error).message, 'error')
        return undefined
      }
    }
  }, [state, page, focus, refresh, toast])

  return (
    <>
      {value ? <Ctx.Provider value={value}>{children(true)}</Ctx.Provider> : children(false)}
      <div className="toasts">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}
      </div>
    </>
  )
}
