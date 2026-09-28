import type { DeliveryMetrics, WordStamp } from '../../../shared/types'

const SR = 16000

// Decode any recorded blob (webm/opus) to 16 kHz mono, which Whisper expects.
export async function decodeTo16k(blob: Blob): Promise<Float32Array> {
  const buf = await blob.arrayBuffer()
  const ctx = new AudioContext()
  const decoded = await ctx.decodeAudioData(buf)
  await ctx.close()
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * SR), SR)
  const src = off.createBufferSource()
  src.buffer = decoded
  src.connect(off.destination)
  src.start()
  const rendered = await off.startRendering()
  return rendered.getChannelData(0).slice()
}

let worker: Worker | null = null
export function transcribe(audio: Float32Array, onStatus: (s: string) => void): Promise<{ text: string; words: WordStamp[] }> {
  if (!worker) worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    const w = worker!
    w.onmessage = (e: MessageEvent) => {
      const m = e.data
      if (m.type === 'status') onStatus(m.text)
      else if (m.type === 'done') resolve({ text: m.text, words: m.words })
      else if (m.type === 'error') reject(new Error(`Speech recognition failed: ${m.error}`))
    }
    w.onerror = (e) => reject(new Error(`Speech recognition failed: ${e.message}`))
    const copy = audio.slice() // the caller keeps its own copy for analysis
    w.postMessage({ audio: copy }, [copy.buffer])
  })
}

// ---------- Delivery metrics ----------

const FILLERS: [string, RegExp][] = [
  ['um / uh', /\b(um+|uh+|erm+|er|ah+|hmm+)\b/g],
  ['you know', /\byou know\b/g],
  ['basically', /\bbasically\b/g],
  ['actually', /\bactually\b/g],
  ['literally', /\bliterally\b/g],
  ['like', /(,\s*like\b|\blike,)/g],
  ['I mean', /\bi mean\b/g],
  ['so yeah', /\bso,? yeah\b/g],
  ['right?', /\bright\?/g]
]
const HEDGES: [string, RegExp][] = [
  ['I think', /\bi think\b/g],
  ['I guess', /\bi guess\b/g],
  ['I feel like', /\bi feel like\b/g],
  ['maybe', /\bmaybe\b/g],
  ['probably', /\bprobably\b/g],
  ['kind of / sort of', /\b(kind|sort) of\b/g],
  ['just', /\bjust\b/g],
  ['a bit / a little', /\ba (little )?bit\b/g],
  ['hopefully', /\bhopefully\b/g],
  ['try to', /\btry(ing)? to\b/g]
]

function countAll(text: string, table: [string, RegExp][]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [label, re] of table) {
    const n = (text.match(re) || []).length
    if (n) out[label] = n
  }
  return out
}

// Autocorrelation pitch estimate for one frame; null if unvoiced.
function pitchOf(a: Float32Array, start: number, len: number): number | null {
  const minLag = Math.floor(SR / 400)
  const maxLag = Math.floor(SR / 70)
  if (start + len + maxLag > a.length) return null
  let energy = 0
  for (let i = 0; i < len; i++) energy += a[start + i] * a[start + i]
  if (energy < 1e-4) return null
  // Energy of the lagged window, slid along as the lag grows. Normalising by
  // both windows stops a word onset (quiet frame, loud lag) from reading as a
  // near-perfect match at the longest lag — an octave-low false pitch.
  let lagEnergy = 0
  for (let i = 0; i < len; i++) lagEnergy += a[start + minLag + i] * a[start + minLag + i]
  let bestLag = -1
  let best = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (lag > minLag) {
      const out = a[start + lag - 1]
      const inn = a[start + lag + len - 1]
      lagEnergy += inn * inn - out * out
    }
    let s = 0
    for (let i = 0; i < len; i++) s += a[start + i] * a[start + i + lag]
    const r = s / Math.sqrt(energy * Math.max(lagEnergy, 1e-9))
    if (r > best) { best = r; bestLag = lag }
  }
  return best > 0.45 && bestLag > 0 ? SR / bestLag : null
}

export function analyze(audio: Float32Array, text: string, words: WordStamp[]): DeliveryMetrics {
  const frame = 320 // 20 ms
  const n = Math.floor(audio.length / frame)
  const rms = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let j = 0; j < frame; j++) { const v = audio[i * frame + j]; s += v * v }
    rms[i] = Math.sqrt(s / frame)
  }
  const sorted = Array.from(rms).sort((a, b) => a - b)
  const floor = sorted[Math.floor(sorted.length * 0.2)] || 0
  const threshold = Math.max(floor * 3, 0.008)
  const voiced = Array.from(rms, (v) => v > threshold)
  const speakingSec = voiced.filter(Boolean).length * 0.02

  const lower = ` ${text.toLowerCase()} `
  const fillers = countAll(lower, FILLERS)
  const hedges = countAll(lower, HEDGES)

  const ws = words.filter((w) => w.text)
  const span = ws.length > 1 ? ws[ws.length - 1].end - ws[0].start : speakingSec
  const wpm = span > 0 ? Math.round(ws.length / (span / 60)) : 0

  // Gaps between words: long silences, and "voiced gaps" — sound but no words,
  // which is almost always an um/uh that the transcript quietly dropped.
  let longPauses = 0
  let longestPauseSec = 0
  let likelyFilledPauses = 0
  for (let i = 1; i < ws.length; i++) {
    const gap = ws[i].start - ws[i - 1].end
    if (gap <= 0) continue
    const f0 = Math.floor((ws[i - 1].end * SR) / frame)
    const f1 = Math.floor((ws[i].start * SR) / frame)
    const span2 = voiced.slice(f0, f1)
    const voicedRatio = span2.length ? span2.filter(Boolean).length / span2.length : 0
    if (gap >= 0.35 && voicedRatio >= 0.55) likelyFilledPauses++
    else if (gap >= 1.2) longPauses++
    longestPauseSec = Math.max(longestPauseSec, gap)
  }

  // Pitch variation in semitones across voiced frames (monotone < ~1.5).
  const pitchAt: (number | null)[] = new Array(n).fill(null)
  const pitches: number[] = []
  for (let i = 0; i < n; i += 2) {
    if (!voiced[i]) continue
    const p = pitchOf(audio, i * frame, 640)
    if (p) { pitches.push(p); pitchAt[i] = p }
  }
  const frameOf = (sec: number): number => Math.min(n, Math.max(0, Math.floor((sec * SR) / frame)))
  const pitchesIn = (fromSec: number, toSec: number): number[] => {
    const out: number[] = []
    for (let i = frameOf(fromSec); i < frameOf(toSec); i++) if (pitchAt[i]) out.push(pitchAt[i]!)
    return out
  }
  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
  let pitchVariationSemitones: number | null = null
  if (pitches.length > 30) {
    const med = [...pitches].sort((a, b) => a - b)[Math.floor(pitches.length / 2)]
    const st = pitches.map((p) => 12 * Math.log2(p / med))
    const mean = st.reduce((s, v) => s + v, 0) / st.length
    pitchVariationSemitones = Math.round(Math.sqrt(st.reduce((s, v) => s + (v - mean) ** 2, 0) / st.length) * 10) / 10
  }

  // Trailing off: the last word of a sentence much quieter than the sentence.
  const energyOf = (w: WordStamp): number => {
    const a = Math.floor((w.start * SR) / frame)
    const b = Math.max(a + 1, Math.floor((w.end * SR) / frame))
    let s = 0
    for (let i = a; i < b && i < n; i++) s += rms[i]
    return s / (b - a)
  }
  // Uptalk: a statement whose last word rises 2+ semitones above the pitch of
  // the rest of the sentence sounds like a question — it reads as unsure.
  let sentences = 0
  let trailing = 0
  let statements = 0
  let uptalk = 0
  let sentenceStart = 0
  for (let i = 0; i < ws.length; i++) {
    if (/[.?!]$/.test(ws[i].text) && i - sentenceStart >= 3) {
      const body = ws.slice(sentenceStart, i)
      const avg = body.reduce((s, w) => s + energyOf(w), 0) / body.length
      sentences++
      if (energyOf(ws[i]) < avg * 0.55) trailing++
      if (!ws[i].text.endsWith('?')) {
        const bodyPitch = pitchesIn(body[0].start, body[body.length - 1].end)
        const last = ws[i]
        const endPitch = pitchesIn(last.start + (last.end - last.start) * 0.4, last.end)
        if (bodyPitch.length >= 5 && endPitch.length >= 1) {
          statements++
          if (12 * Math.log2(median(endPitch) / median(bodyPitch)) >= 2) uptalk++
        }
      }
      sentenceStart = i + 1
    }
  }

  // Energy over the answer: does the voice fade in the last third? And does
  // the pace run away in the second half (a common sign of nerves)?
  const voicedIdx = voiced.flatMap((v, i) => (v ? [i] : []))
  let energyDropPct: number | null = null
  if (voicedIdx.length && (voicedIdx[voicedIdx.length - 1] - voicedIdx[0]) * 0.02 >= 12) {
    const a = voicedIdx[0]
    const third = (voicedIdx[voicedIdx.length - 1] - a) / 3
    const meanIn = (from: number, to: number): number => {
      const xs = voicedIdx.filter((i) => i >= from && i < to).map((i) => rms[i])
      return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0
    }
    const first = meanIn(a, a + third)
    const lastThird = meanIn(a + 2 * third, a + 3 * third + 1)
    if (first > 0) energyDropPct = Math.round(((first - lastThird) / first) * 100)
  }
  let paceShiftWpm: number | null = null
  if (ws.length > 20 && span >= 30) {
    const mid = ws[0].start + span / 2
    const firstHalf = ws.filter((w) => w.start < mid).length
    const secondHalf = ws.length - firstHalf
    paceShiftWpm = Math.round((secondHalf - firstHalf) / (span / 2 / 60))
  }

  return {
    durationSec: Math.round((audio.length / SR) * 10) / 10,
    speakingSec: Math.round(speakingSec * 10) / 10,
    wordCount: ws.length,
    wpm,
    longPauses,
    longestPauseSec: Math.round(longestPauseSec * 10) / 10,
    fillerCount: Object.values(fillers).reduce((s, v) => s + v, 0) + likelyFilledPauses,
    fillers: likelyFilledPauses ? { ...fillers, 'um / uh (heard, not transcribed)': likelyFilledPauses } : fillers,
    hedgeCount: Object.values(hedges).reduce((s, v) => s + v, 0),
    hedges,
    likelyFilledPauses,
    pitchVariationSemitones,
    trailingOffRate: sentences >= 3 ? Math.round((trailing / sentences) * 100) / 100 : null,
    airtimePct: audio.length ? Math.round((speakingSec / (audio.length / SR)) * 100) : 0,
    startLatencySec: ws.length ? Math.round(ws[0].start * 10) / 10 : undefined,
    uptalkRate: statements >= 3 ? Math.round((uptalk / statements) * 100) / 100 : null,
    energyDropPct,
    paceShiftWpm
  }
}
