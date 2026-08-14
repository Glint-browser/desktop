<div align="center">
  <img src="icon-original.png" width="120" alt="Glint logo">

# Glint Browser

**A fast, workspace-first browser built on Chromium — with full native support for every Chrome extension.**

[![Latest release](https://img.shields.io/github/v/release/Glint-browser/desktop?label=download&color=6d5bd0)](https://github.com/Glint-browser/desktop/releases/latest)
[![Platform](https://img.shields.io/badge/platform-macOS%20(Apple%20Silicon)-black)](https://github.com/Glint-browser/desktop/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

</div>

---

## ✨ Features

- **Liquid Glass UI** — on macOS 26 (Tahoe) the entire chrome (sidebar, top strip) is translucent glass, Zen-style
- **Workspaces** — Arc-style spaces with colored dots, slide animations, horizontal-scroll switching and ⌥⌘←/→ shortcuts; exact restore across restarts
- **Command palette** — ⌘T opens a Spotlight-style palette with history search and favicons
- **Every Chrome extension works** — Glint *is* Chromium; install anything from the Chrome Web Store, no compatibility layer
- **Profiles in tabs** — `/profile <name> <url>` in the palette opens an isolated session as a tab in your current workspace (multiple accounts on the same site, side by side)
- **Built-in adblock** — uBlock Origin Lite ships inside the browser, invisible, toggleable in Settings, with an extra list for Scandinavian consent walls
- **Pinned favorites** that actually survive restarts
- **Auto-update check** — Glint tells you when a new version is out (Settings → Browser → Updates)

## 📦 Download

**[Get the latest .dmg →](https://github.com/Glint-browser/desktop/releases/latest)**

> **First launch:** the app is not yet notarized, so macOS will block the first open.
> Go to **System Settings → Privacy & Security**, scroll down, and click **"Open Anyway"** —
> or run `xattr -cr /Applications/Glint.app` in Terminal. This is only needed once.

Requires macOS on Apple Silicon (M1 or newer). The glass look requires macOS 26; older versions get the classic opaque theme.

## 🏗 Architecture

Glint is a **Chromium fork** with its UI built as a web app living in Chromium's side panel
(the Vivaldi approach) — the native tab strip is gone, and one React app drives tabs,
workspaces, pins and bookmarks through the `chrome.*` extension APIs.

```
chromium-ui/       The Glint UI (Vite + React side-panel extension)
  src/adapter.ts     window.browser implemented on chrome.* APIs
  src/workspaces.ts  Arc-style workspace registry (exact group re-linking)
  src/background.ts  Service worker: tab adoption, updates, pins
patches/chromium/  The native half: every fork commit as an applyable patch
scripts/           make-dmg.sh · publish-release.sh · export-patches.sh
src/               Legacy Electron prototype (superseded by the fork)
```

Native additions (in `patches/chromium/`) include the ⌘T palette, the Glint settings
window, isolated tab profiles, the bundled adblocker, Liquid Glass enablement and the
chromeless single-sidebar window.

## 🔨 Building from source

The fork is too large to host — rebuild it from a clean Chromium checkout:

```bash
# 1. Fetch Chromium (https://www.chromium.org/developers/how-tos/get-the-code/)
fetch chromium && cd src

# 2. Pin the base revision and apply the Glint patches
git checkout $(head -1 /path/to/desktop/patches/chromium/BASE_COMMIT.txt)
gclient sync
git am /path/to/desktop/patches/chromium/*.patch

# 3. Build the UI and bake it in
cd /path/to/desktop/chromium-ui
npm install && npm run build && ./sync-component.sh

# 4. Dev build
gn gen out/glint && autoninja -C out/glint chrome
```

See [`patches/chromium/README.md`](patches/chromium/README.md) for details, and
`scripts/make-dmg.sh` for the release packaging pipeline.

## 📄 License

[MIT](LICENSE) — Chromium itself is BSD-licensed by the Chromium Authors.
