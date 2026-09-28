import { contextBridge, ipcRenderer } from 'electron'

// The only bridge between the UI and the rest of the app: named IPC calls plus
// a subscription helper for streamed events (sweep progress, coach replies).
contextBridge.exposeInMainWorld('desk', {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, cb: (payload: unknown) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
})
