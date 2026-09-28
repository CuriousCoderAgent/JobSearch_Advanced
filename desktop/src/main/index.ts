import { app, BrowserWindow, net, protocol, session, shell } from 'electron'
import { join, resolve, sep } from 'path'
import { pathToFileURL } from 'url'
import { registerIpc } from './ipc'
import { handleModelRequest } from './models'
import { practiceDir } from './paths'

// media:// serves practice recordings back to the UI for playback. Only files
// inside the Practice Recordings folder can be reached through it.
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { stream: true, supportFetchAPI: true, bypassCSP: false } },
  { scheme: 'models', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }
])

// Lets on-device speech recognition use several CPU cores. The window only
// ever loads the app's own files, so shared memory carries no cross-site risk.
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer')

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#0b0f1a',
    title: 'JobRadar Desk',
    autoHideMenuBar: true,
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => { mainWindow = null })

  // External links open in the real browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url) }
  })

  if (process.env['ELECTRON_RENDERER_URL']) mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.eshangupta.jobradardesk')

  // Camera and microphone are needed for interview practice; nothing else.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'clipboard-sanitized-write')
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')

  protocol.handle('media', (request) => {
    const file = resolve(decodeURIComponent(request.url.slice('media://'.length)).replace(/\/$/, ''))
    const root = resolve(practiceDir()) + sep
    if (!file.toLowerCase().startsWith(root.toLowerCase())) return new Response('Forbidden', { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })
  protocol.handle('models', (request) => handleModelRequest(request, (pct) => mainWindow?.webContents.send('model:progress', pct)))

  registerIpc(() => mainWindow)
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
