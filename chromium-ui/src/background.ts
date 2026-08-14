/**
 * Glint background worker: workspace (Arc-style) bookkeeping.
 *  - Toolbar icon opens the side panel.
 *  - Every new tab is adopted into the ACTIVE workspace's group; a new tab in
 *    an empty workspace materializes its group.
 *  - The active workspace FOLLOWS tab activation (native Ctrl+1..9 jumps a
 *    tab group — the registry catches up here, and the panel slides along).
 *  - When a group dies (last tab closed) the workspace survives with
 *    groupId = null.
 *  - Cleans up pin metadata when tabs close.
 */
import {
  activateWorkspace,
  createWorkspace,
  groupColorFor,
  groupTitleFor,
  isMaterializing,
  loadWorkspaces,
  reconcileWorkspaces,
  stripMarker,
  workspaceByGroup
} from './workspaces'

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})


// Session restore recreates tabs BEFORE re-attaching them to their groups —
// tabs.onCreated fires while groupId is still -1. Adopting them then rips
// restored tabs into the wrong groups and scrambles every workspace. Real
// browser launches (onStartup/onInstalled) open a grace window during which
// adoption stands down; an alarm afterwards sweeps up genuinely-new strays.
// storage.session survives service-worker restarts but not browser restarts,
// so a mid-session SW wake-up does NOT re-open the window.
const STARTUP_GRACE_MS = 15_000

async function beginStartupGrace(): Promise<void> {
  await chrome.storage.session
    .set({ startupGraceUntil: Date.now() + STARTUP_GRACE_MS })
    .catch(() => {})
  chrome.alarms.create('glint-adopt-sweep', { when: Date.now() + STARTUP_GRACE_MS + 1000 })
  void reconcileWorkspaces().catch(() => {})
}

async function inStartupGrace(): Promise<boolean> {
  try {
    const { startupGraceUntil } = await chrome.storage.session.get('startupGraceUntil')
    return typeof startupGraceUntil === 'number' && Date.now() < startupGraceUntil
  } catch {
    return false
  }
}

async function adoptStrayTabs(): Promise<void> {
  try {
    const state = await reconcileWorkspaces()
    const active = state.workspaces.find((w) => w.id === state.activeId)
    if (!active) return
    const wins = await chrome.windows.getAll({ windowTypes: ['normal'] })
    for (const win of wins) {
      const tabs = await chrome.tabs.query({ windowId: win.id })
      const stray = tabs.filter(
        (t) => t.id !== undefined && !t.pinned && (t.groupId === undefined || t.groupId === -1)
      )
      if (stray.length === 0) continue
      const ids = stray.map((t) => t.id!) 
      if (active.groupId !== null) {
        const groups = await chrome.tabGroups.query({ windowId: win.id })
        if (groups.some((g) => g.id === active.groupId)) {
          await chrome.tabs.group({ tabIds: ids, groupId: active.groupId })
          continue
        }
      }
      const groupId = await chrome.tabs.group({ tabIds: ids })
      await chrome.tabGroups.update(groupId, {
        title: groupTitleFor(active),
        color: groupColorFor(active.color)
      })
      active.groupId = groupId
      await chrome.storage.local.set({ workspaces: state.workspaces })
    }
  } catch {
    // window mid-teardown — next reconcile heals
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'glint-adopt-sweep') void adoptStrayTabs()
})

chrome.runtime.onInstalled.addListener(() => void beginStartupGrace())
chrome.runtime.onStartup.addListener(() => void beginStartupGrace())

// The active workspace follows whatever tab the user lands on — EXCEPT when
// the current workspace just lost its last tab: Chromium then auto-focuses a
// neighbour in another group, which is a side effect of the close, not a
// switch. In that case the (now empty) workspace stays selected.
chrome.tabs.onActivated.addListener(async (info) => {
  try {
    const tab = await chrome.tabs.get(info.tabId)
    const { workspaces, activeId } = await loadWorkspaces()
    if (tab.groupId === undefined || tab.groupId === -1) return
    const wsId = workspaceByGroup(workspaces).get(tab.groupId)
    if (!wsId) return
    const { wsLastActive } = await chrome.storage.session.get('wsLastActive')
    const map = (wsLastActive as Record<string, number>) ?? {}
    map[wsId] = info.tabId
    await chrome.storage.session.set({ wsLastActive: map })
    if (wsId === activeId) return

    const activeWs = workspaces.find((w) => w.id === activeId)
    if (activeWs && activeWs.groupId !== null) {
      const groups = await chrome.tabGroups.query({ windowId: tab.windowId })
      if (!groups.some((g) => g.id === activeWs.groupId)) {
        return // the active workspace just emptied — hold the selection
      }
    } else if (activeWs) {
      return // deliberately parked on an empty workspace — hold
    }
    await chrome.storage.local.set({ activeWorkspaceId: wsId })
  } catch {
    // tab already gone
  }
})

// Adopt new ungrouped tabs into the active workspace.
chrome.tabs.onCreated.addListener(async (tab) => {
  try {
    if (isMaterializing()) return
    if (tab.id === undefined || tab.pinned) return
    if (tab.groupId !== undefined && tab.groupId !== -1) return
    if (await inStartupGrace()) return // session restore owns these tabs
    const win = await chrome.windows.get(tab.windowId)
    if (win.type !== 'normal') return

    const { workspaces, activeId } = await loadWorkspaces()
    const active = workspaces.find((w) => w.id === activeId)
    if (!active) return

    if (active.groupId !== null) {
      const groups = await chrome.tabGroups.query({ windowId: tab.windowId })
      if (groups.some((g) => g.id === active.groupId)) {
        await chrome.tabs.group({ tabIds: [tab.id], groupId: active.groupId })
        return
      }
    }
    // Empty active workspace: this tab materializes its group.
    const groupId = await chrome.tabs.group({ tabIds: [tab.id] })
    await chrome.tabGroups.update(groupId, {
      title: groupTitleFor(active),
      color: groupColorFor(active.color)
    })
    active.groupId = groupId
    await chrome.storage.local.set({ workspaces })
  } catch {
    // Racing a drag or closing window — harmless to skip.
  }
})

// A group died (last tab closed): its workspace survives without a group.
chrome.tabGroups.onRemoved.addListener(async (group) => {
  try {
    const { workspaces } = await loadWorkspaces()
    const ws = workspaces.find((w) => w.groupId === group.id)
    if (!ws) return
    ws.groupId = null
    await chrome.storage.local.set({ workspaces })
  } catch {
    // storage race
  }
})

// Keep registry name/color in sync if the group is edited elsewhere.
chrome.tabGroups.onUpdated.addListener(async (group) => {
  try {
    const { workspaces } = await loadWorkspaces()
    const ws = workspaces.find((w) => w.groupId === group.id)
    const title = stripMarker(group.title ?? '')
    if (!ws || !title || ws.name === title) return
    ws.name = title
    await chrome.storage.local.set({ workspaces })
  } catch {
    // storage race
  }
})

// Drop pin metadata for closed tabs so storage doesn't accumulate stale ids.
// NOT when the window is closing (shutdown/restart): those entries are what
// the adapter rebinds to the restored tabs by URL after relaunch.
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  if (removeInfo?.isWindowClosing) return
  try {
    const { pinMeta } = await chrome.storage.local.get('pinMeta')
    const meta = (pinMeta as Record<string, unknown>) ?? {}
    if (meta[String(tabId)] !== undefined) {
      delete meta[String(tabId)]
      await chrome.storage.local.set({ pinMeta: meta })
    }
  } catch {
    // storage race — next cleanup pass gets it
  }
})

// The panel asks the worker to activate workspaces so switches survive the
// panel's own document being swapped out mid-animation.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'activate-workspace' && typeof msg.id === 'string') {
    void activateWorkspace(msg.id).catch(() => {})
  } else if (msg?.type === 'create-workspace') {
    void createWorkspace(typeof msg.name === 'string' ? msg.name : undefined).catch(() => {})
  }
})

// Keep pinned tabs' stored URLs current so post-restart rebinding matches.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return
  try {
    const { pinMeta } = await chrome.storage.local.get('pinMeta')
    const meta = (pinMeta as Record<string, { url?: string }>) ?? {}
    const entry = meta[String(tabId)]
    if (entry && entry.url !== changeInfo.url) {
      entry.url = changeInfo.url
      await chrome.storage.local.set({ pinMeta: meta })
    }
  } catch {
    // storage race — next update pass gets it
  }
})
