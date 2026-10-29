// JobRadar Desk online: the desktop app's own main process (src/main) served
// over HTTPS so the same app runs in a browser on an iPad or any laptop.
// One person, one password. Data lives on the server's volume (DESK_DATA_DIR).
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { basename, extname, join, relative, resolve, sep } from 'path'
import { fileURLToPath } from 'url'
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { gunzipSync, gzipSync } from 'zlib'
import { Readable } from 'stream'
import type { BrowserWindow } from 'electron'
import { app, broadcastEvent, clickNotification, dataRoot, handlers, setBroadcast, withPicks } from './electron-shim'
import { registerIpc } from '../src/main/ipc'
import { handleModelRequest } from '../src/main/models'
import { clearCache } from '../src/main/store'

process.env['TZ'] ||= 'Asia/Kolkata' // "today" for streaks, nudges and the daily brief

const SECRET = process.env['DESK_SECRET'] || ''
const SETUP_CODE = process.env['SETUP_CODE'] || ''
const SYNC_TOKEN = process.env['SYNC_TOKEN'] || ''
const PORT = Number(process.env['PORT'] || 8080)
if (SECRET.length < 32) { console.error('DESK_SECRET must be set (32+ characters).'); process.exit(1) }

const here = fileURLToPath(new URL('.', import.meta.url))
const RENDERER = resolve(process.env['DESK_RENDERER_DIR'] || join(here, '../../out/renderer'))
const BRIDGE = resolve(join(here, '../bridge.js'))
const UPLOADS = join(dataRoot, 'uploads')
const AUTH_FILE = join(dataRoot, 'web-auth.json')
const docsRoot = (): string => join(app.getPath('documents'), 'JobRadar Desk')
const dataDir = (): string => join(app.getPath('userData'), 'data')

// ---------- Live events (sweep progress, coach replies, notifications) ----------

const clients = new Set<ServerResponse>()
setBroadcast((channel, payload) => {
  const line = `data: ${JSON.stringify({ channel, payload })}\n\n`
  for (const c of clients) c.write(line)
})
setInterval(() => { for (const c of clients) c.write(': ping\n\n') }, 20_000)

const pageWindow = {
  isMinimized: () => false, restore: () => {}, show: () => {}, focus: () => {},
  webContents: { send: broadcastEvent }
}
registerIpc(() => pageWindow as unknown as BrowserWindow)

// ---------- Sign-in ----------

type Auth = { salt: string; hash: string; setAt: string }
const readAuth = (): Auth | null => (existsSync(AUTH_FILE) ? JSON.parse(readFileSync(AUTH_FILE, 'utf8')) as Auth : null)
const hashPassword = (password: string, salt: string): string => scryptSync(password, salt, 64).toString('hex')
const sameText = (a: string, b: string): boolean => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
// A session is an expiry plus a signature over it and the password hash, so
// setting a new password signs every device out.
const sign = (body: string, auth: Auth): string => createHmac('sha256', SECRET).update(`${body}|${auth.hash}`).digest('base64url')
const SESSION_DAYS = 30
function newSession(auth: Auth): string {
  const body = `${Date.now() + SESSION_DAYS * 864e5}.${randomBytes(9).toString('base64url')}`
  return `${body}.${sign(body, auth)}`
}
function cookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}
function signedIn(req: IncomingMessage): boolean {
  const auth = readAuth()
  const token = cookie(req, 'desk_session')
  if (!auth || !token) return false
  const cut = token.lastIndexOf('.')
  const body = token.slice(0, cut)
  return Number(body.split('.')[0]) > Date.now() && sameText(token.slice(cut + 1), sign(body, auth))
}
const sessionCookie = (value: string, maxAge: number): string =>
  `desk_session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`

// Wrong passwords: 8 per address per 15 minutes, 30 in total per hour.
const failures: { ip: string; at: number }[] = []
const clientIp = (req: IncomingMessage): string =>
  String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()
function lockedOut(ip: string): boolean {
  const now = Date.now()
  while (failures.length && now - failures[0].at > 3600e3) failures.shift()
  return failures.filter((f) => f.ip === ip && now - f.at < 900e3).length >= 8 || failures.length >= 30
}

function loginPage(message = ''): string {
  const setup = !readAuth()
  const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>JobRadar Desk</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f1a;color:#e5e7eb;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
form{width:min(360px,calc(100vw - 32px));background:#141a2b;border:1px solid #2a3350;border-radius:16px;padding:28px}
h1{font-size:22px;margin:0 0 6px}p{color:#9ca3af;margin:0 0 18px;font-size:14px}
label{display:block;font-size:13px;color:#9ca3af;margin:12px 0 4px}
input{box-sizing:border-box;width:100%;padding:11px 12px;border-radius:10px;border:1px solid #2a3350;background:#0b0f1a;color:#e5e7eb;font-size:16px}
button{margin-top:18px;width:100%;padding:12px;border:0;border-radius:10px;background:#4f6bed;color:#fff;font-size:16px;font-weight:600}
.err{color:#fca5a5;font-size:14px;margin-top:12px}
</style></head><body>
<form method="post" action="${setup ? '/api/setup' : '/api/login'}">
<h1>JobRadar Desk</h1>
<p>${setup ? 'First visit: enter the setup code, then choose the password you will use on every device.' : 'Sign in to your radar.'}</p>
${setup ? '<label for="code">Setup code</label><input id="code" name="code" autocomplete="one-time-code" required>' : ''}
<label for="password">${setup ? 'New password (10+ characters)' : 'Password'}</label>
<input id="password" name="password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" minlength="${setup ? 10 : 1}" required autofocus>
${setup ? '<label for="again">Same password again</label><input id="again" name="again" type="password" autocomplete="new-password" required>' : ''}
<button type="submit">${setup ? 'Set password' : 'Sign in'}</button>
${message ? `<div class="err">${esc(message)}</div>` : ''}
</form></body></html>`
}

// ---------- Helpers ----------

const SECURITY_HEADERS = {
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer'
}
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf', '.csv': 'text/csv; charset=utf-8', '.webm': 'video/webm', '.mp4': 'video/mp4',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
}

function send(res: ServerResponse, status: number, body: string | Buffer, type = 'text/plain; charset=utf-8', extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': type, 'cache-control': 'no-store', ...extra })
  res.end(body)
}
const json = (res: ServerResponse, status: number, value: unknown): void => send(res, status, JSON.stringify(value), 'application/json')
const redirect = (res: ServerResponse, to: string, extra: Record<string, string> = {}): void => {
  res.writeHead(303, { ...SECURITY_HEADERS, location: to, ...extra })
  res.end()
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw Object.assign(new Error('Too large'), { status: 413 })
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}
const formFields = (buf: Buffer): URLSearchParams => new URLSearchParams(buf.toString('utf8'))

const inside = (root: string, file: string): boolean => {
  const r = resolve(root) + sep
  return resolve(file).toLowerCase().startsWith(r.toLowerCase())
}

// Video and audio need byte ranges to seek (and Safari won't play without them).
function sendFile(req: IncomingMessage, res: ServerResponse, file: string, download: boolean): void {
  const size = statSync(file).size
  const head: Record<string, string> = {
    ...SECURITY_HEADERS, 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'accept-ranges': 'bytes', 'cache-control': 'private, no-cache'
  }
  if (download) head['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(basename(file))}`
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''))
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
    let end = m[1] && m[2] ? Number(m[2]) : size - 1
    end = Math.min(end, size - 1)
    if (start > end) { res.writeHead(416, { ...head, 'content-range': `bytes */${size}` }); res.end(); return }
    res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) })
    createReadStream(file, { start, end }).pipe(res)
    return
  }
  res.writeHead(200, { ...head, 'content-length': String(size) })
  createReadStream(file).pipe(res)
}

// The app page, with the browser bridge loaded before the app's own scripts.
// The fixed layout width lets an iPad in portrait show the desktop layout scaled down.
let indexHtml = ''
function appPage(): string {
  if (!indexHtml) {
    indexHtml = readFileSync(join(RENDERER, 'index.html'), 'utf8').replace(
      '<head>',
      '<head>\n    <meta name="viewport" content="width=1180">\n    <script src="/web-bridge.js"></script>'
    )
  }
  return indexHtml
}

// ArrayBuffers (recordings) arrive as base64 inside the JSON body.
function decode(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decode)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const keys = Object.keys(o)
    if (keys.length === 1 && keys[0] === '__b64' && typeof o['__b64'] === 'string') return Buffer.from(o['__b64'], 'base64')
    return Object.fromEntries(keys.map((k) => [k, decode(o[k])]))
  }
  return v
}

// ---------- Sync with the desktop app (web/sync.mjs) ----------

function bearerOk(req: IncomingMessage): boolean {
  const h = String(req.headers.authorization || '')
  return !!SYNC_TOKEN && h.startsWith('Bearer ') && sameText(h.slice(7), SYNC_TOKEN)
}
function listDocs(root: string, skip: Set<string>): string[] {
  if (!existsSync(root)) return []
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const n of readdirSync(dir)) {
      const f = join(dir, n)
      const rel = relative(root, f)
      if (skip.has(rel.split(sep)[0])) continue
      if (statSync(f).isDirectory()) walk(f)
      else out.push(rel)
    }
  }
  walk(root)
  return out
}
function syncPull(): Buffer {
  const data: Record<string, string> = {}
  if (existsSync(dataDir())) {
    for (const n of readdirSync(dataDir())) if (n.endsWith('.json')) data[n] = readFileSync(join(dataDir(), n), 'utf8')
  }
  const docs = listDocs(docsRoot(), new Set(['Backups'])).map((rel) => ({
    rel: rel.split(sep).join('/'), b64: readFileSync(join(docsRoot(), rel)).toString('base64')
  }))
  return gzipSync(JSON.stringify({ data, docs }))
}
function syncPush(body: Buffer): { data: number; docs: number } {
  const { data, docs } = JSON.parse(gunzipSync(body).toString('utf8')) as { data: Record<string, string>; docs: { rel: string; b64: string }[] }
  const dir = dataDir()
  mkdirSync(dir, { recursive: true })
  // Keep the server's copy before it's replaced (the last five).
  const backups = join(dataRoot, 'backups')
  if (readdirSync(dir).some((n) => n.endsWith('.json'))) {
    const to = join(backups, new Date().toISOString().replace(/[:.]/g, '-'))
    mkdirSync(to, { recursive: true })
    for (const n of readdirSync(dir)) if (n.endsWith('.json')) writeFileSync(join(to, n), readFileSync(join(dir, n)))
    for (const old of readdirSync(backups).sort().slice(0, -5)) rmSync(join(backups, old), { recursive: true, force: true })
  }
  for (const [name, text] of Object.entries(data)) {
    if (!/^[\w-]+\.json$/.test(name)) continue
    JSON.parse(text) // refuse anything that isn't JSON
    writeFileSync(join(dir, `${name}.tmp`), text, 'utf8')
    renameSync(join(dir, `${name}.tmp`), join(dir, name))
  }
  for (const d of docs) {
    const file = join(docsRoot(), ...d.rel.split('/'))
    if (!inside(docsRoot(), file)) continue
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, Buffer.from(d.b64, 'base64'))
  }
  clearCache()
  return { data: Object.keys(data).length, docs: docs.length }
}

// ---------- Routes ----------

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', 'http://localhost')
  const path = url.pathname
  const method = req.method || 'GET'

  if (path === '/healthz') return send(res, 200, 'ok')

  // Desktop sync: its own bearer token, no browser session.
  if (path.startsWith('/api/sync/')) {
    if (!bearerOk(req)) return json(res, 401, { error: 'Bad token' })
    if (path === '/api/sync/info' && method === 'GET') {
      return json(res, 200, { docsRoot: docsRoot(), dataDir: dataDir(), signedUp: !!readAuth() })
    }
    if (path === '/api/sync/pull' && method === 'GET') return send(res, 200, syncPull(), 'application/gzip')
    if (path === '/api/sync/push' && method === 'POST') return json(res, 200, syncPush(await readBody(req, 600e6)))
    return json(res, 404, { error: 'Not found' })
  }

  if (path === '/login') return send(res, 200, loginPage(url.searchParams.get('e') || ''), 'text/html; charset=utf-8')
  if (path === '/logout') return redirect(res, '/login', { 'set-cookie': sessionCookie('', 0) })

  if ((path === '/api/login' || path === '/api/setup') && method === 'POST') {
    const ip = clientIp(req)
    if (lockedOut(ip)) return redirect(res, '/login?e=' + encodeURIComponent('Too many tries. Wait 15 minutes and try again.'))
    const f = formFields(await readBody(req, 10_000))
    const password = f.get('password') || ''
    const fail = (why: string): void => {
      failures.push({ ip, at: Date.now() })
      redirect(res, '/login?e=' + encodeURIComponent(why))
    }
    if (path === '/api/setup') {
      if (readAuth()) return redirect(res, '/login')
      if (!SETUP_CODE || !sameText(f.get('code') || '', SETUP_CODE)) return fail('That setup code is not right.')
      if (password.length < 10) return redirect(res, '/login?e=' + encodeURIComponent('Use at least 10 characters.'))
      if (password !== f.get('again')) return redirect(res, '/login?e=' + encodeURIComponent('The two passwords don’t match.'))
      const salt = randomBytes(16).toString('hex')
      const auth: Auth = { salt, hash: hashPassword(password, salt), setAt: new Date().toISOString() }
      mkdirSync(dataRoot, { recursive: true })
      writeFileSync(AUTH_FILE, JSON.stringify(auth), 'utf8')
      return redirect(res, '/', { 'set-cookie': sessionCookie(newSession(auth), SESSION_DAYS * 86400) })
    }
    const auth = readAuth()
    if (!auth) return redirect(res, '/login')
    if (!sameText(hashPassword(password, auth.salt), auth.hash)) return fail('Wrong password.')
    return redirect(res, '/', { 'set-cookie': sessionCookie(newSession(auth), SESSION_DAYS * 86400) })
  }

  // Everything below needs a signed-in browser.
  if (!signedIn(req)) {
    if (path.startsWith('/api/') || path.startsWith('/models/')) return json(res, 401, { error: 'Signed out' })
    return redirect(res, '/login')
  }
  // Form posts from other sites can't set this header, so state changes need it.
  if (method === 'POST' && req.headers['x-desk'] !== '1') return json(res, 403, { error: 'Missing header' })

  if (path === '/api/events') {
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
    res.write(': connected\n\n')
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }

  if (path === '/api/invoke' && method === 'POST') {
    const { channel, args, picks } = JSON.parse((await readBody(req, 300e6)).toString('utf8')) as { channel: string; args: unknown[]; picks?: string[] }
    const fn = handlers.get(channel)
    if (!fn) return json(res, 200, { ok: false, error: `Unknown action ${channel}` })
    const files = (picks || []).filter((p) => typeof p === 'string' && inside(UPLOADS, p))
    try {
      const result = await withPicks(files, async () => fn({}, ...(decode(args || []) as unknown[]))) as { ok: boolean; data?: unknown }
      if (channel.endsWith(':mediaUrl') && result.ok && typeof result.data === 'string' && result.data.startsWith('media://')) {
        result.data = `/api/media?p=${result.data.slice('media://'.length)}`
      }
      return json(res, 200, result)
    } finally {
      for (const f of files) rmSync(join(f, '..'), { recursive: true, force: true })
    }
  }

  if (path === '/api/upload' && method === 'POST') {
    const name = basename(url.searchParams.get('name') || 'upload').replace(/[^\w .()-]/g, '_').slice(-100) || 'upload'
    const dir = join(UPLOADS, randomBytes(8).toString('hex'))
    mkdirSync(dir, { recursive: true })
    const file = join(dir, name)
    writeFileSync(file, await readBody(req, 50e6))
    return json(res, 200, { path: file })
  }

  if (path === '/api/notify-click' && method === 'POST') {
    const { id } = JSON.parse((await readBody(req, 1000)).toString('utf8')) as { id: string }
    clickNotification(String(id))
    return json(res, 200, { ok: true })
  }

  if (path === '/api/file' || path === '/api/media') {
    const file = url.searchParams.get('p') || ''
    if (!inside(app.getPath('documents'), file) || !existsSync(file) || !statSync(file).isFile()) return send(res, 404, 'Not found')
    return sendFile(req, res, file, path === '/api/file')
  }

  if (path.startsWith('/models/hf/')) {
    const r = await handleModelRequest(new Request(`http://hf/${path.slice('/models/hf/'.length)}`), (pct) => broadcastEvent('model:progress', pct))
    res.writeHead(r.status, { ...SECURITY_HEADERS, ...Object.fromEntries(r.headers) })
    if (r.body) Readable.fromWeb(r.body as never).pipe(res)
    else res.end()
    return
  }

  if (path === '/web-bridge.js') return send(res, 200, readFileSync(BRIDGE), 'text/javascript')
  if (path === '/' || path === '/index.html') return send(res, 200, appPage(), 'text/html; charset=utf-8')

  const file = join(RENDERER, ...decodeURIComponent(path).split('/').filter(Boolean))
  if (inside(RENDERER, file) && existsSync(file) && statSync(file).isFile()) {
    res.writeHead(200, {
      ...SECURITY_HEADERS, 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      // Vite names built assets by content hash, so they never change.
      'cache-control': path.startsWith('/assets/') ? 'private, max-age=31536000, immutable' : 'no-cache'
    })
    createReadStream(file).pipe(res)
    return
  }
  return send(res, 404, 'Not found')
}

createServer((req, res) => {
  route(req, res).catch((err: Error & { status?: number }) => {
    console.error(err)
    if (!res.headersSent) json(res, err.status || 500, { ok: false, error: err.status === 413 ? 'That file is too large.' : 'Server error' })
    else res.end()
  })
}).listen(PORT, () => console.log(`JobRadar Desk online on :${PORT} (data in ${dataRoot})`))
