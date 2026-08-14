/**
 * The Glint browser API (`window.browser`) implemented on chrome.* extension
 * APIs. The React components from the Electron app run unmodified on top of
 * this adapter.
 *
 * Mapping:
 *   tabs        → chrome.tabs        (ids stringified)
 *   spaces      → chrome.tabGroups   (a space IS a tab group; 'default' = ungrouped)
 *   bookmarks   → chrome.bookmarks   (under an "Glint" folder in Other Bookmarks)
 *   history     → chrome.history
 *   pin/favorite/folder metadata + settings → chrome.storage.local
 *   context menus / palette triggers        → CustomEvents handled by App.tsx
 */
import {
  activateWorkspace,
  createWorkspace,
  cycleWorkspaceColor,
  deleteWorkspace,
  groupColorFor,
  groupTitleFor,
  loadWorkspaces,
  reconcileWorkspaces,
  renameWorkspace,
  workspaceByGroup
} from './workspaces'
import type {
  AppSettings,
  Bookmark,
  BookmarkFolder,
  Bounds,
  BrowserState,
  ContextMenuRequest,
  FindResult,
  HistoryEntry,
  SpaceState,
  TabState,
  UiAction,
  UpdateStatus
} from './types'


const GROUP_COLOR_HEX: Record<string, string> = {
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


const SETTINGS_DEFAULTS: AppSettings = {
  theme: 'system',
  searchEngine: 'google',
  sidebarOpacity: 0.06,
  // The bundled uBlock Origin Lite component is on by default natively.
  adblockEnabled: true,
  fingerprintEnabled: false
}

interface PinMeta {
  favorite: boolean
  folderId: string | null
  /** Last known URL — used to rebind pins to new tab ids after a restart. */
  url?: string
}

/** Chromium serves favicons to extensions holding the "favicon" permission. */
function faviconUrl(pageUrl: string): string {
  return chrome.runtime.getURL(`_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=32`)
}

function isNewTabUrl(url: string): boolean {
  return url === '' || url.startsWith('chrome://newtab') || url.startsWith('chrome://new-tab-page')
}

/** URL-or-search heuristic, same behavior as the Electron main process. */
function toNavigableUrl(input: string, engine: AppSettings['searchEngine']): string {
  const q = input.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(q) || /^(about|chrome):/i.test(q)) return q
  if (/^localhost(:\d+)?(\/|$)/i.test(q)) return `http://${q}`
  if (!q.includes(' ') && q.includes('.')) return `https://${q}`
  const searchUrls = {
    google: 'https://www.google.com/search?q=',
    duckduckgo: 'https://duckduckgo.com/?q=',
    bing: 'https://www.bing.com/search?q='
  }
  return searchUrls[engine] + encodeURIComponent(q)
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const panelStart = Date.now()

async function getPinMeta(): Promise<Record<string, PinMeta>> {
  const { pinMeta } = await chrome.storage.local.get('pinMeta')
  return (pinMeta as Record<string, PinMeta>) ?? {}
}

async function setPinMeta(meta: Record<string, PinMeta>): Promise<void> {
  await chrome.storage.local.set({ pinMeta: meta })
}

async function getFolderSpace(): Promise<Record<string, string>> {
  const { folderSpace } = await chrome.storage.local.get('folderSpace')
  return (folderSpace as Record<string, string>) ?? {}
}

// ---------------------------------------------------------------------------
// Glint bookmarks root ("Glint" folder under Other Bookmarks)
// ---------------------------------------------------------------------------

let glintRootId: string | null = null

async function getGlintRoot(): Promise<string> {
  if (glintRootId) {
    // Verify it still exists (user may have deleted it in the bookmark manager).
    try {
      await chrome.bookmarks.get(glintRootId)
      return glintRootId
    } catch {
      glintRootId = null
    }
  }
  const hits = await chrome.bookmarks.search({ title: 'Glint' })
  const folder = hits.find((n) => !n.url)
  if (folder) {
    glintRootId = folder.id
    return folder.id
  }
  const created = await chrome.bookmarks.create({ title: 'Glint' })
  glintRootId = created.id
  return created.id
}

// ---------------------------------------------------------------------------
// State building
// ---------------------------------------------------------------------------

async function currentWindowId(): Promise<number> {
  const win = await chrome.windows.getCurrent()
  return win.id!
}

async function buildState(): Promise<BrowserState> {
  const windowId = await currentWindowId()
  const [tabs, registry, pinMeta, folderSpace, glintId, profileTabs] =
    await Promise.all([
      chrome.tabs.query({ windowId }),
      // Self-healing: every render re-links the registry to live tab groups
      // (no-op write when nothing changed).
      reconcileWorkspaces(windowId),
      getPinMeta(),
      getFolderSpace(),
      getGlintRoot(),
      chrome.storage.local
        .get('glintProfileTabs')
        .then((r) => (r.glintProfileTabs as Record<string, string>) ?? {})
    ])

  const spaces: SpaceState[] = registry.workspaces.map((w) => ({
    id: w.id,
    name: w.name,
    color: w.color
  }))
  const groupToWs = workspaceByGroup(registry.workspaces)
  // Pins are keyed by tab id, which changes across restarts: shortly after
  // panel start, rebind stale entries to restored tabs by URL; later, prune
  // them (a pinned tab that is simply closed stays unpinned).
  {
    const liveIds = new Set(tabs.map((t) => String(t.id)))
    const staleIds = Object.keys(pinMeta).filter((id) => !liveIds.has(id))
    if (staleIds.length > 0) {
      const rebinding = Date.now() - panelStart < 120_000
      const claimed = new Set(Object.keys(pinMeta).filter((id) => liveIds.has(id)))
      let changed = false
      for (const oldId of staleIds) {
        const pm = pinMeta[oldId]
        const match = rebinding && pm.url
          ? tabs.find(
              (t) => !claimed.has(String(t.id)) && (t.url ?? t.pendingUrl) === pm.url
            )
          : undefined
        if (match) {
          delete pinMeta[oldId]
          pinMeta[String(match.id)] = pm
          claimed.add(String(match.id))
          changed = true
        } else if (!rebinding) {
          delete pinMeta[oldId]
          changed = true
        }
      }
      if (changed) await setPinMeta(pinMeta)
    }
  }

  const activeSpaceId = registry.activeId ?? spaces[0]?.id ?? null

  const activeTab = tabs.find((t) => t.active) ?? null

  const tabStates: TabState[] = tabs.map((t) => {
    const id = String(t.id)
    const meta = pinMeta[id]
    const url = t.url ?? t.pendingUrl ?? ''
    return {
      id,
      // Unknown/ungrouped tabs surface in the active workspace while the
      // background worker adopts them.
      spaceId:
        (t.groupId !== undefined && t.groupId !== -1
          ? groupToWs.get(t.groupId)
          : undefined) ?? activeSpaceId ?? '',
      url,
      title: t.title ?? '',
      favicon: t.favIconUrl || (url && !isNewTabUrl(url) ? faviconUrl(url) : null),
      isLoading: t.status === 'loading',
      canGoBack: false,
      canGoForward: false,
      isNewTabPage: isNewTabUrl(url),
      pinned: !!meta,
      favorite: meta?.favorite ?? false,
      folderId: meta?.folderId ?? null,
      // Glint profile tabs: the fork writes tabId -> profile-name into
      // "glintProfileTabs" when opening them.
      profile: profileTabs[id] ?? (t.incognito ? 'P' : null)
    }
  })

  // Bookmarks: direct children of the Glint folder; one level of subfolders.
  const children = await chrome.bookmarks.getSubTree(glintId)
  const rootChildren = children[0]?.children ?? []
  const bookmarks: Bookmark[] = []
  const bookmarkFolders: BookmarkFolder[] = []
  for (const node of rootChildren) {
    if (node.url) {
      bookmarks.push({
        id: node.id,
        url: node.url,
        title: node.title,
        favicon: faviconUrl(node.url),
        folderId: null
      })
    } else {
      bookmarkFolders.push({
        id: node.id,
        name: node.title,
        // Folders keep their space assignment in storage; unmapped folders
        // surface in the currently active space so they're never invisible.
        spaceId: folderSpace[node.id] ?? activeSpaceId ?? ''
      })
      for (const child of node.children ?? []) {
        if (child.url) {
          bookmarks.push({
            id: child.id,
            url: child.url,
            title: child.title,
            favicon: faviconUrl(child.url),
            folderId: node.id
          })
        }
      }
    }
  }

  return {
    spaces,
    activeSpaceId,
    tabs: tabStates,
    activeTabId: activeTab ? String(activeTab.id) : null,
    splitTabIds: [],
    bookmarks,
    bookmarkFolders,
    profiles: [],
    extensions: []
  }
}

// ---------------------------------------------------------------------------
// Change notification
// ---------------------------------------------------------------------------

type StateCallback = (state: BrowserState) => void
const stateCallbacks = new Set<StateCallback>()
let rebuildTimer: ReturnType<typeof setTimeout> | null = null

function scheduleRebuild(): void {
  if (stateCallbacks.size === 0) return
  if (rebuildTimer) clearTimeout(rebuildTimer)
  rebuildTimer = setTimeout(async () => {
    rebuildTimer = null
    try {
      const state = await buildState()
      stateCallbacks.forEach((cb) => cb(state))
    } catch {
      // Window closing mid-query etc. — next event rebuilds.
    }
  }, 60)
}

chrome.tabs.onCreated.addListener(scheduleRebuild)
chrome.tabs.onRemoved.addListener(scheduleRebuild)
chrome.tabs.onUpdated.addListener(scheduleRebuild)
chrome.tabs.onActivated.addListener(scheduleRebuild)
chrome.tabs.onMoved.addListener(scheduleRebuild)
chrome.tabs.onAttached.addListener(scheduleRebuild)
chrome.tabs.onDetached.addListener(scheduleRebuild)
chrome.tabGroups.onCreated.addListener(scheduleRebuild)
chrome.tabGroups.onRemoved.addListener(scheduleRebuild)
chrome.tabGroups.onUpdated.addListener(scheduleRebuild)
chrome.tabGroups.onMoved.addListener(scheduleRebuild)
chrome.bookmarks.onCreated.addListener(scheduleRebuild)
chrome.bookmarks.onRemoved.addListener(scheduleRebuild)
chrome.bookmarks.onChanged.addListener(scheduleRebuild)
chrome.bookmarks.onMoved.addListener(scheduleRebuild)
chrome.storage.onChanged.addListener(scheduleRebuild)

// Safety net: tabs from OTHER profiles (Glint /profile sessions) live in
// this window's strip and appear in tabs.query, but Chromium filters their
// EVENTS away from this extension — without a periodic rebuild the sidebar
// would never learn about them.
setInterval(scheduleRebuild, 1500)

// UI actions pushed from the background worker (keyboard commands).
type UiActionCallback = (action: UiAction) => void
const uiActionCallbacks = new Set<UiActionCallback>()
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'ui-action' && msg.action) {
    uiActionCallbacks.forEach((cb) => cb(msg.action as UiAction))
  }
})

// ---------------------------------------------------------------------------
// Space helpers
// ---------------------------------------------------------------------------

async function tabsInSpace(spaceId: string): Promise<chrome.tabs.Tab[]> {
  const windowId = await currentWindowId()
  const [tabs, registry] = await Promise.all([
    chrome.tabs.query({ windowId }),
    loadWorkspaces()
  ])
  const ws = registry.workspaces.find((w) => w.id === spaceId)
  if (!ws || ws.groupId === null) return []
  return tabs.filter((t) => t.groupId === ws.groupId)
}

// ---------------------------------------------------------------------------
// The API
// ---------------------------------------------------------------------------

const api = {
  platform: 'darwin' as string,

  createTab: async (url?: string): Promise<string> => {
    const settings = await api.getSettings()
    const finalUrl = url ? toNavigableUrl(url, settings.searchEngine) : undefined
    const tab = await chrome.tabs.create({ url: finalUrl, active: true })
    return String(tab.id)
  },

  closeTab: async (id: string): Promise<void> => {
    await chrome.tabs.remove(Number(id))
  },

  activateTab: async (id: string): Promise<void> => {
    await chrome.tabs.update(Number(id), { active: true })
  },

  navigate: async (id: string, url: string): Promise<void> => {
    const settings = await api.getSettings()
    await chrome.tabs.update(Number(id), { url: toNavigableUrl(url, settings.searchEngine) })
  },

  goBack: async (id: string): Promise<void> => {
    await chrome.tabs.goBack(Number(id))
  },

  goForward: async (id: string): Promise<void> => {
    await chrome.tabs.goForward(Number(id))
  },

  reload: async (id: string): Promise<void> => {
    await chrome.tabs.reload(Number(id))
  },

  /** ids is the full space order (pinned tabs in their slots) — move to match. */
  reorderTabs: async (spaceId: string, ids: string[]): Promise<void> => {
    const current = await tabsInSpace(spaceId)
    if (current.length === 0) return
    const base = Math.min(...current.map((t) => t.index))
    for (let i = 0; i < ids.length; i++) {
      try {
        await chrome.tabs.move(Number(ids[i]), { index: base + i })
      } catch {
        // A tab may have closed mid-reorder; keep going.
      }
    }
  },

  toggleSplit: async (): Promise<void> => {
    // Split view is a native-fork feature (milestone 2); no-op in the extension.
  },

  createSpace: async (name?: string): Promise<string> => {
    // Grouping happens in the background worker (single writer — its
    // adoption listener must see the materializing flag in-process). If the
    // worker is unreachable, do it here rather than dropping the click.
    try {
      await chrome.runtime.sendMessage({ type: 'create-workspace', name })
    } catch {
      await createWorkspace(name)
    }
    return ''
  },

  activateSpace: async (id: string): Promise<void> => {
    try {
      await chrome.runtime.sendMessage({ type: 'activate-workspace', id })
    } catch {
      await activateWorkspace(id)
    }
  },

  renameSpace: async (id: string, name: string): Promise<void> => renameWorkspace(id, name),

  cycleSpaceColor: async (id: string): Promise<void> => cycleWorkspaceColor(id),

  deleteSpace: async (id: string): Promise<void> => deleteWorkspace(id),

  addBookmark: async (url: string, title: string, _favicon: string | null): Promise<void> => {
    const root = await getGlintRoot()
    await chrome.bookmarks.create({ parentId: root, title: title || url, url })
  },

  removeBookmark: async (target: { id?: string; url?: string }): Promise<void> => {
    if (target.id) {
      await chrome.bookmarks.remove(target.id)
      return
    }
    if (!target.url) return
    const root = await getGlintRoot()
    const tree = await chrome.bookmarks.getSubTree(root)
    const stack = [...(tree[0]?.children ?? [])]
    while (stack.length) {
      const node = stack.pop()!
      if (node.url === target.url) {
        await chrome.bookmarks.remove(node.id)
        return
      }
      if (node.children) stack.push(...node.children)
    }
  },

  moveBookmark: async (id: string, folderId: string | null): Promise<void> => {
    const root = await getGlintRoot()
    await chrome.bookmarks.move(id, { parentId: folderId ?? root })
  },

  clearBookmarks: async (): Promise<void> => {
    const root = await getGlintRoot()
    const tree = await chrome.bookmarks.getSubTree(root)
    for (const child of tree[0]?.children ?? []) {
      await chrome.bookmarks.removeTree(child.id)
    }
  },

  createFolder: async (name?: string): Promise<void> => {
    const root = await getGlintRoot()
    const state = await buildState()
    const folder = await chrome.bookmarks.create({ parentId: root, title: name ?? 'New Folder' })
    const folderSpace = await getFolderSpace()
    folderSpace[folder.id] = state.activeSpaceId ?? ''
    await chrome.storage.local.set({ folderSpace })
  },

  removeFolder: async (id: string): Promise<void> => {
    await chrome.bookmarks.removeTree(id)
    const folderSpace = await getFolderSpace()
    delete folderSpace[id]
    await chrome.storage.local.set({ folderSpace })
  },

  renameFolder: async (id: string, name: string): Promise<void> => {
    await chrome.bookmarks.update(id, { title: name })
  },

  pinTab: async (id: string, folderId: string | null = null, favorite = false): Promise<void> => {
    const meta = await getPinMeta()
    const tab = await chrome.tabs.get(Number(id)).catch(() => null)
    meta[id] = { favorite, folderId, url: tab?.url ?? tab?.pendingUrl }
    await setPinMeta(meta)
  },

  unpinTab: async (id: string): Promise<void> => {
    const meta = await getPinMeta()
    delete meta[id]
    await setPinMeta(meta)
  },

  moveTabToSpace: async (id: string, spaceId: string): Promise<void> => {
    const registry = await loadWorkspaces()
    const ws = registry.workspaces.find((w) => w.id === spaceId)
    if (!ws) return
    if (ws.groupId !== null) {
      await chrome.tabs.group({ tabIds: [Number(id)], groupId: ws.groupId })
      return
    }
    // Moving a tab into an empty workspace materializes its group.
    const groupId = await chrome.tabs.group({ tabIds: [Number(id)] })
    await chrome.tabGroups.update(groupId, {
      title: groupTitleFor(ws),
      color: groupColorFor(ws.color)
    })
    ws.groupId = groupId
    await chrome.storage.local.set({ workspaces: registry.workspaces })
  },

  // Profiles are a native concept (milestone 2 — Chromium has real profiles).
  openInProfile: async (_profile: string, url: string): Promise<void> => {
    await api.createTab(url)
  },
  createProfile: async (_name: string): Promise<void> => {},
  deleteProfile: async (_name: string): Promise<void> => {},

  // Extension management is native in Chromium — the whole point of the port.
  addExtension: async (): Promise<void> => {
    await chrome.tabs.create({ url: 'chrome://extensions' })
  },
  installExtensionFromStore: async (url: string): Promise<string | null> => {
    await chrome.tabs.create({ url })
    return null
  },
  removeExtension: async (_id: string): Promise<void> => {},
  openExtensionPopup: async (_id: string): Promise<void> => {},

  /** Handled by App.tsx as an in-panel menu (no native menus in extensions). */
  showContextMenu: async (req: ContextMenuRequest): Promise<void> => {
    window.dispatchEvent(new CustomEvent('glint-context-menu', { detail: req }))
  },

  copyToClipboard: async (text: string): Promise<void> => {
    await navigator.clipboard.writeText(text)
  },

  searchHistory: async (query: string): Promise<HistoryEntry[]> => {
    const results = await chrome.history.search({ text: query, maxResults: 20 })
    return results.map((r) => ({
      url: r.url ?? '',
      title: r.title ?? r.url ?? '',
      favicon: r.url ? faviconUrl(r.url) : null,
      ts: r.lastVisitTime ?? 0
    }))
  },

  getAllHistory: async (query = ''): Promise<HistoryEntry[]> => {
    const results = await chrome.history.search({
      text: query,
      maxResults: 500,
      startTime: 0
    })
    return results.map((r) => ({
      url: r.url ?? '',
      title: r.title ?? r.url ?? '',
      favicon: r.url ? faviconUrl(r.url) : null,
      ts: r.lastVisitTime ?? 0
    }))
  },

  deleteHistory: async (url: string): Promise<void> => {
    await chrome.history.deleteUrl({ url })
  },

  clearHistory: async (): Promise<void> => {
    await chrome.history.deleteAll()
  },

  getSettings: async (): Promise<AppSettings> => {
    const { settings } = await chrome.storage.local.get('settings')
    return { ...SETTINGS_DEFAULTS, ...((settings as Partial<AppSettings>) ?? {}) }
  },

  setSettings: async (patch: Partial<AppSettings>): Promise<AppSettings> => {
    const merged = { ...(await api.getSettings()), ...patch }
    await chrome.storage.local.set({ settings: merged })
    return merged
  },

  onSettingsChanged: (cb: (settings: AppSettings) => void): (() => void) => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>): void => {
      if (changes.settings) {
        cb({ ...SETTINGS_DEFAULTS, ...(changes.settings.newValue ?? {}) })
      }
    }
    chrome.storage.local.onChanged.addListener(listener)
    return () => chrome.storage.local.onChanged.removeListener(listener)
  },

  // Find-in-page has no extension API; native ⌘F works. Milestone 2 wires this.
  find: async (_text: string, _forward = true): Promise<void> => {},
  stopFind: async (): Promise<void> => {},
  onFindResult: (_cb: (result: FindResult) => void): (() => void) => () => {},

  // The side panel never overlaps page content — both are no-ops here.
  setOverlay: async (_on: boolean): Promise<void> => {},
  setContentBounds: async (_bounds: Bounds): Promise<void> => {},

  getState: (): Promise<BrowserState> => buildState(),

  onStateChanged: (cb: StateCallback): (() => void) => {
    stateCallbacks.add(cb)
    return () => stateCallbacks.delete(cb)
  },

  onUiAction: (cb: UiActionCallback): (() => void) => {
    uiActionCallbacks.add(cb)
    return () => uiActionCallbacks.delete(cb)
  },

  getAppVersion: async (): Promise<string> => chrome.runtime.getManifest().version,

  // Updates ship with the browser itself in the Chromium build.
  checkForUpdates: async (): Promise<UpdateStatus> => ({ state: 'unsupported' }),
  installUpdate: async (): Promise<void> => {},
  onUpdateStatus: (_cb: (status: UpdateStatus) => void): (() => void) => () => {}
}

export type BrowserApi = typeof api

declare global {
  interface Window {
    browser: BrowserApi
  }
}

window.browser = api
