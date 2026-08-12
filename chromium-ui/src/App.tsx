import { useEffect, useRef, useState, type JSX } from 'react'
import type { BrowserState, ContextMenuRequest, UiAction } from './types'
import { Sidebar } from './components/Sidebar'
import { applyThemeAttribute } from './workspaces'

const EMPTY: BrowserState = {
  spaces: [],
  activeSpaceId: null,
  tabs: [],
  activeTabId: null,
  splitTabIds: [],
  bookmarks: [],
  bookmarkFolders: [],
  profiles: [],
  extensions: []
}

interface MenuState {
  x: number
  y: number
  req: ContextMenuRequest
}

/**
 * Side-panel shell for the Glint UI (Chromium port). The Electron app's window
 * chrome (TopBar, page-host bounds, overlay juggling) is gone — the browser
 * renders pages natively; this panel is pure sidebar.
 */
export default function App(): JSX.Element {
  const [state, setState] = useState<BrowserState>(EMPTY)
  const [rename, setRename] = useState<{ kind: 'space' | 'folder'; id: string } | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [slide, setSlide] = useState<'left' | 'right' | null>(null)
  const prevSpace = useRef<{ id: string | null; index: number }>({ id: null, index: 0 })
  // Last right-click position — the adapter's showContextMenu carries no coords.
  const mousePos = useRef({ x: 0, y: 0 })

  useEffect(() => {
    window.browser.getState().then((s) => s && setState(s))
    const offState = window.browser.onStateChanged(setState)
    const offUi = window.browser.onUiAction((action: UiAction) => {
      // The command palette is native in the Chromium fork (⌘T) — the panel
      // only handles rename actions.
      if (action.type === 'rename-space') setRename({ kind: 'space', id: action.id })
      else if (action.type === 'rename-folder') setRename({ kind: 'folder', id: action.id })
    })
    return () => {
      offState()
      offUi()
    }
  }, [])

  // Context menu plumbing: components call window.browser.showContextMenu(),
  // the adapter re-dispatches it as a DOM event, we render an HTML menu.
  useEffect(() => {
    const onPointer = (e: MouseEvent): void => {
      mousePos.current = { x: e.clientX, y: e.clientY }
    }
    const onMenu = (e: Event): void => {
      const req = (e as CustomEvent<ContextMenuRequest>).detail
      setMenu({ x: mousePos.current.x, y: mousePos.current.y, req })
    }
    window.addEventListener('contextmenu', onPointer, true)
    window.addEventListener('glint-context-menu', onMenu)
    return () => {
      window.removeEventListener('contextmenu', onPointer, true)
      window.removeEventListener('glint-context-menu', onMenu)
    }
  }, [])

  // Apply the sidebar wash from settings, same as the Electron shell.
  useEffect(() => {
    const apply = (s: { sidebarOpacity: number; theme: 'system' | 'light' | 'dark' }): void => {
      document.documentElement.style.setProperty(
        '--sidebar-wash',
        `rgba(255, 255, 255, ${s.sidebarOpacity})`
      )
      applyThemeAttribute(s.theme)
    }
    window.browser.getSettings().then(apply)
    return window.browser.onSettingsChanged(apply)
  }, [])

  // Workspace switch direction drives the Arc-style slide animation.
  useEffect(() => {
    const index = state.spaces.findIndex((s) => s.id === state.activeSpaceId)
    const prev = prevSpace.current
    if (prev.id !== null && state.activeSpaceId !== null && prev.id !== state.activeSpaceId) {
      setSlide(index >= prev.index ? 'left' : 'right')
    }
    prevSpace.current = { id: state.activeSpaceId, index: Math.max(0, index) }
  }, [state.activeSpaceId, state.spaces])

  // Zen-style gesture: horizontal scroll over the sidebar switches
  // workspace. Lives in the panel, so it only fires with the pointer here.
  useEffect(() => {
    let acc = 0
    let lastTrigger = 0
    let lastEvent = 0
    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
      const now = Date.now()
      if (now - lastEvent > 250) acc = 0
      lastEvent = now
      acc += e.deltaX
      e.preventDefault()
      if (now - lastTrigger < 420 || Math.abs(acc) < 60) return
      const dir = acc > 0 ? 1 : -1
      acc = 0
      lastTrigger = now
      if (state.spaces.length < 2) return
      const idx = state.spaces.findIndex((s) => s.id === state.activeSpaceId)
      if (idx === -1) return
      const next =
        state.spaces[(idx + dir + state.spaces.length) % state.spaces.length]
      void window.browser.activateSpace(next.id)
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [state.spaces, state.activeSpaceId])

  const spaceTabs = state.tabs.filter((t) => t.spaceId === state.activeSpaceId)
  const active = spaceTabs.find((t) => t.id === state.activeTabId) ?? null

  return (
    <div className="app panel">
      <Sidebar
        state={state}
        spaceTabs={spaceTabs}
        active={active}
        collapsed={false}
        onOpenPalette={() => {
          // glint:// is intercepted natively by the fork and opens the
          // command palette; the panel never actually navigates.
          window.location.href = 'glint://palette'
        }}
        renamingSpaceId={rename?.kind === 'space' ? rename.id : null}
        renamingFolderId={rename?.kind === 'folder' ? rename.id : null}
        onRenameDone={() => setRename(null)}
        slide={slide}
      />

      {menu && (
        <ContextMenu
          menu={menu}
          state={state}
          onRename={(kind, id) => setRename({ kind, id })}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

function ContextMenu({
  menu,
  state,
  onRename,
  onClose
}: {
  menu: MenuState
  state: BrowserState
  onRename: (kind: 'space' | 'folder', id: string) => void
  onClose: () => void
}): JSX.Element {
  const { req } = menu
  const items: { label: string; danger?: boolean; run: () => void }[] = []

  if (req.kind === 'tab') {
    const tab = state.tabs.find((t) => t.id === req.id)
    if (tab?.pinned) {
      items.push({ label: 'Unpin', run: () => void window.browser.unpinTab(req.id) })
    } else {
      items.push({
        label: 'Pin to Favorites',
        run: () => void window.browser.pinTab(req.id, null, true)
      })
      items.push({
        label: 'Pin above Folders',
        run: () => void window.browser.pinTab(req.id, null, false)
      })
    }
    items.push({
      label: 'Close Tab',
      danger: true,
      run: () => void window.browser.closeTab(req.id)
    })
  } else if (req.kind === 'space') {
    const space = state.spaces.find((s) => s.id === req.id)
    items.push({ label: 'Rename Space', run: () => onRename('space', req.id) })
    items.push({
      label: 'Change color',
      run: () => void window.browser.cycleSpaceColor(req.id)
    })
    items.push({ label: 'New Space', run: () => void window.browser.createSpace() })
    items.push({
      label: 'Delete Space…',
      danger: true,
      run: () => {
        if (window.confirm(`Delete "${space?.name ?? 'space'}" and close its tabs?`)) {
          void window.browser.deleteSpace(req.id)
        }
      }
    })
  } else if (req.kind === 'folder') {
    items.push({ label: 'Rename Folder', run: () => onRename('folder', req.id) })
    items.push({
      label: 'Remove Folder',
      danger: true,
      run: () => void window.browser.removeFolder(req.id)
    })
  }

  if (items.length === 0) return <></>

  // Keep the menu inside the (narrow) panel.
  const width = 180
  const x = Math.min(menu.x, window.innerWidth - width - 8)
  const y = Math.min(menu.y, window.innerHeight - items.length * 34 - 12)

  return (
    <div className="menu-backdrop" onMouseDown={onClose} onContextMenu={(e) => e.preventDefault()}>
      <div className="context-menu" style={{ left: x, top: y, width }}>
        {items.map((item) => (
          <button
            key={item.label}
            className={`context-item${item.danger ? ' danger' : ''}`}
            onMouseDown={(e) => {
              e.stopPropagation()
              item.run()
              onClose()
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
