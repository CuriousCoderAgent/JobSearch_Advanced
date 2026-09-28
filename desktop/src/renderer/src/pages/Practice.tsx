import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, CircleStop, Eye, EyeOff, Mic, RotateCcw, Shuffle, Sparkles, Trash2 } from 'lucide-react'
import { call, onEvent, useDesk } from '../lib/desk'
import { analyze, decodeTo16k, transcribe } from '../lib/voice'
import { Bar, Empty, Markdown, Ring, Spinner, fmtDate, scoreTone } from '../components/ui'
import type { PracticeAttempt, Question } from '../../../shared/types'

type Phase = 'idle' | 'recording' | 'processing' | 'done'

export default function Practice() {
  const { state, patch, run, focus, toast } = useDesk()
  const initial = focus && state.questions.some((q) => q.id === focus) ? focus : (state.questions.find((q) => q.myAnswer) ?? state.questions[0])?.id
  const [qid, setQid] = useState<string | undefined>(initial)
  const [mode, setMode] = useState<'audio' | 'video'>('video')
  const [phase, setPhase] = useState<Phase>('idle')
  const [status, setStatus] = useState('')
  useEffect(() => onEvent('model:progress', (pct) => setStatus(`Downloading the speech model (one time only)… ${pct}%`)), [])
  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState<number[]>(Array(24).fill(2))
  const [peek, setPeek] = useState(false)
  const [viewId, setViewId] = useState<string | null>(null)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const framesRef = useRef<string[]>([])
  const timers = useRef<number[]>([])

  const q = state.questions.find((x) => x.id === qid)
  const attempts = useMemo(() => state.practice.filter((p) => p.questionId === qid).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [state.practice, qid])
  const viewing = state.practice.find((p) => p.id === viewId) ?? null

  const stopStream = (): void => {
    timers.current.forEach((t) => clearInterval(t)); timers.current = []
    streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null
  }
  useEffect(() => stopStream, [])
  useEffect(() => { setViewId(null); setPhase('idle'); setPeek(false) }, [qid])
  useEffect(() => {
    setMediaUrl(null)
    if (viewing) call<string | null>('practice:mediaUrl', viewing.id).then(setMediaUrl).catch(() => setMediaUrl(null))
  }, [viewing?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const start = async (): Promise<void> => {
    if (!q) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: mode === 'video' ? { width: 1280, height: 720 } : false })
      streamRef.current = stream
      if (videoRef.current && mode === 'video') { videoRef.current.srcObject = stream; await videoRef.current.play() }
      chunksRef.current = []; framesRef.current = []
      const mime = mode === 'video'
        ? (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm')
        : 'audio/webm;codecs=opus'
      const rec = new MediaRecorder(stream, { mimeType: mime })
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
      rec.start(1000)
      recRef.current = rec

      // Live level meter.
      const ctx = new AudioContext()
      const an = ctx.createAnalyser(); an.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(an)
      const data = new Uint8Array(an.frequencyBinCount)
      timers.current.push(window.setInterval(() => {
        an.getByteTimeDomainData(data)
        let peak = 0
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128))
        setLevels((l) => [...l.slice(1), Math.max(2, Math.min(34, peak / 2.2))])
      }, 80))
      // Snapshot a frame every 8 seconds for body-language feedback.
      if (mode === 'video') {
        const grab = (): void => {
          const v = videoRef.current
          if (!v || !v.videoWidth) return
          const c = document.createElement('canvas')
          c.width = 640; c.height = Math.round((640 * v.videoHeight) / v.videoWidth)
          c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
          framesRef.current.push(c.toDataURL('image/jpeg', 0.72).split(',')[1])
        }
        timers.current.push(window.setTimeout(grab, 2500))
        timers.current.push(window.setInterval(grab, 8000))
      }
      const t0 = Date.now()
      setElapsed(0)
      timers.current.push(window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 250))
      setViewId(null)
      setPhase('recording')
    } catch (e) {
      toast(`Couldn’t start the ${mode === 'video' ? 'camera/microphone' : 'microphone'}: ${(e as Error).message}. Check Windows privacy settings for camera and microphone.`, 'error')
      stopStream()
    }
  }

  const stop = async (): Promise<void> => {
    const rec = recRef.current
    if (!rec || !q) return
    const done = new Promise<void>((r) => { rec.onstop = () => r() })
    rec.stop()
    await done
    stopStream()
    setPhase('processing')
    const blob = new Blob(chunksRef.current, { type: rec.mimeType })
    try {
      setStatus('Preparing audio…')
      const audio = await decodeTo16k(blob)
      if (audio.length < 16000 * 3) throw new Error('That recording was under 3 seconds — try again.')
      const { text, words } = await transcribe(audio, setStatus)
      const metrics = analyze(audio, text, words)
      setStatus(state.hasKey ? 'Your coach is reviewing the answer…' : 'Saving…')
      const frames = framesRef.current
      const pick = frames.length > 6 ? Array.from({ length: 6 }, (_, i) => frames[Math.floor((i * frames.length) / 6)]) : frames
      let attempt: PracticeAttempt | undefined
      try {
        attempt = await call<PracticeAttempt>('practice:save', {
          questionId: q.id, mode, media: await blob.arrayBuffer(), ext: 'webm', transcript: text, words, metrics, frames: pick
        })
      } catch (err) {
        toast((err as Error).message, 'error')
      }
      if (attempt) {
        const a = attempt
        const fe = (attempt as PracticeAttempt & { feedbackError?: string }).feedbackError
        if (fe) toast(`Recording saved, but the coach review failed: ${fe}`, 'error')
        patch((s) => ({
          ...s,
          practice: [...s.practice.filter((p) => p.id !== a.id), a],
          questions: s.questions.map((x) => (x.id === q.id ? { ...x, attempts: x.attempts + 1, bestScore: a.feedback ? Math.max(a.feedback.overall, x.bestScore ?? 0) : x.bestScore } : x)),
          week: { ...s.week, practice: s.week.practice + 1 }
        }))
        setViewId(a.id)
      }
      setPhase('done')
    } catch (e) {
      toast((e as Error).message, 'error')
      setPhase('idle')
    }
    setStatus('')
  }

  const shuffle = (): void => {
    const pool = state.questions.filter((x) => x.id !== qid)
    if (pool.length) setQid(pool[Math.floor(Math.random() * pool.length)].id)
  }
  const retryFeedback = async (a: PracticeAttempt): Promise<void> => {
    const updated = await run(() => call<PracticeAttempt>('practice:retryFeedback', a.id), 'Feedback ready.')
    if (updated) patch((s) => ({ ...s, practice: s.practice.map((p) => (p.id === updated.id ? updated : p)) }))
  }
  const removeAttempt = async (a: PracticeAttempt): Promise<void> => {
    if (!window.confirm('Delete this recording and its feedback?')) return
    await run(() => call('practice:remove', a.id))
    patch((s) => ({ ...s, practice: s.practice.filter((p) => p.id !== a.id) }))
    setViewId(null)
  }

  if (!state.questions.length) return <div className="page"><Empty title="No questions yet" /></div>
  const mm = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Practice studio</div>
          <div className="page-title">Say it out loud. Get coached.</div>
          <div className="page-sub">Transcribed privately on your PC. Your coach scores structure, substance, presence and delivery — like a VP panel would.</div>
        </div>
        <div className="tabs">
          <button className={`tab ${mode === 'video' ? 'on' : ''}`} disabled={phase === 'recording'} onClick={() => setMode('video')}><Camera size={13} /> Video</button>
          <button className={`tab ${mode === 'audio' ? 'on' : ''}`} disabled={phase === 'recording'} onClick={() => setMode('audio')}><Mic size={13} /> Audio only</button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.25fr 1fr', gap: 16, alignItems: 'start' }}>
        <div className="stack" style={{ gap: 16 }}>
          <div className="card">
            <div className="row">
              <select value={qid} onChange={(e) => setQid(e.target.value)} disabled={phase === 'recording'}>
                {[...new Set(state.questions.map((x) => x.category))].map((cat) => (
                  <optgroup key={cat} label={cat}>
                    {state.questions.filter((x) => x.category === cat).map((x) => <option key={x.id} value={x.id}>{x.text}</option>)}
                  </optgroup>
                ))}
              </select>
              <button className="btn" onClick={shuffle} disabled={phase === 'recording'} title="Surprise me"><Shuffle size={15} /></button>
            </div>
            {q && (
              <>
                <h2 style={{ fontSize: 22, margin: '16px 0 6px', lineHeight: 1.3 }}>{q.text}</h2>
                {q.why && <div className="small muted">{q.why}</div>}
                {q.myAnswer && (
                  <div style={{ marginTop: 12 }}>
                    <button className="btn sm ghost" style={{ paddingLeft: 0 }} onClick={() => setPeek(!peek)}>{peek ? <EyeOff size={14} /> : <Eye size={14} />} {peek ? 'Hide' : 'Peek at'} my prepared answer</button>
                    {peek && <div className="small" style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 10, padding: 12, marginTop: 6, whiteSpace: 'pre-wrap' }}>{q.myAnswer}</div>}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="recorder">
            {mode === 'video' && <video ref={videoRef} muted playsInline style={{ display: phase === 'recording' ? 'block' : 'none' }} />}
            {phase !== 'recording' && (
              <div style={{ textAlign: 'center', padding: 20 }}>
                {phase === 'processing'
                  ? <><Spinner size={30} /><div style={{ marginTop: 14, fontWeight: 600 }}>{status}</div></>
                  : <><div style={{ fontSize: 15, color: 'var(--text-2)', marginBottom: 16 }}>Aim for 60–120 seconds. Look at the camera, slow down, land the number.</div>
                    <button className="btn gold lg" onClick={start}>{mode === 'video' ? <Camera size={18} /> : <Mic size={18} />} Start recording</button></>}
              </div>
            )}
            {phase === 'recording' && (
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14px 18px', background: 'linear-gradient(transparent, rgba(0,0,0,0.75))' }} className="row between">
                <div className="row"><span className="rec-dot" /><b style={{ fontVariantNumeric: 'tabular-nums', color: elapsed > 150 ? 'var(--bad)' : '#fff' }}>{mm}</b>
                  {elapsed > 150 && <span className="pill bad">Wrap it up</span>}</div>
                <div className="meter">{levels.map((h, i) => <i key={i} style={{ height: h }} />)}</div>
                <button className="btn primary" onClick={stop}><CircleStop size={16} /> Stop & get feedback</button>
              </div>
            )}
          </div>

          {attempts.length > 0 && (
            <div className="card">
              <div className="card-title">Your attempts at this question <span className="sub">{attempts.length}</span></div>
              <div className="row wrap" style={{ gap: 8 }}>
                {attempts.map((a) => (
                  <button key={a.id} className="item clickable" style={{ padding: '8px 12px', borderColor: a.id === viewId ? 'var(--blue)' : undefined, font: 'inherit', color: 'inherit' }} onClick={() => setViewId(a.id)}>
                    <b style={{ color: a.feedback ? scoreTone(a.feedback.overall) : 'var(--muted)' }}>{a.feedback?.overall ?? '—'}</b>
                    <span className="small muted">{fmtDate(a.createdAt)} · {a.mode}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="stack" style={{ gap: 16 }}>
          {viewing ? <Feedback a={viewing} mediaUrl={mediaUrl} onRetry={() => retryFeedback(viewing)} onDelete={() => removeAttempt(viewing)} onAgain={start} hasKey={state.hasKey} />
            : <Empty title="Record an answer to get coached">You’ll get an overall score, a dimension-by-dimension breakdown, the exact phrases to fix, and a “power answer” showing how to say it.</Empty>}
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className="card tight">
      <div className="stat-label">{label}</div>
      <div className="stat-num" style={{ fontSize: 22, color: tone }}>{value}</div>
      {note && <div className="tiny muted">{note}</div>}
    </div>
  )
}

// Recorded webm files carry no duration, so the seek bar is dead until the
// browser has scanned to the end once. Nudge it there and back.
function fixDuration(e: React.SyntheticEvent<HTMLMediaElement>): void {
  const m = e.currentTarget
  if (m.duration !== Infinity) return
  m.ontimeupdate = () => { m.ontimeupdate = null; m.currentTime = 0 }
  m.currentTime = 1e101
}

function Feedback({ a, mediaUrl, onRetry, onDelete, onAgain, hasKey }: { a: PracticeAttempt; mediaUrl: string | null; onRetry: () => void; onDelete: () => void; onAgain: () => void; hasKey: boolean }) {
  const m = a.metrics
  const f = a.feedback
  const perMin = m.durationSec > 0 ? m.fillerCount / (m.durationSec / 60) : 0
  const dims: [string, number | null][] = f ? [
    ['Structure', f.scores.structure], ['Substance & numbers', f.scores.substance], ['Executive presence', f.scores.executivePresence],
    ['Delivery', f.scores.delivery], ['Confidence', f.scores.confidence], ['Body language', f.scores.bodyLanguage]
  ] : []
  const verdictTone = f?.wouldAdvance === 'yes' ? 'good' : f?.wouldAdvance === 'borderline' ? 'gold' : 'bad'
  const highlighted = a.transcript.replace(/\b(um+|uh+|you know|basically|actually|literally|i think|i guess|kind of|sort of|maybe|just)\b/gi, '**$1**')

  return (
    <>
      <div className="card">
        {f ? (
          <div className="row" style={{ gap: 18 }}>
            <Ring value={f.overall} size={96} stroke={9} color={scoreTone(f.overall)} label={<div className="ring-num" style={{ fontSize: 30 }}>{f.overall}</div>} />
            <div className="grow">
              <span className={`pill ${verdictTone}`}>{f.wouldAdvance === 'yes' ? 'Would advance' : f.wouldAdvance === 'borderline' ? 'Borderline' : 'Would not advance yet'}</span>
              <div style={{ fontWeight: 650, fontSize: 15.5, marginTop: 8 }}>{f.verdict}</div>
              <div className="tiny muted" style={{ marginTop: 4 }}>{fmtDate(a.createdAt)} · {a.mode} · {Math.round(m.durationSec)}s</div>
            </div>
          </div>
        ) : (
          <div className="row between"><div><b>Recorded and transcribed.</b><div className="small muted">{hasKey ? 'Coach feedback didn’t come through.' : 'Add your Anthropic key in Settings for coaching.'}</div></div>
            {hasKey && <button className="btn sm primary" onClick={onRetry}><Sparkles size={14} /> Get feedback</button>}</div>
        )}
        {f && (
          <div className="stack" style={{ gap: 8, marginTop: 16 }}>
            {dims.filter(([, v]) => v != null).map(([label, v]) => (
              <div key={label} className="dim"><span className="muted">{label}</span><Bar value={v!} max={10} tone={v! >= 8 ? 'good' : v! >= 6 ? 'gold' : ''} /><b style={{ textAlign: 'right' }}>{v}</b></div>
            ))}
          </div>
        )}
      </div>

      <div className="grid g3">
        <Metric label="Pace" value={`${m.wpm} wpm`} note="130–160 sounds confident" tone={m.wpm >= 125 && m.wpm <= 170 ? 'var(--good)' : 'var(--gold)'} />
        <Metric label="Fillers" value={`${m.fillerCount}`} note={`${perMin.toFixed(1)}/min · aim under 3`} tone={perMin <= 3 ? 'var(--good)' : 'var(--bad)'} />
        <Metric label="Hedges" value={`${m.hedgeCount}`} note={Object.keys(m.hedges).slice(0, 2).join(', ') || 'none — good'} tone={m.hedgeCount <= 2 ? 'var(--good)' : 'var(--gold)'} />
        <Metric label="Length" value={`${Math.round(m.durationSec)}s`} note="60–120s is the sweet spot" tone={m.durationSec <= 150 ? 'var(--good)' : 'var(--bad)'} />
        <Metric label="Long pauses" value={`${m.longPauses}`} note={`longest ${m.longestPauseSec}s`} />
        <Metric label="Vocal variety" value={m.pitchVariationSemitones != null ? `${m.pitchVariationSemitones} st` : '—'} note="under 1.5 reads monotone"
          tone={m.pitchVariationSemitones == null ? undefined : m.pitchVariationSemitones >= 1.5 ? 'var(--good)' : 'var(--gold)'} />
      </div>

      {f && (
        <>
          <div className="card">
            <div className="card-title" style={{ color: 'var(--good)' }}>What landed</div>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 5 }}>{f.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
          <div className="card">
            <div className="card-title" style={{ color: 'var(--gold-2)' }}>Fix these</div>
            <div className="stack">
              {f.fixes.map((x, i) => (
                <div key={i} style={{ borderLeft: '3px solid var(--gold)', paddingLeft: 12 }}>
                  <div style={{ fontWeight: 650 }}>{x.issue}</div>
                  <div className="small muted" style={{ fontStyle: 'italic', margin: '3px 0' }}>“{x.evidence}”</div>
                  <div className="small">{x.fix}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="card" style={{ borderColor: 'rgba(124,156,255,0.35)' }}>
            <div className="card-title"><Sparkles size={16} color="var(--blue-2)" /> Power answer — how to say it</div>
            <Markdown text={f.powerAnswer} />
          </div>
          <div className="card tight" style={{ background: 'var(--gold-tint)', borderColor: 'rgba(245,181,68,0.3)' }}>
            <b style={{ color: 'var(--gold-2)' }}>Drill for next time: </b>{f.drill}
          </div>
        </>
      )}

      <div className="card">
        <div className="card-title">Recording & transcript</div>
        {mediaUrl && (a.mode === 'video'
          ? <video src={mediaUrl} controls onLoadedMetadata={fixDuration} style={{ width: '100%', borderRadius: 12, marginBottom: 12 }} />
          : <audio src={mediaUrl} controls onLoadedMetadata={fixDuration} style={{ width: '100%', marginBottom: 12 }} />)}
        <Markdown text={highlighted || '_Nothing was recognised._'} />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn sm gold" onClick={onAgain}><RotateCcw size={14} /> Try again</button>
          <button className="btn sm ghost danger" style={{ marginLeft: 'auto' }} onClick={onDelete}><Trash2 size={14} /> Delete</button>
        </div>
      </div>
    </>
  )
}
