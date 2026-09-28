import { useEffect, useMemo, useState } from 'react'
import confetti from 'canvas-confetti'
import { ArrowDownToLine, Lightbulb, Mic, Plus, Search, Sparkles, Star, Target, Trash2 } from 'lucide-react'
import { call, useDesk } from '../lib/desk'
import { Bar, Empty, Markdown, Modal, Ring, Spinner, fmtDate, scoreTone } from '../components/ui'
import { READINESS, type Question, type Readiness, type Track } from '../../../shared/types'

const READY_TONE: Record<Readiness, string> = { new: '', drafting: 'violet', polished: 'blue', ready: 'good' }

export default function Prep() {
  const { state, patch, run, go, focus } = useDesk()
  const [track, setTrack] = useState<'all' | Track>('all')
  const [cat, setCat] = useState<string>('all')
  const [appFilter, setAppFilter] = useState<string>(focus && state.applications.some((a) => a.id === focus) ? focus : 'all')
  const [q, setQ] = useState('')
  const [selId, setSelId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const categories = useMemo(() => [...new Set(state.questions.map((x) => x.category))], [state.questions])
  const list = useMemo(() => {
    const needle = q.toLowerCase()
    return state.questions.filter((x) =>
      (track === 'all' || x.tracks.includes(track)) &&
      (cat === 'all' || x.category === cat) &&
      (appFilter === 'all' ? true : appFilter === 'general' ? !x.applicationId : x.applicationId === appFilter) &&
      (!needle || x.text.toLowerCase().includes(needle)))
  }, [state.questions, track, cat, appFilter, q])
  useEffect(() => { if (!selId || !list.some((x) => x.id === selId)) setSelId(list[0]?.id ?? null) }, [list]) // eslint-disable-line react-hooks/exhaustive-deps

  const ready = state.questions.filter((x) => x.readiness === 'ready').length
  const replace = (qn: Question): void => patch((s) => ({ ...s, questions: s.questions.map((x) => (x.id === qn.id ? qn : x)) }))
  const sel = state.questions.find((x) => x.id === selId)
  const appsWithQs = state.applications.filter((a) => state.questions.some((x) => x.applicationId === a.id))

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Interview prep</div>
          <div className="page-title">Answers you can say in your sleep</div>
          <div className="page-sub">Study the model answer, write your own, get it critiqued, then say it out loud in Practice.</div>
        </div>
        <div className="row" style={{ gap: 18 }}>
          <Ring value={state.questions.length ? (ready / state.questions.length) * 100 : 0} size={64} stroke={7} color="var(--good)"
            label={<div className="ring-num" style={{ fontSize: 15 }}>{ready}</div>} />
          <div className="small"><b>{ready} interview-ready</b><div className="muted">of {state.questions.length} questions</div></div>
          <button className="btn primary" onClick={() => setAdding(true)}><Plus size={16} /> Add question</button>
        </div>
      </div>

      <div className="row wrap" style={{ marginBottom: 14 }}>
        <div className="tabs">
          {([['all', 'All roles'], ['ic', 'Enterprise Account Director'], ['leader', 'Leadership roles']] as const).map(([id, label]) => (
            <button key={id} className={`tab ${track === id ? 'on' : ''}`} onClick={() => setTrack(id)}>{label}</button>
          ))}
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: 220 }}>
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={appFilter} onChange={(e) => setAppFilter(e.target.value)} style={{ width: 260 }}>
          <option value="all">General + company-specific</option>
          <option value="general">General only</option>
          {appsWithQs.map((a) => <option key={a.id} value={a.id}>For {a.company} — {a.role}</option>)}
        </select>
        <div className="row grow" style={{ position: 'relative', minWidth: 200 }}>
          <Search size={15} style={{ position: 'absolute', left: 12, color: 'var(--muted)' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search questions" style={{ paddingLeft: 34 }} />
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(340px, 0.9fr) 1.4fr', gap: 16, alignItems: 'start' }}>
        <div className="list" style={{ maxHeight: 'calc(100vh - 250px)', overflow: 'auto', paddingRight: 4 }}>
          {list.map((x) => {
            const app = x.applicationId ? state.applications.find((a) => a.id === x.applicationId) : undefined
            return (
              <div key={x.id} className="item clickable" onClick={() => setSelId(x.id)}
                style={{ alignItems: 'flex-start', borderColor: x.id === selId ? 'var(--blue)' : undefined, background: x.id === selId ? 'var(--blue-tint)' : undefined }}>
                <div className="grow">
                  <div style={{ fontWeight: 600, lineHeight: 1.35 }}>{x.text}</div>
                  <div className="row wrap" style={{ gap: 5, marginTop: 7 }}>
                    <span className={`pill ${READY_TONE[x.readiness]}`}>{READINESS.find((r) => r.id === x.readiness)?.label}</span>
                    <span className="pill">{x.category}</span>
                    {app && <span className="pill gold">{app.company}</span>}
                    {x.bestScore != null && <span className="pill" style={{ color: scoreTone(x.bestScore) }}>Best {x.bestScore}</span>}
                  </div>
                </div>
                {x.starred && <Star size={15} fill="var(--gold)" color="var(--gold)" />}
              </div>
            )
          })}
          {!list.length && <Empty title="No questions match these filters" />}
        </div>
        {sel ? <QuestionPanel key={sel.id} q={sel} onChange={replace} onPractice={() => go('practice', sel.id)} /> : <Empty title="Pick a question" />}
      </div>

      {adding && <AddQuestion categories={categories} onClose={() => setAdding(false)} onAdd={async (text, category, tracks) => {
        const qn = await run(() => call<Question>('prep:add', text, category, tracks), 'Question added.')
        if (qn) { patch((s) => ({ ...s, questions: [qn, ...s.questions] })); setSelId(qn.id); setAdding(false) }
      }} />}
    </div>
  )
}

function QuestionPanel({ q, onChange, onPractice }: { q: Question; onChange: (q: Question) => void; onPractice: () => void }) {
  const { state, run, patch } = useDesk()
  const [mine, setMine] = useState(q.myAnswer || '')
  const [busy, setBusy] = useState<string | null>(null)
  const dirty = mine !== (q.myAnswer || '')

  const save = async (patchQ: Partial<Question> = {}, msg?: string): Promise<void> => {
    const next = { ...q, myAnswer: mine, ...patchQ }
    if (next.myAnswer && next.readiness === 'new') next.readiness = 'drafting'
    const saved = await run(() => call<Question>('prep:save', next), msg)
    if (saved) {
      onChange(saved)
      if (patchQ.readiness === 'ready' && q.readiness !== 'ready') confetti({ particleCount: 90, spread: 70, origin: { y: 0.35 }, colors: ['#34d399', '#f5b544', '#7c9cff'] })
    }
  }
  const aiAnswer = async (): Promise<void> => {
    setBusy('ai')
    const saved = await run(() => call<Question>('prep:modelAnswer', q.id))
    if (saved) onChange(saved)
    setBusy(null)
  }
  const critique = async (): Promise<void> => {
    if (dirty) await save()
    setBusy('critique')
    const saved = await run(() => call<Question>('prep:critique', q.id))
    if (saved) onChange(saved)
    setBusy(null)
  }
  const remove = async (): Promise<void> => {
    if (!window.confirm('Delete this question?')) return
    await run(() => call('prep:remove', q.id))
    patch((s) => ({ ...s, questions: s.questions.filter((x) => x.id !== q.id) }))
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="card">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <h2 className="grow" style={{ fontSize: 21, lineHeight: 1.3 }}>{q.text}</h2>
          <button className="icon-btn" onClick={() => save({ starred: !q.starred })} title="Star"><Star size={17} fill={q.starred ? 'var(--gold)' : 'none'} color="var(--gold)" /></button>
          {q.custom || q.applicationId ? <button className="icon-btn" onClick={remove} title="Delete"><Trash2 size={16} /></button> : null}
        </div>
        {q.why && (
          <div className="row" style={{ alignItems: 'flex-start', gap: 10, marginTop: 12, padding: '10px 12px', background: 'var(--gold-tint)', borderRadius: 10 }}>
            <Lightbulb size={16} color="var(--gold)" style={{ marginTop: 2, flex: '0 0 auto' }} />
            <div className="small"><b style={{ color: 'var(--gold-2)' }}>What they’re really testing: </b>{q.why}</div>
          </div>
        )}
        <div className="row wrap" style={{ marginTop: 14 }}>
          <span className="stat-label">Readiness</span>
          {READINESS.map((r) => (
            <button key={r.id} className={`pill ${q.readiness === r.id ? READY_TONE[r.id] || 'blue' : ''}`} style={{ cursor: 'pointer', border: '1px solid var(--line-2)' }}
              onClick={() => save({ readiness: r.id }, r.id === 'ready' ? 'Marked interview-ready. 🎯' : undefined)}>{r.label}</button>
          ))}
          <button className="btn sm gold" style={{ marginLeft: 'auto' }} onClick={onPractice}><Mic size={14} /> Practice out loud</button>
        </div>
      </div>

      <div className="card">
        <div className="card-title"><Sparkles size={16} color="var(--blue-2)" /> Model answer <span className="sub">{q.aiAnswerAt ? `built ${fmtDate(q.aiAnswerAt)} from your profile` : 'built from your CV and background'}</span></div>
        {q.aiAnswer ? <Markdown text={q.aiAnswer} /> : <div className="muted small">Ask the coach for the strongest honest answer you could give, built from your own experience.</div>}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn sm primary" onClick={aiAnswer} disabled={!!busy || !state.hasKey}>{busy === 'ai' ? <Spinner size={14} /> : <Sparkles size={14} />} {q.aiAnswer ? 'Regenerate' : 'Show me a strong answer'}</button>
          {q.aiAnswer && <button className="btn sm" onClick={() => setMine(q.aiAnswer!.split('\n\n**Key points')[0])}><ArrowDownToLine size={14} /> Use as my starting draft</button>}
        </div>
      </div>

      <div className="card" style={{ borderColor: 'rgba(245,181,68,0.3)' }}>
        <div className="card-title"><Target size={16} color="var(--gold)" /> {state.profile.name?.split(' ')[0] || 'My'}’s final answer
          <span className="sub">{q.myAnswerUpdatedAt ? `updated ${fmtDate(q.myAnswerUpdatedAt)}` : ''}</span></div>
        <textarea rows={9} value={mine} onChange={(e) => setMine(e.target.value)} placeholder="Your answer, in your words. Aim for 60–120 seconds out loud: context, what you did, the number, the lesson." />
        <div className="row between" style={{ marginTop: 10 }}>
          <span className="tiny muted">{mine.trim() ? `${mine.trim().split(/\s+/).length} words · ~${Math.round(mine.trim().split(/\s+/).length / 2.3)}s spoken` : ''}</span>
          <div className="row">
            <button className="btn sm" onClick={critique} disabled={!!busy || !mine.trim() || !state.hasKey}>{busy === 'critique' ? <Spinner size={14} /> : <Target size={14} />} Critique my answer</button>
            <button className="btn sm primary" disabled={!dirty} onClick={() => save({}, 'Answer saved.')}>Save</button>
          </div>
        </div>
      </div>

      {q.critique && (
        <div className="card">
          <div className="row" style={{ gap: 16, marginBottom: 12 }}>
            <Ring value={q.critique.score} size={70} color={scoreTone(q.critique.score)} label={<div className="ring-num" style={{ fontSize: 20 }}>{q.critique.score}</div>} />
            <div className="grow"><div className="stat-label">Coach’s verdict · {fmtDate(q.critique.at)}</div><div style={{ fontWeight: 650, fontSize: 15, marginTop: 3 }}>{q.critique.verdict}</div>
              <div style={{ marginTop: 8, maxWidth: 260 }}><Bar value={q.critique.score} tone={q.critique.score >= 80 ? 'good' : 'gold'} /></div></div>
          </div>
          <div className="grid g2">
            <div><div className="stat-label" style={{ marginBottom: 6, color: 'var(--good)' }}>What’s working</div><ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>{q.critique.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
            <div><div className="stat-label" style={{ marginBottom: 6, color: 'var(--gold-2)' }}>Fix before the interview</div><ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>{q.critique.fixes.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
          </div>
          <div className="hr" />
          <div className="stat-label" style={{ marginBottom: 6 }}>Tightened version (your facts, your voice)</div>
          <Markdown text={q.critique.tightened} />
          <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setMine(q.critique!.tightened)}><ArrowDownToLine size={14} /> Use this as my answer</button>
        </div>
      )}
    </div>
  )
}

function AddQuestion({ categories, onClose, onAdd }: { categories: string[]; onClose: () => void; onAdd: (t: string, c: string, tr: Track[]) => void }) {
  const [text, setText] = useState('')
  const [category, setCategory] = useState('My questions')
  const [tracks, setTracks] = useState<Track[]>(['ic', 'leader'])
  const toggle = (t: Track): void => setTracks(tracks.includes(t) ? tracks.filter((x) => x !== t) : [...tracks, t])
  return (
    <Modal onClose={onClose}>
      <h2 style={{ marginBottom: 14 }}>Add a question</h2>
      <div className="stack" style={{ gap: 12 }}>
        <label className="field">Question<textarea autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. A question you were asked in a real interview" /></label>
        <label className="field">Category<input list="cats" value={category} onChange={(e) => setCategory(e.target.value)} /><datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></label>
        <div className="row">
          <label className="check"><input type="checkbox" checked={tracks.includes('ic')} onChange={() => toggle('ic')} /> Enterprise Account Director</label>
          <label className="check"><input type="checkbox" checked={tracks.includes('leader')} onChange={() => toggle('leader')} /> Leadership roles</label>
        </div>
      </div>
      <div className="row between" style={{ marginTop: 18 }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!text.trim() || !tracks.length} onClick={() => onAdd(text.trim(), category.trim(), tracks)}>Add</button>
      </div>
    </Modal>
  )
}
