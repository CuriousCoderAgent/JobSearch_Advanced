import { useEffect, useMemo, useState } from 'react'
import { Building2, Check, ExternalLink, EyeOff, Plus, Radar, RefreshCw, Search, Sparkles, Trash2 } from 'lucide-react'
import { call, onEvent, useDesk } from '../lib/desk'
import { Avatar, Empty, Spinner, daysAgo, fmtDate } from '../components/ui'
import { STARTER_GROUPS } from '../../../shared/starters'
import type { Application, Company, SweepProgress } from '../../../shared/types'

// One-click watch lists: AI-first companies and the tech-led platforms that
// hire senior enterprise sellers in India. All are on free job feeds.
function Suggestions() {
  const { state, patch, run } = useDesk()
  const [busy, setBusy] = useState<string | null>(null)
  const watched = new Set(state.companies.map((c) => c.name.toLowerCase()))
  const groups = STARTER_GROUPS.map((g) => ({ ...g, missing: g.names.filter((n) => !watched.has(n.toLowerCase())) })).filter((g) => g.missing.length)
  if (!groups.length) return null
  const add = async (names: string[], key: string): Promise<void> => {
    setBusy(key)
    const added = await run(() => call<Company[]>('companies:addMany', names), names.length > 1 ? `Watching ${names.length} more companies — they’re checked on the next sweep.` : `Watching ${names[0]}.`)
    if (added) patch((s) => ({ ...s, companies: [...s.companies, ...added] }))
    setBusy(null)
  }
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title"><Sparkles size={16} color="var(--gold)" /> Suggested for an AI-led move <span className="sub">all on free job feeds</span></div>
      <div className="stack" style={{ gap: 12 }}>
        {groups.map((g) => (
          <div key={g.label}>
            <div className="row" style={{ marginBottom: 6 }}>
              <span className="stat-label">{g.label}</span>
              <button className="btn sm ghost" style={{ marginLeft: 'auto' }} disabled={!!busy} onClick={() => add(g.missing, g.label)}>
                {busy === g.label ? <Spinner size={13} /> : <Plus size={13} />} Add all {g.missing.length}</button>
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {g.missing.map((n) => (
                <button key={n} className="pill" style={{ cursor: 'pointer', border: '1px solid var(--line-2)', padding: '5px 11px' }} disabled={!!busy} onClick={() => add([n], n)}>
                  <Plus size={11} /> {n}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const SOURCE_LABEL: Record<string, [string, string]> = {
  greenhouse: ['Free feed · Greenhouse', 'good'], lever: ['Free feed · Lever', 'good'], ashby: ['Free feed · Ashby', 'good'],
  smartrecruiters: ['Free feed · SmartRecruiters', 'good'], workday: ['Free feed · Workday', 'good'],
  successfactors: ['Free feed · SuccessFactors', 'good'], oracle: ['Free feed · Oracle', 'good'], amazon: ['Free feed · Amazon', 'good'],
  page: ['AI reads page when it changes', 'gold'], portal: ['Portal — check manually', 'violet'], none: ['No feed found — add a careers URL', 'bad']
}

export default function Jobs() {
  const { state, patch, refresh, run, toast, go, focus } = useDesk()
  const [tab, setTab] = useState<'openings' | 'companies'>(focus === 'starters' || !state.companies.length ? 'companies' : 'openings')
  const [progress, setProgress] = useState<SweepProgress | null>(null)
  const [q, setQ] = useState('')
  const [company, setCompany] = useState('all')
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [editing, setEditing] = useState<{ id: string; url: string } | null>(null)

  useEffect(() => onEvent('sweep:progress', (p) => setProgress(p as SweepProgress)), [])

  const sweep = async (): Promise<void> => {
    if (!state.companies.length) { toast('Add some target companies first.'); setTab('companies'); return }
    setProgress({ running: true, done: 0, total: state.companies.length })
    const r = await run(() => call<SweepProgress>('jobs:sweep'))
    await refresh()
    if (r) toast(r.newJobs ? `Sweep done — ${r.newJobs} new matching role${r.newJobs === 1 ? '' : 's'}.` : 'Sweep done — no new matches this time.', 'good')
    if (r?.error) toast(`AI relevance check skipped: ${r.error}`, 'error')
  }

  const jobs = useMemo(() => {
    const needle = q.toLowerCase()
    return state.jobs
      .filter((j) => (company === 'all' || j.companyId === company) && (!needle || `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(needle)))
      .sort((a, b) => b.firstSeen.localeCompare(a.firstSeen))
  }, [state.jobs, q, company])
  const trackedIds = new Set(state.applications.map((a) => a.jobId).filter(Boolean))

  const track = async (id: string): Promise<void> => {
    const app = await run(() => call<Application>('jobs:track', id), 'Tracked — the job description is being pulled into the application.')
    if (app) patch((s) => ({ ...s, applications: s.applications.some((a) => a.id === app.id) ? s.applications : [app, ...s.applications] }))
  }
  const dismiss = async (id: string): Promise<void> => {
    await run(() => call('jobs:dismiss', id))
    patch((s) => ({ ...s, jobs: s.jobs.filter((j) => j.id !== id) }))
  }
  const addCompany = async (): Promise<void> => {
    const c = await run(() => call<Company>('companies:add', newName, newUrl))
    if (c) { patch((s) => ({ ...s, companies: [...s.companies, c] })); setNewName(''); setNewUrl('') }
  }
  const removeCompany = async (c: Company): Promise<void> => {
    await run(() => call('companies:remove', c.id), `Removed ${c.name}.`)
    patch((s) => ({ ...s, companies: s.companies.filter((x) => x.id !== c.id), jobs: s.jobs.filter((j) => j.companyId !== c.id) }))
  }
  const redetect = async (c: Company, careersUrl?: string): Promise<void> => {
    const next = { ...c, careersUrl: careersUrl ?? c.careersUrl, source: undefined, pageHash: undefined }
    await run(() => call('companies:update', next), `${c.name} will be re-detected on the next sweep.`)
    patch((s) => ({ ...s, companies: s.companies.map((x) => (x.id === c.id ? next : x)) }))
  }

  const running = progress?.running
  const free = state.companies.filter((c) => c.source && SOURCE_LABEL[c.source.type]?.[1] === 'good').length

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Jobs radar</div>
          <div className="page-title">New openings at your target companies</div>
          <div className="page-sub">
            {state.settings.lastSweepAt ? `Last swept ${fmtDate(state.settings.lastSweepAt)}, ${new Date(state.settings.lastSweepAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} · ` : ''}
            {state.companies.length} companies watched · {free} on free feeds{state.settings.autoSweep ? ' · sweeps itself twice a day while the app is open' : ''}
          </div>
        </div>
        <div className="row">
          <div className="tabs">
            <button className={`tab ${tab === 'openings' ? 'on' : ''}`} onClick={() => setTab('openings')}>Openings ({state.jobs.length})</button>
            <button className={`tab ${tab === 'companies' ? 'on' : ''}`} onClick={() => setTab('companies')}>Companies ({state.companies.length})</button>
          </div>
          <button className="btn primary" onClick={sweep} disabled={running}>{running ? <Spinner /> : <Radar size={16} />} {running ? 'Sweeping…' : 'Sweep now'}</button>
        </div>
      </div>

      {running && progress && (
        <div className="card tight" style={{ marginBottom: 16 }}>
          <div className="row between small"><span>Checking {progress.current || '…'}</span><span className="muted">{progress.done} / {progress.total}</span></div>
          <div className="bar" style={{ marginTop: 8 }}><i style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /></div>
        </div>
      )}

      {tab === 'openings' && (
        <>
          <div className="row" style={{ marginBottom: 14 }}>
            <div className="row grow" style={{ position: 'relative' }}>
              <Search size={15} style={{ position: 'absolute', left: 12, color: 'var(--muted)' }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by title, company or location" style={{ paddingLeft: 34 }} />
            </div>
            <select value={company} onChange={(e) => setCompany(e.target.value)} style={{ width: 240 }}>
              <option value="all">All companies</option>
              {state.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {jobs.length ? (
            <div className="list">
              {jobs.map((j) => (
                <div key={j.id} className="item">
                  <Avatar name={j.company} />
                  <div className="grow">
                    <div className="row" style={{ gap: 8 }}>
                      <span style={{ fontWeight: 650 }} className="ellipsis">{j.title}</span>
                      {daysAgo(j.firstSeen) < 3 && <span className="pill gold">New</span>}
                    </div>
                    <div className="small muted ellipsis">{j.company}{j.location ? ` · ${j.location}` : ''} · seen {fmtDate(j.firstSeen)}</div>
                    {j.relevanceReason && <div className="tiny" style={{ color: 'var(--blue-2)', marginTop: 3 }}>{j.relevanceReason}</div>}
                  </div>
                  <button className="btn sm ghost" onClick={() => call('shell:openExternal', j.url)}><ExternalLink size={14} /> View</button>
                  {trackedIds.has(j.id)
                    ? <button className="btn sm" onClick={() => go('applications')}><Check size={14} /> Tracked</button>
                    : <button className="btn sm primary" onClick={() => track(j.id)}><Plus size={14} /> Track</button>}
                  <button className="icon-btn" title="Not for me" onClick={() => dismiss(j.id)}><EyeOff size={15} /></button>
                </div>
              ))}
            </div>
          ) : (
            <Empty title={state.companies.length ? 'No matching openings yet' : 'Your radar has nothing to watch yet'}
              action={<button className="btn primary" onClick={state.companies.length ? sweep : () => setTab('companies')}>{state.companies.length ? 'Run a sweep' : 'Add companies'}</button>}>
              {state.companies.length ? 'Run a sweep to check every company on your list.' : 'Add the companies you’d love to work at — dream ones included.'}
            </Empty>
          )}
        </>
      )}

      {tab === 'companies' && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title"><Building2 size={17} /> Add a company</div>
            <div className="row">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Company name, e.g. Databricks" onKeyDown={(e) => e.key === 'Enter' && newName.trim() && addCompany()} />
              <input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="Careers page URL (optional — only if auto-detection misses it)" />
              <button className="btn primary" disabled={!newName.trim()} onClick={addCompany}><Plus size={16} /> Add</button>
            </div>
            <div className="small muted" style={{ marginTop: 10 }}>
              The radar first looks for a free public job feed (Workday, Greenhouse, Lever, SmartRecruiters, SuccessFactors, Oracle…).
              Only companies with fully custom careers pages use AI — and only when that page actually changes.
            </div>
          </div>
          <Suggestions />
          {state.companies.length ? (
            <div className="list">
              {state.companies.map((c) => {
                const [label, tone] = c.source ? SOURCE_LABEL[c.source.type] ?? ['Unknown', ''] : ['Detected on next sweep', '']
                return (
                  <div key={c.id} className="item" style={editing?.id === c.id ? { flexWrap: 'wrap' } : undefined}>
                    <Avatar name={c.name} />
                    <div className="grow">
                      <div className="row" style={{ gap: 8 }}><span style={{ fontWeight: 650 }}>{c.name}</span><span className={`pill ${tone}`}>{label}</span></div>
                      <div className="small muted ellipsis">{c.lastStatus || 'Not checked yet'}{c.lastChecked ? ` · ${fmtDate(c.lastChecked)}` : ''}</div>
                    </div>
                    {c.source?.url && <button className="btn sm ghost" onClick={() => call('shell:openExternal', c.source!.url!)}><ExternalLink size={14} /> Careers</button>}
                    <button className="btn sm ghost" title="Paste a careers URL and re-detect" onClick={() => setEditing({ id: c.id, url: c.careersUrl || '' })}><RefreshCw size={14} /> Re-detect</button>
                    <button className="icon-btn" title="Remove" onClick={() => removeCompany(c)}><Trash2 size={15} /></button>
                    {editing?.id === c.id && (
                      <div className="row" style={{ flexBasis: '100%', marginTop: 10 }}>
                        <input autoFocus value={editing.url} onChange={(e) => setEditing({ ...editing, url: e.target.value })} placeholder="Careers page URL (leave empty to just re-detect)"
                          onKeyDown={(e) => { if (e.key === 'Enter') { redetect(c, editing.url.trim() || undefined); setEditing(null) } else if (e.key === 'Escape') setEditing(null) }} />
                        <button className="btn sm primary" onClick={() => { redetect(c, editing.url.trim() || undefined); setEditing(null) }}>Re-detect</button>
                        <button className="btn sm ghost" onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : <Empty title="No companies yet">Add your first target company above.</Empty>}
        </>
      )}
    </div>
  )
}
