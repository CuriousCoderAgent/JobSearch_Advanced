// Stands in for the 'electron' module when the desktop app's main process runs
// as the online server (web/build.mjs aliases 'electron' to this file). Only
// the parts the main process uses are here; anything that would open a window
// or a dialog on the PC becomes an event the browser shows instead.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import { existsSync, readdirSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'

export const dataRoot = process.env['DESK_DATA_DIR'] || '/data'
const paths: Record<string, string> = {
  userData: join(dataRoot, 'userData'),
  documents: join(dataRoot, 'Documents'),
  temp: tmpdir()
}

type Broadcast = (channel: string, payload: unknown) => void
let broadcast: Broadcast = () => {}
export function setBroadcast(fn: Broadcast): void { broadcast = fn }
export const broadcastEvent: Broadcast = (channel, payload) => broadcast(channel, payload)

// Files the browser uploaded for the call in progress. The open dialog
// "returns" these, so the handlers that import a CV or a contact map run as-is.
let picks: string[] = []
export async function withPicks<T>(files: string[], fn: () => Promise<T>): Promise<T> {
  picks = files
  try { return await fn() } finally { picks = [] }
}

export const app = {
  getPath: (name: string): string => paths[name] ?? join(dataRoot, name),
  setPath: (name: string, p: string): void => { paths[name] = p },
  getVersion: (): string => process.env['DESK_VERSION'] || '0.0.0',
  isPackaged: true
}

// The Anthropic key is kept encrypted with the server's own secret.
const MAGIC = Buffer.from('jrw1')
function storageKey(): Buffer {
  const secret = process.env['DESK_SECRET']
  if (!secret) throw new Error('DESK_SECRET is not set.')
  return createHash('sha256').update(`jobradar-key-storage:${secret}`).digest()
}
export const safeStorage = {
  isEncryptionAvailable: (): boolean => !!process.env['DESK_SECRET'],
  encryptString(text: string): Buffer {
    const iv = randomBytes(12)
    const c = createCipheriv('aes-256-gcm', storageKey(), iv)
    const body = Buffer.concat([c.update(text, 'utf8'), c.final()])
    return Buffer.concat([MAGIC, iv, c.getAuthTag(), body])
  },
  decryptString(buf: Buffer): string {
    if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error('Not a key saved by this server.')
    const d = createDecipheriv('aes-256-gcm', storageKey(), buf.subarray(4, 16))
    d.setAuthTag(buf.subarray(16, 32))
    return Buffer.concat([d.update(buf.subarray(32)), d.final()]).toString('utf8')
  }
}

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown
export const handlers = new Map<string, IpcHandler>()
export const ipcMain = {
  handle: (channel: string, fn: IpcHandler): void => { handlers.set(channel, fn) }
}

// Desktop notifications become a card in the corner of the page.
const clicks = new Map<string, () => void>()
export function clickNotification(id: string): void {
  clicks.get(id)?.()
  clicks.delete(id)
}
export class Notification {
  static isSupported(): boolean { return true }
  private id = randomBytes(8).toString('hex')
  constructor(private opts: { title: string; body?: string }) {}
  on(event: string, fn: () => void): this {
    if (event === 'click') {
      clicks.set(this.id, fn)
      if (clicks.size > 50) clicks.delete(clicks.keys().next().value!)
    }
    return this
  }
  show(): void { broadcast('web:notify', { id: this.id, title: this.opts.title, body: this.opts.body ?? '' }) }
}

export const dialog = {
  showOpenDialog: async (_win: unknown, _opts: unknown): Promise<{ canceled: boolean; filePaths: string[] }> =>
    ({ canceled: !picks.length, filePaths: [...picks] }),
  // Exports are written where the desktop would suggest, then offered as a download.
  showSaveDialog: async (_win: unknown, opts: { defaultPath?: string }): Promise<{ canceled: boolean; filePath?: string }> =>
    ({ canceled: !opts.defaultPath, filePath: opts.defaultPath })
}

const fileLink = (file: string): { name: string; url: string } =>
  ({ name: basename(file), url: `/api/file?p=${encodeURIComponent(file)}` })

function offerFiles(p: string): void {
  if (!existsSync(p)) { broadcast('web:files', { title: 'Nothing saved here yet', files: [] }); return }
  if (!statSync(p).isDirectory()) { broadcast('web:files', { title: 'Your file is ready', files: [fileLink(p)] }); return }
  const files = readdirSync(p).map((n) => join(p, n)).filter((f) => statSync(f).isFile()).map(fileLink)
  broadcast('web:files', { title: basename(p), files })
}

export const shell = {
  openExternal: async (url: string): Promise<void> => { broadcast('web:open', { url }) },
  openPath: async (p: string): Promise<string> => { offerFiles(p); return '' },
  showItemInFolder: (file: string): void => { offerFiles(file) }
}

// Only used to print a CV to PDF: the same HTML goes through headless Chromium.
type PdfOptions = { pageSize?: string; printBackground?: boolean; preferCSSPageSize?: boolean }
export class BrowserWindow {
  static getAllWindows(): BrowserWindow[] { return [] }
  private url = ''
  webContents = {
    printToPDF: (opts: PdfOptions): Promise<Buffer> => printToPdf(this.url, opts),
    send: (channel: string, payload: unknown): void => broadcast(channel, payload)
  }
  constructor(_opts?: unknown) {}
  async loadURL(url: string): Promise<void> { this.url = url }
  destroy(): void {}
}

async function printToPdf(url: string, opts: PdfOptions): Promise<Buffer> {
  const html = decodeURIComponent(url.replace(/^data:text\/html;charset=utf-8,/, ''))
  // Installed in the server image only (web/Dockerfile), not part of the desktop app.
  const mod = await import(process.env['PUPPETEER_MODULE'] || 'puppeteer-core')
  const puppeteer = mod.default ?? mod
  const browser = await puppeteer.launch({
    executablePath: process.env['CHROME_PATH'] || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    headless: true
  })
  try {
    const page = await browser.newPage()
    await page.setJavaScriptEnabled(false)
    await page.setContent(html, { waitUntil: 'load' })
    return Buffer.from(await page.pdf({ format: 'A4', printBackground: opts.printBackground, preferCSSPageSize: opts.preferCSSPageSize }))
  } finally {
    await browser.close()
  }
}
