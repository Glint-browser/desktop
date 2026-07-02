import { app } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const pathOf = (file: string): string => join(app.getPath('userData'), file)

export function loadJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(pathOf(file), 'utf-8')) as T
  } catch {
    return fallback
  }
}

export function saveJson(file: string, data: unknown): void {
  try {
    writeFileSync(pathOf(file), JSON.stringify(data), 'utf-8')
  } catch {
    // best-effort; ignore write failures
  }
}

const timers = new Map<string, NodeJS.Timeout>()

/** Debounced write so we don't hit disk on every event. */
export function saveJsonDebounced(file: string, get: () => unknown): void {
  const existing = timers.get(file)
  if (existing) clearTimeout(existing)
  timers.set(
    file,
    setTimeout(() => saveJson(file, get()), 400)
  )
}
