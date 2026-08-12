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
  isMaterializing,
  loadWorkspaces,
  reconcileWorkspaces,
  workspaceByGroup
} from './workspaces'

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})

// Schibsted CMP blocker (network half): dynamic DNR rules — no static
// ruleset indexing/checksums involved. The cosmetic half is css/schibsted.css.
const SCHIBSTED_RULES: chrome.declarativeNetRequest.Rule[] = [
  '||cmp.vg.no^',
  '||cmp.aftenposten.no^',
  '||static.privacy.schibsted.com^',
  '||cdn.privacy.schibsted.com^'
].map((urlFilter, i) => ({
  id: 9001 + i,
  priority: 1,
  action: { type: 'block' as chrome.declarativeNetRequest.RuleActionType },
  condition: { urlFilter }
}))

async function ensureSchibstedRules(): Promise<void> {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: SCHIBSTED_RULES.map((r) => r.id),
      addRules: SCHIBSTED_RULES
    })
  } catch {
    // DNR unavailable — nothing to do.
  }
}

chrome.runtime.onInstalled.addListener(() => void ensureSchibstedRules())
chrome.runtime.onStartup.addListener(() => void ensureSchibstedRules())

chrome.runtime.onInstalled.addListener(() => void reconcileWorkspaces().catch(() => {}))
chrome.runtime.onStartup.addListener(() => void reconcileWorkspaces().catch(() => {}))

// The active workspace follows whatever tab the user lands on.
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
    if (wsId !== activeId) {
      await chrome.storage.local.set({ activeWorkspaceId: wsId })
    }
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
      title: active.name,
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
    if (!ws || !group.title || ws.name === group.title) return
    ws.name = group.title
    await chrome.storage.local.set({ workspaces })
  } catch {
    // storage race
  }
})

// Drop pin metadata for closed tabs so storage doesn't accumulate stale ids.
chrome.tabs.onRemoved.addListener(async (tabId) => {
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
