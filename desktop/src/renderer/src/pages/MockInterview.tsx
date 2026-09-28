import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Camera, CircleStop, Mic, Play, SkipForward, Sparkles, Trash2, Users, Volume2, X } from 'lucide-react'
import { call, onEvent, useDesk } from '../lib/desk'
import { analyze, decodeTo16k, transcribe } from '../lib/voice'
import { Empty, Markdown, Ring, Sparkline, Spinner, fixDuration, fmtDate, scoreTone } from '../components/ui'
import type { Application, MockDecision, MockSession, MockTurn, Question } from '../../../shared/types'

type Phase = 'setup' | 'asking' | 'answering' | 'noting' | 'debriefing'
interface Current { kind: MockTurn['kind']; questionId?: string; text: string; index: number }

const DECISION: Record<MockDecision, [string, string]> = {
  'strong-yes': ['Strong yes — they’d fight for you', 'good'],
  yes: ['Yes — you’d go through', 'good'],
  'lean-no': ['Lean no — close, not there yet', 'gold'],
  no: ['No — not on this showing', 'bad']
}
const LENGTHS = [[3, '~10 min'], [5, '~15 min'], [7, '~25 min']] as const

// Reads the question aloud with the PC's own voices (offline), preferring an
// Indian English voice. Resolves when finished, or at once if speech is off.
async function speak(text: string): Promise<void> {
  const synth = window.speechSynthesis
  if (!synth) return
  if (!synth.getVoices().length) {
    await new Promise<void>((r) => { synth.addEventListener('voiceschanged', () => r(), { once: true }); setTimeout(r, 1200) })
  }
  const voices = synth.getVoices()
  const u = new SpeechSynthesisUtterance(text)
  u.voice = voices.find((v) => v.lang === 'en-IN') ?? voices.find((v) => v.lang === 'en-GB') ?? voices.find((v) => v.lang.startsWith('en')) ?? null
  u.rate = 0.98
  synth.cancel()
  await new Promise<void>((resolve) => {
    u.onend = () => resolve()
    u.onerror = () => resolve()
    setTimeout(resolve, 2000 + text.length * 110) // never hang the interview on a silent voice
    synth.speak(u)
  })
}

export default function MockInterview({ tabs, initialAppId, onPractise }: { tabs: ReactNode; initialAppId?: string; onPractise: (questionId: string) => void }) {
  const { state, patch, run, toast } = useDesk()
  const active = state.applications.filter((a) => a.status !== 'closed')
  const defaultApp = initialAppId ?? active.find((a) => a.status === 'interviewing')?.id ?? ''
  const [appId, setAppId] = useState(defaultApp)
  const [count, setCount] = useState<number>(5)
  const [mode, setMode] = useState<'audio' | 'video'>('video')
  const [followUps, setFollowUps] = useState(true)
  const [voice, setVoice] = useState(true)
  const [phase, setPhase] = useState<Phase>('setup')
  const [session, setSession] = useState<MockSession | null>(null)
  const [current, setCurrent] = useState<Current | null>(null)
  const [status, setStatus] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState<number[]>(Array(24).fill(2))
  const [viewId, setViewId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => onEvent('model:progress', (pct) => setStatus(`Downloading the speech model (one time only)… ${pct}%`)), [])

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const framesRef = useRef<string[]>([])
  const answerTimers = useRef<number[]>([])
  const meterTimer = useRef<number | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const sessionRef = useRef<MockSession | null>(null)
  const endRef = useRef(false)

  const app = state.applications.find((a) => a.id === appId)
  const history = useMemo(() => [...state.mocks].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [state.mocks])
  const viewing = state.mocks.find((m) => m.id === viewId) ?? null

  const clearAnswerTimers = (): void => { answerTimers.current.forEach((t) => clearInterval(t)); answerTimers.current = [] }
  const stopEverything = (): void => {
    clearAnswerTimers()
    if (meterTimer.current) { clearInterval(meterTimer.current); meterTimer.current = null }
    window.speechSynthesis?.cancel()
    if (recRef.current?.state === 'recording') recRef.current.stop()
    streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null
    audioCtxRef.current?.close().catch(() => undefined); audioCtxRef.current = null
  }
  useEffect(() => stopEverything, [])

  const saveSession = (s: MockSession): void => {
    sessionRef.current = s
    setSession(s)
    patch((st) => ({ ...st, mocks: st.mocks.some((m) => m.id === s.id) ? st.mocks.map((m) => (m.id === s.id ? s : m)) : [s, ...st.mocks] }))
  }

  const begin = async (): Promise<void> => {
    endRef.current = false
    const s = await run(() => call<MockSession>('mock:start', appId || null, count, mode, followUps))
    if (!s) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: mode === 'video' ? { width: 1280, height: 720 } : false
      })
      streamRef.current = stream
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      const an = ctx.createAnalyser(); an.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(an)
      const data = new Uint8Array(an.frequencyBinCount)
      meterTimer.current = window.setInterval(() => {
        an.getByteTimeDomainData(data)
        let peak = 0
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128))
        setLevels((l) => [...l.slice(1), Math.max(2, Math.min(34, peak / 2.2))])
      }, 80)
    } catch (e) {
      toast(`Couldn’t start the ${mode === 'video' ? 'camera/microphone' : 'microphone'}: ${(e as Error).message}. Check Windows privacy settings.`, 'error')
      await call('mock:remove', s.id).catch(() => undefined)
      stopEverything()
      return
    }
    saveSession(s)
    setViewId(null)
    ask({ kind: 'main', questionId: s.planned[0].questionId, text: s.planned[0].text, index: 0 })
  }

  // The camera preview lives for the whole interview, like a video call.
  useEffect(() => {
    const v = videoRef.current
    if (v && streamRef.current && mode === 'video' && v.srcObject !== streamRef.current) { v.srcObject = streamRef.current; v.play().catch(() => undefined) }
  })

  const ask = async (cur: Current): Promise<void> => {
    setCurrent(cur)
    setPhase('asking')
    if (voice) { await new Promise((r) => setTimeout(r, 500)); await speak(cur.text) }
    if (endRef.current) { finish(); return }
    startAnswer()
  }

  const startAnswer = (): void => {
    const stream = streamRef.current
    if (!stream) return
    const mime = mode === 'video'
      ? (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm')
      : 'audio/webm;codecs=opus'
    const rec = new MediaRecorder(stream, { mimeType: mime })
    chunksRef.current = []; framesRef.current = []
    rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
    rec.start(1000)
    recRef.current = rec
    const t0 = Date.now()
    setElapsed(0)
    answerTimers.current.push(window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 250))
    if (mode === 'video') {
      const grab = (): void => {
        const v = videoRef.current
        if (!v || !v.videoWidth) return
        const c = document.createElement('canvas')
        c.width = 640; c.height = Math.round((640 * v.videoHeight) / v.videoWidth)
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
        framesRef.current.push(c.toDataURL('image/jpeg', 0.72).split(',')[1])
      }
      answerTimers.current.push(window.setTimeout(grab, 3000))
      answerTimers.current.push(window.setInterval(grab, 6000))
    }
    setPhase('answering')
  }

  const nextAfter = async (cur: Current, savedTurn: MockTurn | null): Promise<void> => {
    const s = sessionRef.current!
    if (endRef.current) { finish(); return }
    if (savedTurn && cur.kind === 'main' && s.followUps) {
      setStatus('The panel is conferring…')
      const follow = await call<string | null>('mock:followUp', s.id, savedTurn.id).catch(() => null)
      if (endRef.current) { finish(); return }
      if (follow) { ask({ kind: 'followup', text: follow, index: cur.index }); return }
    }
    const next = cur.index + 1
    if (next < s.planned.length) ask({ kind: 'main', questionId: s.planned[next].questionId, text: s.planned[next].text, index: next })
    else finish()
  }

  const finishAnswer = async (skip = false): Promise<void> => {
    const rec = recRef.current
    const cur = current
    if (!rec || !cur) return
    const done = new Promise<void>((r) => { rec.onstop = () => r() })
    rec.stop()
    await done
    clearAnswerTimers()
    setPhase('noting')
    if (skip) { nextAfter(cur, null); return }
    setStatus('The panel is taking notes…')
    let saved: MockTurn | null = null
    try {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType })
      const audio = await decodeTo16k(blob)
      if (audio.length < 16000 * 2) throw new Error('That answer was under 2 seconds, so it wasn’t kept.')
      const { text, words } = await transcribe(audio, setStatus)
      const metrics = analyze(audio, text, words)
      const frames = framesRef.current
      setStatus('The panel is taking notes…')
      saved = await call<MockTurn>('mock:turn', sessionRef.current!.id, {
        kind: cur.kind, questionId: cur.questionId, question: cur.text, media: await blob.arrayBuffer(), ext: 'webm',
        transcript: text, metrics, frame: frames.length ? frames[Math.floor(frames.length / 2)] : undefined
      })
      const s = sessionRef.current!
      saveSession({ ...s, turns: [...s.turns, saved] })
    } catch (e) {
      toast((e as Error).message, 'error')
    }
    nextAfter(cur, saved)
  }

  const finish = async (): Promise<void> => {
    stopEverything()
    setCurrent(null)
    const s = sessionRef.current
    if (!s || !s.turns.length) {
      if (s) { await call('mock:remove', s.id).catch(() => undefined); patch((st) => ({ ...st, mocks: st.mocks.filter((m) => m.id !== s.id) })) }
      setPhase('setup')
      return
    }
    setViewId(s.id)
    if (!state.hasKey) { setPhase('setup'); return }
    setPhase('debriefing')
    const d = await run(() => call<MockSession>('mock:debrief', s.id))
    if (d) saveSession(d)
    setPhase('setup')
  }

  const endInterview = (): void => {
    endRef.current = true
    if (phase === 'answering') finishAnswer()
    else if (phase === 'asking') window.speechSynthesis?.cancel()
  }

  const generateForApp = async (a: Application): Promise<void> => {
    setBusy(true)
    const qs = await run(() => call<Question[]>('prep:generateForApp', a.id), `Added ${a.company}’s likely questions — the mock will use them.`)
    if (qs) patch((st) => ({ ...st, questions: [...qs, ...st.questions] }))
    setBusy(false)
  }

  const removeSession = async (m: MockSession): Promise<void> => {
    if (!window.confirm('Delete this mock interview and its recordings?')) return
    await run(() => call('mock:remove', m.id))
    patch((st) => ({ ...st, mocks: st.mocks.filter((x) => x.id !== m.id) }))
    if (viewId === m.id) setViewId(null)
  }

  // ---------- Live interview ----------
  if (phase !== 'setup' && phase !== 'debriefing' && session) {
    const mm = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
    const q = current
    return (
      <div className="page" style={{ maxWidth: 1180 }}>
        <div className="row between" style={{ marginBottom: 16 }}>
          <div>
            <div className="eyebrow">Mock interview · {session.label}</div>
            <div className="row" style={{ gap: 6 }}>
              {session.planned.map((p, i) => (
                <span key={p.questionId} className="mock-dot" data-state={q && i < q.index ? 'done' : q && i === q.index ? 'now' : 'todo'} title={p.text} />
              ))}
              <span className="small muted" style={{ marginLeft: 6 }}>Question {(q?.index ?? 0) + 1} of {session.planned.length}{q?.kind === 'followup' ? ' · follow-up' : ''}</span>
            </div>
          </div>
          <button className="btn ghost sm danger" onClick={endInterview} disabled={phase === 'noting' && endRef.current}><X size={14} /> End interview</button>
        </div>

        <div className="card mock-question" data-followup={q?.kind === 'followup' || undefined}>
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <span className="avatar" style={{ width: 40, height: 40, background: 'linear-gradient(135deg, #6f8dff, #5876f0)' }}><Users size={19} /></span>
            <div className="grow">
              <div className="stat-label">{q?.kind === 'followup' ? 'The panel follows up' : 'The panel asks'}</div>
              <div style={{ fontSize: 21, fontWeight: 650, lineHeight: 1.35, marginTop: 4, fontFamily: 'var(--display)' }}>{q?.text ?? '…'}</div>
            </div>
            {phase === 'asking' && voice && <Volume2 size={18} color="var(--blue-2)" className="pulse" />}
          </div>
        </div>

        <div className="recorder" style={{ marginTop: 14 }}>
          {mode === 'video' ? <video ref={videoRef} muted playsInline /> : (
            <div style={{ textAlign: 'center' }}><Mic size={42} color="var(--muted)" /><div className="small muted" style={{ marginTop: 8 }}>Audio-only interview</div></div>
          )}
          {(phase === 'asking' || phase === 'noting') && (
            <div className="mock-overlay">
              {phase === 'asking' ? <><Volume2 size={16} /> {voice ? 'Listen to the question…' : 'Get ready…'}</> : <><Spinner size={16} /> {status || 'The panel is taking notes…'}</>}
            </div>
          )}
          {phase === 'answering' && (
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14px 18px', background: 'linear-gradient(transparent, rgba(0,0,0,0.75))' }} className="row between">
              <div className="row"><span className="rec-dot" /><b style={{ fontVariantNumeric: 'tabular-nums', color: elapsed > 150 ? 'var(--bad)' : '#fff' }}>{mm}</b>
                {elapsed > 150 && <span className="pill bad">Wrap it up</span>}</div>
              <div className="meter">{levels.map((h, i) => <i key={i} style={{ height: h }} />)}</div>
              <div className="row">
                <button className="btn sm ghost" style={{ color: '#fff' }} onClick={() => finishAnswer(true)} title="Skip this question"><SkipForward size={14} /> Skip</button>
                <button className="btn primary" onClick={() => finishAnswer()}><CircleStop size={16} /> Done — next</button>
              </div>
            </div>
          )}
        </div>
        <div className="small muted" style={{ marginTop: 10 }}>Answer as you would in the room — 60 to 120 seconds, numbers early. The panel won’t coach you until the end.</div>
      </div>
    )
  }

  // ---------- Setup, debrief and history ----------
  const appQs = app ? state.questions.filter((x) => x.applicationId === app.id).length : 0
  const scored = history.filter((m) => m.debrief).reverse()
  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Practice studio</div>
          <div className="page-title">Sit the real thing.</div>
          <div className="page-sub">A full panel, back to back: questions read aloud, follow-ups on what you actually said, and one honest debrief at the end.</div>
        </div>
        {tabs}
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <div className="stack" style={{ gap: 16 }}>
          {phase === 'debriefing' ? (
            <div className="card" style={{ textAlign: 'center', padding: 40 }}>
              <Spinner size={30} />
              <div style={{ fontWeight: 650, marginTop: 14 }}>The panel is deciding — and your coach is writing up the debrief…</div>
              <div className="small muted" style={{ marginTop: 4 }}>Usually under a minute.</div>
            </div>
          ) : viewing ? (
            <Debrief s={viewing} onClose={() => setViewId(null)} onPractise={onPractise}
              onRetry={async () => { const d = await run(() => call<MockSession>('mock:debrief', viewing.id)); if (d) saveSession(d) }} />
          ) : (
            <div className="card">
              <div className="card-title"><Users size={17} color="var(--gold)" /> Set up your panel</div>
              <div className="stack" style={{ gap: 14 }}>
                <label className="field">Interviewing for
                  <select value={appId} onChange={(e) => setAppId(e.target.value)}>
                    <option value="">An AI-first company (general panel)</option>
                    {active.map((a) => <option key={a.id} value={a.id}>{a.company} — {a.role}{a.status === 'interviewing' ? ' · interviewing' : ''}</option>)}
                  </select>
                </label>
                {app && !appQs && (
                  <div className="row small" style={{ gap: 10, padding: '9px 12px', borderRadius: 10, background: 'var(--gold-tint)' }}>
                    <span className="grow">No {app.company}-specific questions yet — the mock is sharper with them{app.jd ? '' : ' (and with the job description saved)'}.</span>
                    <button className="btn sm" disabled={busy || !state.hasKey} onClick={() => generateForApp(app)}>{busy ? <Spinner size={13} /> : <Sparkles size={13} />} Predict their questions</button>
                  </div>
                )}
                <div className="row wrap" style={{ gap: 18 }}>
                  <div>
                    <div className="stat-label" style={{ marginBottom: 6 }}>Length</div>
                    <div className="tabs">{LENGTHS.map(([n, t]) => <button key={n} className={`tab ${count === n ? 'on' : ''}`} onClick={() => setCount(n)}>{n} questions · {t}</button>)}</div>
                  </div>
                  <div>
                    <div className="stat-label" style={{ marginBottom: 6 }}>Format</div>
                    <div className="tabs">
                      <button className={`tab ${mode === 'video' ? 'on' : ''}`} onClick={() => setMode('video')}><Camera size={13} /> Video call</button>
                      <button className={`tab ${mode === 'audio' ? 'on' : ''}`} onClick={() => setMode('audio')}><Mic size={13} /> Phone screen</button>
                    </div>
                  </div>
                </div>
                <label className="check"><input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> Read each question aloud</label>
                <label className="check"><input type="checkbox" checked={followUps && state.hasKey} disabled={!state.hasKey} onChange={(e) => setFollowUps(e.target.checked)} /> Let the panel ask follow-ups on what you actually said</label>
                <div className="small muted">
                  {state.hasKey
                    ? 'Recordings and transcripts stay on this PC. AI cost is roughly $0.20–0.40: a few short follow-ups and one debrief.'
                    : 'Add your Anthropic key in Settings for follow-ups and the debrief. You can still sit the interview and replay it.'}
                </div>
                <div><button className="btn gold lg" onClick={begin}><Play size={17} /> Start the interview</button></div>
              </div>
            </div>
          )}
        </div>

        <div className="stack" style={{ gap: 16 }}>
          {scored.length >= 2 && (
            <div className="card">
              <div className="card-title">Mock interview trend <span className="sub">{scored.length} debriefed</span></div>
              <Sparkline values={scored.map((m) => m.debrief!.overall)} />
            </div>
          )}
          <div className="card">
            <div className="card-title">Past mock interviews <span className="sub">{history.length}</span></div>
            {history.length ? (
              <div className="list">
                {history.map((m) => (
                  <div key={m.id} className="item clickable" style={{ borderColor: m.id === viewId ? 'var(--blue)' : undefined }} onClick={() => setViewId(m.id)}>
                    <div className="grow">
                      <div style={{ fontWeight: 650 }} className="ellipsis">{m.label}</div>
                      <div className="tiny muted">{fmtDate(m.createdAt)} · {m.turns.length} answer{m.turns.length === 1 ? '' : 's'} · {m.mode === 'video' ? 'video' : 'audio'}</div>
                    </div>
                    {m.debrief
                      ? <><span className={`pill ${DECISION[m.debrief.decision][1]}`}>{m.debrief.decision.replace('-', ' ')}</span><b style={{ color: scoreTone(m.debrief.overall) }}>{m.debrief.overall}</b></>
                      : <span className="pill">No debrief</span>}
                    <button className="icon-btn" title="Delete" onClick={(e) => { e.stopPropagation(); removeSession(m) }}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            ) : <div className="muted small">Your mock interviews will be listed here, with the panel’s verdict on each.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

function Debrief({ s, onClose, onPractise, onRetry }: { s: MockSession; onClose: () => void; onPractise: (qid: string) => void; onRetry: () => Promise<void> }) {
  const { state } = useDesk()
  const [busy, setBusy] = useState(false)
  const d = s.debrief
  return (
    <>
      <div className="card">
        <div className="row between" style={{ marginBottom: d ? 14 : 0 }}>
          <div><div className="eyebrow" style={{ margin: 0 }}>Debrief · {fmtDate(s.createdAt)}</div><div style={{ fontWeight: 700, fontSize: 16 }}>{s.label}</div></div>
          <button className="icon-btn" onClick={onClose} title="Back to setup"><X size={16} /></button>
        </div>
        {d ? (
          <>
            <div className="row" style={{ gap: 18, alignItems: 'flex-start' }}>
              <Ring value={d.overall} size={96} stroke={9} color={scoreTone(d.overall)} label={<div className="ring-num" style={{ fontSize: 30 }}>{d.overall}</div>} />
              <div className="grow">
                <span className={`pill ${DECISION[d.decision][1]}`}>{DECISION[d.decision][0]}</span>
                <div style={{ fontWeight: 650, fontSize: 16, marginTop: 8 }}>{d.headline}</div>
                <div className="small muted" style={{ marginTop: 6 }}>{d.summary}</div>
              </div>
            </div>
            {d.progress && <div className="small" style={{ marginTop: 14, padding: '9px 12px', borderRadius: 10, background: 'var(--blue-tint)' }}><b style={{ color: 'var(--blue-2)' }}>Since your last mock: </b>{d.progress}</div>}
          </>
        ) : (
          <div className="row between" style={{ marginTop: 10 }}>
            <span className="small muted">{state.hasKey ? 'No debrief yet for this interview.' : 'Add your Anthropic key in Settings to get the panel’s debrief.'}</span>
            {state.hasKey && <button className="btn sm primary" disabled={busy} onClick={async () => { setBusy(true); await onRetry(); setBusy(false) }}>{busy ? <Spinner size={14} /> : <Sparkles size={14} />} Get the debrief</button>}
          </div>
        )}
      </div>

      {d && (
        <div className="grid g2">
          <div className="card">
            <div className="card-title" style={{ color: 'var(--good)' }}>What landed</div>
            <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 5 }}>{d.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
          <div className="card">
            <div className="card-title" style={{ color: 'var(--gold-2)' }}>Patterns across your answers</div>
            <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 5 }}>{d.themes.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        </div>
      )}

      {d && (
        <div className="card">
          <div className="card-title">How you came across</div>
          <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
            {d.presence.comesAcrossAs.map((w) => <span key={w} className="pill violet" style={{ textTransform: 'capitalize' }}>{w}</span>)}
            <span className={`pill ${d.presence.nerves === 'calm' ? 'good' : d.presence.nerves === 'some' ? 'gold' : 'bad'}`}>{d.presence.nerves === 'calm' ? 'Calm' : d.presence.nerves === 'some' ? 'Some nerves showing' : 'Nerves took over'}</span>
            <span className={`pill ${d.presence.energy === 'flat' ? 'gold' : 'good'}`}>{d.presence.energy === 'flat' ? 'Flat energy' : d.presence.energy === 'animated' ? 'Animated' : 'Steady energy'}</span>
          </div>
          <div className="small">{d.presence.read}</div>
          <div className="small" style={{ marginTop: 8 }}><b>Across the interview: </b>{d.presence.arc}</div>
          <div className="small" style={{ marginTop: 8 }}><b style={{ color: 'var(--gold-2)' }}>Try: </b>{d.presence.fix}</div>
        </div>
      )}

      <div className="card">
        <div className="card-title">Answer by answer <span className="sub">{s.turns.length}</span></div>
        <div className="stack" style={{ gap: 10 }}>
          {s.turns.map((t, i) => <TurnRow key={t.id} s={s} t={t} n={i + 1} review={d?.answers.find((a) => a.turn === i + 1)} onPractise={onPractise} />)}
        </div>
      </div>

      {d && (
        <div className="card tight" style={{ background: 'var(--gold-tint)', borderColor: 'rgba(245,181,68,0.3)' }}>
          <b style={{ color: 'var(--gold-2)' }}>Before your next mock</b>
          <ol className="small" style={{ margin: '8px 0 0', paddingLeft: 20, display: 'grid', gap: 4 }}>{d.plan.map((p, i) => <li key={i}>{p}</li>)}</ol>
          <div style={{ marginTop: 10, fontStyle: 'italic', color: 'var(--text-2)' }}>{d.belief}</div>
        </div>
      )}
    </>
  )
}

function TurnRow({ s, t, n, review, onPractise }: { s: MockSession; t: MockTurn; n: number; review?: { score: number; verdict: string; bestLine: string; fix: string }; onPractise: (qid: string) => void }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { if (open && !url) call<string | null>('mock:mediaUrl', s.id, t.id).then(setUrl).catch(() => setUrl(null)) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ borderLeft: `3px solid ${review ? scoreTone(review.score) : 'var(--line-2)'}`, paddingLeft: 12 }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <div className="tiny muted">{n}. {t.kind === 'followup' ? 'Follow-up' : 'Question'} · {Math.round(t.metrics.durationSec)}s · {t.metrics.wpm} wpm</div>
          <div style={{ fontWeight: 650, marginTop: 2 }}>{t.question}</div>
          {review && <div className="small" style={{ marginTop: 4 }}>{review.verdict}</div>}
          {review?.bestLine && <div className="small muted" style={{ fontStyle: 'italic', marginTop: 4 }}>Best line: “{review.bestLine}”</div>}
          {review && <div className="small" style={{ marginTop: 4 }}><b style={{ color: 'var(--gold-2)' }}>Fix: </b>{review.fix}</div>}
        </div>
        {review && <b style={{ fontSize: 20, color: scoreTone(review.score), fontFamily: 'var(--display)' }}>{review.score}</b>}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn sm ghost" style={{ paddingLeft: 0 }} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Replay'} answer & transcript</button>
        {t.questionId && <button className="btn sm ghost" onClick={() => onPractise(t.questionId!)}><Mic size={13} /> Practise this one</button>}
      </div>
      {open && (
        <div style={{ marginTop: 6 }}>
          {url && (s.mode === 'video'
            ? <video src={url} controls onLoadedMetadata={fixDuration} style={{ width: '100%', borderRadius: 12, marginBottom: 8 }} />
            : <audio src={url} controls onLoadedMetadata={fixDuration} style={{ width: '100%', marginBottom: 8 }} />)}
          <Markdown text={t.transcript || '_Nothing was recognised._'} />
        </div>
      )}
    </div>
  )
}
