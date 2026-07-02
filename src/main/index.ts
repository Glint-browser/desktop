import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeTheme, session } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { TabManager, partitionFor } from './TabManager'
import { BookmarkStore } from './bookmarks'
import { ProfileStore } from './profiles'
import { HistoryStore } from './history'
import { SettingsStore } from './settings'
import { enableAdblockForSession, setAdblockEnabled } from './adblock'
import {
  addExtensionViaDialog,
  extensionPopupUrl,
  initExtensions,
  installFromWebStore,
  listExtensions,
  removeExtension
} from './extensions'
import { applyToWebContents, setFingerprintEnabled } from './fingerprint'
import * as mouseNav from 'mouse-nav'
import { buildMenu } from './menu'
import { loadSession, saveSession, saveSessionDebounced } from './session'
import { fixSessionHeaders } from './webstore'
import { checkForUpdates, initUpdater, installUpdate } from './updater'
import {
  IPC,
  type AppSettings,
  type Bounds,
  type BrowserState,
  type ContextMenuRequest,
  type UiAction
} from '../shared/types'

// Swatches offered in the space "Change Color" context submenu.
const SPACE_PALETTE = ['#6d5bd0', '#e0759a', '#3fb6a8', '#e0a458', '#5b8def', '#111111']

// The ad blocker injects best-effort scriptlets that can be rejected by strict
// page CSPs; keep those (and any stray page-driven rejections) from crashing or
// spamming the main process.
process.on('unhandledRejection', () => {})

// Pin the profile dir BEFORE renaming — otherwise app.setName() would move
// userData (and the disk cache) to a "Glint" folder and orphan existing data.
// Dev runs get their own profile so they can never corrupt the installed
// app's caches by running concurrently with it.
app.setPath(
  'userData',
  join(app.getPath('appData'), app.isPackaged ? 'glint-browser' : 'glint-browser-dev')
)

// One profile, one instance: concurrent Chromium instances sharing the same
// profile corrupt GPU/code caches (white pages, garbage textures).
if (!app.requestSingleInstanceLock()) {
  app.quit()
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})
// Branding: name shown in the macOS menu bar / app menu, and the icon file.
app.setName('Glint')
// Strip the Electron/app tokens from the UA — sites (the Chrome Web Store
// especially) sniff them and refuse features or serve broken code paths.
app.userAgentFallback = app.userAgentFallback.replace(/\s(glint-browser|Electron)\/\S+/gi, '')

// The window uses macOS vibrancy (translucent chrome) = effectively a
// transparent window. Chromium promotes video to a hardware overlay plane that
// doesn't composite through a transparent window → the video area is blank
// while audio plays. `disable-gpu-compositing` alone did NOT fix it, so we
// disable hardware acceleration entirely: no overlay planes at all, video is
// composited in software into the surface the window actually shows. Costs some
// smoothness but is the reliable fix for blank video in a vibrancy window.
app.disableHardwareAcceleration()
const ICON_PATH = join(app.getAppPath(), 'icon.png')

let mainWindow: BrowserWindow | null = null
let tabs: TabManager | null = null
// Sessions whose webRequest header fix is already registered (one per session).
const fixedSessions = new Set<Electron.Session>()
let bookmarks: BookmarkStore
let history: HistoryStore
let settings: SettingsStore
let profiles: ProfileStore

// macOS gets translucent vibrancy (the wallpaper shows through); Windows/Linux
// have no vibrancy, so the chrome needs a solid, theme-matched backdrop or the
// semi-transparent panels render muddy over a mismatched fill. These colors
// drive both the window background and the caption-button overlay so the
// min/max/close controls blend into the toolbar instead of a stray light strip.
function chromeColors(): { bg: string; symbol: string } {
  return nativeTheme.shouldUseDarkColors
    ? { bg: '#1c1b22', symbol: '#e8e6f0' }
    : { bg: '#f3f1f6', symbol: '#2b2733' }
}

// Keep the window backdrop + caption overlay in sync with the active theme.
function refreshWindowChrome(): void {
  if (process.platform === 'darwin' || !mainWindow) return
  const { bg, symbol } = chromeColors()
  mainWindow.setBackgroundColor(bg)
  try {
    mainWindow.setTitleBarOverlay({ color: bg, symbolColor: symbol, height: 40 })
  } catch {
    // Not all platforms support a runtime overlay update — ignore.
  }
}

function applySettings(s: AppSettings): void {
  nativeTheme.themeSource = s.theme
  refreshWindowChrome()
  tabs?.setSearchEngine(s.searchEngine)
  setFingerprintEnabled(s.fingerprintEnabled)
  setAdblockEnabled(s.adblockEnabled).catch((e) => console.error('adblock:', e))
}

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    // macOS: inset traffic lights over our chrome. Windows/Linux: hide the OS
    // title bar and let Chromium paint the min/max/close buttons as an overlay
    // in the top-right, which our toolbar reserves room for. Using the native
    // 'hiddenInset' verbatim on Windows falls back to a full framed window
    // (stray title bar + in-window menu bar), which is what looked broken.
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac
      ? {}
      : {
          titleBarOverlay: {
            color: chromeColors().bg,
            symbolColor: chromeColors().symbol,
            height: 40
          }
        }),
    // The redundant File/Edit/View… bar belongs in the macOS global menu; on
    // Windows/Linux hide it (Alt still reveals it) so it doesn't eat a row.
    autoHideMenuBar: !isMac,
    icon: ICON_PATH,
    // macOS vibrancy so the desktop/wallpaper shows through the translucent
    // chrome. Do NOT also set `transparent: true` — it conflicts with vibrancy
    // and produces a flat fill instead of a frosted blur of what's behind.
    // Windows/Linux have no vibrancy, so use a solid theme-matched backdrop.
    backgroundColor: isMac ? '#00000000' : chromeColors().bg,
    ...(isMac ? { vibrancy: 'under-window' as const, visualEffectState: 'active' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Safety net: `ready-to-show` can occasionally not fire when the caption
  // overlay is in play; make sure the window is never left invisible.
  setTimeout(() => mainWindow?.show(), 3000)

  const send = (state: BrowserState): void => {
    mainWindow?.webContents.send(IPC.STATE_CHANGED, state)
    if (tabs) saveSessionDebounced(() => tabs!.serialize())
  }
  tabs = new TabManager(mainWindow, {
    onChange: send,
    getBookmarks: () => bookmarks.list(),
    getBookmarkFolders: () => bookmarks.listFolders(),
    getProfiles: () => profiles.list(),
    getExtensions: () => listExtensions(),
    onVisit: (entry) => history.record(entry),
    onFindResult: (result) => mainWindow?.webContents.send(IPC.FIND_RESULT, result),
    onViewCreated: (wc) => {
      applyToWebContents(wc)
      enableAdblockForSession(wc.session).catch(() => {})
      if (!fixedSessions.has(wc.session)) {
        fixedSessions.add(wc.session)
        fixSessionHeaders(wc.session)
      }
    },
    onWebStoreInstall: async (url) => {
      try {
        await installFromWebStore(url)
        tabs?.refresh()
        return null
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[webstore] install failed:', msg)
        return msg
      }
    }
  })
  buildMenu(mainWindow, tabs)

  // Trackpad / mouse-driver "swipe between pages" gesture → back/forward.
  mainWindow.on('swipe', (_e, direction) => {
    if (direction === 'left') tabs?.historyGo('back')
    else if (direction === 'right') tabs?.historyGo('forward')
  })

  // `ready-to-show` can fire more than once (e.g. on re-paint); initialize the
  // session exactly once or we'd spawn a new space/tab on every emission.
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    const saved = loadSession()
    if (saved) tabs?.restore(saved)
    else tabs?.createSpace() // first run: one space with a new-tab page
  })

  // The chrome UI must never spawn OS windows or the default browser; route
  // any link it tries to open into a new in-app tab instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) tabs?.createTab(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.TAB_CREATE, (_e, url?: string) => tabs?.createTab(url))
  ipcMain.handle(IPC.TAB_CLOSE, (_e, id: string) => tabs?.closeTab(id))
  ipcMain.handle(IPC.TAB_ACTIVATE, (_e, id: string) => tabs?.activate(id))
  ipcMain.handle(IPC.TAB_NAVIGATE, (_e, id: string, url: string) => tabs?.navigate(id, url))
  ipcMain.handle(IPC.TAB_BACK, (_e, id: string) => tabs?.goBack(id))
  ipcMain.handle(IPC.TAB_FORWARD, (_e, id: string) => tabs?.goForward(id))
  ipcMain.handle(IPC.TAB_RELOAD, (_e, id: string) => tabs?.reload(id))
  ipcMain.handle(IPC.TAB_REORDER, (_e, spaceId: string, ids: string[]) =>
    tabs?.reorderTabs(spaceId, ids)
  )
  ipcMain.handle(IPC.TAB_TOGGLE_SPLIT, () => tabs?.toggleSplit())
  ipcMain.handle(IPC.SPACE_CREATE, (_e, name?: string) => tabs?.createSpace(name))
  ipcMain.handle(IPC.SPACE_ACTIVATE, (_e, id: string) => tabs?.activateSpace(id))
  ipcMain.handle(IPC.SPACE_RENAME, (_e, id: string, name: string) => tabs?.renameSpace(id, name))
  ipcMain.handle(IPC.BOOKMARK_ADD, (_e, url: string, title: string, favicon: string | null) => {
    bookmarks.add(url, title, favicon)
    tabs?.refresh()
  })
  ipcMain.handle(IPC.BOOKMARK_REMOVE, (_e, idOrUrl: { id?: string; url?: string }) => {
    if (idOrUrl.id) bookmarks.removeById(idOrUrl.id)
    else if (idOrUrl.url) bookmarks.removeByUrl(idOrUrl.url)
    tabs?.refresh()
  })
  ipcMain.handle(IPC.BOOKMARK_MOVE, (_e, id: string, folderId: string | null) => {
    bookmarks.move(id, folderId)
    tabs?.refresh()
  })
  ipcMain.handle(IPC.BOOKMARK_CLEAR, () => {
    bookmarks.clear()
    tabs?.refresh()
  })
  ipcMain.handle(IPC.FOLDER_CREATE, (_e, name?: string) => {
    const spaceId = tabs?.getState().activeSpaceId
    if (spaceId) {
      bookmarks.addFolder(name, spaceId)
      tabs?.refresh()
    }
  })
  ipcMain.handle(IPC.FOLDER_REMOVE, (_e, id: string) => {
    bookmarks.removeFolder(id)
    tabs?.refresh()
  })
  ipcMain.handle(IPC.FOLDER_RENAME, (_e, id: string, name: string) => {
    bookmarks.renameFolder(id, name)
    tabs?.refresh()
  })
  ipcMain.handle(IPC.TAB_PIN, (_e, id: string, folderId: string | null, favorite?: boolean) =>
    tabs?.pinTab(id, folderId ?? null, !!favorite)
  )
  ipcMain.handle(IPC.TAB_UNPIN, (_e, id: string) => tabs?.unpinTab(id))
  ipcMain.handle(IPC.TAB_MOVE_TO_SPACE, (_e, id: string, spaceId: string) =>
    tabs?.moveTabToSpace(id, spaceId)
  )
  ipcMain.handle(IPC.TAB_OPEN_IN_PROFILE, (_e, profile: string, url: string) => {
    profiles.add(profile)
    tabs?.openInProfile(profile, url)
  })
  ipcMain.handle(IPC.PROFILE_CREATE, (_e, name: string) => {
    profiles.add(name)
    tabs?.refresh()
  })
  ipcMain.handle(IPC.PROFILE_DELETE, async (_e, name: string) => {
    tabs?.closeTabsForProfile(name)
    const part = partitionFor(name)
    if (part) await session.fromPartition(part).clearStorageData()
    profiles.remove(name)
    tabs?.refresh()
  })
  ipcMain.handle(IPC.EXTENSION_ADD, async () => {
    const ok = await addExtensionViaDialog(mainWindow)
    if (ok) tabs?.refresh()
  })
  // Returns null on success, or a user-facing error message.
  ipcMain.handle(IPC.EXTENSION_INSTALL_STORE, async (_e, url: string) => {
    try {
      await installFromWebStore(url)
      tabs?.refresh()
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  })
  ipcMain.handle(IPC.EXTENSION_REMOVE, (_e, id: string) => {
    removeExtension(id)
    tabs?.refresh()
  })
  ipcMain.handle(IPC.EXTENSION_POPUP, (_e, id: string) => openExtensionPopup(id))
  ipcMain.handle(IPC.CONTEXT_MENU, (_e, req: ContextMenuRequest) => showContextMenu(req))
  ipcMain.handle(IPC.CLIPBOARD_WRITE, (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle(IPC.HISTORY_SEARCH, (_e, query: string) => history.search(query))
  ipcMain.handle(IPC.HISTORY_GET_ALL, (_e, query: string) => history.all(query))
  ipcMain.handle(IPC.HISTORY_DELETE, (_e, url: string) => history.remove(url))
  ipcMain.handle(IPC.HISTORY_CLEAR, () => history.clear())
  ipcMain.handle(IPC.SETTINGS_GET, () => settings.get())
  ipcMain.handle(IPC.SETTINGS_SET, (_e, patch: Partial<AppSettings>) => {
    const s = settings.set(patch)
    applySettings(s)
    mainWindow?.webContents.send(IPC.SETTINGS_CHANGED, s)
    return s
  })
  ipcMain.handle(IPC.FIND, (_e, text: string, forward: boolean) => tabs?.findInPage(text, forward))
  ipcMain.handle(IPC.FIND_STOP, () => tabs?.stopFind())
  ipcMain.handle(IPC.SET_OVERLAY, (_e, on: boolean) => tabs?.setOverlay(on))
  ipcMain.handle(IPC.VIEW_SET_BOUNDS, (_e, bounds: Bounds) => tabs?.setContentBounds(bounds))
  ipcMain.handle(IPC.STATE_GET, () => tabs?.getState())
  ipcMain.handle(IPC.APP_GET_VERSION, () => app.getVersion())
  ipcMain.handle(IPC.UPDATE_CHECK, () => checkForUpdates())
  ipcMain.handle(IPC.UPDATE_INSTALL, () => installUpdate())
}

function sendUi(action: UiAction): void {
  mainWindow?.webContents.send(IPC.UI_ACTION, action)
}

/** Open an extension's toolbar popup in a small frameless window near the corner. */
function openExtensionPopup(id: string): void {
  const url = extensionPopupUrl(id)
  if (!url || !mainWindow) return
  const b = mainWindow.getBounds()
  const [w, h] = [380, 520]
  const popup = new BrowserWindow({
    width: w,
    height: h,
    x: b.x + b.width - w - 16,
    y: b.y + 46,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    parent: mainWindow,
    webPreferences: { sandbox: false }
  })
  popup.loadURL(url)
  popup.once('ready-to-show', () => popup.show())
  popup.on('blur', () => popup.close())
}

/** Save a tab as a bookmark (a link), optionally into a folder. */
function addBookmarkFromTab(tabId: string, folderId: string | null): void {
  const info = tabs?.getTabInfo(tabId)
  if (!info || info.isNewTabPage) return
  bookmarks.add(info.url, info.title, info.favicon, folderId)
  tabs?.refresh()
}

/** Build and pop a native macOS context menu for a space, folder, or tab. */
function showContextMenu(req: ContextMenuRequest): void {
  if (!mainWindow || !tabs) return

  if (req.kind === 'app') {
    const menu: MenuItemConstructorOptions[] = [
      { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => sendUi({ type: 'open-palette', mode: 'tab' }) },
      { label: 'New Workspace', accelerator: 'CmdOrCtrl+Shift+N', click: () => tabs?.createSpace() },
      { type: 'separator' },
      { label: 'Find in Page…', accelerator: 'CmdOrCtrl+F', click: () => sendUi({ type: 'open-find' }) },
      { label: 'Toggle Split View', accelerator: 'CmdOrCtrl+D', click: () => tabs?.toggleSplit() },
      { label: 'Reload Page', accelerator: 'CmdOrCtrl+R', click: () => tabs?.reloadActive() },
      { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => tabs?.printActive() },
      {
        label: 'Zoom',
        submenu: [
          { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => tabs?.zoomActive(0.5) },
          { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => tabs?.zoomActive(-0.5) },
          { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => tabs?.zoomActive(0) }
        ]
      },
      { type: 'separator' },
      { label: 'History…', accelerator: 'CmdOrCtrl+Y', click: () => sendUi({ type: 'open-history' }) },
      { label: 'Developer Tools', accelerator: 'Alt+Cmd+I', click: () => tabs?.toggleDevToolsActive() },
      { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => sendUi({ type: 'open-settings' }) },
      { type: 'separator' },
      { label: `Glint Browser v${app.getVersion()}`, enabled: false }
    ]
    Menu.buildFromTemplate(menu).popup({ window: mainWindow })
    return
  }
  if (req.kind === 'extensions') {
    const exts = listExtensions()
    const template: MenuItemConstructorOptions[] = [
      { label: 'Add extension…', click: () => addExtensionViaDialog(mainWindow).then((ok) => ok && tabs?.refresh()) },
      { label: 'Manage extensions…', click: () => sendUi({ type: 'open-settings' }) },
      { type: 'separator' },
      ...(exts.length
        ? exts.map((e) => ({ label: e.name, enabled: false }))
        : [{ label: 'No extensions installed', enabled: false }])
    ]
    Menu.buildFromTemplate(template).popup({ window: mainWindow })
    return
  }

  let template: MenuItemConstructorOptions[]
  if (req.kind === 'tab') {
    const info = tabs.getTabInfo(req.id)
    const folders = bookmarks.listFolders()
    const otherSpaces = tabs.getState().spaces.filter((s) => s.id !== info?.spaceId)
    template = [
      info?.pinned
        ? { label: 'Unpin Tab', click: () => tabs?.unpinTab(req.id) }
        : {
            label: 'Add to Favorites',
            enabled: !!info && !info.isNewTabPage,
            click: () => tabs?.pinTab(req.id, null, true)
          },
      ...(folders.length
        ? [
            {
              label: 'Move to Folder',
              submenu: folders.map((f) => ({
                label: f.name,
                click: () => tabs?.pinTab(req.id, f.id)
              }))
            } as MenuItemConstructorOptions
          ]
        : []),
      {
        label: 'Add Bookmark',
        enabled: !!info && !info.isNewTabPage,
        click: () => addBookmarkFromTab(req.id, null)
      },
      ...(otherSpaces.length
        ? [
            {
              label: 'Move to Space',
              submenu: otherSpaces.map((s) => ({
                label: s.name,
                click: () => tabs?.moveTabToSpace(req.id, s.id)
              }))
            } as MenuItemConstructorOptions
          ]
        : []),
      { type: 'separator' },
      { label: 'Close Tab', click: () => tabs?.closeTab(req.id) }
    ]
    Menu.buildFromTemplate(template).popup({ window: mainWindow })
    return
  }
  if (req.kind === 'space') {
    template = [
      { label: 'Rename', click: () => sendUi({ type: 'rename-space', id: req.id }) },
      {
        label: 'Change Color',
        submenu: SPACE_PALETTE.map((color) => ({
          label: color,
          click: () => tabs?.setSpaceColor(req.id, color)
        }))
      },
      { type: 'separator' },
      { label: 'New Space', click: () => tabs?.createSpace() },
      { label: 'Delete Space', click: () => tabs?.removeSpace(req.id) }
    ]
  } else {
    template = [
      { label: 'Rename', click: () => sendUi({ type: 'rename-folder', id: req.id }) },
      { type: 'separator' },
      {
        label: 'New Folder',
        click: () => {
          const spaceId = tabs?.getState().activeSpaceId
          if (spaceId) {
            bookmarks.addFolder(undefined, spaceId)
            tabs?.refresh()
          }
        }
      },
      {
        label: 'Delete Folder',
        click: () => {
          bookmarks.removeFolder(req.id)
          tabs?.refresh()
        }
      }
    ]
  }

  Menu.buildFromTemplate(template).popup({ window: mainWindow })
}

app.whenReady().then(() => {
  // Show the Glint logo in the macOS dock (dev; packaged uses the bundle icon).
  if (process.platform === 'darwin' && app.dock) {
    try {
      app.dock.setIcon(ICON_PATH)
    } catch {
      // icon file missing — ignore
    }
  }
  // Keep the Windows/Linux window backdrop + caption overlay in sync when the
  // OS flips between light and dark (relevant when the app theme is "system").
  nativeTheme.on('updated', refreshWindowChrome)
  bookmarks = new BookmarkStore()
  history = new HistoryStore()
  settings = new SettingsStore()
  profiles = new ProfileStore()
  registerIpc()
  // Native mouse side buttons (X1/X2) → back/forward. Chromium ignores these on
  // macOS, so a local NSEvent monitor reports them and we drive the active tab.
  mouseNav.start((direction) => tabs?.historyGo(direction))
  // Load installed extensions before the first tabs so their content scripts apply.
  initExtensions().finally(() => {
    createWindow()
    applySettings(settings.get())
    // Register the auto-updater's event → renderer bridge. Do NOT check yet:
    // kicking off a network request on the startup path crashed the packaged
    // build. The background check runs once the window has finished loading.
    initUpdater(() => mainWindow)
    // Check once in the background shortly after the window is up, so a waiting
    // update surfaces without the user having to open Settings.
    mainWindow?.webContents.once('did-finish-load', () => {
      setTimeout(() => checkForUpdates().catch(() => {}), 5000)
    })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Links opened from other apps (Glint is registered for http/https).
app.on('open-url', (event, url) => {
  event.preventDefault()
  if (tabs) tabs.createTab(url)
})

app.on('before-quit', () => {
  if (tabs) saveSession(tabs.serialize())
  mouseNav.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
