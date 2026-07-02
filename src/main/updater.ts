import { app, BrowserWindow, shell } from 'electron'
import { spawn } from 'child_process'
import { createWriteStream } from 'fs'
import { unlink } from 'fs/promises'
import https from 'https'
import { tmpdir } from 'os'
import { join } from 'path'
import { IPC, type UpdateStatus } from '../shared/types'

// A dependency-free updater backed by GitHub Releases. We deliberately avoid
// electron-updater here: on Electron 35 (Windows) its net-based check crashed
// the packaged process with no catchable error. Plain Node HTTPS + running the
// published installer is simpler and rock-solid. The GitHub Actions workflow
// still publishes the installer as a release asset, which is all this needs.
const OWNER = 'Glint-browser'
const REPO = 'desktop'
const API_LATEST = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`

let getWindow: () => BrowserWindow | null = () => null
// Path to a downloaded installer awaiting a restart-to-install.
let pendingInstaller: string | null = null

function send(status: UpdateStatus): void {
  const w = getWindow()
  if (w && !w.isDestroyed() && !w.webContents.isDestroyed()) {
    w.webContents.send(IPC.UPDATE_STATUS, status)
  }
}

export function initUpdater(resolveWindow: () => BrowserWindow | null): void {
  getWindow = resolveWindow
}

/** Compare dotted versions; returns >0 if a is newer than b. */
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

/** The release asset that installs an update on this platform. */
function assetSuffix(): string {
  return process.platform === 'darwin' ? '.dmg' : '.exe'
}

interface GhAsset {
  name: string
  browser_download_url: string
}
interface GhRelease {
  tag_name: string
  assets: GhAsset[]
}

/** GET a URL as JSON, following redirects. */
function getJson<T>(url: string, redirectsLeft = 5): Promise<T> {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'Glint-Browser-Updater',
            Accept: 'application/vnd.github+json'
          }
        },
        (res) => {
          const { statusCode = 0, headers } = res
          if (statusCode >= 300 && statusCode < 400 && headers.location) {
            if (redirectsLeft <= 0) return reject(new Error('Too many redirects'))
            res.resume()
            return resolve(getJson<T>(headers.location, redirectsLeft - 1))
          }
          if (statusCode !== 200) {
            res.resume()
            return reject(new Error(`GitHub returned HTTP ${statusCode}`))
          }
          let body = ''
          res.setEncoding('utf8')
          res.on('data', (c) => (body += c))
          res.on('end', () => {
            try {
              resolve(JSON.parse(body) as T)
            } catch (e) {
              reject(e)
            }
          })
        }
      )
      .on('error', reject)
  })
}

/** Download a URL to `dest`, following redirects and reporting percent. */
function download(
  url: string,
  dest: string,
  onProgress: (percent: number) => void,
  redirectsLeft = 5
): Promise<void> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'Glint-Browser-Updater' } }, (res) => {
        const { statusCode = 0, headers } = res
        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          if (redirectsLeft <= 0) return reject(new Error('Too many redirects'))
          res.resume()
          return resolve(download(headers.location, dest, onProgress, redirectsLeft - 1))
        }
        if (statusCode !== 200) {
          res.resume()
          return reject(new Error(`Download failed: HTTP ${statusCode}`))
        }
        const total = parseInt(headers['content-length'] || '0', 10)
        let received = 0
        const file = createWriteStream(dest)
        res.on('data', (chunk) => {
          received += chunk.length
          if (total) onProgress(Math.round((received / total) * 100))
        })
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve()))
        file.on('error', reject)
      })
      .on('error', reject)
  })
}

/** Check GitHub for a newer release; download its installer if found. */
export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) return { state: 'unsupported' }
  try {
    send({ state: 'checking' })
    let release: GhRelease
    try {
      release = await getJson<GhRelease>(API_LATEST)
    } catch (e) {
      // 404 from the "latest release" endpoint means the repo has no published
      // releases yet — i.e. there is nothing newer to update to.
      if (e instanceof Error && e.message.includes('HTTP 404')) {
        send({ state: 'not-available' })
        return { state: 'not-available' }
      }
      throw e
    }
    const latest = release.tag_name.replace(/^v/, '')
    if (compareVersions(latest, app.getVersion()) <= 0) {
      const status: UpdateStatus = { state: 'not-available' }
      send(status)
      return status
    }
    const asset = release.assets.find((a) => a.name.toLowerCase().endsWith(assetSuffix()))
    if (!asset) {
      const status: UpdateStatus = {
        state: 'error',
        message: `Release ${latest} has no ${assetSuffix()} installer.`
      }
      send(status)
      return status
    }
    send({ state: 'available', version: latest })
    const dest = join(tmpdir(), asset.name)
    await unlink(dest).catch(() => {})
    await download(asset.browser_download_url, dest, (percent) =>
      send({ state: 'downloading', percent })
    )
    pendingInstaller = dest
    send({ state: 'downloaded', version: latest })
    return { state: 'downloaded', version: latest }
  } catch (e) {
    const status: UpdateStatus = { state: 'error', message: e instanceof Error ? e.message : String(e) }
    send(status)
    return status
  }
}

/** Run the downloaded installer and quit so it can replace the app. */
export function installUpdate(): void {
  if (!pendingInstaller) return
  if (process.platform === 'win32') {
    // The NSIS installer updates in place and relaunches the app.
    spawn(pendingInstaller, [], { detached: true, stdio: 'ignore' }).unref()
    app.quit()
  } else {
    // macOS: open the .dmg so the user can drag the new app over the old one.
    shell.openPath(pendingInstaller)
    app.quit()
  }
}
