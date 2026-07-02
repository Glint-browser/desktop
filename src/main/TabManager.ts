import { BrowserWindow, WebContentsView, type WebContents } from 'electron'
import { randomUUID } from 'crypto'
import type {
  Bookmark,
  BookmarkFolder,
  Bounds,
  BrowserState,
  ExtensionInfo,
  FindResult,
  HistoryEntry,
  SearchEngine,
  SpaceState,
  TabState
} from '../shared/types'
import { NEW_TAB_URL, isNewTabUrl } from './newtab'
import {
  FIREFOX_UA,
  GOOGLE_LOGIN_HOSTS,
  WEBSTORE_HOOK_SCRIPT,
  WEBSTORE_MARKER,
  isWebStoreUrl,
  toastScript
} from './webstore'

interface Tab {
  id: string
  spaceId: string
  view: WebContentsView
  pinned: boolean
  favorite: boolean
  folderId: string | null
  profile: string | null
}

/** Electron session partition for a named profile (isolated cookies/logins). */
export function partitionFor(profile: string | null): string | undefined {
  if (!profile) return undefined
  const slug = profile.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `persist:glint-profile-${slug || 'x'}`
}

export interface TabManagerHooks {
  onChange: (state: BrowserState) => void
  getBookmarks: () => Bookmark[]
  getBookmarkFolders: () => BookmarkFolder[]
  getProfiles: () => string[]
  getExtensions: () => ExtensionInfo[]
  onVisit: (entry: Omit<HistoryEntry, 'ts'>) => void
  onFindResult: (result: FindResult) => void
  onViewCreated: (wc: WebContents) => void
  /** Install from a Web Store page URL; resolves to an error message or null. */
  onWebStoreInstall: (url: string) => Promise<string | null>
}

export interface SessionData {
  spaces: SpaceState[]
  activeSpaceId: string | null
  tabs: {
    id: string
    spaceId: string
    url: string
    pinned?: boolean
    favorite?: boolean
    folderId?: string | null
    profile?: string | null
  }[]
  activeTabBySpace: Record<string, string>
  splitBySpace?: Record<string, string[]>
}

const SPACE_COLORS = ['#6d5bd0', '#e0759a', '#3fb6a8', '#e0a458', '#5b8def']
/** Corner radius of the page views; matches the content card's --radius in CSS. */
const CONTENT_RADIUS = 12

const SEARCH_URLS: Record<SearchEngine, string> = {
  google: 'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q='
}

/**
 * Owns spaces and their tabs. Each tab is a WebContentsView layered over the
 * window's content view; only the active space's active tab is visible, sized
 * to the content-area bounds reported by the renderer.
 */
export class TabManager {
  private spaces: SpaceState[] = []
  private tabs: Tab[] = []
  private activeSpaceId: string | null = null
  private activeTabBySpace = new Map<string, string>()
  /** Per-space split: ordered tab ids shown side-by-side (empty/absent = single). */
  private splitBySpace = new Map<string, string[]>()
  private contentBounds: Bounds = { x: 0, y: 0, width: 0, height: 0 }
  /** When true, all page views are hidden so a renderer modal can show through. */
  private overlay = false
  private searchEngine: SearchEngine = 'google'
  /** The normal (cleaned Chrome-like) UA; restored when leaving login hosts. */
  private readonly defaultUserAgent: string

  constructor(
    private window: BrowserWindow,
    private hooks: TabManagerHooks
  ) {
    this.defaultUserAgent = window.webContents.session.getUserAgent()
    // Mouse side buttons on Windows/Linux arrive as window-level app commands.
    // (macOS is handled by the native mouse-nav monitor, routed via historyGo.)
    window.on('app-command', (_e, cmd) => {
      if (cmd === 'browser-backward') this.historyGo('back')
      else if (cmd === 'browser-forward') this.historyGo('forward')
    })
  }

  /** Navigate the active tab back or forward (used by mouse side buttons). */
  historyGo(direction: 'back' | 'forward'): void {
    const id = this.getActiveTabId()
    if (!id) return
    if (direction === 'back') this.goBack(id)
    else this.goForward(id)
  }

  // ---------- Spaces ----------

  createSpace(name?: string): string {
    const id = randomUUID()
    const color = SPACE_COLORS[this.spaces.length % SPACE_COLORS.length]
    this.spaces.push({ id, name: name?.trim() || `Space ${this.spaces.length + 1}`, color })
    this.activeSpaceId = id
    this.createTab(undefined, id) // a fresh space starts with a new-tab page
    return id
  }

  activateSpace(id: string): void {
    if (!this.spaces.some((s) => s.id === id) || this.activeSpaceId === id) return
    this.activeSpaceId = id
    if (!this.tabsOf(id).length) {
      this.createTab(undefined, id)
      return
    }
    this.applyActive()
    this.emitState()
  }

  renameSpace(id: string, name: string): void {
    const space = this.spaces.find((s) => s.id === id)
    if (!space || !name.trim()) return
    space.name = name.trim()
    this.emitState()
  }

  setSpaceColor(id: string, color: string): void {
    const space = this.spaces.find((s) => s.id === id)
    if (!space) return
    space.color = color
    this.emitState()
  }

  removeSpace(id: string): void {
    const idx = this.spaces.findIndex((s) => s.id === id)
    if (idx === -1) return

    for (const t of this.tabsOf(id)) {
      this.window.contentView.removeChildView(t.view)
      t.view.webContents.close()
    }
    this.tabs = this.tabs.filter((t) => t.spaceId !== id)
    this.spaces.splice(idx, 1)
    this.activeTabBySpace.delete(id)
    this.splitBySpace.delete(id)

    if (this.activeSpaceId === id) {
      const next = this.spaces[idx] ?? this.spaces[idx - 1] ?? null
      this.activeSpaceId = next?.id ?? null
      if (!this.activeSpaceId) {
        this.createSpace() // never leave the user with zero spaces
        return
      }
      if (!this.tabsOf(this.activeSpaceId).length) {
        this.createTab(undefined, this.activeSpaceId)
        return
      }
    }
    this.applyActive()
    this.emitState()
  }

  // ---------- Tabs ----------

  createTab(url?: string, spaceId = this.activeSpaceId, profile: string | null = null): string {
    if (!spaceId) spaceId = this.createSpaceInternal()
    const view = this.createView(partitionFor(profile))
    const tab: Tab = {
      id: randomUUID(),
      spaceId,
      view,
      pinned: false,
      favorite: false,
      folderId: null,
      profile
    }
    this.tabs.push(tab)
    this.window.contentView.addChildView(view)
    this.wireEvents(tab)

    view.webContents.loadURL(url ?? NEW_TAB_URL)
    this.setActiveTab(tab.id)
    return tab.id
  }

  /** Open a URL in a named profile (isolated session); reuses that partition. */
  openInProfile(profile: string, input: string): void {
    const id = this.createTab(undefined, this.activeSpaceId, profile.trim())
    this.navigate(id, input)
  }

  closeTab(id: string): void {
    const idx = this.tabs.findIndex((t) => t.id === id)
    if (idx === -1) return
    const [tab] = this.tabs.splice(idx, 1)
    this.window.contentView.removeChildView(tab.view)
    tab.view.webContents.close()

    if (this.activeTabBySpace.get(tab.spaceId) === id) {
      const siblings = this.tabsOf(tab.spaceId)
      const next = siblings[Math.min(idx, siblings.length - 1)] ?? null
      if (next) this.activeTabBySpace.set(tab.spaceId, next.id)
      else this.activeTabBySpace.delete(tab.spaceId)
    }

    // Drop the closed tab from any split; collapse a split that lost a pane.
    const split = this.splitBySpace.get(tab.spaceId)
    if (split?.includes(id)) {
      const remaining = split.filter((sid) => sid !== id)
      if (remaining.length >= 2) this.splitBySpace.set(tab.spaceId, remaining)
      else this.splitBySpace.delete(tab.spaceId)
    }

    this.applyActive()
    this.emitState()
  }

  activate(id: string): void {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) return
    this.activeSpaceId = tab.spaceId
    this.setActiveTab(id)
  }

  /**
   * Pin a tab. `favorite` = top icon row; else a loose row (folderId null) or a
   * folder (folderId set). A folder placement is never a favorite.
   */
  pinTab(tabId: string, folderId: string | null = null, favorite = false): void {
    const tab = this.tabs.find((t) => t.id === tabId)
    if (!tab) return
    tab.pinned = true
    tab.folderId = folderId
    tab.favorite = favorite && !folderId
    this.emitState()
  }

  /** Unpin a tab back into the regular tab list. */
  unpinTab(tabId: string): void {
    const tab = this.tabs.find((t) => t.id === tabId)
    if (!tab || !tab.pinned) return
    tab.pinned = false
    tab.favorite = false
    tab.folderId = null
    this.emitState()
  }

  /** Move a tab into another space (keeps it as that space's active tab). */
  moveTabToSpace(tabId: string, targetSpaceId: string): void {
    const tab = this.tabs.find((t) => t.id === tabId)
    if (!tab || tab.spaceId === targetSpaceId) return
    if (!this.spaces.some((s) => s.id === targetSpaceId)) return
    const from = tab.spaceId

    // Detach from the source space's split.
    const split = this.splitBySpace.get(from)
    if (split?.includes(tabId)) {
      const remaining = split.filter((id) => id !== tabId)
      if (remaining.length >= 2) this.splitBySpace.set(from, remaining)
      else this.splitBySpace.delete(from)
    }
    // Repoint the source space's active tab if it was this one.
    if (this.activeTabBySpace.get(from) === tabId) {
      const sibling = this.tabsOf(from).find((t) => t.id !== tabId)
      if (sibling) this.activeTabBySpace.set(from, sibling.id)
      else this.activeTabBySpace.delete(from)
    }

    tab.spaceId = targetSpaceId
    this.activeTabBySpace.set(targetSpaceId, tabId)
    this.applyActive()
    this.emitState()
  }

  /** Snapshot of a tab for building context menus / pinning. */
  getTabInfo(id: string):
    | { url: string; title: string; favicon: string | null; spaceId: string; isNewTabPage: boolean; pinned: boolean }
    | undefined {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) return undefined
    const wc = tab.view.webContents
    const url = wc.getURL()
    return {
      url,
      title: wc.getTitle(),
      favicon: faviconOf(url),
      spaceId: tab.spaceId,
      isNewTabPage: isNewTabUrl(url),
      pinned: tab.pinned
    }
  }

  navigate(id: string, input: string): void {
    this.tabs.find((t) => t.id === id)?.view.webContents.loadURL(this.toUrl(input))
  }

  setSearchEngine(engine: SearchEngine): void {
    this.searchEngine = engine
  }

  /** Address-bar string → URL: navigate if it looks like one, else web search. */
  private toUrl(input: string): string {
    const trimmed = input.trim()
    if (/^[a-z]+:\/\//i.test(trimmed)) return trimmed
    if (/^[^\s]+\.[^\s]{2,}(\/.*)?$/.test(trimmed)) return `https://${trimmed}`
    return SEARCH_URLS[this.searchEngine] + encodeURIComponent(trimmed)
  }

  goBack(id: string): void {
    this.tabs.find((t) => t.id === id)?.view.webContents.navigationHistory.goBack()
  }

  goForward(id: string): void {
    this.tabs.find((t) => t.id === id)?.view.webContents.navigationHistory.goForward()
  }

  reload(id: string): void {
    this.tabs.find((t) => t.id === id)?.view.webContents.reload()
  }

  /** Reorder the tabs of a space to match `orderedIds` (drag-to-reorder). */
  reorderTabs(spaceId: string, orderedIds: string[]): void {
    const inSpace = this.tabsOf(spaceId)
    const byId = new Map(inSpace.map((t) => [t.id, t]))
    const reordered = orderedIds.map((id) => byId.get(id)).filter((t): t is Tab => !!t)
    if (reordered.length !== inSpace.length) return // ignore stale/partial input

    let k = 0
    this.tabs = this.tabs.map((t) => (t.spaceId === spaceId ? reordered[k++] : t))
    this.emitState()
  }

  /** Toggle a 2-up split in the active space (active tab + a neighbor). */
  toggleSplit(): void {
    const spaceId = this.activeSpaceId
    if (!spaceId) return
    if (this.splitBySpace.get(spaceId)?.length) {
      this.splitBySpace.delete(spaceId)
      this.applyActive()
      this.emitState()
      return
    }
    const inSpace = this.tabsOf(spaceId)
    if (inSpace.length < 2) return
    const activeId = this.getActiveTabId()
    const i = Math.max(0, inSpace.findIndex((t) => t.id === activeId))
    const partner = inSpace[i + 1] ?? inSpace[i - 1]
    this.splitBySpace.set(spaceId, [inSpace[i].id, partner.id])
    this.applyActive()
    this.emitState()
  }

  // ---------- Convenience for menu accelerators ----------

  getActiveTabId(): string | null {
    return this.activeSpaceId ? this.activeTabBySpace.get(this.activeSpaceId) ?? null : null
  }

  closeActiveTab(): void {
    const id = this.getActiveTabId()
    if (id) this.closeTab(id)
  }

  reloadActive(): void {
    const id = this.getActiveTabId()
    if (id) this.reload(id)
  }

  backActive(): void {
    const id = this.getActiveTabId()
    if (id) this.goBack(id)
  }

  forwardActive(): void {
    const id = this.getActiveTabId()
    if (id) this.goForward(id)
  }

  activateSpaceByIndex(index: number): void {
    const space = this.spaces[index]
    if (space) this.activateSpace(space.id)
  }

  toggleDevToolsActive(): void {
    const wc = this.activeWc()
    if (!wc) return
    if (wc.isDevToolsOpened()) wc.closeDevTools()
    else wc.openDevTools({ mode: 'right' })
  }

  printActive(): void {
    this.activeWc()?.print()
  }

  /** Adjust the active tab's zoom. `step` in zoom levels; 0 resets to 100%. */
  zoomActive(step: number): void {
    const wc = this.activeWc()
    if (!wc) return
    if (step === 0) wc.setZoomLevel(0)
    else wc.setZoomLevel(Math.max(-5, Math.min(5, wc.getZoomLevel() + step)))
  }

  // ---------- Layout ----------

  setContentBounds(bounds: Bounds): void {
    this.contentBounds = bounds
    this.applyActive()
  }

  /** Force a state push (e.g. after bookmarks change outside the TabManager). */
  refresh(): void {
    this.emitState()
  }

  /** Hide/show all page views so a full-screen renderer modal can render over them. */
  setOverlay(on: boolean): void {
    this.overlay = on
    this.applyActive()
  }

  // ---------- State ----------

  getState(): BrowserState {
    const tabs: TabState[] = this.tabs.map((t) => {
      const wc = t.view.webContents
      const url = wc.getURL()
      return {
        id: t.id,
        spaceId: t.spaceId,
        url,
        title: wc.getTitle(),
        favicon: faviconOf(url),
        isLoading: wc.isLoading(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        isNewTabPage: isNewTabUrl(url),
        pinned: t.pinned,
        favorite: t.favorite,
        folderId: t.folderId,
        profile: t.profile
      }
    })
    return {
      spaces: this.spaces,
      activeSpaceId: this.activeSpaceId,
      tabs,
      activeTabId: this.getActiveTabId(),
      splitTabIds: this.activeSpaceId ? this.splitBySpace.get(this.activeSpaceId) ?? [] : [],
      bookmarks: this.hooks.getBookmarks(),
      bookmarkFolders: this.hooks.getBookmarkFolders(),
      profiles: this.hooks.getProfiles(),
      extensions: this.hooks.getExtensions()
    }
  }

  /** Close every tab that belongs to a profile (used when deleting a profile). */
  closeTabsForProfile(profile: string): void {
    for (const t of this.tabs.filter((t) => t.profile === profile)) this.closeTab(t.id)
  }

  // ---------- Persistence ----------

  serialize(): SessionData {
    return {
      spaces: this.spaces,
      activeSpaceId: this.activeSpaceId,
      tabs: this.tabs.map((t) => ({
        id: t.id,
        spaceId: t.spaceId,
        url: t.view.webContents.getURL(),
        pinned: t.pinned,
        favorite: t.favorite,
        folderId: t.folderId,
        profile: t.profile
      })),
      activeTabBySpace: Object.fromEntries(this.activeTabBySpace),
      splitBySpace: Object.fromEntries(this.splitBySpace)
    }
  }

  restore(data: SessionData): void {
    if (!data.spaces?.length) {
      this.createSpace()
      return
    }
    this.spaces = data.spaces
    for (const t of data.tabs) {
      if (!this.spaces.some((s) => s.id === t.spaceId)) continue
      const profile = t.profile ?? null
      const view = this.createView(partitionFor(profile))
      const tab: Tab = {
        id: t.id,
        spaceId: t.spaceId,
        view,
        pinned: !!t.pinned,
        favorite: !!t.favorite,
        folderId: t.folderId ?? null,
        profile
      }
      this.tabs.push(tab)
      this.window.contentView.addChildView(view)
      this.wireEvents(tab)
      // Re-open the new-tab page locally rather than restoring its huge data URL.
      view.webContents.loadURL(isNewTabUrl(t.url) ? NEW_TAB_URL : t.url)
    }
    for (const [spaceId, tabId] of Object.entries(data.activeTabBySpace)) {
      if (this.tabs.some((t) => t.id === tabId)) this.activeTabBySpace.set(spaceId, tabId)
    }
    for (const [spaceId, ids] of Object.entries(data.splitBySpace ?? {})) {
      const valid = ids.filter((id) => this.tabs.some((t) => t.id === id))
      if (valid.length >= 2) this.splitBySpace.set(spaceId, valid)
    }
    this.activeSpaceId = data.activeSpaceId ?? this.spaces[0]?.id ?? null
    // Ensure the active space has at least one tab.
    if (this.activeSpaceId && !this.tabsOf(this.activeSpaceId).length) {
      this.createTab(undefined, this.activeSpaceId)
    } else {
      this.applyActive()
      this.emitState()
    }
  }

  // ---------- Internals ----------

  private createSpaceInternal(): string {
    const id = randomUUID()
    const color = SPACE_COLORS[this.spaces.length % SPACE_COLORS.length]
    this.spaces.push({ id, name: `Space ${this.spaces.length + 1}`, color })
    this.activeSpaceId = id
    return id
  }

  private setActiveTab(id: string): void {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) return
    this.activeTabBySpace.set(tab.spaceId, id)
    // Activating a tab outside the current split exits split view.
    const split = this.splitBySpace.get(tab.spaceId)
    if (split && !split.includes(id)) this.splitBySpace.delete(tab.spaceId)
    this.applyActive()
    this.emitState()
  }

  private tabsOf(spaceId: string): Tab[] {
    return this.tabs.filter((t) => t.spaceId === spaceId)
  }

  /** Create a page view with rounded corners; `partition` isolates a profile. */
  private createView(partition?: string): WebContentsView {
    // sandbox:false lets the ad blocker's preload inject cosmetic/scriptlet code
    // (needed for YouTube video ads); Node stays off and context stays isolated.
    const view = new WebContentsView({
      webPreferences: { sandbox: false, contextIsolation: true, nodeIntegration: false, partition }
    })
    view.setBorderRadius(CONTENT_RADIUS)
    this.hooks.onViewCreated(view.webContents)
    return view
  }

  private emitState(): void {
    this.hooks.onChange(this.getState())
  }

  private applyActive(): void {
    if (this.overlay) {
      for (const tab of this.tabs) tab.view.setVisible(false)
      return
    }
    const split = this.activeSpaceId ? this.splitBySpace.get(this.activeSpaceId) ?? [] : []
    const activeId = this.getActiveTabId()
    // In split view show the split panes; otherwise just the active tab.
    const visibleIds = split.length >= 2 ? split : activeId ? [activeId] : []

    for (const tab of this.tabs) {
      const paneIndex = tab.spaceId === this.activeSpaceId ? visibleIds.indexOf(tab.id) : -1
      tab.view.setVisible(paneIndex !== -1)
      if (paneIndex !== -1) tab.view.setBounds(paneBounds(this.contentBounds, paneIndex, visibleIds.length))
    }
  }

  private wireEvents(tab: Tab): void {
    const wc = tab.view.webContents
    const emit = (): void => this.emitState()
    const recordVisit = (): void => {
      const url = wc.getURL()
      this.hooks.onVisit({ url, title: wc.getTitle(), favicon: faviconOf(url) })
    }

    wc.on('page-title-updated', () => {
      recordVisit()
      emit()
    })
    wc.on('did-start-loading', emit)
    wc.on('did-stop-loading', emit)
    wc.on('did-navigate', () => {
      recordVisit()
      emit()
    })
    wc.on('did-navigate-in-page', () => {
      recordVisit()
      emit()
    })
    wc.on('did-start-navigation', (e) => {
      // Present as Firefox on Google's sign-in flow (both the request UA and
      // the JS-visible navigator.userAgent) — Google blocks Electron-as-Chrome
      // there with "this browser may not be secure".
      if (e.isMainFrame) {
        let host = ''
        try {
          host = new URL(e.url).hostname
        } catch {
          // ignore unparsable
        }
        const wantFirefox = GOOGLE_LOGIN_HOSTS.includes(host)
        const target = wantFirefox ? FIREFOX_UA : this.defaultUserAgent
        if (wc.getUserAgent() !== target) wc.setUserAgent(target)
      }
      emit()
    })
    wc.on('page-favicon-updated', emit)
    wc.on('found-in-page', (_e, result) => {
      this.hooks.onFindResult({
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches
      })
    })

    // Popups / target=_blank open as a new in-app tab in the same space.
    wc.setWindowOpenHandler(({ url }) => {
      if (url && url !== 'about:blank') this.createTab(url, tab.spaceId)
      return { action: 'deny' }
    })

    // Chrome Web Store: rebrand "Add to Chrome" → "Add to Glint" and install on
    // click. The page reports the click via a console marker (no IPC bridge in
    // tab pages); only honored while the tab is actually on the store.
    wc.on('dom-ready', () => {
      if (isWebStoreUrl(wc.getURL())) wc.executeJavaScript(WEBSTORE_HOOK_SCRIPT).catch(() => {})
    })
    wc.on('console-message', (details) => {
      const msg = details.message
      if (!msg.startsWith(WEBSTORE_MARKER) || !isWebStoreUrl(wc.getURL())) return
      const url = msg.slice(WEBSTORE_MARKER.length).trim()
      this.hooks.onWebStoreInstall(url).then((error) => {
        if (wc.isDestroyed()) return
        wc.executeJavaScript(
          toastScript(error ?? 'Added to Glint ✓', error === null)
        ).catch(() => {})
      })
    })

    // Keyboard back/forward shortcuts, caught at the page level so they work
    // even while the web content has focus. macOS mouse drivers (Logitech,
    // Razer, etc.) map the side buttons to ⌘[ / ⌘], which land here; power
    // users get the shortcuts too. Raw mouse buttons on Windows/Linux come
    // through the window's app-command event (see the constructor).
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const cmd = process.platform === 'darwin' ? input.meta : input.alt
      if (cmd && (input.key === '[' || input.key === 'ArrowLeft')) {
        wc.navigationHistory.goBack()
        event.preventDefault()
      } else if (cmd && (input.key === ']' || input.key === 'ArrowRight')) {
        wc.navigationHistory.goForward()
        event.preventDefault()
      }
    })
  }

  // ---------- Find in page ----------

  findInPage(text: string, forward = true): void {
    const wc = this.activeWc()
    if (wc && text) wc.findInPage(text, { forward })
  }

  stopFind(): void {
    this.activeWc()?.stopFindInPage('clearSelection')
  }

  private activeWc(): Electron.WebContents | undefined {
    const id = this.getActiveTabId()
    return id ? this.tabs.find((t) => t.id === id)?.view.webContents : undefined
  }
}

/** Compute the rectangle for pane `index` of `count` evenly-split columns. */
function paneBounds(area: Bounds, index: number, count: number): Bounds {
  if (count <= 1) return area
  const gap = 8
  const paneWidth = Math.floor((area.width - gap * (count - 1)) / count)
  return {
    x: area.x + index * (paneWidth + gap),
    y: area.y,
    width: paneWidth,
    height: area.height
  }
}

/** Derive a favicon URL from a page URL. Returns null for the local new-tab page. */
function faviconOf(pageUrl: string): string | null {
  if (isNewTabUrl(pageUrl)) return null
  try {
    const { hostname } = new URL(pageUrl)
    if (!hostname) return null
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`
  } catch {
    return null
  }
}
