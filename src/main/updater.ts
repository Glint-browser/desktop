import { app, BrowserWindow } from 'electron'
import pkg from 'electron-updater'
import { IPC, type UpdateStatus } from '../shared/types'

// electron-updater ships as CommonJS; destructure the default export so this
// works whether the bundler gives us the namespace or the default object.
const { autoUpdater } = pkg

let getWindow: () => BrowserWindow | null = () => null
let wired = false

function send(status: UpdateStatus): void {
  getWindow()?.webContents.send(IPC.UPDATE_STATUS, status)
}

/**
 * Wire the GitHub-backed auto-updater. The `publish` config in package.json
 * (provider: github) is baked into app-update.yml at build time, so no repo
 * details are needed here. Updates only function in a packaged, installed build.
 */
export function initUpdater(resolveWindow: () => BrowserWindow | null): void {
  getWindow = resolveWindow
  if (wired) return
  wired = true

  // Let the user decide when to download and when to restart.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => {
    send({ state: 'available', version: info.version })
    // Begin downloading immediately; the UI shows progress and a restart button.
    autoUpdater.downloadUpdate().catch((e) => send({ state: 'error', message: errText(e) }))
  })
  autoUpdater.on('update-not-available', () => send({ state: 'not-available' }))
  autoUpdater.on('download-progress', (p) =>
    send({ state: 'downloading', percent: Math.round(p.percent) })
  )
  autoUpdater.on('update-downloaded', (info) =>
    send({ state: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', (e) => send({ state: 'error', message: errText(e) }))
}

/** Kick off a check. Returns the immediate status (async progress arrives via events). */
export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) return { state: 'unsupported' }
  try {
    send({ state: 'checking' })
    await autoUpdater.checkForUpdates()
    return { state: 'checking' }
  } catch (e) {
    const status: UpdateStatus = { state: 'error', message: errText(e) }
    send(status)
    return status
  }
}

/** Quit and install a downloaded update. */
export function installUpdate(): void {
  if (!app.isPackaged) return
  autoUpdater.quitAndInstall()
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
