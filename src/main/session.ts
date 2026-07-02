import { app } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { SessionData } from './TabManager'

const FILE = (): string => join(app.getPath('userData'), 'session.json')

export function loadSession(): SessionData | null {
  try {
    return JSON.parse(readFileSync(FILE(), 'utf-8')) as SessionData
  } catch {
    return null // first run or unreadable
  }
}

let pending: NodeJS.Timeout | null = null

/** Debounced save so we don't write on every navigation event. */
export function saveSessionDebounced(get: () => SessionData): void {
  if (pending) clearTimeout(pending)
  pending = setTimeout(() => saveSession(get()), 500)
}

export function saveSession(data: SessionData): void {
  try {
    writeFileSync(FILE(), JSON.stringify(data), 'utf-8')
  } catch {
    // best-effort; ignore write failures
  }
}
