import { app } from 'electron'
import { createReadStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync, createWriteStream } from 'fs'
import { dirname, join } from 'path'
import { Readable, Writable } from 'stream'

// models://hf/<repo>/resolve/<rev>/<file> — the speech model is fetched once from
// Hugging Face by the main process, kept in the app's data folder, and served to
// the transcription worker from disk from then on (works offline afterwards).
const ALLOWED = /^Xenova\/whisper-[\w.-]+\/resolve\/main\/[\w.-]+(\/[\w.-]+)?$/
const CORS = { 'access-control-allow-origin': '*' }

const modelsDir = (): string => join(app.getPath('userData'), 'models')

function typeOf(file: string): string {
  return file.endsWith('.json') ? 'application/json' : 'application/octet-stream'
}

// Download progress across all model files, reported to the UI because the
// streamed response reaching the worker carries no content-length.
const downloads = new Map<string, { got: number; total: number }>()
function report(notify: (pct: number) => void): void {
  let got = 0
  let total = 0
  for (const d of downloads.values()) { got += d.got; total += d.total }
  if (total) notify(Math.min(100, Math.round((got / total) * 100)))
}

export async function handleModelRequest(request: Request, notify: (pct: number) => void): Promise<Response> {
  const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '')
  if (!ALLOWED.test(rel) || rel.includes('..')) return new Response('Not found', { status: 404, headers: CORS })
  const file = join(modelsDir(), rel)

  if (existsSync(file)) {
    const size = statSync(file).size
    const body = Readable.toWeb(createReadStream(file)) as ReadableStream
    return new Response(body, { headers: { ...CORS, 'content-type': typeOf(file), 'content-length': String(size) } })
  }

  let res: globalThis.Response
  try {
    res = await fetch(`https://huggingface.co/${rel}`)
  } catch (e) {
    return new Response(`Could not download the speech model: ${(e as Error).message}`, { status: 502, headers: CORS })
  }
  if (!res.ok || !res.body) return new Response(null, { status: res.status, headers: CORS })

  // Stream to the worker and to disk at the same time.
  const [toWorker, toDisk] = res.body.tee()
  mkdirSync(dirname(file), { recursive: true })
  const part = `${file}.part`
  const entry = { got: 0, total: Number(res.headers.get('content-length')) || 0 }
  downloads.set(rel, entry)
  let last = 0
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      entry.got += chunk.byteLength
      if (Date.now() - last > 250) { last = Date.now(); report(notify) }
      ctrl.enqueue(chunk)
    }
  })
  toDisk
    .pipeThrough(counter)
    .pipeTo(Writable.toWeb(createWriteStream(part)))
    .then(() => { renameSync(part, file); report(notify) })
    .catch(() => { try { unlinkSync(part) } catch { /* already gone */ } })
    .finally(() => { if ([...downloads.values()].every((d) => d.got >= d.total)) downloads.clear() })

  const headers: Record<string, string> = { ...CORS, 'content-type': typeOf(file) }
  const len = res.headers.get('content-length')
  if (len) headers['content-length'] = len
  return new Response(toWorker, { status: 200, headers })
}
