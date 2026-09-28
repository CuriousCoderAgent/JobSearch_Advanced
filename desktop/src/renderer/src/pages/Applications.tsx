import { useEffect, useState } from 'react'
import confetti from 'canvas-confetti'
import {
  BookOpenCheck, CalendarClock, Download, ExternalLink, FileText, FolderOpen, HeartHandshake, Lock, Plus, Sparkles, Star, Trash2, Wand2
} from 'lucide-react'
import { call, useDesk } from '../lib/desk'
import { Avatar, Drawer, Empty, Modal, Spinner, daysAgo, fmtDate } from '../components/ui'
import { APP_STATUSES, localDay, type AppStatus, type Application, type CvVersion, type InterviewRound, type Question } from '../../../shared/types'

const CLOSE_REASONS = ['Rejected', 'No response', 'Role closed or on hold', 'I withdrew', 'I declined the offer']

const COLORS: Record<AppStatus, string> = {
  saved: 'var(--muted)', applied: 'var(--blue)', screening: 'var(--violet)', interviewing: 'var(--gold)', offer: 'var(--good)', closed: '#56607a'
}

function celebrate(): void {
  confetti({ particleCount: 120, spread: 75, origin: { y: 0.3 }, colors: ['#f5b544', '#ffd27a', '#7c9cff', '#34d399'] })
}

export default function Applications() {
  const { state, patch, run, focus } = useDesk()
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<AppStatus | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => { if (focus && state.applications.some((a) => a.id === focus)) setOpenId(focus) }, [focus, state.applications])

  const save = async (app: Application, celebrateMove = false): Promise<Application | undefined> => {
    const saved = await run(() => call<Application>('apps:save', app))
    if (saved) {
      patch((s) => ({ ...s, applications: s.applications.some((a) => a.id === saved.id) ? s.applications.map((a) => (a.id === saved.id ? saved : a)) : [saved, ...s.applications] }))
      if (celebrateMove) celebrate()
    }
    return saved
  }
  const move = (id: string, status: AppStatus): void => {
    const app = state.applications.find((a) => a.id === id)
    if (!app || app.status === status) return
    save({ ...app, status }, status === 'interviewing' || status === 'offer')
  }

  const open = state.applications.find((a) => a.id === openId)
  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Applications</div>
          <div className="page-title">Your pipeline</div>
          <div className="page-sub">Drag cards between stages. Every application keeps the exact CV and cover letter you sent.</div>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}><Plus size={16} /> Add application</button>
      </div>

      {state.applications.length ? (
        <div className="board">
          {APP_STATUSES.map(({ id, label }) => {
            const cards = state.applications.filter((a) => a.status === id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            return (
              <div key={id} className={`col ${over === id ? 'drop' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setOver(id) }}
                onDragLeave={() => setOver(null)}
                onDrop={() => { if (dragId) move(dragId, id); setOver(null); setDragId(null) }}>
                <div className="col-head"><span className="col-dot" style={{ background: COLORS[id] }} />{label}<span className="count">{cards.length}</span></div>
                {cards.map((a) => (
                  <div key={a.id} className={`kcard ${dragId === a.id ? 'dragging' : ''}`} draggable
                    onDragStart={() => setDragId(a.id)} onDragEnd={() => setDragId(null)} onClick={() => setOpenId(a.id)}>
                    <div className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
                      <Avatar name={a.company} size={28} />
                      <div className="grow">
                        <div className="kcard-role">{a.role}</div>
                        <div className="kcard-co">{a.company}</div>
                      </div>
                    </div>
                    <div className="row wrap" style={{ gap: 5, marginTop: 9 }}>
                      {a.appliedFiles?.length ? <span className="pill good"><Lock size={10} /> Pack saved</span> : a.cvVersionId ? <span className="pill blue"><FileText size={10} /> CV ready</span> : null}
                      {a.nextStepDate && <span className="pill gold"><CalendarClock size={10} /> {fmtDate(a.nextStepDate)}</span>}
                      {a.status === 'applied' && a.appliedAt && daysAgo(a.appliedAt) >= 7 && <span className="pill bad">{daysAgo(a.appliedAt)}d — follow up</span>}
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      ) : (
        <Empty title="No applications yet" action={<button className="btn primary" onClick={() => setAdding(true)}><Plus size={16} /> Add your first</button>}>
          Track a role from the Jobs radar, or add one you found anywhere else.
        </Empty>
      )}

      {adding && <AddModal onClose={() => setAdding(false)} onSave={async (a) => { const s = await save(a); if (s) { setAdding(false); setOpenId(s.id) } }} />}
      {open && <AppDrawer app={open} onClose={() => setOpenId(null)} onSave={save} />}
    </div>
  )
}

function AddModal({ onClose, onSave }: { onClose: () => void; onSave: (a: Application) => void }) {
  const [a, setA] = useState({ company: '', role: '', url: '', jd: '' })
  const now = new Date().toISOString()
  return (
    <Modal onClose={onClose}>
      <h2 style={{ marginBottom: 16 }}>Add an application</h2>
      <div className="stack" style={{ gap: 12 }}>
        <div className="grid g2">
          <label className="field">Company<input autoFocus value={a.company} onChange={(e) => setA({ ...a, company: e.target.value })} /></label>
          <label className="field">Role<input value={a.role} onChange={(e) => setA({ ...a, role: e.target.value })} /></label>
        </div>
        <label className="field">Job link<input value={a.url} onChange={(e) => setA({ ...a, url: e.target.value })} placeholder="https://…" /></label>
        <label className="field">Job description <span className="hint">— paste it; tailoring and interview prep get much sharper</span>
          <textarea rows={6} value={a.jd} onChange={(e) => setA({ ...a, jd: e.target.value })} /></label>
      </div>
      <div className="row between" style={{ marginTop: 18 }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!a.company.trim() || !a.role.trim()}
          onClick={() => onSave({ id: crypto.randomUUID(), ...a, status: 'saved', createdAt: now, updatedAt: now, rounds: [] })}>Add</button>
      </div>
    </Modal>
  )
}

function AppDrawer({ app, onClose, onSave }: { app: Application; onClose: () => void; onSave: (a: Application, c?: boolean) => Promise<Application | undefined> }) {
  const { state, run, patch, go, toast } = useDesk()
  const [d, setD] = useState<Application>(app)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => setD(app), [app])
  const set = (patchA: Partial<Application>): void => setD((x) => ({ ...x, ...patchA }))
  const dirty = JSON.stringify(d) !== JSON.stringify(app)
  const cvs = state.cvs
  const chosenCv = cvs.find((c) => c.id === d.cvVersionId)
  const jobQs = state.questions.filter((q) => q.applicationId === app.id)

  const persist = async (): Promise<Application | undefined> => (dirty ? onSave(d, d.status !== app.status && ['interviewing', 'offer'].includes(d.status)) : app)
  const letter = async (): Promise<void> => {
    if (!d.cvVersionId) { toast('Pick the CV version you are sending first.'); return }
    await persist()
    setBusy('letter')
    const text = await run(() => call<string>('cvs:coverLetter', d.cvVersionId, app.id), 'Cover letter drafted.')
    if (text) { set({ coverLetter: text }); patch((s) => ({ ...s, applications: s.applications.map((a) => (a.id === app.id ? { ...a, coverLetter: text } : a)) })) }
    setBusy(null)
  }
  const lockPack = async (): Promise<void> => {
    if (!d.cvVersionId) { toast('Pick the CV version you are sending first.'); return }
    await persist()
    setBusy('lock')
    const r = await run(() => call<{ app: Application; cv: CvVersion }>('apps:lockPack', app.id, d.cvVersionId, d.coverLetter), 'Application pack saved — this exact CV is frozen for this application.')
    if (r) {
      const { app: saved, cv } = r
      patch((s) => ({
        ...s,
        applications: s.applications.map((a) => (a.id === saved.id ? saved : a)),
        cvs: s.cvs.some((c) => c.id === cv.id) ? s.cvs.map((c) => (c.id === cv.id ? cv : c)) : [cv, ...s.cvs]
      }))
      setD(saved)
    }
    setBusy(null)
  }
  const genQuestions = async (): Promise<void> => {
    await persist()
    setBusy('prep')
    const qs = await run(() => call<Question[]>('prep:generateForApp', app.id), 'Likely interview questions added to Interview Prep.')
    if (qs) { patch((s) => ({ ...s, questions: [...qs, ...s.questions] })); go('prep', app.id) }
    setBusy(null)
  }
  const remove = async (): Promise<void> => {
    if (!window.confirm(`Remove ${app.role} at ${app.company}? Files already saved in your Documents folder are kept.`)) return
    await run(() => call('apps:remove', app.id))
    patch((s) => ({ ...s, applications: s.applications.filter((a) => a.id !== app.id) }))
    onClose()
  }
  const fetchJd = async (): Promise<void> => {
    await persist()
    setBusy('jd')
    const saved = await run(() => call<Application>('apps:fetchJd', app.id), 'Job description pulled in.')
    if (saved) { patch((s) => ({ ...s, applications: s.applications.map((a) => (a.id === saved.id ? saved : a)) })); setD(saved) }
    setBusy(null)
  }
  const talkItThrough = async (): Promise<void> => {
    await persist()
    const how = d.closedReason && d.closedReason !== 'Rejected' ? `closed (${d.closedReason.toLowerCase()})` : 'a rejection'
    go('coach', `The ${d.role} role at ${d.company} ended in ${how}.${d.rounds?.length ? ` I got through ${d.rounds.length} round${d.rounds.length === 1 ? '' : 's'}.` : ''} Help me process it — what can I learn, and what should I do next?`)
  }
  const addRound = (): void => set({ rounds: [...(d.rounds || []), { id: crypto.randomUUID(), date: localDay(), stage: '', interviewers: '', notes: '' }] })
  const setRound = (id: string, r: Partial<InterviewRound>): void => set({ rounds: d.rounds.map((x) => (x.id === id ? { ...x, ...r } : x)) })

  return (
    <Drawer onClose={() => { if (dirty && !window.confirm('Discard unsaved changes?')) return; onClose() }}>
      <div className="row" style={{ gap: 14, marginBottom: 18, paddingRight: 40 }}>
        <Avatar name={d.company} size={46} />
        <div className="grow">
          <h2 style={{ fontSize: 22 }}>{d.role}</h2>
          <div className="muted">{d.company}{d.location ? ` · ${d.location}` : ''}</div>
        </div>
      </div>

      <div className="row wrap" style={{ marginBottom: 18 }}>
        <select value={d.status} onChange={(e) => set({ status: e.target.value as AppStatus })} style={{ width: 170 }}>
          {APP_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        {d.url && <button className="btn sm" onClick={() => call('shell:openExternal', d.url)}><ExternalLink size={14} /> Job post</button>}
        <button className="btn sm" onClick={() => call('apps:openFolder', app.id)}><FolderOpen size={14} /> Open folder</button>
        <div className="row" style={{ gap: 2, marginLeft: 'auto' }} title="How excited are you?">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className="icon-btn" onClick={() => set({ excitement: n })}><Star size={16} fill={(d.excitement ?? 0) >= n ? 'var(--gold)' : 'none'} color="var(--gold)" /></button>
          ))}
        </div>
      </div>

      {d.status === 'closed' && (
        <div className="card tight" style={{ marginBottom: 14, borderColor: 'rgba(183,148,246,0.35)' }}>
          <div className="row wrap">
            <label className="field grow" style={{ minWidth: 220 }}>How did it end?
              <select value={d.closedReason || ''} onChange={(e) => set({ closedReason: e.target.value || undefined })}>
                <option value="">Choose…</option>
                {CLOSE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            {state.hasKey && <button className="btn sm" style={{ alignSelf: 'flex-end' }} onClick={talkItThrough}><HeartHandshake size={14} /> Talk it through with your coach</button>}
          </div>
          {(d.closedReason === 'Rejected' || d.closedReason === 'No response') && (
            <div className="small muted" style={{ marginTop: 8 }}>This one stings — and it isn’t a verdict on you. Log what you learned in the rounds below; it makes the next one easier.</div>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title"><Lock size={16} color="var(--gold)" /> What you send</div>
        <div className="row">
          <select value={d.cvVersionId || ''} onChange={(e) => set({ cvVersionId: e.target.value || undefined })}>
            <option value="">Choose the CV version for this application…</option>
            {cvs.filter((c) => !c.locked || c.applicationId === app.id).map((c) => <option key={c.id} value={c.id}>{c.locked ? '🔒 ' : ''}{c.name} ({c.locked ? 'sent' : c.kind})</option>)}
          </select>
          <button className="btn sm" onClick={async () => { await persist(); go('cvs', app.id) }}><Wand2 size={14} /> Tailor a CV</button>
        </div>
        {chosenCv?.locked && <div className="small" style={{ color: 'var(--good)', marginTop: 8 }}>This is the frozen copy that went to {app.company}{chosenCv.lockedAt ? ` on ${fmtDate(chosenCv.lockedAt)}` : ''}.</div>}
        {chosenCv && !chosenCv.locked && chosenCv.kind !== 'tailored' && <div className="small muted" style={{ marginTop: 8 }}>Saving the pack freezes a copy of this CV for {app.company}; the original stays editable.</div>}
        <label className="field" style={{ marginTop: 12 }}>Cover letter
          <textarea rows={d.coverLetter ? 8 : 3} value={d.coverLetter || ''} onChange={(e) => set({ coverLetter: e.target.value })} placeholder="Optional. Generate one from your CV and the job description, then edit." />
        </label>
        <div className="row wrap" style={{ marginTop: 10 }}>
          <button className="btn sm" onClick={letter} disabled={!!busy || !state.hasKey}>{busy === 'letter' ? <Spinner size={14} /> : <Sparkles size={14} />} Draft cover letter</button>
          <button className="btn sm gold" onClick={lockPack} disabled={!!busy}>{busy === 'lock' ? <Spinner size={14} /> : <Lock size={14} />} Save application pack</button>
        </div>
        {d.appliedFiles?.length ? (
          <div className="small muted" style={{ marginTop: 10 }}>
            Saved {fmtDate(d.appliedAt)}: {d.appliedFiles.map((f) => f.split(/[\\/]/).pop()).join(' · ')}
          </div>
        ) : <div className="small muted" style={{ marginTop: 10 }}>Saves the CV (.docx + .pdf), cover letter and job description into Documents › JobRadar Desk › Applications, and freezes the exact CV version this company received.</div>}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title"><BookOpenCheck size={16} color="var(--blue-2)" /> Interview prep for this role
          <span className="sub">{jobQs.length ? `${jobQs.filter((q) => q.readiness === 'ready').length}/${jobQs.length} ready` : ''}</span></div>
        <div className="row wrap">
          <button className="btn sm primary" onClick={genQuestions} disabled={!!busy || !state.hasKey}>{busy === 'prep' ? <Spinner size={14} /> : <Sparkles size={14} />} {jobQs.length ? 'Generate more questions' : 'Predict their questions'}</button>
          {jobQs.length > 0 && <button className="btn sm" onClick={() => go('prep', app.id)}>Open these questions</button>}
        </div>
      </div>

      <div className="grid g2" style={{ marginBottom: 12 }}>
        <label className="field">Next step<input value={d.nextStep || ''} onChange={(e) => set({ nextStep: e.target.value })} placeholder="e.g. Call with hiring manager" /></label>
        <label className="field">Date<input type="date" value={d.nextStepDate || ''} onChange={(e) => set({ nextStepDate: e.target.value })} /></label>
        <label className="field">Location<input value={d.location || ''} onChange={(e) => set({ location: e.target.value })} /></label>
        <label className="field">Compensation notes<input value={d.compensation || ''} onChange={(e) => set({ compensation: e.target.value })} placeholder="e.g. ₹85L fixed + 40% variable" /></label>
      </div>
      <label className="field" style={{ marginBottom: 12 }}>
        <span className="row between">Job description
          {d.url && <button className="btn sm ghost" style={{ padding: '2px 6px' }} onClick={(e) => { e.preventDefault(); fetchJd() }} disabled={!!busy}>
            {busy === 'jd' ? <Spinner size={13} /> : <Download size={13} />} {d.jd?.trim() ? 'Re-fetch from the job link' : 'Fetch from the job link'}</button>}
        </span>
        <textarea rows={6} value={d.jd || ''} onChange={(e) => set({ jd: e.target.value })} placeholder={d.url ? 'Fetch it from the job link above, or paste it here' : 'Paste the full job description'} />
      </label>
      <label className="field" style={{ marginBottom: 12 }}>Contacts<textarea rows={2} value={d.contacts || ''} onChange={(e) => set({ contacts: e.target.value })} placeholder="Recruiter, hiring manager, referrals…" /></label>
      <label className="field" style={{ marginBottom: 14 }}>Notes<textarea rows={3} value={d.notes || ''} onChange={(e) => set({ notes: e.target.value })} /></label>

      <div className="card-title" style={{ marginTop: 6 }}>Interview rounds <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={addRound}><Plus size={14} /> Add round</button></div>
      <div className="stack">
        {(d.rounds || []).map((r) => (
          <div key={r.id} className="card tight stack">
            <div className="grid g3">
              <input type="date" value={r.date} onChange={(e) => setRound(r.id, { date: e.target.value })} />
              <input value={r.stage} onChange={(e) => setRound(r.id, { stage: e.target.value })} placeholder="Stage, e.g. VP Sales round" />
              <input value={r.interviewers} onChange={(e) => setRound(r.id, { interviewers: e.target.value })} placeholder="Interviewers" />
            </div>
            <textarea rows={2} value={r.notes} onChange={(e) => setRound(r.id, { notes: e.target.value })} placeholder="What they asked, how it went, what to fix next time" />
          </div>
        ))}
      </div>

      <div className="row between" style={{ marginTop: 22, position: 'sticky', bottom: -40, background: 'var(--bg-2)', padding: '12px 0' }}>
        <button className="btn ghost danger" onClick={remove}><Trash2 size={15} /> Remove</button>
        <button className="btn primary" disabled={!dirty} onClick={async () => { const s = await persist(); if (s) toast('Saved.', 'good') }}>Save changes</button>
      </div>
    </Drawer>
  )
}
