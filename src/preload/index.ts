import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type AppSettings,
  type Bounds,
  type BrowserState,
  type ContextMenuRequest,
  type FindResult,
  type HistoryEntry,
  type UiAction
} from '../shared/types'

const api = {
  // 'darwin' | 'win32' | 'linux' — lets the chrome adapt window-control layout.
  platform: process.platform,
  createTab: (url?: string): Promise<string> => ipcRenderer.invoke(IPC.TAB_CREATE, url),
  closeTab: (id: string): Promise<void> => ipcRenderer.invoke(IPC.TAB_CLOSE, id),
  activateTab: (id: string): Promise<void> => ipcRenderer.invoke(IPC.TAB_ACTIVATE, id),
  navigate: (id: string, url: string): Promise<void> =>
    ipcRenderer.invoke(IPC.TAB_NAVIGATE, id, url),
  goBack: (id: string): Promise<void> => ipcRenderer.invoke(IPC.TAB_BACK, id),
  goForward: (id: string): Promise<void> => ipcRenderer.invoke(IPC.TAB_FORWARD, id),
  reload: (id: string): Promise<void> => ipcRenderer.invoke(IPC.TAB_RELOAD, id),
  reorderTabs: (spaceId: string, ids: string[]): Promise<void> =>
    ipcRenderer.invoke(IPC.TAB_REORDER, spaceId, ids),
  toggleSplit: (): Promise<void> => ipcRenderer.invoke(IPC.TAB_TOGGLE_SPLIT),
  createSpace: (name?: string): Promise<string> => ipcRenderer.invoke(IPC.SPACE_CREATE, name),
  activateSpace: (id: string): Promise<void> => ipcRenderer.invoke(IPC.SPACE_ACTIVATE, id),
  renameSpace: (id: string, name: string): Promise<void> =>
    ipcRenderer.invoke(IPC.SPACE_RENAME, id, name),
  addBookmark: (url: string, title: string, favicon: string | null): Promise<void> =>
    ipcRenderer.invoke(IPC.BOOKMARK_ADD, url, title, favicon),
  removeBookmark: (target: { id?: string; url?: string }): Promise<void> =>
    ipcRenderer.invoke(IPC.BOOKMARK_REMOVE, target),
  moveBookmark: (id: string, folderId: string | null): Promise<void> =>
    ipcRenderer.invoke(IPC.BOOKMARK_MOVE, id, folderId),
  clearBookmarks: (): Promise<void> => ipcRenderer.invoke(IPC.BOOKMARK_CLEAR),
  createFolder: (name?: string): Promise<void> => ipcRenderer.invoke(IPC.FOLDER_CREATE, name),
  removeFolder: (id: string): Promise<void> => ipcRenderer.invoke(IPC.FOLDER_REMOVE, id),
  renameFolder: (id: string, name: string): Promise<void> =>
    ipcRenderer.invoke(IPC.FOLDER_RENAME, id, name),
  pinTab: (id: string, folderId: string | null = null, favorite = false): Promise<void> =>
    ipcRenderer.invoke(IPC.TAB_PIN, id, folderId, favorite),
  unpinTab: (id: string): Promise<void> => ipcRenderer.invoke(IPC.TAB_UNPIN, id),
  moveTabToSpace: (id: string, spaceId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.TAB_MOVE_TO_SPACE, id, spaceId),
  openInProfile: (profile: string, url: string): Promise<void> =>
    ipcRenderer.invoke(IPC.TAB_OPEN_IN_PROFILE, profile, url),
  createProfile: (name: string): Promise<void> => ipcRenderer.invoke(IPC.PROFILE_CREATE, name),
  deleteProfile: (name: string): Promise<void> => ipcRenderer.invoke(IPC.PROFILE_DELETE, name),
  addExtension: (): Promise<void> => ipcRenderer.invoke(IPC.EXTENSION_ADD),
  installExtensionFromStore: (url: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.EXTENSION_INSTALL_STORE, url),
  removeExtension: (id: string): Promise<void> => ipcRenderer.invoke(IPC.EXTENSION_REMOVE, id),
  openExtensionPopup: (id: string): Promise<void> => ipcRenderer.invoke(IPC.EXTENSION_POPUP, id),
  showContextMenu: (req: ContextMenuRequest): Promise<void> =>
    ipcRenderer.invoke(IPC.CONTEXT_MENU, req),
  copyToClipboard: (text: string): Promise<void> =>
    ipcRenderer.invoke(IPC.CLIPBOARD_WRITE, text),
  searchHistory: (query: string): Promise<HistoryEntry[]> =>
    ipcRenderer.invoke(IPC.HISTORY_SEARCH, query),
  getAllHistory: (query = ''): Promise<HistoryEntry[]> =>
    ipcRenderer.invoke(IPC.HISTORY_GET_ALL, query),
  deleteHistory: (url: string): Promise<void> => ipcRenderer.invoke(IPC.HISTORY_DELETE, url),
  clearHistory: (): Promise<void> => ipcRenderer.invoke(IPC.HISTORY_CLEAR),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
  setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.SETTINGS_SET, patch),
  onSettingsChanged: (cb: (settings: AppSettings) => void): (() => void) => {
    const listener = (_e: unknown, s: AppSettings): void => cb(s)
    ipcRenderer.on(IPC.SETTINGS_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC.SETTINGS_CHANGED, listener)
  },
  find: (text: string, forward = true): Promise<void> =>
    ipcRenderer.invoke(IPC.FIND, text, forward),
  stopFind: (): Promise<void> => ipcRenderer.invoke(IPC.FIND_STOP),
  setOverlay: (on: boolean): Promise<void> => ipcRenderer.invoke(IPC.SET_OVERLAY, on),
  onFindResult: (cb: (result: FindResult) => void): (() => void) => {
    const listener = (_e: unknown, result: FindResult): void => cb(result)
    ipcRenderer.on(IPC.FIND_RESULT, listener)
    return () => ipcRenderer.removeListener(IPC.FIND_RESULT, listener)
  },
  setContentBounds: (bounds: Bounds): Promise<void> =>
    ipcRenderer.invoke(IPC.VIEW_SET_BOUNDS, bounds),
  getState: (): Promise<BrowserState> => ipcRenderer.invoke(IPC.STATE_GET),
  onStateChanged: (cb: (state: BrowserState) => void): (() => void) => {
    const listener = (_e: unknown, state: BrowserState): void => cb(state)
    ipcRenderer.on(IPC.STATE_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC.STATE_CHANGED, listener)
  },
  onUiAction: (cb: (action: UiAction) => void): (() => void) => {
    const listener = (_e: unknown, action: UiAction): void => cb(action)
    ipcRenderer.on(IPC.UI_ACTION, listener)
    return () => ipcRenderer.removeListener(IPC.UI_ACTION, listener)
  }
}

contextBridge.exposeInMainWorld('browser', api)

export type BrowserApi = typeof api
