/**
 * Arc-style workspace registry. A workspace is an identity (name + color)
 * that OUTLIVES its tab group: closing the last tab keeps the workspace;
 * restarting the browser re-links workspaces to their restored groups.
 *
 * Storage:
 *   chrome.storage.local  "workspaces"        Workspace[] (persistent)
 *   chrome.storage.local  "activeWorkspaceId" string
 *   chrome.storage.session "wsLastActive"     { [workspaceId]: tabId }
 *
 * Used by both the side panel (UI actions) and the background worker
 * (adoption, reconcile, active-follow).
 */

import { restoreIfWiped, writeBackup } from './lib/backup'

export interface Workspace {
  id: string
  name: string
  color: string
  /** Live tab group backing this workspace, or null when it has no tabs. */
  groupId: number | null
}

export const WS_PALETTE = ['#8f5be8', '#4a7dfc', '#3fa15c', '#ec8a3b', '#e06f9c']

const HEX_TO_GROUP_COLOR: Record<string, chrome.tabGroups.ColorEnum> = {
  '#8f5be8': 'purple',
  '#4a7dfc': 'blue',
  '#3fa15c': 'green',
  '#ec8a3b': 'orange',
  '#e06f9c': 'pink'
}

const GROUP_COLOR_TO_HEX: Record<string, string> = {
  grey: '#8f8f94',
  blue: '#4a7dfc',
  red: '#e25c4a',
  yellow: '#f0a92a',
  green: '#3fa15c',
  pink: '#e06f9c',
  purple: '#8f5be8',
  cyan: '#3fb0c4',
  orange: '#ec8a3b'
}

export function groupColorFor(hex: string): chrome.tabGroups.ColorEnum {
  return HEX_TO_GROUP_COLOR[hex] ?? 'purple'
}

// ---------------------------------------------------------------------------
// Invisible workspace-id marker in group titles. Session restore preserves
// titles, so re-linking workspaces to their restored groups is EXACT instead
// of guessed from names (breaks with duplicate names) or slot order.
// ---------------------------------------------------------------------------
const MARK = '\u2063' // invisible separator: "Glint marker follows"
const ZW0 = '\u200b'
const ZW1 = '\u200c'

function idPrefix(wsId: string): string {
  return wsId.replace(/-/g, '').slice(0, 8)
}

function markerFor(wsId: string): string {
  const bits = [...idPrefix(wsId)].flatMap((h) =>
    parseInt(h, 16).toString(2).padStart(4, '0').split('')
  )
  return MARK + bits.map((b) => (b === '1' ? ZW1 : ZW0)).join('')
}

/** The full group title for a workspace: visible name + invisible id. */
export function groupTitleFor(ws: { id: string; name: string }): string {
  return ws.name + markerFor(ws.id)
}

/** Extracts the 8-hex workspace id prefix from a marked title, or null. */
function parseMarkedId(title: string): string | null {
  const i = title.indexOf(MARK)
  if (i === -1) return null
  const bits = [...title.slice(i + 1)]
    .map((c) => (c === ZW1 ? '1' : c === ZW0 ? '0' : ''))
    .join('')
  if (bits.length < 32) return null
  let hex = ''
  for (let k = 0; k < 32; k += 4) {
    hex += parseInt(bits.slice(k, k + 4), 2).toString(16)
  }
  return hex
}

/** Group title without the invisible marker (for display / name sync).
 *  Aggressive: also removes stray marker characters anywhere — corrupted
 *  names/titles with accumulated markers must never survive a pass. */
export function stripMarker(title: string): string {
  const i = title.indexOf(MARK)
  return (i === -1 ? title : title.slice(0, i)).replace(/[\u2063\u200b\u200c]/g, '')
}

export interface WorkspaceState {
  workspaces: Workspace[]
  activeId: string
}

export async function loadWorkspaces(windowId?: number): Promise<{
  workspaces: Workspace[]
  activeId: string | null
}> {
  const { workspaces, activeWorkspaceId } = await chrome.storage.local.get([
    'workspaces',
    'activeWorkspaceId'
  ])
  let activeId = (activeWorkspaceId as string) ?? null
  if (windowId !== undefined) {
    // Active workspace is PER WINDOW, so two windows can show different
    // workspaces (and different profile tabs) at the same time instead of
    // mirroring each other. windowIds are per-session, so this map lives in
    // session storage; activeWorkspaceId stays as the global last-active
    // fallback for new windows and restarts.
    const { activeByWindow } = await chrome.storage.session.get('activeByWindow')
    const perWindow = (activeByWindow as Record<string, string>)?.[String(windowId)]
    if (perWindow) activeId = perWindow
  }
  return {
    workspaces: (workspaces as Workspace[]) ?? [],
    activeId
  }
}

/** Records the active workspace for a window (and as the global last-active). */
export async function setWindowActiveWorkspace(
  windowId: number,
  activeId: string
): Promise<void> {
  await chrome.storage.local.set({ activeWorkspaceId: activeId })
  const { activeByWindow } = await chrome.storage.session.get('activeByWindow')
  const map = (activeByWindow as Record<string, string>) ?? {}
  if (map[String(windowId)] !== activeId) {
    map[String(windowId)] = activeId
    await chrome.storage.session.set({ activeByWindow: map })
  }
}

async function saveWorkspaces(
  workspaces: Workspace[],
  activeId: string,
  windowId?: number
): Promise<void> {
  await chrome.storage.local.set({ workspaces, activeWorkspaceId: activeId })
  if (windowId !== undefined) {
    await setWindowActiveWorkspace(windowId, activeId)
  }
  // Keep the durable backup current (local snapshot + throttled storage.sync
  // mirror) so a later crash/corruption self-heals instead of wiping spaces.
  void writeBackup().catch(() => {})
}

async function currentWindowId(): Promise<number> {
  // getCurrent() has no meaning in the background service worker (no
  // ambient window) — resolve the last focused normal window instead, and
  // fall back to getCurrent for panel contexts.
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] })
    if (win.id !== undefined) return win.id
  } catch {
    // fall through
  }
  const win = await chrome.windows.getCurrent()
  return win.id!
}

/**
 * Aligns the registry with reality (existing tab groups). Groups keep their
 * ids within a session but get NEW ids after a restart — re-link by group id
 * first, then by title. Unknown groups become new workspaces; workspaces
 * whose group died stay, with groupId = null.
 */
export async function reconcileWorkspaces(windowId?: number): Promise<WorkspaceState> {
  let win: number
  try {
    win = windowId ?? (await currentWindowId())
  } catch {
    // No window yet (startup / session restore in flight): report the stored
    // state untouched — the next call self-heals once reality exists.
    const stored = await loadWorkspaces()
    return { workspaces: stored.workspaces, activeId: stored.activeId ?? '' }
  }
  // Self-heal BEFORE reading: if the registry was wiped (crash/LevelDB
  // corruption) but a durable backup has real workspaces, restore it so we
  // never cement a fresh "Personal" over the lost spaces. No-op when healthy.
  await restoreIfWiped().catch(() => null)
  const groups = await chrome.tabGroups.query({ windowId: win })
  const { workspaces, activeId } = await loadWorkspaces(win)
  const before = JSON.stringify({ workspaces, activeId })

  const liveIds = new Set(groups.map((g) => g.id))
  const claimed = new Set<number>()

  // Sanitation: registry names must never contain marker characters — a
  // polluted name makes every stamping pass append another marker, and the
  // ballooning titles CHECK-crash the browser's session save.
  for (const w of workspaces) {
    const clean = stripMarker(w.name)
    if (clean !== w.name) w.name = clean || 'Space'
  }

  // Cleanup: two registry entries must never share a group, and identical
  // empty duplicates (damage from historical double-writer sessions) collapse.
  {
    const seenGroups = new Set<number>()
    for (const w of workspaces) {
      if (w.groupId !== null) {
        if (seenGroups.has(w.groupId)) w.groupId = null
        else seenGroups.add(w.groupId)
      }
    }
    const seenEmpty = new Set<string>()
    for (let i = workspaces.length - 1; i >= 0; i--) {
      const w = workspaces[i]
      if (w.groupId === null) {
        const key = w.name + '|' + w.color
        if (seenEmpty.has(key)) workspaces.splice(i, 1)
        else seenEmpty.add(key)
      }
    }
  }

  // Pass 1: same-session links by group id.
  for (const ws of workspaces) {
    if (ws.groupId !== null && liveIds.has(ws.groupId) && !claimed.has(ws.groupId)) {
      claimed.add(ws.groupId)
    } else {
      ws.groupId = null
    }
  }
  // Pass 2: EXACT re-link via the invisible id marker in group titles
  // (restored groups have new ids but keep their titles).
  for (const ws of workspaces) {
    if (ws.groupId !== null) continue
    const pref = idPrefix(ws.id)
    const match = groups.find(
      (g) => !claimed.has(g.id) && parseMarkedId(g.title ?? '') === pref
    )
    if (match) {
      ws.groupId = match.id
      claimed.add(match.id)
    }
  }
  // Pass 3 (legacy, unmarked groups only): match by visible title.
  for (const ws of workspaces) {
    if (ws.groupId !== null) continue
    const match = groups.find(
      (g) =>
        !claimed.has(g.id) &&
        parseMarkedId(g.title ?? '') === null &&
        g.title !== '' &&
        g.title === ws.name
    )
    if (match) {
      ws.groupId = match.id
      claimed.add(match.id)
    }
  }
  // Pass 4 (legacy, unmarked only): remaining groups fill empty workspaces in
  // order. Pass 5: anything still unclaimed becomes a new workspace.
  for (const g of groups) {
    if (claimed.has(g.id)) continue
    const marked = parseMarkedId(g.title ?? '') !== null
    const empty = marked ? undefined : workspaces.find((w) => w.groupId === null)
    if (empty) {
      empty.groupId = g.id
      claimed.add(g.id)
    } else {
      workspaces.push({
        id: crypto.randomUUID(),
        name: stripMarker(g.title ?? '') || `Space ${workspaces.length + 1}`,
        color: GROUP_COLOR_TO_HEX[g.color] ?? WS_PALETTE[0],
        groupId: g.id
      })
      claimed.add(g.id)
    }
  }

  if (workspaces.length === 0) {
    workspaces.push({
      id: crypto.randomUUID(),
      name: 'Personal',
      color: WS_PALETTE[0],
      groupId: null
    })
  }

  // Every linked group carries "name + invisible id marker" as its title —
  // this also transitions pre-marker sessions in place.
  for (const ws of workspaces) {
    if (ws.groupId === null) continue
    const g = groups.find((x) => x.id === ws.groupId)
    if (!g) continue
    const wanted = groupTitleFor(ws)
    if ((g.title ?? '') !== wanted) {
      void chrome.tabGroups.update(ws.groupId, { title: wanted }).catch(() => {})
    }
  }

  // Distinct colors: adopted groups often share one color — give duplicates
  // the first unused palette color so every dot reads differently.
  const seen = new Set<string>()
  for (const ws of workspaces) {
    if (seen.has(ws.color)) {
      const free = WS_PALETTE.find((c) => !seen.has(c))
      if (free) {
        ws.color = free
        if (ws.groupId !== null) {
          void chrome.tabGroups
            .update(ws.groupId, { color: groupColorFor(free) })
            .catch(() => {})
        }
      }
    }
    seen.add(ws.color)
  }

  let active = activeId && workspaces.some((w) => w.id === activeId) ? activeId : null
  if (!active) active = workspaces[0].id

  // The focused tab is ground truth: the user is IN the workspace that owns
  // the active tab's group (missed follow events — e.g. session restore or
  // cross-profile tabs — otherwise leave the sidebar showing the wrong one).
  // Exception: a deliberately selected EMPTY workspace stays selected — the
  // old tab keeps focus (there is nothing to focus here yet).
  const activeEntry = workspaces.find((w) => w.id === active)
  if (!activeEntry || activeEntry.groupId !== null) {
    try {
      const [activeTab] = await chrome.tabs.query({ windowId: win, active: true })
      if (activeTab && activeTab.groupId !== undefined && activeTab.groupId !== -1) {
        const owner = workspaces.find((w) => w.groupId === activeTab.groupId)
        if (owner) active = owner.id
      }
    } catch {
      // window mid-teardown
    }
  }

  // Only persist when something actually changed — reconcile runs on every
  // panel render, and an unconditional write would loop via storage.onChanged.
  if (JSON.stringify({ workspaces, activeId: active }) !== before) {
    await saveWorkspaces(workspaces, active, win)
  }
  return { workspaces, activeId: active }
}

// True while activateWorkspace materializes a group for an empty workspace.
// The background adoption listener checks this (same module instance in the
// service worker) so it doesn't race the new tab into the OLD active group.
let materializing = false

export function isMaterializing(): boolean {
  return materializing
}

async function rememberTab(workspaceId: string, tabId: number): Promise<void> {
  const { wsLastActive } = await chrome.storage.session.get('wsLastActive')
  const map = (wsLastActive as Record<string, number>) ?? {}
  map[workspaceId] = tabId
  await chrome.storage.session.set({ wsLastActive: map })
}

/** Ensures the workspace has a live group (creates one with a fresh tab when
 *  empty), then focuses its remembered — or first — tab. */
export async function activateWorkspace(id: string, windowId?: number): Promise<void> {
  const win = windowId ?? (await currentWindowId())
  const state = await reconcileWorkspaces(win)
  const ws = state.workspaces.find((w) => w.id === id)
  if (!ws) return

  if (ws.groupId === null) {
    // Switching to an empty workspace shows it EMPTY — no tab is created
    // (the scroll gesture cycles past empty workspaces without side
    // effects). The first tab opened here materializes the group via the
    // background adoption listener.
    await saveWorkspaces(state.workspaces, id, win)
    return
  }

  const tabs = await chrome.tabs.query({ windowId: win, groupId: ws.groupId })
  if (tabs.length === 0) {
    ws.groupId = null
    await saveWorkspaces(state.workspaces, id, win)
    return activateWorkspace(id, win)
  }
  const { wsLastActive } = await chrome.storage.session.get('wsLastActive')
  const remembered = ((wsLastActive as Record<string, number>) ?? {})[id]
  const target = tabs.find((t) => t.id === remembered) ?? tabs[0]
  await saveWorkspaces(state.workspaces, id, win)
  await chrome.tabs.update(target.id!, { active: true })
}

export async function createWorkspace(
  name?: string,
  windowId?: number
): Promise<string> {
  const win = windowId ?? (await currentWindowId())
  const state = await reconcileWorkspaces(win)
  const ws: Workspace = {
    id: crypto.randomUUID(),
    name: name ?? `Space ${state.workspaces.length + 1}`,
    color: WS_PALETTE[state.workspaces.length % WS_PALETTE.length],
    groupId: null
  }
  state.workspaces.push(ws)
  await saveWorkspaces(state.workspaces, state.activeId, win)
  await activateWorkspace(ws.id, win)
  return ws.id
}

export async function renameWorkspace(id: string, name: string): Promise<void> {
  const state = await reconcileWorkspaces()
  const ws = state.workspaces.find((w) => w.id === id)
  if (!ws) return
  ws.name = name
  await saveWorkspaces(state.workspaces, state.activeId)
  if (ws.groupId !== null) {
    await chrome.tabGroups
      .update(ws.groupId, { title: groupTitleFor(ws) })
      .catch(() => {})
  }
}

/** Cycles the workspace through the Glint palette (dot + group color). */
export async function cycleWorkspaceColor(id: string): Promise<void> {
  const state = await reconcileWorkspaces()
  const ws = state.workspaces.find((w) => w.id === id)
  if (!ws) return
  const next = WS_PALETTE[(WS_PALETTE.indexOf(ws.color) + 1) % WS_PALETTE.length]
  ws.color = next
  await saveWorkspaces(state.workspaces, state.activeId)
  if (ws.groupId !== null) {
    await chrome.tabGroups.update(ws.groupId, { color: groupColorFor(next) }).catch(() => {})
  }
}

/** Arc-style delete: closes the workspace's tabs. The last workspace is
 *  replaced with a fresh one so the browser never has zero workspaces. */
export async function deleteWorkspace(id: string): Promise<void> {
  const win = await currentWindowId()
  const state = await reconcileWorkspaces(win)
  const index = state.workspaces.findIndex((w) => w.id === id)
  if (index === -1) return
  const [ws] = state.workspaces.splice(index, 1)

  if (state.workspaces.length === 0) {
    state.workspaces.push({
      id: crypto.randomUUID(),
      name: 'Personal',
      color: WS_PALETTE[0],
      groupId: null
    })
  }
  const nextActive = state.workspaces[Math.max(0, index - 1)].id
  await saveWorkspaces(state.workspaces, nextActive, win)

  // Activate the neighbour BEFORE closing tabs: closing the active tab would
  // otherwise make Chromium focus some arbitrary tab in another group.
  await activateWorkspace(nextActive, win)

  if (ws.groupId !== null) {
    const tabs = await chrome.tabs.query({ windowId: win, groupId: ws.groupId })
    const ids = tabs.map((t) => t.id).filter((x): x is number => x !== undefined)
    if (ids.length > 0) {
      await chrome.tabs.remove(ids).catch(() => {})
    }
  }
}

/** Group id → workspace id lookup map. */
export function workspaceByGroup(workspaces: Workspace[]): Map<number, string> {
  const map = new Map<number, string>()
  for (const ws of workspaces) {
    if (ws.groupId !== null) map.set(ws.groupId, ws.id)
  }
  return map
}

/** Applies the Glint theme setting to the document (explicit beats OS). */
export function applyThemeAttribute(theme: 'system' | 'light' | 'dark'): void {
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme
  document.documentElement.dataset.theme = resolved
}

// The Liquid Glass chrome (macOS 26+) is dark translucent no matter the
// theme — the PANEL always uses the dark palette + pure white text so icons
// and labels stay readable over the glass (Zen-style). Detected via the
// real platform version (the UA string is frozen).
let glassUi = false

export function isGlassUi(): boolean {
  return glassUi
}

export async function detectGlassUi(): Promise<boolean> {
  try {
    const uad = (
      navigator as unknown as {
        userAgentData?: {
          platform: string
          getHighEntropyValues: (k: string[]) => Promise<{ platformVersion?: string }>
        }
      }
    ).userAgentData
    if (uad?.platform === 'macOS') {
      const { platformVersion } = await uad.getHighEntropyValues(['platformVersion'])
      glassUi = parseInt((platformVersion ?? '0').split('.')[0], 10) >= 26
    }
  } catch {
    glassUi = false
  }
  document.documentElement.dataset.glass = glassUi ? 'true' : 'false'
  return glassUi
}
