// Online version only: stands in for the desktop preload bridge
// (src/preload/index.ts). Calls go to the server over HTTPS; server events
// (sweep progress, coach replies, notifications) arrive over one EventSource.
;(() => {
  const listeners = new Map()
  const emit = (channel, payload) => {
    for (const cb of listeners.get(channel) || []) {
      try { cb(payload) } catch (e) { console.error(e) }
    }
  }

  const events = new EventSource('/api/events')
  events.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.channel === 'web:notify') notify(m.payload)
    else if (m.channel === 'web:files') files(m.payload)
    else if (m.channel === 'web:open') openLink(m.payload)
    else emit(m.channel, m.payload)
  }

  // Recordings are ArrayBuffers; they travel as base64 inside the JSON body.
  const b64 = (bytes) => {
    let s = ''
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    return btoa(s)
  }
  const encode = (v) => {
    if (v instanceof ArrayBuffer) return { __b64: b64(new Uint8Array(v)) }
    if (ArrayBuffer.isView(v)) return { __b64: b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) }
    if (Array.isArray(v)) return v.map(encode)
    if (v && typeof v === 'object') {
      const o = {}
      for (const k of Object.keys(v)) o[k] = encode(v[k])
      return o
    }
    return v
  }

  // Calls that open a file dialog on the desktop pick a file here instead.
  const PICKS = {
    'cvs:import': { accept: '.docx,.pdf,.txt,.md', multiple: false, none: null },
    'cvs:importMany': { accept: '.docx,.pdf,.txt,.md', multiple: true, none: { imported: [], failed: [] } },
    'people:import': { accept: '.xlsx,.csv', multiple: false, none: null }
  }
  const choose = (p) => new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = p.accept
    input.multiple = p.multiple
    input.style.display = 'none'
    let done = false
    const finish = (v) => { if (!done) { done = true; input.remove(); resolve(v) } }
    input.addEventListener('change', () => finish(input.files && input.files.length ? [...input.files] : null))
    input.addEventListener('cancel', () => finish(null))
    document.body.appendChild(input)
    input.click()
  })
  const upload = async (file) => {
    const r = await fetch(`/api/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'x-desk': '1' }, body: file })
    if (!r.ok) throw new Error(r.status === 413 ? 'That file is too large.' : `Upload failed (${r.status}).`)
    return (await r.json()).path
  }

  async function invoke(channel, ...args) {
    // Opened right away, while the tap still counts, so Safari doesn't block it.
    if (channel === 'shell:openExternal') {
      window.open(String(args[0]), '_blank', 'noopener')
      return { ok: true, data: true }
    }
    let picks
    const p = PICKS[channel]
    if (p && !(channel === 'people:import' && args[0])) {
      const chosen = await choose(p)
      if (!chosen) return { ok: true, data: p.none }
      try { picks = await Promise.all(chosen.map(upload)) } catch (e) { return { ok: false, error: e.message } }
    }
    let res
    try {
      res = await fetch('/api/invoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-desk': '1' },
        body: JSON.stringify({ channel, args: encode(args), picks })
      })
    } catch {
      return { ok: false, error: 'Can’t reach JobRadar online. Check your connection and try again.' }
    }
    if (res.status === 401) { location.href = '/login'; return { ok: false, error: 'Signed out.' } }
    if (!res.ok) return { ok: false, error: res.status === 413 ? 'That is too large to send.' : `The server returned ${res.status}.` }
    return res.json()
  }

  window.desk = {
    invoke,
    on(channel, cb) {
      if (!listeners.has(channel)) listeners.set(channel, new Set())
      listeners.get(channel).add(cb)
      return () => listeners.get(channel).delete(cb)
    }
  }
  window.deskWeb = true

  // ---------- Cards in the corner: notifications, downloads, links ----------

  let tray
  const card = (title, body, autoClose) => {
    if (!tray) {
      tray = document.createElement('div')
      tray.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;display:flex;flex-direction:column;gap:8px;width:min(360px,calc(100vw - 32px));font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif'
      document.body.appendChild(tray)
    }
    const el = document.createElement('div')
    el.style.cssText = 'background:#141a2b;color:#e5e7eb;border:1px solid #2a3350;border-radius:12px;padding:12px 14px;box-shadow:0 8px 24px rgba(0,0,0,.45)'
    const head = document.createElement('div')
    head.style.cssText = 'display:flex;justify-content:space-between;gap:12px;font-weight:600'
    const t = document.createElement('span')
    t.textContent = title
    const x = document.createElement('button')
    x.textContent = '×'
    x.setAttribute('aria-label', 'Dismiss')
    x.style.cssText = 'background:none;border:0;color:#9ca3af;font-size:20px;line-height:1;cursor:pointer;padding:0 2px'
    x.onclick = (e) => { e.stopPropagation(); el.remove() }
    head.append(t, x)
    el.appendChild(head)
    if (body) {
      const b = document.createElement('div')
      b.style.cssText = 'color:#9ca3af;white-space:pre-line;margin-top:4px'
      b.textContent = body
      el.appendChild(b)
    }
    tray.appendChild(el)
    if (autoClose) setTimeout(() => el.remove(), autoClose)
    return el
  }
  const link = (el, href, text, download) => {
    const a = document.createElement('a')
    a.href = href
    a.textContent = text
    if (download) a.setAttribute('download', download)
    else { a.target = '_blank'; a.rel = 'noopener' }
    a.style.cssText = 'display:block;color:#93c5fd;margin-top:6px;word-break:break-all'
    el.appendChild(a)
  }

  function notify({ id, title, body }) {
    const el = card(title, body, 15000)
    el.style.cursor = 'pointer'
    el.onclick = () => {
      el.remove()
      fetch('/api/notify-click', { method: 'POST', headers: { 'content-type': 'application/json', 'x-desk': '1' }, body: JSON.stringify({ id }) })
    }
  }
  function files({ title, files }) {
    const el = card(title, files.length ? '' : 'No files here yet.')
    for (const f of files) link(el, f.url, `Download ${f.name}`, f.name)
  }
  function openLink({ url }) {
    link(card('Open link', ''), url, url)
  }
})()
