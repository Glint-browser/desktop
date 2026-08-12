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

export interface WorkspaceState {
  workspaces: Workspace[]
  activeId: string
}

export async function loadWorkspaces(): Promise<{
  workspaces: Workspace[]
  activeId: string | null
}> {
  const { workspaces, activeWorkspaceId } = await chrome.storage.local.get([
    'workspaces',
    'activeWorkspaceId'
  ])
  return {
    workspaces: (workspaces as Workspace[]) ?? [],
    activeId: (activeWorkspaceId as string) ?? null
  }
}

async function saveWorkspaces(workspaces: Workspace[], activeId: string): Promise<void> {
  await chrome.storage.local.set({ workspaces, activeWorkspaceId: activeId })
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
  const groups = await chrome.tabGroups.query({ windowId: win })
  const { workspaces, activeId } = await loadWorkspaces()
  const before = JSON.stringify({ workspaces, activeId })

  const liveIds = new Set(groups.map((g) => g.id))
  const claimed = new Set<number>()

  // Pass 1: keep live group links. Pass 2: re-link by title (session restore
  // hands groups new ids but keeps titles).
  for (const ws of workspaces) {
    if (ws.groupId !== null && liveIds.has(ws.groupId) && !claimed.has(ws.groupId)) {
      claimed.add(ws.groupId)
    } else {
      ws.groupId = null
    }
  }
  for (const ws of workspaces) {
    if (ws.groupId !== null) continue
    const match = groups.find(
      (g) => !claimed.has(g.id) && g.title !== '' && g.title === ws.name
    )
    if (match) {
      ws.groupId = match.id
      claimed.add(match.id)
    }
  }

  // Pass 3: unclaimed groups FILL empty workspaces (in order) — the registry
  // is the source of truth, so the group takes the workspace's name/color.
  // Pass 4: still-unclaimed groups become new workspaces.
  for (const g of groups) {
    if (claimed.has(g.id)) continue
    const empty = workspaces.find((w) => w.groupId === null)
    if (empty) {
      empty.groupId = g.id
      claimed.add(g.id)
      void chrome.tabGroups
        .update(g.id, { title: empty.name, color: groupColorFor(empty.color) })
        .catch(() => {})
    } else {
      workspaces.push({
        id: crypto.randomUUID(),
        name: g.title || `Space ${workspaces.length + 1}`,
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
  try {
    const [activeTab] = await chrome.tabs.query({ windowId: win, active: true })
    if (activeTab && activeTab.groupId !== undefined && activeTab.groupId !== -1) {
      const owner = workspaces.find((w) => w.groupId === activeTab.groupId)
      if (owner) active = owner.id
    }
  } catch {
    // window mid-teardown
  }

  // Only persist when something actually changed — reconcile runs on every
  // panel render, and an unconditional write would loop via storage.onChanged.
  if (JSON.stringify({ workspaces, activeId: active }) !== before) {
    await saveWorkspaces(workspaces, active)
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
    materializing = true
    try {
      const tab = await chrome.tabs.create({ active: true, windowId: win })
      const groupId = await chrome.tabs.group({ tabIds: [tab.id!] })
      await chrome.tabGroups.update(groupId, {
        title: ws.name,
        color: groupColorFor(ws.color)
      })
      ws.groupId = groupId
      await saveWorkspaces(state.workspaces, id)
      await rememberTab(id, tab.id!)
    } finally {
      materializing = false
    }
    return
  }

  const tabs = await chrome.tabs.query({ windowId: win, groupId: ws.groupId })
  if (tabs.length === 0) {
    ws.groupId = null
    await saveWorkspaces(state.workspaces, id)
    return activateWorkspace(id, win)
  }
  const { wsLastActive } = await chrome.storage.session.get('wsLastActive')
  const remembered = ((wsLastActive as Record<string, number>) ?? {})[id]
  const target = tabs.find((t) => t.id === remembered) ?? tabs[0]
  await saveWorkspaces(state.workspaces, id)
  await chrome.tabs.update(target.id!, { active: true })
}

export async function createWorkspace(name?: string): Promise<string> {
  const state = await reconcileWorkspaces()
  const ws: Workspace = {
    id: crypto.randomUUID(),
    name: name ?? `Space ${state.workspaces.length + 1}`,
    color: WS_PALETTE[state.workspaces.length % WS_PALETTE.length],
    groupId: null
  }
  state.workspaces.push(ws)
  await saveWorkspaces(state.workspaces, state.activeId)
  await activateWorkspace(ws.id)
  return ws.id
}

export async function renameWorkspace(id: string, name: string): Promise<void> {
  const state = await reconcileWorkspaces()
  const ws = state.workspaces.find((w) => w.id === id)
  if (!ws) return
  ws.name = name
  await saveWorkspaces(state.workspaces, state.activeId)
  if (ws.groupId !== null) {
    await chrome.tabGroups.update(ws.groupId, { title: name }).catch(() => {})
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
  await saveWorkspaces(state.workspaces, nextActive)

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
