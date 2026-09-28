export {}

declare global {
  interface Window {
    desk: {
      invoke: (channel: string, ...args: unknown[]) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>
      on: (channel: string, cb: (payload: unknown) => void) => () => void
    }
  }
}
