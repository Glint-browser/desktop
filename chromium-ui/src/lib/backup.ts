/**
 * Durability for the Glint UI's critical state.
 *
 * Everything that defines "your browser" — workspaces, the active workspace,
 * pins/favorites, bookmark-folder placement and settings — lives in the
 * extension's chrome.storage.local (one LevelDB). A hard crash can corrupt
 * that store; Chromium then resets it to empty and the reconcile logic used to
 * cement a fresh "Personal" over the loss.
 *
 * This module adds three layers so a wipe is survivable:
 *   1. A full snapshot in a local backup key (cheap, same store).
 *   2. A mirror of the small critical subset to chrome.storage.sync — a
 *      SEPARATE backing store, so it survives storage.local corruption, and
 *      (when the profile is signed in) is backed up server-side + synced across
 *      devices.
 *   3. Export / import to a JSON file the user keeps — survives anything.
 *
 * restoreIfWiped() self-heals: if the primary registry is empty but a backup
 * has workspaces, it restores before anything overwrites the empty state.
 */

/** Keys that make up the user's core, hard-to-recreate state. */
const CORE_KEYS = [
  'workspaces',
  'activeWorkspaceId',
  'pinMeta',
  'folderSpace',
  'settings'
] as const

const LOCAL_KEY = 'glintBackup'
/** Small critical subset mirrored to storage.sync (quota-limited). */
const SYNC_KEY = 'glintBackupSync'
const CURRENT_VERSION = 1 as const

export interface GlintBackup {
  version: number
  ts: number
  workspaces: unknown[]
  activeWorkspaceId: unknown
  pinMeta: unknown
  folderSpace: unknown
  settings: unknown
}

function hasWorkspaces(b: Partial<GlintBackup> | null | undefined): b is GlintBackup {
  return !!b && Array.isArray(b.workspaces) && b.workspaces.length > 0
}

/** Reads the current core state from storage.local. */
export async function snapshot(): Promise<GlintBackup> {
  const r = await chrome.storage.local.get([...CORE_KEYS])
  return {
    version: CURRENT_VERSION,
    ts: Date.now(),
    workspaces: (r.workspaces as unknown[]) ?? [],
    activeWorkspaceId: r.activeWorkspaceId ?? null,
    pinMeta: r.pinMeta ?? {},
    folderSpace: r.folderSpace ?? {},
    settings: r.settings ?? null
  }
}

let lastSyncWrite = 0

/**
 * Persists a backup of the current state. No-op when the current state is
 * empty but a good backup already exists — a wipe must never propagate into
 * the backup. The storage.sync mirror is throttled (sync has write-rate and
 * per-item size quotas) and only carries the small workspace/settings subset.
 */
export async function writeBackup(): Promise<void> {
  const snap = await snapshot()
  if (!hasWorkspaces(snap)) {
    const existing = await readBackup()
    if (hasWorkspaces(existing)) return // don't overwrite a good backup with a wipe
  }
  await chrome.storage.local.set({ [LOCAL_KEY]: snap })

  const now = Date.now()
  if (now - lastSyncWrite < 30_000) return
  const small = {
    version: CURRENT_VERSION,
    ts: snap.ts,
    workspaces: snap.workspaces,
    activeWorkspaceId: snap.activeWorkspaceId,
    settings: snap.settings
  }
  // Stay under QUOTA_BYTES_PER_ITEM (~8 KB). Workspaces are tiny; skip the
  // sync mirror rather than throw if a pathological case is too big.
  const bytes = new Blob([JSON.stringify(small)]).size
  if (bytes >= 7500) return
  lastSyncWrite = now
  try {
    await chrome.storage.sync.set({ [SYNC_KEY]: small })
  } catch {
    // offline, signed out, or quota — the local backup still stands.
  }
}

/** Best available backup: local full snapshot, else the storage.sync mirror. */
export async function readBackup(): Promise<GlintBackup | null> {
  const r = await chrome.storage.local.get(LOCAL_KEY)
  const local = r[LOCAL_KEY] as GlintBackup | undefined
  if (hasWorkspaces(local)) return local
  try {
    const s = await chrome.storage.sync.get(SYNC_KEY)
    const sync = s[SYNC_KEY] as Partial<GlintBackup> | undefined
    if (hasWorkspaces(sync)) {
      return {
        version: sync.version ?? CURRENT_VERSION,
        ts: sync.ts ?? 0,
        workspaces: sync.workspaces,
        activeWorkspaceId: sync.activeWorkspaceId ?? null,
        pinMeta: {},
        folderSpace: {},
        settings: sync.settings ?? null
      }
    }
  } catch {
    // storage.sync unavailable — nothing more to try.
  }
  return null
}

async function applyBackup(b: GlintBackup): Promise<void> {
  await chrome.storage.local.set({
    workspaces: b.workspaces,
    activeWorkspaceId: b.activeWorkspaceId ?? null,
    pinMeta: b.pinMeta ?? {},
    folderSpace: b.folderSpace ?? {},
    ...(b.settings ? { settings: b.settings } : {})
  })
}

/**
 * If the primary workspace registry is empty/missing but a backup has real
 * workspaces, restore the core keys and return the backup. Safe to call
 * unconditionally before reconcile — it no-ops when the registry is healthy.
 */
export async function restoreIfWiped(): Promise<GlintBackup | null> {
  const cur = await chrome.storage.local.get('workspaces')
  const ws = cur.workspaces as unknown[] | undefined
  if (Array.isArray(ws) && ws.length > 0) return null
  const b = await readBackup()
  if (!hasWorkspaces(b)) return null
  await applyBackup(b)
  return b
}

/** Pretty JSON for the user to download and keep. */
export async function exportBackupJson(): Promise<string> {
  return JSON.stringify(await snapshot(), null, 2)
}

/** Restores from a user-provided backup file. Throws on an invalid file. */
export async function importBackupJson(json: string): Promise<GlintBackup> {
  let b: GlintBackup
  try {
    b = JSON.parse(json) as GlintBackup
  } catch {
    throw new Error('Not a valid Glint backup file (bad JSON).')
  }
  if (!b || !Array.isArray(b.workspaces)) {
    throw new Error('Not a valid Glint backup file (no workspaces).')
  }
  await applyBackup(b)
  await writeBackup()
  return b
}
