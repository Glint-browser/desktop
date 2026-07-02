import { useEffect, useRef, useState, type JSX } from 'react'
import type { BrowserState, UiAction } from '../../shared/types'
import type { AppSettings } from '../../shared/types'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { CommandPalette } from './components/CommandPalette'
import { FindBar } from './components/FindBar'
import { Settings } from './components/Settings'
import { History } from './components/History'

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

export default function App(): JSX.Element {
  const [state, setState] = useState<BrowserState>(EMPTY)
  const [palette, setPalette] = useState<{ mode: 'tab' | 'address' } | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [rename, setRename] = useState<{ kind: 'space' | 'folder'; id: string } | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Subscribe to tab state and menu-driven UI actions from the main process.
  useEffect(() => {
    window.browser.getState().then((s) => s && setState(s))
    const offState = window.browser.onStateChanged(setState)
    const offUi = window.browser.onUiAction((action: UiAction) => {
      if (action.type === 'open-palette') setPalette({ mode: action.mode })
      else if (action.type === 'open-find') setFindOpen(true)
      else if (action.type === 'open-settings') setSettingsOpen(true)
      else if (action.type === 'open-history') setHistoryOpen(true)
      else if (action.type === 'rename-space') setRename({ kind: 'space', id: action.id })
      else if (action.type === 'rename-folder') setRename({ kind: 'folder', id: action.id })
    })
    return () => {
      offState()
      offUi()
    }
  }, [])

  // Report where the page content area sits so main can size the active view.
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const report = (): void => {
      const r = el.getBoundingClientRect()
      window.browser.setContentBounds({
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height)
      })
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    window.addEventListener('resize', report)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', report)
    }
  }, [])

  // Only let the left mouse button start a drag — a right-click on a draggable
  // row could otherwise kick off a phantom drag that never ends (stuck state).
  useEffect(() => {
    let leftButton = true
    const onDown = (e: MouseEvent): void => {
      leftButton = e.button === 0
    }
    const onDragStart = (e: DragEvent): void => {
      if (!leftButton) e.preventDefault()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('dragstart', onDragStart, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('dragstart', onDragStart, true)
    }
  }, [])

  // The page view is composited above the renderer, so hide it while a
  // full-screen modal (command palette or settings) needs to show through.
  useEffect(() => {
    window.browser.setOverlay(palette !== null || settingsOpen || historyOpen)
  }, [palette, settingsOpen, historyOpen])

  // Load settings; apply the sidebar-wash opacity live.
  useEffect(() => {
    window.browser.getSettings().then(setSettings)
    return window.browser.onSettingsChanged(setSettings)
  }, [])

  useEffect(() => {
    if (settings) {
      document.documentElement.style.setProperty(
        '--sidebar-wash',
        `rgba(255, 255, 255, ${settings.sidebarOpacity})`
      )
    }
  }, [settings?.sidebarOpacity])

  const spaceTabs = state.tabs.filter((t) => t.spaceId === state.activeSpaceId)
  const active = spaceTabs.find((t) => t.id === state.activeTabId) ?? null

  return (
    <div className="app">
      <TopBar
        active={active}
        extensions={state.extensions}
        splitActive={state.splitTabIds.length >= 2}
        splitDisabled={spaceTabs.length < 2}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
      />
      <div className="body">
        <Sidebar
          state={state}
          spaceTabs={spaceTabs}
          active={active}
          collapsed={!sidebarOpen}
          onOpenPalette={() => setPalette({ mode: 'tab' })}
          renamingSpaceId={rename?.kind === 'space' ? rename.id : null}
          renamingFolderId={rename?.kind === 'folder' ? rename.id : null}
          onRenameDone={() => setRename(null)}
        />
        <div className={`content${sidebarOpen ? '' : ' no-sidebar'}`}>
          {findOpen && <FindBar onClose={() => setFindOpen(false)} />}
          {/* The page view (native, composited on top) is positioned over this
              rectangle by the main process; the find bar above shrinks it. */}
          <div className="page-host" ref={contentRef}>
            {spaceTabs.length === 0 && <div className="content-empty">No tabs open</div>}
          </div>
        </div>
      </div>

      {palette && (
        <CommandPalette
          mode={palette.mode}
          tabs={spaceTabs}
          profiles={state.profiles}
          activeTabId={state.activeTabId}
          onClose={() => setPalette(null)}
        />
      )}

      {settingsOpen && settings && (
        <Settings
          settings={settings}
          profiles={state.profiles}
          extensions={state.extensions}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {historyOpen && <History onClose={() => setHistoryOpen(false)} />}
    </div>
  )
}
