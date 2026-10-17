import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, CircleStop, Mic, Pencil, Play, Plus, SkipForward, Sparkles, Star, Swords, Trash2, UserX, Volume2, X } from 'lucide-react'
import { call, onEvent, useDesk } from '../lib/desk'
import { analyze, decodeTo16k, transcribe } from '../lib/voice'
import { openMedia } from '../lib/media'
import { speak } from '../lib/speak'
import { Markdown, Ring, Sparkline, Spinner, fixDuration, fmtDate, scoreTone } from '../components/ui'
import type { BridgeStory, DojoDebrief, DojoOutcome, DojoRound, DojoSession, Objection } from '../../../shared/types'

type Phase = 'setup' | 'asking' | 'answering' | 'noting' | 'debriefing'
interface Current { kind: DojoRound['kind']; text: string; index: number }
interface Pushback { pushback: string; conceded: boolean; angle: string }

const OUTCOME: Record<DojoOutcome, [string, string]> = {
  held: ['Held — the doubt was answered', 'good'],
  wobbled: ['Wobbled — recovered, but it showed', 'gold'],
  folded: ['Folded — the objection won', 'bad']
}
const PUSHBACKS = [[2, 'Quick spar'], [3, 'Standard'], [4, 'Full pressure']] as const
const tone10 = (n: number): string => scoreTone(n * 10)

export default function Dojo() {
  const { state, patch, run, toast, focus } = useDesk()
  const active = state.applications.filter((a) => a.status !== 'closed')
  const [objectionId, setObjectionId] = useState<string>(
    (focus && state.objections.some((o) => o.id === focus) ? focus : undefined) ?? state.objections[0]?.id ?? ''
  )
  const [appId, setAppId] = useState(active.find((a) => a.status === 'interviewing')?.id ?? active[0]?.id ?? '')
  const [pushbacks, setPushbacks] = useState<number>(3)
  const [mode, setMode] = useState<'audio' | 'video'>('video')
  const [voice, setVoice] = useState(true)
  const [phase, setPhase] = useState<Phase>('setup')
  const [session, setSession] = useState<DojoSession | null>(null)
  const [current, setCurrent] = useState<Current | null>(null)
  const [status, setStatus] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState<number[]>(Array(24).fill(2))
  const [viewId, setViewId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newText, setNewText] = useState('')
  const [newWhy, setNewWhy] = useState('')
  useEffect(() => onEvent('model:progress', (pct) => setStatus(`Downloading the speech model (one time only)… ${pct}%`)), [])

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const framesRef = useRef<string[]>([])
  const answerTimers = useRef<number[]>([])
  const meterTimer = useRef<number | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const sessionRef = useRef<DojoSession | null>(null)
  const endRef = useRef(false)

  const objection = state.objections.find((o) => o.id === objectionId)
  const app = state.applications.find((a) => a.id === appId)
  const history = useMemo(() => [...state.dojo].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [state.dojo])
  const viewing = state.dojo.find((d) => d.id === viewId) ?? null
  const forObjection = useMemo(() => state.bridges.filter((b) => b.objectionId === objectionId), [state.bridges, objectionId])

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

  const saveSession = (s: DojoSession): void => {
    sessionRef.current = s
    setSession(s)
    patch((st) => ({ ...st, dojo: st.dojo.some((d) => d.id === s.id) ? st.dojo.map((d) => (d.id === s.id ? s : d)) : [s, ...st.dojo] }))
  }

  const begin = async (): Promise<void> => {
    if (!objection) { toast('Pick an objection first.', 'error'); return }
    endRef.current = false
    let opened: Awaited<ReturnType<typeof openMedia>>
    try {
      opened = await openMedia(mode === 'video')
    } catch (e) {
      toast((e as Error).message, 'error')
      return
    }
    if (opened.cameraIssue) {
      opened.stream.getTracks().forEach((t) => t.stop())
      setMode('audio')
      toast(`${opened.cameraIssue} Switched to sound only — press Start again to go ahead.`, 'error')
      return
    }
    const s = await run(() => call<DojoSession>('dojo:start', objection.id, appId || null, mode, pushbacks))
    if (!s) { opened.stream.getTracks().forEach((t) => t.stop()); return }
    const stream = opened.stream
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
    saveSession(s)
    setViewId(null)
    ask({ kind: 'opening', text: s.objectionText, index: 0 })
  }

  // The camera preview lives for the whole session, like a video call.
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

  // After every answer the sceptic either pushes again on the same theme or,
  // if the doubt was genuinely answered, concedes and the session ends.
  const nextAfter = async (cur: Current): Promise<void> => {
    const s = sessionRef.current!
    if (endRef.current) { finish(); return }
    const used = s.rounds.filter((r) => r.kind === 'pushback').length
    if (used >= s.maxPushbacks || !state.hasKey) { finish(); return }
    setStatus('The sceptic is weighing that…')
    const next = await call<Pushback | null>('dojo:pushback', s.id).catch((e: Error) => { toast(e.message, 'error'); return null })
    if (endRef.current) { finish(); return }
    if (!next) { finish(); return }
    if (next.conceded) {
      saveSession({ ...sessionRef.current!, concededAt: new Date().toISOString() })
      setCurrent({ kind: 'pushback', text: next.pushback, index: cur.index + 1 })
      setPhase('asking')
      if (voice) await speak(next.pushback)
      else await new Promise((r) => setTimeout(r, 1800))
      finish()
      return
    }
    ask({ kind: 'pushback', text: next.pushback, index: cur.index + 1 })
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
    setStatus(skip ? 'Noting the silence…' : 'Listening back…')
    try {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType })
      const audio = await decodeTo16k(blob)
      let text = ''
      let words: Awaited<ReturnType<typeof transcribe>>['words'] = []
      if (!skip && audio.length >= 16000 * 2) ({ text, words } = await transcribe(audio, setStatus))
      const metrics = analyze(audio, text, words)
      const frames = framesRef.current
      setStatus('Saving the round…')
      const saved = await call<DojoRound>('dojo:round', sessionRef.current!.id, {
        kind: cur.kind, prompt: cur.text, media: await blob.arrayBuffer(), ext: 'webm',
        transcript: text, metrics, frame: frames.length ? frames[Math.floor(frames.length / 2)] : undefined
      })
      const s = sessionRef.current!
      saveSession({ ...s, rounds: [...s.rounds, saved] })
    } catch (e) {
      toast((e as Error).message, 'error')
    }
    nextAfter(cur)
  }

  const finish = async (): Promise<void> => {
    stopEverything()
    setCurrent(null)
    const s = sessionRef.current
    if (!s || !s.rounds.length) {
      if (s) { await call('dojo:remove', s.id).catch(() => undefined); patch((st) => ({ ...st, dojo: st.dojo.filter((d) => d.id !== s.id) })) }
      setPhase('setup')
      return
    }
    setViewId(s.id)
    if (!state.hasKey) { setPhase('setup'); return }
    setPhase('debriefing')
    const d = await run(() => call<DojoSession>('dojo:debrief', s.id))
    if (d) { saveSession(d); await refreshBridges() }
    setPhase('setup')
  }

  // The debrief writes a bridge story into the bank on the main side; pull the
  // fresh list rather than guessing at it.
  const refreshBridges = async (): Promise<void> => {
    const st = await call<{ bridges: BridgeStory[]; dojo: DojoSession[] }>('state:get').catch(() => null)
    if (st) patch((cur) => ({ ...cur, bridges: st.bridges, dojo: st.dojo }))
  }

  const endSession = (): void => {
    endRef.current = true
    if (phase === 'answering') finishAnswer()
    else if (phase === 'asking') window.speechSynthesis?.cancel()
  }

  const addObjection = async (): Promise<void> => {
    const o = await run(() => call<Objection>('objections:add', newText, newWhy), 'Added to your objections.')
    if (!o) return
    patch((st) => ({ ...st, objections: [o, ...st.objections] }))
    setObjectionId(o.id); setAdding(false); setNewText(''); setNewWhy('')
  }
  const removeObjection = async (o: Objection): Promise<void> => {
    if (!window.confirm('Remove this objection from the list? Past sessions on it are kept.')) return
    await run(() => call('objections:remove', o.id))
    patch((st) => ({ ...st, objections: st.objections.filter((x) => x.id !== o.id) }))
    if (objectionId === o.id) setObjectionId(state.objections.find((x) => x.id !== o.id)?.id ?? '')
  }
  const removeSession = async (d: DojoSession): Promise<void> => {
    if (!window.confirm('Delete this sparring session and its recordings? Its bridge story stays in the bank.')) return
    await run(() => call('dojo:remove', d.id))
    patch((st) => ({ ...st, dojo: st.dojo.filter((x) => x.id !== d.id) }))
    if (viewId === d.id) setViewId(null)
  }

  // ---------- Live sparring ----------
  if (phase !== 'setup' && phase !== 'debriefing' && session) {
    const mm = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
    const q = current
    const total = session.maxPushbacks + 1
    return (
      <div className="page" style={{ maxWidth: 1180 }}>
        <div className="row between" style={{ marginBottom: 16 }}>
          <div>
            <div className="eyebrow">Objection Dojo · {session.label}</div>
            <div className="row" style={{ gap: 6 }}>
              {Array.from({ length: total }, (_, i) => (
                <span key={i} className="mock-dot" data-state={q && i < q.index ? 'done' : q && i === q.index ? 'now' : 'todo'} />
              ))}
              <span className="small muted" style={{ marginLeft: 6 }}>
                {q?.kind === 'opening' ? 'The objection' : `Pushback ${q?.index ?? 0} of ${session.maxPushbacks}`}
                {session.concededAt ? ' · conceded' : ''}
              </span>
            </div>
          </div>
          <button className="btn ghost sm danger" onClick={endSession} disabled={phase === 'noting' && endRef.current}><X size={14} /> End session</button>
        </div>

        <div className="card dojo-sceptic" data-conceded={session.concededAt || undefined}>
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <span className="avatar" style={{ width: 40, height: 40, background: 'linear-gradient(135deg, #f87171, #c2410c)' }}><UserX size={19} /></span>
            <div className="grow">
              <div className="stat-label">{session.concededAt ? 'The sceptic concedes' : q?.kind === 'opening' ? 'The hiring manager says' : 'The hiring manager pushes back'}</div>
              <div style={{ fontSize: 21, fontWeight: 650, lineHeight: 1.35, marginTop: 4, fontFamily: 'var(--display)' }}>{q?.text ?? '…'}</div>
            </div>
            {phase === 'asking' && voice && <Volume2 size={18} color="var(--bad)" className="pulse" />}
          </div>
        </div>

        <div className="recorder" style={{ marginTop: 14 }}>
          {mode === 'video' ? <video ref={videoRef} muted playsInline /> : (
            <div style={{ textAlign: 'center' }}><Mic size={42} color="var(--muted)" /><div className="small muted" style={{ marginTop: 8 }}>Sound-only session</div></div>
          )}
          {(phase === 'asking' || phase === 'noting') && (
            <div className="mock-overlay">
              {phase === 'asking' ? <><Volume2 size={16} /> {voice ? 'Listen…' : 'Get ready…'}</> : <><Spinner size={16} /> {status || 'Listening back…'}</>}
            </div>
          )}
          {phase === 'answering' && (
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14px 18px', background: 'linear-gradient(transparent, rgba(0,0,0,0.75))' }} className="row between">
              <div className="row"><span className="rec-dot" /><b style={{ fontVariantNumeric: 'tabular-nums', color: elapsed > 90 ? 'var(--bad)' : '#fff' }}>{mm}</b>
                {elapsed > 90 && <span className="pill bad">Too long — land it</span>}</div>
              <div className="meter">{levels.map((h, i) => <i key={i} style={{ height: h }} />)}</div>
              <div className="row">
                <button className="btn sm ghost" style={{ color: '#fff' }} onClick={() => finishAnswer(true)} title="Say nothing"><SkipForward size={14} /> Skip</button>
                <button className="btn primary" onClick={() => finishAnswer()}><CircleStop size={16} /> Done</button>
              </div>
            </div>
          )}
        </div>
        <div className="small muted" style={{ marginTop: 10 }}>
          Name the gap before they do, then prove what transfers: your own numbers, their buyers, their motion. 45–90 seconds. They won’t soften until you’re specific.
        </div>
      </div>
    )
  }

  // ---------- Setup, debrief and the bank ----------
  const scored = history.filter((d) => d.debrief).reverse()
  const custom = (o: Objection): boolean => !o.builtIn
  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Objection Dojo</div>
          <div className="page-title">Spar with the doubt that costs you offers.</div>
          <div className="page-sub">One objection, one sceptical hiring manager who keeps pushing on it, and a scorecard for the thing a mock interview doesn’t measure: turning SHL proof into platform language.</div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <div className="stack" style={{ gap: 16 }}>
          {phase === 'debriefing' ? (
            <div className="card" style={{ textAlign: 'center', padding: 40 }}>
              <Spinner size={30} />
              <div style={{ fontWeight: 650, marginTop: 14 }}>Scoring the exchange and distilling your bridge story…</div>
              <div className="small muted" style={{ marginTop: 4 }}>Usually under a minute.</div>
            </div>
          ) : viewing ? (
            <Debrief s={viewing} onClose={() => setViewId(null)}
              onRetry={async () => { const d = await run(() => call<DojoSession>('dojo:debrief', viewing.id)); if (d) { saveSession(d); await refreshBridges() } }}
              onAgain={() => { setObjectionId(viewing.objectionId); if (viewing.applicationId) setAppId(viewing.applicationId); setViewId(null) }} />
          ) : (
            <>
              <div className="card">
                <div className="card-title"><Swords size={17} color="var(--bad)" /> Pick the objection
                  <span className="sub"><button className="btn sm ghost" onClick={() => setAdding(!adding)}><Plus size={13} /> Add your own</button></span>
                </div>
                {adding && (
                  <div className="stack" style={{ gap: 8, marginBottom: 12, padding: 12, borderRadius: 12, background: 'var(--bg-2)' }}>
                    <label className="field">What they’d actually say
                      <textarea rows={2} value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="e.g. Your whole career is one vendor. How do we know you can sell something you didn’t grow up with?" />
                    </label>
                    <label className="field">The doubt underneath it <span className="hint">(optional — helps the sceptic push on the right thing)</span>
                      <input value={newWhy} onChange={(e) => setNewWhy(e.target.value)} placeholder="e.g. Adaptability and learning speed outside a known playbook" />
                    </label>
                    <div className="row"><button className="btn sm primary" onClick={addObjection} disabled={newText.trim().length < 10}>Add</button><button className="btn sm ghost" onClick={() => setAdding(false)}>Cancel</button></div>
                  </div>
                )}
                <div className="list">
                  {state.objections.map((o) => {
                    const on = o.id === objectionId
                    const sessions = state.dojo.filter((d) => d.objectionId === o.id && d.debrief)
                    const best = sessions.length ? Math.max(...sessions.map((d) => d.debrief!.overall)) : null
                    const stories = state.bridges.filter((b) => b.objectionId === o.id).length
                    return (
                      <div key={o.id} className="item clickable objection" data-on={on || undefined} onClick={() => setObjectionId(o.id)}>
                        <div className="grow">
                          <div style={{ fontWeight: 600, lineHeight: 1.4 }}>“{o.text}”</div>
                          {on && o.why && <div className="small muted" style={{ marginTop: 6 }}><b style={{ color: 'var(--text-2)' }}>Underneath it: </b>{o.why}</div>}
                          <div className="row wrap tiny muted" style={{ gap: 8, marginTop: 6 }}>
                            {best != null ? <span className="pill" style={{ color: scoreTone(best) }}>best {best}</span> : <span className="pill">not yet sparred</span>}
                            {sessions.length > 0 && <span>{sessions.length} session{sessions.length === 1 ? '' : 's'}</span>}
                            {stories > 0 && <span>{stories} bridge stor{stories === 1 ? 'y' : 'ies'}</span>}
                          </div>
                        </div>
                        {custom(o) && <button className="icon-btn" title="Remove" onClick={(e) => { e.stopPropagation(); removeObjection(o) }}><Trash2 size={14} /></button>}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="card">
                <div className="card-title"><UserX size={17} color="var(--bad)" /> Who’s doubting you</div>
                <div className="stack" style={{ gap: 14 }}>
                  <label className="field">The hiring manager at
                    <select value={appId} onChange={(e) => setAppId(e.target.value)}>
                      <option value="">An AI-first platform company (generic)</option>
                      {active.map((a) => <option key={a.id} value={a.id}>{a.company} — {a.role}{a.status === 'interviewing' ? ' · interviewing' : ''}</option>)}
                    </select>
                  </label>
                  {app && !app.jd && <div className="small muted">No job description saved for {app.company} — the sceptic will push from the title and company. Fetch the JD on the Applications page to sharpen it.</div>}
                  <div className="row wrap" style={{ gap: 18 }}>
                    <div>
                      <div className="stat-label" style={{ marginBottom: 6 }}>How hard</div>
                      <div className="tabs">{PUSHBACKS.map(([n, t]) => <button key={n} className={`tab ${pushbacks === n ? 'on' : ''}`} onClick={() => setPushbacks(n)}>{t} · {n} pushbacks</button>)}</div>
                    </div>
                    <div>
                      <div className="stat-label" style={{ marginBottom: 6 }}>Format</div>
                      <div className="tabs">
                        <button className={`tab ${mode === 'video' ? 'on' : ''}`} onClick={() => setMode('video')}><Camera size={13} /> Video call</button>
                        <button className={`tab ${mode === 'audio' ? 'on' : ''}`} onClick={() => setMode('audio')}><Mic size={13} /> Phone screen</button>
                      </div>
                    </div>
                  </div>
                  <label className="check"><input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> Read the sceptic’s lines aloud</label>
                  {forObjection.length > 0 && (
                    <div className="small" style={{ padding: '9px 12px', borderRadius: 10, background: 'var(--gold-tint)' }}>
                      <b style={{ color: 'var(--gold-2)' }}>You have {forObjection.length} bridge stor{forObjection.length === 1 ? 'y' : 'ies'} for this one. </b>
                      Read {forObjection.length === 1 ? 'it' : 'them'} once on the right, then put {forObjection.length === 1 ? 'it' : 'them'} away — the point is to land {forObjection.length === 1 ? 'it' : 'them'} under pressure, not read {forObjection.length === 1 ? 'it' : 'them'}.
                    </div>
                  )}
                  <div className="small muted">
                    {state.hasKey
                      ? 'Recordings and transcripts stay on this PC. AI cost is roughly $0.15–0.30: a few short pushbacks and one debrief.'
                      : 'Add your Anthropic key in Settings for the sceptic’s pushbacks and the debrief. Without it you get the opening objection only.'}
                  </div>
                  <div><button className="btn gold lg" onClick={begin} disabled={!objection}><Play size={17} /> Start sparring</button></div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <BridgeBank selectedObjectionId={objectionId} />
          {scored.length >= 2 && (
            <div className="card">
              <div className="card-title">Dojo trend <span className="sub">{scored.length} scored</span></div>
              <Sparkline values={scored.map((d) => d.debrief!.overall)} />
            </div>
          )}
          <div className="card">
            <div className="card-title">Past sessions <span className="sub">{history.length}</span></div>
            {history.length ? (
              <div className="list">
                {history.map((d) => (
                  <div key={d.id} className="item clickable" style={{ borderColor: d.id === viewId ? 'var(--blue)' : undefined }} onClick={() => setViewId(d.id)}>
                    <div className="grow">
                      <div style={{ fontWeight: 650 }} className="ellipsis">“{d.objectionText}”</div>
                      <div className="tiny muted">{fmtDate(d.createdAt)} · {d.label} · {d.rounds.length} round{d.rounds.length === 1 ? '' : 's'}{d.concededAt ? ' · they conceded' : ''}</div>
                    </div>
                    {d.debrief
                      ? <><span className={`pill ${OUTCOME[d.debrief.outcome][1]}`}>{d.debrief.outcome}</span><b style={{ color: scoreTone(d.debrief.overall) }}>{d.debrief.overall}</b></>
                      : <span className="pill">No debrief</span>}
                    <button className="icon-btn" title="Delete" onClick={(e) => { e.stopPropagation(); removeSession(d) }}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            ) : <div className="muted small">Each sparring session lands here with its score and the sceptic’s verdict.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- Debrief ----------

function Debrief({ s, onClose, onRetry, onAgain }: { s: DojoSession; onClose: () => void; onRetry: () => Promise<void>; onAgain: () => void }) {
  const { state } = useDesk()
  const [busy, setBusy] = useState(false)
  const d = s.debrief
  const story = s.bridgeStoryId ? state.bridges.find((b) => b.id === s.bridgeStoryId) : undefined
  return (
    <>
      <div className="card">
        <div className="row between" style={{ marginBottom: d ? 14 : 0 }}>
          <div>
            <div className="eyebrow" style={{ margin: 0 }}>Debrief · {fmtDate(s.createdAt)} · {s.label}</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginTop: 4, lineHeight: 1.4 }}>“{s.objectionText}”</div>
          </div>
          <button className="icon-btn" onClick={onClose} title="Back"><X size={16} /></button>
        </div>
        {d ? (
          <>
            <div className="row" style={{ gap: 18, alignItems: 'flex-start' }}>
              <Ring value={d.overall} size={96} stroke={9} color={scoreTone(d.overall)} label={<div className="ring-num" style={{ fontSize: 30 }}>{d.overall}</div>} />
              <div className="grow">
                <span className={`pill ${OUTCOME[d.outcome][1]}`}>{OUTCOME[d.outcome][0]}</span>
                <div style={{ fontWeight: 650, fontSize: 16, marginTop: 8 }}>{d.headline}</div>
                <div className="small muted" style={{ marginTop: 6 }}>{d.summary}</div>
              </div>
            </div>
            {d.progress && <div className="small" style={{ marginTop: 14, padding: '9px 12px', borderRadius: 10, background: 'var(--blue-tint)' }}><b style={{ color: 'var(--blue-2)' }}>Since last time on this objection: </b>{d.progress}</div>}
          </>
        ) : (
          <div className="row between" style={{ marginTop: 10 }}>
            <span className="small muted">{state.hasKey ? 'No debrief yet for this session.' : 'Add your Anthropic key in Settings to get the debrief.'}</span>
            {state.hasKey && <button className="btn sm primary" disabled={busy} onClick={async () => { setBusy(true); await onRetry(); setBusy(false) }}>{busy ? <Spinner size={14} /> : <Sparkles size={14} />} Get the debrief</button>}
          </div>
        )}
      </div>

      {d && (
        <div className="card">
          <div className="card-title">The Dojo scorecard</div>
          <div className="stack" style={{ gap: 12 }}>
            {([['translation', 'Translation', 'SHL proof in their language'], ['quantification', 'Numbers', 'Scope, results, your own part'], ['stance', 'Stance', 'Leader framing it vs defensive IC']] as const).map(([k, label, sub]) => (
              <div key={k} className="dojo-score">
                <div>
                  <div style={{ fontWeight: 650 }}>{label} <span className="tiny muted" style={{ fontWeight: 500 }}>{sub}</span></div>
                  <div className="small muted" style={{ marginTop: 2 }}>{d.scoreNotes[k]}</div>
                </div>
                <b style={{ fontSize: 24, color: tone10(d.scores[k]), fontFamily: 'var(--display)' }}>{d.scores[k]}<span className="tiny muted" style={{ fontWeight: 500 }}>/10</span></b>
              </div>
            ))}
          </div>
        </div>
      )}

      {story && (
        <div className="card" style={{ borderColor: 'rgba(245,181,68,0.35)' }}>
          <div className="card-title" style={{ color: 'var(--gold-2)' }}><Sparkles size={16} /> Your bridge story from this session <span className="sub">saved to the bank — edit it there</span></div>
          <StoryBody b={story} />
        </div>
      )}

      {d && d.tells.length > 0 && (
        <div className="card">
          <div className="card-title" style={{ color: 'var(--bad)' }}>Defensive tells</div>
          <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 5 }}>{d.tells.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}

      <div className="card">
        <div className="card-title">Round by round <span className="sub">{s.rounds.length}</span></div>
        <div className="stack" style={{ gap: 10 }}>
          {s.rounds.map((r, i) => <RoundRow key={r.id} s={s} r={r} n={i + 1} review={d?.rounds.find((x) => x.round === i + 1)} />)}
        </div>
      </div>

      {d && (
        <div className="card tight" style={{ background: 'var(--gold-tint)', borderColor: 'rgba(245,181,68,0.3)' }}>
          <b style={{ color: 'var(--gold-2)' }}>Drill before you spar this again</b>
          <div className="small" style={{ marginTop: 6 }}>{d.drill}</div>
          <div style={{ marginTop: 10, fontStyle: 'italic', color: 'var(--text-2)' }}>{d.belief}</div>
          <div style={{ marginTop: 12 }}><button className="btn sm" onClick={onAgain}><Swords size={13} /> Spar this objection again</button></div>
        </div>
      )}
    </>
  )
}

function RoundRow({ s, r, n, review }: { s: DojoSession; r: DojoRound; n: number; review?: DojoDebrief['rounds'][number] }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { if (open && !url) call<string | null>('dojo:mediaUrl', s.id, r.id).then(setUrl).catch(() => setUrl(null)) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ borderLeft: `3px solid ${r.kind === 'opening' ? 'var(--bad)' : 'var(--gold)'}`, paddingLeft: 12 }}>
      <div className="tiny muted">{n}. {r.kind === 'opening' ? 'The objection' : 'Pushback'} · {Math.round(r.metrics.durationSec)}s · {r.metrics.wpm} wpm · {r.metrics.hedgeCount} hedges</div>
      <div style={{ fontWeight: 650, marginTop: 2, color: 'var(--text-2)' }}>“{r.prompt}”</div>
      {review && <div className="small" style={{ marginTop: 4 }}>{review.verdict}</div>}
      {review?.bestLine && <div className="small muted" style={{ fontStyle: 'italic', marginTop: 4 }}>Best line: “{review.bestLine}”</div>}
      {review && <div className="small" style={{ marginTop: 4 }}><b style={{ color: 'var(--gold-2)' }}>Fix: </b>{review.fix}</div>}
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn sm ghost" style={{ paddingLeft: 0 }} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Replay'} answer & transcript</button>
      </div>
      {open && (
        <div style={{ marginTop: 6 }}>
          {url && (s.mode === 'video'
            ? <video src={url} controls onLoadedMetadata={fixDuration} style={{ width: '100%', borderRadius: 12, marginBottom: 8 }} />
            : <audio src={url} controls onLoadedMetadata={fixDuration} style={{ width: '100%', marginBottom: 8 }} />)}
          <Markdown text={r.transcript || '_Nothing was recognised._'} />
        </div>
      )}
    </div>
  )
}

// ---------- Bridge Stories bank ----------

function StoryBody({ b }: { b: BridgeStory }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="small"><b style={{ color: 'var(--text-2)' }}>The proof: </b>{b.proof || <span className="muted">—</span>}</div>
      <div className="small"><b style={{ color: 'var(--text-2)' }}>In their language: </b>{b.translation || <span className="muted">—</span>}</div>
      <div className="small" style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--bg-2)', fontStyle: 'italic' }}>{b.landing ? `“${b.landing}”` : <span className="muted">No landing line yet.</span>}</div>
    </div>
  )
}

function BridgeBank({ selectedObjectionId }: { selectedObjectionId: string }) {
  const { state, patch, run } = useDesk()
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<BridgeStory | null>(null)
  const stories = useMemo(() => [...state.bridges].sort((a, b) =>
    Number(b.objectionId === selectedObjectionId) - Number(a.objectionId === selectedObjectionId) ||
    Number(!!b.starred) - Number(!!a.starred) || b.updatedAt.localeCompare(a.updatedAt)
  ), [state.bridges, selectedObjectionId])

  const save = async (b: BridgeStory): Promise<void> => {
    const saved = await run(() => call<BridgeStory>('bridges:save', b), 'Bridge story saved.')
    if (!saved) return
    patch((st) => ({ ...st, bridges: st.bridges.some((x) => x.id === saved.id) ? st.bridges.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...st.bridges] }))
    setEditing(null)
  }
  const star = async (b: BridgeStory): Promise<void> => {
    const saved = await run(() => call<BridgeStory>('bridges:save', { ...b, starred: !b.starred }))
    if (saved) patch((st) => ({ ...st, bridges: st.bridges.map((x) => (x.id === saved.id ? saved : x)) }))
  }
  const remove = async (b: BridgeStory): Promise<void> => {
    if (!window.confirm('Delete this bridge story?')) return
    await run(() => call('bridges:remove', b.id))
    patch((st) => ({ ...st, bridges: st.bridges.filter((x) => x.id !== b.id) }))
    if (openId === b.id) setOpenId(null)
  }
  const add = async (): Promise<void> => {
    const b = await run(() => call<BridgeStory>('bridges:add', selectedObjectionId || null))
    if (!b) return
    patch((st) => ({ ...st, bridges: [b, ...st.bridges] }))
    setOpenId(b.id); setEditing(b)
  }

  return (
    <div className="card">
      <div className="card-title"><Sparkles size={16} color="var(--gold)" /> Bridge Stories
        <span className="sub">{state.bridges.length} · <button className="btn sm ghost" style={{ padding: '2px 6px' }} onClick={add}><Plus size={12} /> Write one</button></span>
      </div>
      {stories.length ? (
        <div className="list">
          {stories.map((b) => {
            const open = openId === b.id
            const mine = b.objectionId === selectedObjectionId
            return (
              <div key={b.id} className="item bridge" data-on={mine || undefined} style={{ display: 'block' }}>
                <div className="row" style={{ alignItems: 'flex-start', cursor: 'pointer' }} onClick={() => setOpenId(open ? null : b.id)}>
                  <div className="grow">
                    <div style={{ fontWeight: 650 }}>{b.starred && <Star size={12} fill="var(--gold)" color="var(--gold)" style={{ marginRight: 5, verticalAlign: -1 }} />}{b.title}</div>
                    <div className="tiny muted ellipsis" style={{ marginTop: 2 }}>answers: “{b.objectionText}”</div>
                    {!open && b.landing && <div className="small" style={{ marginTop: 4, fontStyle: 'italic', color: 'var(--text-2)' }}>“{b.landing}”</div>}
                  </div>
                  <button className="icon-btn" title={b.starred ? 'Unstar' : 'Star — the coach leads with starred stories'} onClick={(e) => { e.stopPropagation(); star(b) }}><Star size={14} fill={b.starred ? 'var(--gold)' : 'none'} color={b.starred ? 'var(--gold)' : undefined} /></button>
                </div>
                {open && (editing?.id === b.id ? (
                  <div className="stack" style={{ gap: 8, marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                    <label className="field">Title<input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></label>
                    <label className="field">The proof <span className="hint">— the SHL fact, with numbers</span><textarea rows={3} value={editing.proof} onChange={(e) => setEditing({ ...editing, proof: e.target.value })} /></label>
                    <label className="field">In their language <span className="hint">— as a platform seller would say it</span><textarea rows={3} value={editing.translation} onChange={(e) => setEditing({ ...editing, translation: e.target.value })} /></label>
                    <label className="field">Landing line <span className="hint">— the one sentence you say out loud</span><textarea rows={2} value={editing.landing} onChange={(e) => setEditing({ ...editing, landing: e.target.value })} /></label>
                    <div className="row"><button className="btn sm primary" onClick={() => save(editing)}>Save</button><button className="btn sm ghost" onClick={() => setEditing(null)}>Cancel</button></div>
                  </div>
                ) : (
                  <div style={{ marginTop: 10 }}>
                    <StoryBody b={b} />
                    <div className="row" style={{ marginTop: 8 }}>
                      <button className="btn sm ghost" style={{ paddingLeft: 0 }} onClick={() => setEditing(b)}><Pencil size={13} /> Edit</button>
                      <button className="btn sm ghost danger" onClick={() => remove(b)}><Trash2 size={13} /> Delete</button>
                      <span className="tiny muted" style={{ marginLeft: 'auto' }}>{fmtDate(b.updatedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="muted small">Every sparring session distils one reusable story here: the SHL proof, the same thing in platform language, and the line that lands it. Starred stories are the ones your coach leads with.</div>
      )}
    </div>
  )
}
