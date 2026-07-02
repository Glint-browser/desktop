# Glint Browser

A fast, workspace-based web browser built on **Electron + Chromium**, cross-platform (macOS / Windows / Linux).

The browser "chrome" (sidebar, spaces, tabs, address bar) is a React UI. Each
tab is a real Chromium `WebContentsView` managed by the main process and layered
over the page-content area reported by the UI.

## Architecture

```
src/
  main/            Electron main process (Node)
    index.ts       App entry: window, IPC wiring
    TabManager.ts  Owns tabs as WebContentsViews; navigation, layout, state
  preload/         contextBridge API exposed to the UI as window.browser
  renderer/        React UI (the Glint sidebar)
    src/
      App.tsx                 Layout + reports content-area bounds to main
      components/Sidebar.tsx  Address bar, nav buttons, tab list, spaces
      components/TabItem.tsx  A single tab row
  shared/types.ts  Shared TabState/BrowserState + IPC channel names
```

The UI never touches web content directly. It sends intents (create/close/
navigate/activate) over IPC; the main process drives Chromium and pushes back a
`BrowserState` snapshot the UI renders.

## Run

```bash
npm install
npm run dev      # dev with hot reload
npm run start    # preview the production build
npm run build    # build only
```

> **Note (this dev machine only):** the shell has `ELECTRON_RUN_AS_NODE=1` set,
> which makes the Electron binary boot as plain Node (you'll see
> `TypeError: Cannot read properties of undefined (reading 'whenReady')`).
> Launch with it unset:
> ```bash
> env -u ELECTRON_RUN_AS_NODE npm run dev
> ```

## Package (installers)

```bash
npm run pack:mac     # .dmg / .zip
npm run pack:win     # .exe (NSIS)
npm run pack:linux   # AppImage / deb
```

Output lands in `release/` (git-ignored). macOS builds are unsigned — see the
limitations below. The native `mouse-nav` addon and other native modules are
rebuilt automatically for Electron's ABI during packaging.

## Features

- **Local new-tab page** (no Google auto-load) with a search box.
- **Command palette** (`⌘T` / `⌘L`): filter open tabs, or type a URL / web
  search. `↑/↓` to move, `Enter` to run, `Esc` to close.
- **Spaces**: colored workspaces, each with its own set of tabs. Switch with the
  pills in the sidebar or `⌘1`–`⌘9`; create with `⌘⇧N`.
- **Split view** (`⌘D`): show the active tab and a neighbor side-by-side in the
  active space. Split tabs get a blue accent in the sidebar; activating a tab
  outside the split collapses it.
- **Tab drag-to-reorder**: drag tabs within a space to reorder them.
- **Find in page** (`⌘F`): incremental search with match count and prev/next
  (`Enter` / `Shift+Enter`), shown in a bar above the page.
- **Bookmarks / favorites**: star the active page (☆/★ in the toolbar); favorites
  show as a grid in the sidebar. Click to open, right-click to remove. Stored in
  `userData/bookmarks.json`.
- **Browsing history**: every visit is recorded to `userData/history.json` and
  surfaced in the command palette as you type.
- **Session persistence**: spaces, tabs, and splits are saved to
  `userData/session.json` and restored on launch.
- Menu accelerators for new tab, close tab (`⌘W`), reload (`⌘R`), back/forward.

> **Note on overlays:** the page is a native `WebContentsView` composited *above*
> the React UI, so full-screen modals (the command palette) hide the page view
> while open; the find bar instead shrinks the page from the top so it stays
> visible. The sidebar is always visible because no view is positioned over it.

## Roadmap / known limitations

- **DRM & proprietary codecs** (Netflix, Spotify, some H.264/AAC): vanilla
  Electron omits Widevine. Swap to the `castlabs/electron-releases` build +
  VMP signing to enable it.
- **Chrome extensions**: Electron supports only a subset of the extensions API.
  Full Web Store support is a large, separate effort.
- Not yet built: downloads, settings, dedicated history page, N-way (>2) split,
  drag-tab-to-split gesture.
- Distribution: installers build, but aren't code-signed/notarized yet — needs
  an Apple Developer cert (mac) and a code-signing cert (Windows).
```
