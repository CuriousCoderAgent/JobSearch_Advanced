import { useEffect, useMemo, useState } from 'react'
import { Copy, Crown, Download, Eye, FileUp, Lock, PenLine, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { call, useDesk } from '../lib/desk'
import { Empty, Markdown, Spinner, fmtDate } from '../components/ui'
import type { CvVersion } from '../../../shared/types'

interface TailorResult { cv: CvVersion; changes: string[]; keywordsMatched: string[]; gaps: string[] }

export default function CvStudio() {
  const { state, patch, run, focus, toast } = useDesk()
  const [selId, setSelId] = useState<string | null>(state.cvs[0]?.id ?? null)
  const [draft, setDraft] = useState<CvVersion | null>(null)
  const [preview, setPreview] = useState(true)
  const [baseId, setBaseId] = useState<string>(state.profile.masterCvId || state.cvs[0]?.id || '')
  const [appId, setAppId] = useState<string>(focus && state.applications.some((a) => a.id === focus) ? focus : '')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<TailorResult | null>(null)

  const sel = state.cvs.find((c) => c.id === selId) ?? null
  useEffect(() => { setDraft(sel); setPreview(true) }, [selId]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!draft && !!sel && JSON.stringify(draft) !== JSON.stringify(sel)

  const groups = useMemo(() => ([
    ['Master', state.cvs.filter((c) => c.kind === 'master')],
    ['Working versions', state.cvs.filter((c) => c.kind === 'working')],
    ['Tailored for a job', state.cvs.filter((c) => c.kind === 'tailored')]
  ] as const), [state.cvs])

  const replace = (cv: CvVersion): void => patch((s) => ({ ...s, cvs: s.cvs.some((c) => c.id === cv.id) ? s.cvs.map((c) => (c.id === cv.id ? cv : c)) : [cv, ...s.cvs] }))
  const importCv = async (): Promise<void> => {
    const cv = await run(() => call<CvVersion | null>('cvs:import'))
    if (cv) { replace(cv); setSelId(cv.id); toast(`Imported "${cv.name}".`, 'good') }
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
      setResult(r); setSelId(r.cv.id)
    }
    setBusy(false)
  }

  const app = state.applications.find((a) => a.id === appId)
  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">CV Studio</div>
          <div className="page-title">Every version, one place</div>
          <div className="page-sub">Tailor for a job in one click. Versions you’ve sent are locked, so you always know exactly what they read.</div>
        </div>
        <button className="btn primary" onClick={importCv}><FileUp size={16} /> Import CV</button>
      </div>

      <div className="card" style={{ marginBottom: 16, background: 'linear-gradient(135deg, rgba(124,156,255,0.1), rgba(245,181,68,0.06)), var(--panel)' }}>
        <div className="card-title"><Wand2 size={17} color="var(--gold)" /> Tailor for a job</div>
        <div className="row">
          <select value={baseId} onChange={(e) => setBaseId(e.target.value)} style={{ maxWidth: 340 }}>
            <option value="">Start from…</option>
            {state.cvs.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.kind})</option>)}
          </select>
          <select value={appId} onChange={(e) => setAppId(e.target.value)}>
            <option value="">For which application…</option>
            {state.applications.filter((a) => a.status !== 'closed').map((a) => <option key={a.id} value={a.id}>{a.role} — {a.company}{a.jd ? '' : ' (no JD saved)'}</option>)}
          </select>
          <button className="btn gold" disabled={!baseId || !appId || busy || !state.hasKey} onClick={tailor}>{busy ? <Spinner /> : <Sparkles size={16} />} {busy ? 'Tailoring…' : 'Tailor'}</button>
        </div>
        {app && !app.jd && <div className="small" style={{ color: 'var(--warn)', marginTop: 8 }}>Tip: paste the job description into this application first — tailoring is far sharper with it.</div>}
        {result && (
          <div className="grid g3" style={{ marginTop: 14 }}>
            <div><div className="stat-label" style={{ marginBottom: 6 }}>What changed</div><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{result.changes.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
            <div><div className="stat-label" style={{ marginBottom: 6 }}>Job keywords now covered</div><div className="row wrap" style={{ gap: 5 }}>{result.keywordsMatched.map((k) => <span key={k} className="pill good">{k}</span>)}</div></div>
            <div><div className="stat-label" style={{ marginBottom: 6 }}>Honest gaps to address</div><ul className="small" style={{ margin: 0, paddingLeft: 18, color: 'var(--gold-2)' }}>{result.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></div>
          </div>
        )}
      </div>

      {state.cvs.length ? (
        <div className="grid" style={{ gridTemplateColumns: '300px 1fr', gap: 16, alignItems: 'start' }}>
          <div className="stack" style={{ gap: 14 }}>
            {groups.map(([label, list]) => list.length > 0 && (
              <div key={label}>
                <div className="stat-label" style={{ margin: '0 0 8px 4px' }}>{label}</div>
                <div className="list">
                  {list.map((c) => (
                    <div key={c.id} className="item clickable" style={{ borderColor: c.id === selId ? 'var(--blue)' : undefined, background: c.id === selId ? 'var(--blue-tint)' : undefined }} onClick={() => setSelId(c.id)}>
                      {c.kind === 'master' ? <Crown size={16} color="var(--gold)" /> : c.locked ? <Lock size={15} color="var(--good)" /> : <PenLine size={15} color="var(--muted)" />}
                      <div className="grow"><div className="ellipsis" style={{ fontWeight: 600, fontSize: 13.5 }}>{c.name}</div><div className="tiny muted">{c.locked ? `Sent · ${fmtDate(c.lockedAt)}` : `Edited ${fmtDate(c.updatedAt)}`}</div></div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {draft && sel ? (
            <div className="card">
              <div className="row" style={{ marginBottom: 14 }}>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={{ fontWeight: 700, fontSize: 16 }} />
                <div className="tabs">
                  <button className={`tab ${preview ? 'on' : ''}`} onClick={() => setPreview(true)}><Eye size={13} /> Preview</button>
                  <button className={`tab ${!preview ? 'on' : ''}`} onClick={() => setPreview(false)} disabled={sel.locked}><PenLine size={13} /> Edit</button>
                </div>
              </div>
              {sel.locked && <div className="pill good" style={{ marginBottom: 12 }}><Lock size={12} /> Sent to an employer — locked. Duplicate it to make changes.</div>}
              {preview
                ? <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 12, padding: '18px 22px', maxHeight: '62vh', overflow: 'auto' }}><Markdown text={draft.text} /></div>
                : <textarea value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} rows={28} style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 13 }} />}
              <div className="row wrap" style={{ marginTop: 14 }}>
                <button className="btn primary" disabled={!dirty} onClick={save}>Save</button>
                <button className="btn" onClick={() => exportAs('docx')}><Download size={15} /> Word</button>
                <button className="btn" onClick={() => exportAs('pdf')}><Download size={15} /> PDF</button>
                <button className="btn" onClick={duplicate}><Copy size={15} /> Duplicate</button>
                {sel.kind !== 'master' && <button className="btn ghost" onClick={makeMaster}><Crown size={15} /> Make master</button>}
                <button className="btn ghost danger" style={{ marginLeft: 'auto' }} onClick={del} disabled={sel.locked}><Trash2 size={15} /></button>
              </div>
            </div>
          ) : <Empty title="Pick a CV on the left" />}
        </div>
      ) : (
        <Empty title="No CVs yet" action={<button className="btn primary" onClick={importCv}><FileUp size={16} /> Import your CV</button>}>
          Import your current CV (.docx or .pdf). It becomes the master every tailored version is built from.
        </Empty>
      )}
    </div>
  )
}
