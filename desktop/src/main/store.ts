import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { localDay } from '../shared/types'

// Small JSON-file store: one file per collection under userData/data.
// Writes are atomic (temp file + rename) so a crash never leaves half a file.
const cache = new Map<string, unknown>()

function dataDir(): string {
  const dir = join(app.getPath('userData'), 'data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function read<T>(name: string, fallback: T): T {
  if (cache.has(name)) return cache.get(name) as T
  const file = join(dataDir(), `${name}.json`)
  let value = fallback
  if (existsSync(file)) {
    try { value = JSON.parse(readFileSync(file, 'utf8')) as T } catch { value = fallback }
  }
  cache.set(name, value)
  return value
}

export function write<T>(name: string, value: T): T {
  const file = join(dataDir(), `${name}.json`)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, file)
  cache.set(name, value)
  return value
}

export function update<T>(name: string, fallback: T, fn: (current: T) => T): T {
  return write(name, fn(read(name, fallback)))
}

export const newId = (): string => randomUUID()
export const nowIso = (): string => new Date().toISOString()
export const today = (): string => localDay()
