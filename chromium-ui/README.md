# Glint UI — Chromium port

The Glint sidebar (spaces, tabs, favorites, pinned bookmarks, command palette)
running as a Chromium **side-panel extension** — the Electron renderer ported
onto `chrome.*` APIs. This is milestone 1 of the Vivaldi-style architecture:
web UI + real Chromium = every Web Store extension works natively.

## How it works

| Electron concept              | Chromium replacement                       |
| ----------------------------- | ------------------------------------------ |
| `window.browser` (preload)    | `src/adapter.ts` — same API on `chrome.*`  |
| main-process TabManager       | `chrome.tabs` / `chrome.tabGroups`         |
| Spaces                        | Tab groups (a space **is** a group)        |
| Bookmarks store               | `chrome.bookmarks` ("Glint" folder)        |
| History store                 | `chrome.history`                           |
| pin/favorite/folder metadata  | `chrome.storage.local`                     |
| Native context menus          | In-panel HTML menu (`App.tsx`)             |
| Auto-adopt new tabs to space  | `src/background.ts` service worker         |

The React components in `src/components/` are byte-for-byte copies of the
Electron renderer's (only the types import path changed). Keep them in sync —
or better, extract them to a shared package once milestone 2 starts.

## Build & run

```sh
cd chromium-ui
npm install
npm run build          # → dist/
```

Load into the fork build (fresh instance):

```sh
open -na ~/chromium/src/out/glint/Glint.app --args \
  --load-extension="$PWD/dist"
```

Then click the **Glint UI** toolbar icon to open the side panel (the fork
already docks panels left). `npm run dev` rebuilds on change; hit ⟳ on
chrome://extensions to reload.

Works in stock Chrome/Chromium too — handy for quick UI iteration.

## What's deliberately missing (extension API has no equivalent)

- **Split view** — native fork feature (`MultiContentsView` patches).
- **Find-in-page UI** — native ⌘F works; custom bar needs a private API.
- **Profiles** (`/profile` palette command) — Chromium has real profiles;
  wire `openInProfile` to them in milestone 2.
- **Omnibox suggestions** in the palette — currently history-only; full
  autocomplete (search suggest, etc.) needs an `AutocompleteController`
  bridge in C++.

## Milestone 2 — bake it into the fork

1. **Component extension**: register `dist/` as a component extension
   (`chrome/browser/extensions/component_loader.cc` + grd resources) so it
   ships inside Glint.app, pinned open, uninstallable.
2. **Hide native chrome**: drop the vertical tab strip
   (the sidebar now owns tabs); keep the toolbar minimal or hide it and move
   nav controls into the panel.
3. **Force the panel open** on window creation, fixed to the left, and make
   its width a browser pref instead of a drag handle.
4. **Reuse the existing patches**: rounded content corners (12px), left
   side-panel region, purple theme seed — all still apply as-is.
5. Later: `AutocompleteController` bridge for the palette, real profile
   integration, custom find bar, window vibrancy behind the panel.
