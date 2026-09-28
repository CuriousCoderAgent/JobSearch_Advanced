import { app } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

// Everything you'd want to find in Explorer lives under Documents\JobRadar Desk.
export function deskRoot(): string {
  return ensure(join(app.getPath('documents'), 'JobRadar Desk'))
}
export const cvDir = (): string => ensure(join(deskRoot(), 'CVs'))
export const cvOriginalsDir = (): string => ensure(join(cvDir(), 'Originals'))
export const applicationsDir = (): string => ensure(join(deskRoot(), 'Applications'))
export const practiceDir = (): string => ensure(join(deskRoot(), 'Practice Recordings'))

export function ensure(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

// Windows forbids <>:"/\|?* in file names; also trim trailing dots/spaces.
export function safeName(s: string, max = 60): string {
  return (s || 'Untitled')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, max) || 'Untitled'
}
