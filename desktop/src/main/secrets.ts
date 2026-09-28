import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'

// The Anthropic key is encrypted with the OS keychain (DPAPI on Windows)
// and never leaves the main process — the UI only learns whether one is set.
const keyFile = (): string => join(app.getPath('userData'), 'anthropic.key')

export function setApiKey(key: string): void {
  const trimmed = key.trim()
  if (!trimmed) {
    if (existsSync(keyFile())) unlinkSync(keyFile())
    return
  }
  const payload = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(trimmed)
    : Buffer.from(`plain:${trimmed}`, 'utf8')
  writeFileSync(keyFile(), payload)
}

export function getApiKey(): string | null {
  if (!existsSync(keyFile())) return null
  const buf = readFileSync(keyFile())
  const asText = buf.toString('utf8')
  if (asText.startsWith('plain:')) return asText.slice(6)
  try { return safeStorage.decryptString(buf) } catch { return null }
}

export const hasApiKey = (): boolean => !!getApiKey()
