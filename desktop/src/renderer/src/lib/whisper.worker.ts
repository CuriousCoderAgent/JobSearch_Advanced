/// <reference lib="webworker" />
// Speech-to-text runs entirely on this PC (Whisper via ONNX in WebAssembly).
// Audio never leaves the machine; only the transcript goes to the coach.
import { pipeline, env } from '@huggingface/transformers'
import ortMjs from 'ort-dist/ort-wasm-simd-threaded.jsep.mjs?url'
import ortWasm from 'ort-dist/ort-wasm-simd-threaded.jsep.wasm?url'

// Model files come through models:// — the main process downloads them once and
// keeps them on disk. The ONNX runtime itself is bundled with the app.
env.allowLocalModels = false
env.useBrowserCache = false
env.remoteHost = 'models://hf/'
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm }
  // Use a few cores when shared memory is available (enabled by the main process).
  if (typeof SharedArrayBuffer !== 'undefined') env.backends.onnx.wasm.numThreads = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1))
}

const MODEL = 'Xenova/whisper-base.en'
const SR = 16000
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let asr: any = null

// Split long answers at the quietest moment between 18 and 27 seconds into each
// piece, so every piece fits Whisper's 30s window and no words are lost at seams.
function cutPoints(a: Float32Array): number[] {
  const frame = 320
  const n = Math.floor(a.length / frame)
  const rms = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let j = 0; j < frame; j++) { const v = a[i * frame + j]; s += v * v }
    rms[i] = Math.sqrt(s / frame)
  }
  const energy = (i: number): number => (rms[i - 1] ?? 1) + rms[i] + (rms[i + 1] ?? 1)
  const cuts = [0]
  let start = 0
  while (a.length - start > 28 * SR) {
    const lo = Math.floor((start + 18 * SR) / frame)
    const hi = Math.min(n - 1, Math.floor((start + 27 * SR) / frame))
    let best = lo
    for (let i = lo; i < hi; i++) if (energy(i) < energy(best)) best = i
    start = best * frame
    cuts.push(start)
  }
  return cuts
}

self.onmessage = async (e: MessageEvent<{ audio: Float32Array }>) => {
  try {
    if (!asr) {
      self.postMessage({ type: 'status', text: 'Loading the speech model (first time only, ~80 MB)…' })
      asr = await pipeline('automatic-speech-recognition', MODEL, { dtype: 'q8' })
    }
    const audio = e.data.audio
    const cuts = cutPoints(audio)
    const words: { text: string; start: number; end: number }[] = []
    let text = ''
    for (let k = 0; k < cuts.length; k++) {
      self.postMessage({ type: 'status', text: `Transcribing on your PC… ${Math.round((k / cuts.length) * 100)}%` })
      const seg = audio.subarray(cuts[k], cuts[k + 1] ?? audio.length)
      const out = await asr(seg, { return_timestamps: 'word' })
      const offset = cuts[k] / SR
      text += out.text
      for (const c of out.chunks || []) {
        const [s, en] = c.timestamp
        words.push({ text: String(c.text).trim(), start: s + offset, end: (en ?? s) + offset })
      }
    }
    self.postMessage({ type: 'done', text: text.trim(), words })
  } catch (err) {
    self.postMessage({ type: 'error', error: (err as Error).message || String(err) })
  }
}
