import {
  app,
  dialog,
  net,
  session,
  nativeImage,
  type BrowserWindow,
  type OpenDialogOptions
} from 'electron'
import { promises as fs, existsSync } from 'fs'
import { get as httpsGetRaw } from 'https'
import { join } from 'path'
import { createHash } from 'crypto'
import AdmZip from 'adm-zip'
import type { ExtensionInfo } from '../shared/types'
import { loadJson, saveJson } from './store'

const FILE = 'extensions.json'
const managedDir = (): string => join(app.getPath('userData'), 'Extensions')

interface Loaded {
  info: ExtensionInfo
  source: string
  popupUrl: string | null
}
const loaded = new Map<string, Loaded>()

function savePersisted(): void {
  saveJson(FILE, [...loaded.values()].map((l) => l.source))
}

/** Unpack a .crx (CRX2/CRX3 = header + zip) into a managed folder, return its path. */
async function unpackCrx(crxPath: string): Promise<string> {
  const dir = join(managedDir(), createHash('sha1').update(crxPath).digest('hex').slice(0, 12))
  let buf: Buffer
  try {
    buf = await fs.readFile(crxPath)
  } catch (e) {
    // Archive gone but its unpacked copy survives — self-heal from that.
    if (existsSync(join(dir, 'manifest.json'))) return dir
    throw e
  }
  let zipStart = 0
  if (buf.subarray(0, 4).toString() === 'Cr24') {
    const version = buf.readUInt32LE(4)
    if (version === 3) {
      zipStart = 12 + buf.readUInt32LE(8)
    } else {
      zipStart = 16 + buf.readUInt32LE(8) + buf.readUInt32LE(12)
    }
  }
  await fs.rm(dir, { recursive: true, force: true })
  new AdmZip(buf.subarray(zipStart)).extractAllTo(dir, true)
  return dir
}

/** Best action/toolbar icon path from a manifest (MV2 or MV3). */
function pickIcon(m: Record<string, unknown>): string | null {
  const action = (m.action ?? m.browser_action ?? m.page_action) as { default_icon?: unknown } | undefined
  const di = action?.default_icon
  if (typeof di === 'string') return di
  const fromMap = (o: unknown): string | null =>
    o && typeof o === 'object'
      ? ((o as Record<string, string>)['32'] ??
        (o as Record<string, string>)['48'] ??
        (o as Record<string, string>)['16'] ??
        Object.values(o as Record<string, string>)[0] ??
        null)
      : null
  return fromMap(di) ?? fromMap(m.icons)
}

function iconDataUrl(extPath: string, m: Record<string, unknown>): string | null {
  const rel = pickIcon(m)
  if (!rel) return null
  try {
    const img = nativeImage.createFromPath(join(extPath, rel))
    return img.isEmpty() ? null : img.resize({ width: 32, height: 32 }).toDataURL()
  } catch {
    return null
  }
}

async function loadOne(source: string): Promise<ExtensionInfo | null> {
  try {
    const dir = source.toLowerCase().endsWith('.crx') ? await unpackCrx(source) : source
    if (!existsSync(dir)) return null
    const ext = await session.defaultSession.loadExtension(dir, { allowFileAccess: true })
    const m = ext.manifest as Record<string, unknown>
    const action = (m.action ?? m.browser_action) as { default_popup?: string } | undefined
    const popup = action?.default_popup ?? null
    const info: ExtensionInfo = {
      id: ext.id,
      name: ext.name,
      icon: iconDataUrl(ext.path, m),
      hasPopup: !!popup
    }
    loaded.set(ext.id, { info, source, popupUrl: popup ? ext.url + popup : null })
    console.log(`[ext] loaded "${ext.name}" (${ext.id}) popup=${!!popup} icon=${!!info.icon}`)
    return info
  } catch (e) {
    console.error('[ext] failed to load', source, e)
    return null
  }
}

/** Load all previously-added extensions (call once, after app ready). */
export async function initExtensions(): Promise<void> {
  await fs.mkdir(managedDir(), { recursive: true }).catch(() => {})
  for (const src of loadJson<string[]>(FILE, [])) await loadOne(src)
}

export function listExtensions(): ExtensionInfo[] {
  return [...loaded.values()].map((l) => l.info)
}

export function extensionPopupUrl(id: string): string | null {
  return loaded.get(id)?.popupUrl ?? null
}

/** Prompt for an unpacked folder or a .crx and load it. */
export async function addExtensionViaDialog(win: BrowserWindow | null): Promise<boolean> {
  const opts: OpenDialogOptions = {
    title: 'Load Chrome extension',
    message: 'Choose an unpacked extension folder or a .crx file',
    properties: ['openFile', 'openDirectory'],
    filters: [{ name: 'Chrome extension', extensions: ['crx'] }]
  }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || !res.filePaths[0]) return false
  const info = await loadOne(res.filePaths[0])
  if (info) savePersisted()
  return !!info
}

// Web Store extension IDs are 32 chars from the a–p alphabet.
const WEBSTORE_ID_RE = /[a-p]{32}/

/**
 * Install straight from a Chrome Web Store URL (or a bare extension ID):
 * download the .crx from Google's update endpoint, unpack, load, persist.
 */
/** Plain Node TLS download with redirect following — independent of any
 *  browser session, so ad blocking / fingerprinting / session state can't
 *  interfere. Used as fallback when Chromium's net.fetch fails. */
function httpsDownload(url: string, redirects = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    httpsGetRaw(url, { headers: { 'user-agent': 'Mozilla/5.0' } }, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
        res.resume()
        resolve(httpsDownload(new URL(res.headers.location, url).toString(), redirects - 1))
        return
      }
      if (status !== 200) {
        res.resume()
        reject(new Error(`Web Store download failed (HTTP ${status}).`))
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    }).on('error', reject)
  })
}

async function downloadCrx(url: string): Promise<Buffer> {
  try {
    const res = await net.fetch(url)
    if (!res.ok) throw new Error(`Web Store download failed (HTTP ${res.status}).`)
    return Buffer.from(await res.arrayBuffer())
  } catch (e) {
    console.error('[ext] net.fetch failed, retrying over Node TLS:', e)
    return httpsDownload(url)
  }
}

export async function installFromWebStore(input: string): Promise<ExtensionInfo> {
  const id = input.match(WEBSTORE_ID_RE)?.[0]
  if (!id) throw new Error('That does not look like a Chrome Web Store URL or extension ID.')
  // Already installed? Just report it — re-downloading would collide with the
  // loaded copy (and previously even deleted its archive).
  const existing = [...loaded.values()].find((l) => l.source.endsWith(`${id}.crx`))
  if (existing) return existing.info
  const crxUrl =
    'https://clients2.google.com/service/update2/crx?response=redirect' +
    `&prodversion=${process.versions.chrome}&acceptformat=crx2,crx3&x=id%3D${id}%26uc`
  const buf = await downloadCrx(crxUrl)
  await fs.mkdir(managedDir(), { recursive: true })
  const crxPath = join(managedDir(), `${id}.crx`)
  await fs.writeFile(crxPath, buf)
  const info = await loadOne(crxPath)
  if (!info) {
    await fs.rm(crxPath, { force: true }).catch(() => {})
    throw new Error('Downloaded, but it failed to load — it may need Chrome APIs Electron lacks.')
  }
  savePersisted()
  return info
}

export function removeExtension(id: string): void {
  const entry = loaded.get(id)
  if (!entry) return
  try {
    session.defaultSession.removeExtension(id)
  } catch {
    // already gone
  }
  loaded.delete(id)
  savePersisted()
  // Clean up managed files (downloaded .crx + its unpack dir); leave
  // user-owned unpacked folders alone.
  if (entry.source.startsWith(managedDir())) {
    const unpackDir = join(
      managedDir(),
      createHash('sha1').update(entry.source).digest('hex').slice(0, 12)
    )
    fs.rm(entry.source, { force: true }).catch(() => {})
    fs.rm(unpackDir, { recursive: true, force: true }).catch(() => {})
  }
}
