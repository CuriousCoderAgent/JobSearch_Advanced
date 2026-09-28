import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Copy, Crown, Download, Eye, FileStack, FileUp, FolderOpen, Lock, PenLine, Search, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { call, useDesk } from '../lib/desk'
import { Empty, Markdown, Spinner, fmtDate } from '../components/ui'
import { APP_STATUSES, type Application, type CvVersion } from '../../../shared/types'

interface TailorResult { cv: CvVersion; changes: string[]; keywordsMatched: string[]; gaps: string[] }

const statusLabel = (a: Application): string => APP_STATUSES.find((s) => s.id === a.status)?.label ?? a.status

export default function CvStudio() {
  const { state, patch, run, focus, toast, go } = useDesk()
  const [view, setView] = useState<'versions' | 'register'>('versions')
  const [selId, setSelId] = useState<string | null>(state.cvs[0]?.id ?? null)
  const [draft, setDraft] = useState<CvVersion | null>(null)
  const [preview, setPreview] = useState(true)
  const [baseId, setBaseId] = useState<string>(state.profile.masterCvId || state.cvs[0]?.id || '')
  const [appId, setAppId] = useState<string>(focus && state.applications.some((a) => a.id === focus) ? focus : '')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<TailorResult | null>(null)
  const [filter, setFilter] = useState('')

  const sel = state.cvs.find((c) => c.id === selId) ?? null
  useEffect(() => { setDraft(sel); setPreview(true) }, [selId]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!draft && !!sel && JSON.stringify(draft) !== JSON.stringify(sel)
  const appOf = (cv: CvVersion): Application | undefined => (cv.applicationId ? state.applications.find((a) => a.id === cv.applicationId) : undefined)

  const groups = useMemo(() => {
    const needle = filter.toLowerCase()
    const cvs = state.cvs.filter((c) => !needle || `${c.name} ${appOf(c)?.company ?? ''} ${appOf(c)?.role ?? ''}`.toLowerCase().includes(needle))
    return [
      ['Master', cvs.filter((c) => c.kind === 'master')],
      ['Working drafts', cvs.filter((c) => c.kind === 'working')],
      ['Tailored — not sent yet', cvs.filter((c) => c.kind === 'tailored' && !c.locked)],
      ['Sent to employers', cvs.filter((c) => c.locked).sort((a, b) => (b.lockedAt || '').localeCompare(a.lockedAt || ''))]
    ] as const
  }, [state.cvs, state.applications, filter]) // eslint-disable-line react-hooks/exhaustive-deps

  const replace = (cv: CvVersion): void => patch((s) => ({ ...s, cvs: s.cvs.some((c) => c.id === cv.id) ? s.cvs.map((c) => (c.id === cv.id ? cv : c)) : [cv, ...s.cvs] }))
  const importCv = async (): Promise<void> => {
    const cv = await run(() => call<CvVersion | null>('cvs:import'))
    if (cv) { replace(cv); setSelId(cv.id); setView('versions'); toast(`Imported "${cv.name}".`, 'good') }
  }
  const importMany = async (): Promise<void> => {
    const r = await run(() => call<{ imported: CvVersion[]; failed: string[] }>('cvs:importMany'))
    if (!r) return
    r.imported.forEach(replace)
    if (r.imported[0]) { setSelId(r.imported[0].id); setView('versions') }
    if (r.imported.length) toast(`Imported ${r.imported.length} version${r.imported.length === 1 ? '' : 's'}. Rename them or make the best one your master.`, 'good')
    if (r.failed.length) toast(`Couldn’t read: ${r.failed.join(', ')}`, 'error')
  }
  const save = async (): Promise<void> => {
    if (!draft) return
    const cv = await run(() => call<CvVersion>('cvs:save', draft), 'Saved.')
    if (cv) replace(cv)
  }
  const duplicate = async (): Promise<void> => {
    if (!sel) return
    const cv = await run(() => call<CvVersion>('cvs:duplicate', sel.id), 'Duplicated — edit the copy freely.')
    if (cv) { replace(cv); setSelId(cv.id); setPreview(false) }
  }
  const del = async (): Promise<void> => {
    if (!sel || !window.confirm(`Delete "${sel.name}"?`)) return
    const ok = await run(() => call('cvs:remove', sel.id).then(() => true))
    if (ok) { patch((s) => ({ ...s, cvs: s.cvs.filter((c) => c.id !== sel.id) })); setSelId(state.cvs.find((c) => c.id !== sel.id)?.id ?? null) }
  }
  const makeMaster = async (): Promise<void> => {
    if (!sel) return
    const profile = { ...state.profile, masterCvId: sel.id }
    await run(() => call('profile:save', profile))
    const updates = state.cvs.map((c) => (c.id === sel.id ? { ...c, kind: 'master' as const } : c.kind === 'master' ? { ...c, kind: 'working' as const } : c))
    for (const c of updates.filter((c, i) => c.kind !== state.cvs[i].kind)) await call('cvs:save', c)
    patch((s) => ({ ...s, profile, cvs: updates }))
    toast(`"${sel.name}" is now your master CV — the coach builds from it.`, 'good')
  }
  const exportAs = (format: 'docx' | 'pdf'): void => { if (sel) run(() => call('cvs:export', sel.id, format)) }
  const tailor = async (): Promise<void> => {
    setBusy(true); setResult(null)
    const r = await run(() => call<TailorResult>('cvs:tailor', baseId, appId), 'Tailored CV ready.')
    if (r) {
      replace(r.cv)
      patch((s) => ({ ...s, applications: s.applications.map((a) => (a.id === appId ? { ...a, cvVersionId: r.cv.id } : a)) }))
      setResult(r); setSelId(r.cv.id); setView('versions')
    }
    setBusy(false)
  }

  const app = state.applications.find((a) => a.id === appId)
  const selApp = sel ? appOf(sel) : undefined
  const parent = sel?.basedOn ? state.cvs.find((c) => c.id === sel.basedOn) : undefined
  const usedBy = sel ? state.applications.filter((a) => a.cvVersionId === sel.id && a.id !== selApp?.id) : []

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">CV Studio</div>
          <div className="page-title">Every version, one place</div>
          <div className="page-sub">Tailor for a job in one click. Each application keeps a frozen copy of exactly what you sent — your master stays editable.</div>
        </div>
        <div className="row">
          <div className="tabs">
            <button className={`tab ${view === 'versions' ? 'on' : ''}`} onClick={() => setView('versions')}>Versions ({state.cvs.length})</button>
            <button className={`tab ${view === 'register' ? 'on' : ''}`} onClick={() => setView('register')}>Sent register</button>
          </div>
          <button className="btn" onClick={importMany} title="Pick several files at once — e.g. a whole folder of old versions"><FileStack size={16} /> Import several</button>
          <button className="btn primary" onClick={importCv}><FileUp size={16} /> Import CV</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16, background: 'linear-gradient(135deg, rgba(124,156,255,0.1), rgba(245,181,68,0.06)), var(--panel)' }}>
        <div className="card-title"><Wand2 size={17} color="var(--gold)" /> Tailor for a job</div>
        <div className="row">
          <select value={baseId} onChange={(e) => setBaseId(e.target.value)} style={{ maxWidth: 340 }}>
            <option value="">Start from…</option>
            {state.cvs.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.locked ? 'sent' : c.kind})</option>)}
          </select>
          <select value={appId} onChange={(e) => setAppId(e.target.value)}>
            <option value="">For which application…</option>
            {state.applications.filter((a) => a.status !== 'closed').map((a) => <option key={a.id} value={a.id}>{a.role} — {a.company}{a.jd ? '' : ' (no JD saved)'}</option>)}
          </select>
          <button className="btn gold" disabled={!baseId || !appId || busy || !state.hasKey} onClick={tailor}>{busy ? <Spinner /> : <Sparkles size={16} />} {busy ? 'Tailoring…' : 'Tailor'}</button>
        </div>
        {app && !app.jd && <div className="small" style={{ color: 'var(--warn)', marginTop: 8 }}>Tip: open this application and fetch or paste the job description first — tailoring is far sharper with it.</div>}
        {result && (
          <div className="grid g3" style={{ marginTop: 14 }}>
            <div><div className="stat-label" style={{ marginBottom: 6 }}>What changed</div><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{result.changes.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
            <div><div className="stat-label" style={{ marginBottom: 6 }}>Job keywords now covered</div><div className="row wrap" style={{ gap: 5 }}>{result.keywordsMatched.map((k) => <span key={k} className="pill good">{k}</span>)}</div></div>
            <div><div className="stat-label" style={{ marginBottom: 6 }}>Honest gaps to address</div><ul className="small" style={{ margin: 0, paddingLeft: 18, color: 'var(--gold-2)' }}>{result.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></div>
          </div>
        )}
      </div>

      {view === 'register' ? <Register onOpen={(id) => { setSelId(id); setView('versions') }} /> : state.cvs.length ? (
        <div className="grid" style={{ gridTemplateColumns: '320px 1fr', gap: 16, alignItems: 'start' }}>
          <div className="stack" style={{ gap: 14, maxHeight: 'calc(100vh - 330px)', overflow: 'auto', paddingRight: 4 }}>
            {state.cvs.length > 6 && (
              <div className="row" style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 11, color: 'var(--muted)' }} />
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a version or company" style={{ paddingLeft: 32 }} />
              </div>
            )}
            {groups.map(([label, list]) => list.length > 0 && (
              <div key={label}>
                <div className="stat-label" style={{ margin: '0 0 8px 4px' }}>{label} <span className="muted">· {list.length}</span></div>
                <div className="list">
                  {list.map((c) => {
                    const a = appOf(c)
                    return (
                      <div key={c.id} className="item clickable" style={{ borderColor: c.id === selId ? 'var(--blue)' : undefined, background: c.id === selId ? 'var(--blue-tint)' : undefined }} onClick={() => setSelId(c.id)}>
                        {c.kind === 'master' ? <Crown size={16} color="var(--gold)" /> : c.locked ? <Lock size={15} color="var(--good)" /> : c.kind === 'tailored' ? <Sparkles size={15} color="var(--blue-2)" /> : <PenLine size={15} color="var(--muted)" />}
                        <div className="grow">
                          <div className="ellipsis" style={{ fontWeight: 600, fontSize: 13.5 }}>{c.locked && a ? `${a.company} — ${a.role}` : c.name}</div>
                          <div className="tiny muted ellipsis">{c.locked ? `Sent ${fmtDate(c.lockedAt)}${a ? ` · ${statusLabel(a)}` : ''}` : a ? `For ${a.company} · edited ${fmtDate(c.updatedAt)}` : `Edited ${fmtDate(c.updatedAt)}`}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {draft && sel ? (
            <div className="card">
              <div className="row" style={{ marginBottom: 12 }}>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={{ fontWeight: 700, fontSize: 16 }} />
                <div className="tabs">
                  <button className={`tab ${preview ? 'on' : ''}`} onClick={() => setPreview(true)}><Eye size={13} /> Preview</button>
                  <button className={`tab ${!preview ? 'on' : ''}`} onClick={() => setPreview(false)} disabled={sel.locked}><PenLine size={13} /> Edit</button>
                </div>
              </div>
              <div className="row wrap small" style={{ gap: 8, marginBottom: 12 }}>
                {sel.locked && <span className="pill good"><Lock size={12} /> Sent to an employer — locked. Duplicate it to make changes.</span>}
                {selApp && (
                  <button className="pill blue" style={{ cursor: 'pointer', border: 'none' }} onClick={() => go('applications', selApp.id)}>
                    {sel.locked ? 'Sent to' : 'For'} {selApp.company} — {selApp.role} · {statusLabel(selApp)} <ArrowUpRight size={12} />
                  </button>
                )}
                {selApp?.folder && <button className="pill" style={{ cursor: 'pointer', border: 'none' }} onClick={() => call('shell:openPath', selApp.folder!)}><FolderOpen size={12} /> Files sent</button>}
                {parent && <button className="pill" style={{ cursor: 'pointer', border: 'none' }} onClick={() => setSelId(parent.id)}>Built from “{parent.name}”</button>}
                {usedBy.length > 0 && <span className="pill gold">Chosen for {usedBy.map((a) => a.company).join(', ')}</span>}
              </div>
              {preview
                ? <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 12, padding: '18px 22px', maxHeight: '58vh', overflow: 'auto' }}><Markdown text={draft.text} /></div>
                : <textarea value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} rows={28} style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 13 }} />}
              <div className="row wrap" style={{ marginTop: 14 }}>
                <button className="btn primary" disabled={!dirty} onClick={save}>Save</button>
                <button className="btn" onClick={() => exportAs('docx')}><Download size={15} /> Word</button>
                <button className="btn" onClick={() => exportAs('pdf')}><Download size={15} /> PDF</button>
                <button className="btn" onClick={duplicate}><Copy size={15} /> Duplicate</button>
                {sel.kind !== 'master' && !sel.locked && <button className="btn ghost" onClick={makeMaster}><Crown size={15} /> Make master</button>}
                <button className="btn ghost danger" style={{ marginLeft: 'auto' }} onClick={del} disabled={sel.locked}><Trash2 size={15} /></button>
              </div>
            </div>
          ) : <Empty title="Pick a CV on the left" />}
        </div>
      ) : (
        <Empty title="No CVs yet" action={<div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn primary" onClick={importCv}><FileUp size={16} /> Import your CV</button>
          <button className="btn" onClick={importMany}><FileStack size={16} /> Import several</button></div>}>
          Import your current CV (.docx or .pdf). It becomes the master every tailored version is built from. Got a folder of old versions? Import them all at once.
        </Empty>
      )}
    </div>
  )
}

// Which CV went to which employer, newest first — the answer to "what did they read?".
function Register({ onOpen }: { onOpen: (cvId: string) => void }) {
  const { state, go } = useDesk()
  const sent = state.applications.filter((a) => a.appliedFiles?.length).sort((a, b) => (b.appliedAt || '').localeCompare(a.appliedAt || ''))
  const pending = state.applications.filter((a) => !a.appliedFiles?.length && a.status !== 'closed')
  const cv = (id?: string): CvVersion | undefined => state.cvs.find((c) => c.id === id)
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card">
        <div className="card-title"><Lock size={16} color="var(--good)" /> Sent <span className="sub">{sent.length} application pack{sent.length === 1 ? '' : 's'} · also saved as “CV register.csv” in Documents › JobRadar Desk › Applications</span></div>
        {sent.length ? (
          <table className="register">
            <thead><tr><th>Sent</th><th>Company & role</th><th>Status</th><th>CV they have</th><th>Built from</th><th /></tr></thead>
            <tbody>
              {sent.map((a) => {
                const c = cv(a.cvVersionId)
                const base = cv(c?.basedOn)
                return (
                  <tr key={a.id}>
                    <td className="muted">{fmtDate(a.appliedAt)}</td>
                    <td><b>{a.company}</b><div className="small muted">{a.role}</div></td>
                    <td><span className="pill">{statusLabel(a)}</span></td>
                    <td>{c ? <button className="btn sm ghost" style={{ paddingLeft: 0 }} onClick={() => onOpen(c.id)}><Eye size={13} /> View</button> : <span className="muted small">—</span>}</td>
                    <td className="small">{base ? <button className="btn sm ghost" style={{ paddingLeft: 0 }} onClick={() => onOpen(base.id)}>{base.name}</button> : <span className="muted">—</span>}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {a.folder && <button className="btn sm ghost" onClick={() => call('shell:openPath', a.folder!)}><FolderOpen size={13} /> Files</button>}
                      <button className="btn sm ghost" onClick={() => go('applications', a.id)}><ArrowUpRight size={13} /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : <div className="muted small">Nothing sent yet. In an application, choose the CV and click “Save application pack” — it freezes the exact version and files them together.</div>}
      </div>
      {pending.length > 0 && (
        <div className="card">
          <div className="card-title">Not sent yet <span className="sub">{pending.length}</span></div>
          <div className="list">
            {pending.map((a) => {
              const c = cv(a.cvVersionId)
              return (
                <div key={a.id} className="item clickable" onClick={() => go('applications', a.id)}>
                  <div className="grow"><b>{a.company}</b> <span className="muted">— {a.role}</span></div>
                  {c ? <span className="pill blue">CV chosen: {c.name}</span> : <span className="pill gold">No CV chosen</span>}
                  <ArrowUpRight size={14} color="var(--muted)" />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
