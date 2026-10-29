// Copies JobRadar Desk data between this PC and the online version.
//   node sync.mjs push [log]   PC -> online. The server keeps a backup of what it had.
//   node sync.mjs pull [log]   online -> PC. Close the desktop app first; the PC's data is backed up first.
// The address and sync token come from %LOCALAPPDATA%\JobRadar Desk Online\sync.json:
//   { "url": "https://…", "token": "…" }
// Practice recordings stay where they are (they're large); everything else goes across.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join, relative, sep } from 'path'
import { gunzipSync, gzipSync } from 'zlib'

const [cmd, logFile] = process.argv.slice(2)
const say = (line) => { if (logFile) writeFileSync(logFile, line + '\n', { flag: 'a' }); else console.log(line) }

const cfgFile = process.env.JOBRADAR_SYNC_CONFIG || join(process.env.LOCALAPPDATA, 'JobRadar Desk Online', 'sync.json')
const { url, token } = JSON.parse(readFileSync(cfgFile, 'utf8'))
const DATA = process.env.JOBRADAR_DATA_DIR || join(process.env.APPDATA, 'JobRadar Desk', 'data')
const DOCS = process.env.JOBRADAR_DOCS_DIR || join(homedir(), 'Documents', 'JobRadar Desk')
const SKIP = new Set(['Backups', 'Practice Recordings'])

async function api(path, init = {}) {
  const res = await fetch(url.replace(/\/$/, '') + path, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } })
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`)
  return res
}

// Saved file paths point into the Documents folder of whichever side wrote them.
function remap(value, from, to, toSep) {
  if (typeof value === 'string') {
    if (value.toLowerCase().startsWith(from.toLowerCase())) {
      return to + value.slice(from.length).split(/[\\/]/).join(toSep)
    }
    return value
  }
  if (Array.isArray(value)) return value.map((v) => remap(v, from, to, toSep))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v, from, to, toSep)]))
  return value
}

function listDocs(root) {
  const out = []
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      const f = join(dir, n)
      if (SKIP.has(relative(root, f).split(sep)[0])) continue
      if (statSync(f).isDirectory()) walk(f)
      else out.push(relative(root, f))
    }
  }
  if (existsSync(root)) walk(root)
  return out
}

async function push() {
  const info = await (await api('/api/sync/info')).json()
  const data = {}
  for (const n of readdirSync(DATA).filter((n) => n.endsWith('.json'))) {
    data[n] = JSON.stringify(remap(JSON.parse(readFileSync(join(DATA, n), 'utf8')), DOCS, info.docsRoot, '/'), null, 2)
  }
  const docs = listDocs(DOCS).map((rel) => ({ rel: rel.split(sep).join('/'), b64: readFileSync(join(DOCS, rel)).toString('base64') }))
  const body = gzipSync(JSON.stringify({ data, docs }))
  const r = await (await api('/api/sync/push', { method: 'POST', headers: { 'content-type': 'application/gzip' }, body })).json()
  say(`ok: pushed ${r.data} data files and ${r.docs} documents (${(body.length / 1e6).toFixed(1)} MB)`)
}

async function pull() {
  const info = await (await api('/api/sync/info')).json()
  const { data, docs } = JSON.parse(gunzipSync(Buffer.from(await (await api('/api/sync/pull')).arrayBuffer())).toString('utf8'))
  const backup = join(DOCS, 'Backups', `data-before-online-pull-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(backup, { recursive: true })
  for (const n of readdirSync(DATA).filter((n) => n.endsWith('.json'))) copyFileSync(join(DATA, n), join(backup, n))
  for (const [name, text] of Object.entries(data)) {
    if (!/^[\w-]+\.json$/.test(name)) continue
    const file = join(DATA, name)
    writeFileSync(file + '.tmp', JSON.stringify(remap(JSON.parse(text), info.docsRoot, DOCS, '\\'), null, 2), 'utf8')
    renameSync(file + '.tmp', file)
  }
  let n = 0
  for (const d of docs) {
    const parts = d.rel.split('/')
    // Recordings made online do come down; the PC's backups are never overwritten.
    if (parts[0] === 'Backups' || parts.some((p) => p === '..' || !p)) continue
    const file = join(DOCS, ...parts)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, Buffer.from(d.b64, 'base64'))
    n++
  }
  say(`ok: pulled ${Object.keys(data).length} data files and ${n} documents; previous data backed up to ${backup}`)
}

try {
  if (cmd === 'push') await push()
  else if (cmd === 'pull') await pull()
  else throw new Error('Use: node sync.mjs push|pull [log file]')
} catch (e) {
  say(`error: ${e.message}`)
  process.exitCode = 1
}
