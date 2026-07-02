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
  /** Toolbar action icon as a data URL, or null. */
  icon: string | null
  hasPopup: boolean
}

export type ThemeSource = 'system' | 'light' | 'dark'
export type SearchEngine = 'google' | 'duckduckgo' | 'bing'

/** Progress of the GitHub-backed auto-updater, pushed from main to the renderer. */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }
  /** Updates only work in a packaged build installed from a release. */
  | { state: 'unsupported' }

export interface AppSettings {
  theme: ThemeSource
  searchEngine: SearchEngine
  /** White wash over the sidebar/chrome, 0 (clear) .. 1 (opaque). */
  sidebarOpacity: number
  /** Block ads & trackers (uBlock/EasyList engine). */
  adblockEnabled: boolean
  /** Randomize the browser fingerprint (UA, canvas, WebGL, navigator…). */
  fingerprintEnabled: boolean
}

export interface BrowserState {
  spaces: SpaceState[]
  activeSpaceId: string | null
  tabs: TabState[]
  /** Active tab of the *active* space (or null). */
  activeTabId: string | null
  /** Tabs shown side-by-side in the active space (empty = single view). */
  splitTabIds: string[]
  bookmarks: Bookmark[]
  bookmarkFolders: BookmarkFolder[]
  /** Named profiles (isolated sessions) known to the browser. */
  profiles: string[]
  extensions: ExtensionInfo[]
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** A UI action pushed from main (menu accelerators / context menus) to the renderer. */
export type UiAction =
  | { type: 'open-palette'; mode: 'tab' | 'address' }
  | { type: 'focus-address' }
  | { type: 'open-find' }
  | { type: 'open-settings' }
  | { type: 'open-history' }
  | { type: 'rename-space'; id: string }
  | { type: 'rename-folder'; id: string }

/** Payload for requesting a native context menu. */
export type ContextMenuRequest =
  | { kind: 'space'; id: string }
  | { kind: 'folder'; id: string }
  | { kind: 'tab'; id: string }
  | { kind: 'app' }
  | { kind: 'extensions' }

/** Channel names shared between main and renderer. */
export const IPC = {
  // renderer -> main (invoke)
  TAB_CREATE: 'tab:create',
  TAB_CLOSE: 'tab:close',
  TAB_ACTIVATE: 'tab:activate',
  TAB_NAVIGATE: 'tab:navigate',
  TAB_BACK: 'tab:back',
  TAB_FORWARD: 'tab:forward',
  TAB_RELOAD: 'tab:reload',
  TAB_REORDER: 'tab:reorder',
  TAB_TOGGLE_SPLIT: 'tab:toggleSplit',
  SPACE_CREATE: 'space:create',
  SPACE_ACTIVATE: 'space:activate',
  SPACE_RENAME: 'space:rename',
  BOOKMARK_ADD: 'bookmark:add',
  BOOKMARK_REMOVE: 'bookmark:remove',
  BOOKMARK_MOVE: 'bookmark:move',
  BOOKMARK_CLEAR: 'bookmark:clear',
  FOLDER_CREATE: 'folder:create',
  FOLDER_REMOVE: 'folder:remove',
  FOLDER_RENAME: 'folder:rename',
  TAB_PIN: 'tab:pin',
  TAB_UNPIN: 'tab:unpin',
  TAB_MOVE_TO_SPACE: 'tab:moveToSpace',
  TAB_OPEN_IN_PROFILE: 'tab:openInProfile',
  PROFILE_CREATE: 'profile:create',
  PROFILE_DELETE: 'profile:delete',
  EXTENSION_ADD: 'extension:add',
  EXTENSION_INSTALL_STORE: 'extension:installStore',
  EXTENSION_REMOVE: 'extension:remove',
  EXTENSION_POPUP: 'extension:popup',
  CONTEXT_MENU: 'context:show',
  CLIPBOARD_WRITE: 'clipboard:write',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  HISTORY_SEARCH: 'history:search',
  HISTORY_GET_ALL: 'history:getAll',
  HISTORY_DELETE: 'history:delete',
  HISTORY_CLEAR: 'history:clear',
  FIND: 'find:start',
  FIND_STOP: 'find:stop',
  SET_OVERLAY: 'view:setOverlay',
  VIEW_SET_BOUNDS: 'view:setBounds',
  STATE_GET: 'state:get',
  APP_GET_VERSION: 'app:getVersion',
  UPDATE_CHECK: 'update:check',
  UPDATE_INSTALL: 'update:install',
  // main -> renderer (send)
  STATE_CHANGED: 'state:changed',
  UI_ACTION: 'ui:action',
  FIND_RESULT: 'find:result',
  SETTINGS_CHANGED: 'settings:changed',
  UPDATE_STATUS: 'update:status'
} as const
