import { app, session, type Session } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import { fullLists } from '@ghostery/adblocker'

let blocker: ElectronBlocker | null = null
let enabled = false
const activeSessions = new Set<Session>()

// Extra filter lists on top of the full uBlock Origin set. Nordic sites are
// poorly covered by EasyList; Dandelion Sprout's list is what uBO itself uses
// for its "NOR" regional option.
const EXTRA_LISTS = [
  'https://raw.githubusercontent.com/DandelionSprout/adfilt/master/NorwegianList.txt'
]

// Rebuild the engine from fresh lists once a day; between rebuilds the
// serialized engine loads instantly from disk.
const CACHE_FILE = 'adblock-engine-v2.bin'
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000

async function cacheIsStale(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path)
    return Date.now() - stat.mtimeMs > MAX_CACHE_AGE_MS
  } catch {
    return false // no cache yet — nothing to invalidate
  }
}

/**
 * Build the filtering engine: full uBlock Origin lists (incl. YouTube video-ad
 * scriptlets) + Nordic filters, cached to disk and refreshed daily.
 */
async function getBlocker(): Promise<ElectronBlocker> {
  if (blocker) return blocker
  const cachePath = join(app.getPath('userData'), CACHE_FILE)
  // Force a re-download of the lists when the cached engine is a day old.
  if (await cacheIsStale(cachePath)) await fs.rm(cachePath, { force: true }).catch(() => {})
  try {
    blocker = await ElectronBlocker.fromLists(
      fetch,
      [...fullLists, ...EXTRA_LISTS],
      { enableCompression: true },
      { path: cachePath, read: fs.readFile, write: fs.writeFile }
    )
    console.log('[adblock] engine ready (full + nordic lists)')
  } catch (e) {
    // Offline / list fetch failed — fall back to the bundled prebuilt engine
    // (cached under the old name if we ever built it before).
    console.error('[adblock] list build failed, using prebuilt fallback:', e)
    blocker = await ElectronBlocker.fromPrebuiltFull(fetch, {
      path: join(app.getPath('userData'), 'adblock-engine-full.bin'),
      read: fs.readFile,
      write: fs.writeFile
    })
  }
  return blocker
}

function enableOn(ses: Session): void {
  if (!enabled || !blocker || activeSessions.has(ses)) return
  blocker.enableBlockingInSession(ses)
  activeSessions.add(ses)
}

/** Turn ad/tracker blocking on or off for the default browsing session. */
export async function setAdblockEnabled(on: boolean): Promise<void> {
  enabled = on
  if (on) {
    await getBlocker()
    enableOn(session.defaultSession)
  } else if (blocker) {
    for (const ses of activeSessions) blocker.disableBlockingInSession(ses)
    activeSessions.clear()
  }
}

/** Enable blocking on a profile's isolated session (called per new tab view). */
export async function enableAdblockForSession(ses: Session): Promise<void> {
  if (!enabled || ses === session.defaultSession) return
  await getBlocker()
  enableOn(ses)
}
