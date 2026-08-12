// Ported verbatim from the Electron app's src/shared/types.ts (minus the IPC
// channel table, which has no meaning here — chrome.* APIs replace IPC).

export interface TabState {
  id: string
  spaceId: string
  url: string
  title: string
  favicon: string | null
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  isNewTabPage: boolean
  /** Pinned tabs render in the favorites row / list / folders, not the plain list. */
  pinned: boolean
  /** True = top icon favorite; false = a loose row (above folders) or in a folder. */
  favorite: boolean
  /** If pinned inside a folder, that folder's id (else null). */
  folderId: string | null
  /** Named profile (isolated cookies/session), or null for the default session. */
  profile: string | null
}

export interface SpaceState {
  id: string
  name: string
  color: string
}

export interface Bookmark {
  id: string
  url: string
  title: string
  favicon: string | null
  folderId: string | null
}

export interface BookmarkFolder {
  id: string
  name: string
  /** Folders belong to a single workspace (not shared across spaces). */
  spaceId: string
}

export interface HistoryEntry {
  url: string
  title: string
  favicon: string | null
  ts: number
}

export interface FindResult {
  activeMatchOrdinal: number
  matches: number
}

export interface ExtensionInfo {
  id: string
  name: string
  icon: string | null
  hasPopup: boolean
}

export type ThemeSource = 'system' | 'light' | 'dark'
export type SearchEngine = 'google' | 'duckduckgo' | 'bing'

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }
  | { state: 'unsupported' }

export interface AppSettings {
  theme: ThemeSource
  searchEngine: SearchEngine
  /** White wash over the sidebar/chrome, 0 (clear) .. 1 (opaque). */
  sidebarOpacity: number
  adblockEnabled: boolean
  fingerprintEnabled: boolean
}

export interface BrowserState {
  spaces: SpaceState[]
  activeSpaceId: string | null
  tabs: TabState[]
  activeTabId: string | null
  splitTabIds: string[]
  bookmarks: Bookmark[]
  bookmarkFolders: BookmarkFolder[]
  profiles: string[]
  extensions: ExtensionInfo[]
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export type UiAction =
  | { type: 'open-palette'; mode: 'tab' | 'address' }
  | { type: 'focus-address' }
  | { type: 'open-find' }
  | { type: 'open-settings' }
  | { type: 'open-history' }
  | { type: 'rename-space'; id: string }
  | { type: 'rename-folder'; id: string }

export type ContextMenuRequest =
  | { kind: 'space'; id: string }
  | { kind: 'folder'; id: string }
  | { kind: 'tab'; id: string }
  | { kind: 'app' }
  | { kind: 'extensions' }
