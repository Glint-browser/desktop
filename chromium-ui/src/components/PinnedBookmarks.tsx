import { useEffect, useState, type JSX } from 'react'
import { Folder, FolderOpen } from '@phosphor-icons/react'
import type { Bookmark, BookmarkFolder, TabState } from '../types'
import { InlineRename } from './InlineRename'
import { findOpenTab } from '../lib/tabMatch'

interface Props {
  bookmarks: Bookmark[]
  folders: BookmarkFolder[]
  allTabs: TabState[]
  spaceTabs: TabState[]
  active: TabState | null
  activeTabId: string | null
  renamingFolderId: string | null
  onRenameDone: () => void
}

/**
 * Workspace pinned bookmarks as a vertical list (favicon + label rows). Folders
 * are rows with a folder icon that expand to show their bookmarks indented. A
 * bookmark can be dragged onto a folder to file it; clicking a bookmark
 * activates an existing tab or navigates in place (never spawns a new tab).
 */
export function PinnedBookmarks({
  bookmarks,
  folders,
  allTabs,
  spaceTabs,
  active,
  activeTabId,
  renamingFolderId,
  onRenameDone
}: Props): JSX.Element {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropFolder, setDropFolder] = useState<string | null>(null)
  const [tabDragging, setTabDragging] = useState(false) // a tab is being dragged over this area
  const [looseOver, setLooseOver] = useState(false) // hovering the loose drop zone

  // Clear all drop highlights whenever any drag ends (avoids stuck outlines).
  useEffect(() => {
    const clear = (): void => {
      setDragId(null)
      setDropFolder(null)
      setTabDragging(false)
      setLooseOver(false)
    }
    window.addEventListener('dragend', clear, true)
    return () => window.removeEventListener('dragend', clear, true)
  }, [])

  const openBookmark = (url: string): void => {
    const existing = findOpenTab(allTabs, url)
    if (existing) window.browser.activateTab(existing.id)
    else if (active?.isNewTabPage) window.browser.navigate(active.id, url)
    else window.browser.createTab(url)
  }

  const bookmarksIn = (id: string): Bookmark[] => bookmarks.filter((b) => b.folderId === id)
  // Membership is scoped to the active workspace (spaceTabs), not all tabs.
  const tabsIn = (id: string): TabState[] => spaceTabs.filter((t) => t.pinned && t.folderId === id)
  const looseTabs = spaceTabs.filter((t) => t.pinned && !t.favorite && !t.folderId)
  const rootBookmarks = bookmarks.filter(
    (b) => !b.folderId || !folders.some((f) => f.id === b.folderId)
  )

  if (bookmarks.length === 0 && folders.length === 0 && looseTabs.length === 0) return <></>

  // A pinned tab that lives inside a folder: click activates it, drag moves it.
  const tabRow = (tab: TabState): JSX.Element => {
    const label = tab.title || tab.url || 'Tab'
    return (
      <div
        key={tab.id}
        className={`pin-row${tab.id === activeTabId ? ' active' : ''}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/glint-tab', tab.id)
          e.dataTransfer.effectAllowed = 'copyMove'
        }}
        onClick={() => window.browser.activateTab(tab.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          window.browser.showContextMenu({ kind: 'tab', id: tab.id })
        }}
        title={label}
      >
        <span className="pin-icon">
          {tab.favicon ? <img src={tab.favicon} alt="" width={19} height={19} /> : <span className="favicon-fallback" />}
        </span>
        <span className="pin-label">{label}</span>
      </div>
    )
  }

  const bookmarkRow = (b: Bookmark): JSX.Element => (
    <div
      key={b.id}
      className="pin-row"
      draggable
      onDragStart={() => setDragId(b.id)}
      onDragEnd={() => {
        setDragId(null)
        setDropFolder(null)
      }}
      onClick={() => openBookmark(b.url)}
      onContextMenu={(e) => {
        e.preventDefault()
        window.browser.removeBookmark({ id: b.id })
      }}
      title={`${b.title} — right-click to remove`}
    >
      <span className="pin-icon">
        {b.favicon ? <img src={b.favicon} alt="" width={19} height={19} /> : <span className="favicon-fallback" />}
      </span>
      <span className="pin-label">{b.title}</span>
    </div>
  )

  return (
    <div
      className="pinned"
      onDragOver={(e) => {
        // Note the drag so the loose zone above the folders opens up as a target.
        if (e.dataTransfer.types.includes('text/glint-tab')) setTabDragging(true)
      }}
    >
      <div
        className={
          'loose-zone' +
          (looseTabs.length === 0 ? ' empty' : '') +
          (tabDragging ? ' active' : '') +
          (looseOver ? ' over' : '')
        }
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('text/glint-tab')) {
            e.preventDefault()
            e.stopPropagation()
            setLooseOver(true)
          }
        }}
        onDragLeave={() => setLooseOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const tabId = e.dataTransfer.getData('text/glint-tab')
          if (tabId) window.browser.pinTab(tabId, null, false) // loose row (above folders)
          setLooseOver(false)
          setTabDragging(false)
        }}
      >
        {looseTabs.map(tabRow)}
        {looseTabs.length === 0 && tabDragging && (
          <div className="loose-hint">Drop here to pin above folders</div>
        )}
      </div>

      {folders.map((folder) => {
        const isOpen = open[folder.id]
        const memberTabs = tabsIn(folder.id)
        const memberBookmarks = bookmarksIn(folder.id)
        const count = memberTabs.length + memberBookmarks.length
        return (
          <div key={folder.id}>
            <div
              className={`pin-row folder${dropFolder === folder.id ? ' drop' : ''}`}
              onClick={() => setOpen((o) => ({ ...o, [folder.id]: !o[folder.id] }))}
              onContextMenu={(e) => {
                e.preventDefault()
                window.browser.showContextMenu({ kind: 'folder', id: folder.id })
              }}
              onDragOver={(e) => {
                if (dragId || e.dataTransfer.types.includes('text/glint-tab')) {
                  e.preventDefault()
                  setDropFolder(folder.id)
                }
              }}
              onDragLeave={() => setDropFolder((f) => (f === folder.id ? null : f))}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation() // don't also trigger the loose-row drop
                const tabId = e.dataTransfer.getData('text/glint-tab')
                if (tabId) window.browser.pinTab(tabId, folder.id, false)
                else if (dragId) window.browser.moveBookmark(dragId, folder.id)
                setDropFolder(null)
              }}
              title={`${folder.name} — right-click for options`}
            >
              <span className="pin-icon">
                {isOpen ? <FolderOpen size={17} weight="fill" /> : <Folder size={17} weight="fill" />}
              </span>
              {renamingFolderId === folder.id ? (
                <span style={{ flex: 1 }} onClick={(e) => e.stopPropagation()}>
                  <InlineRename
                    initial={folder.name}
                    onSubmit={(name) => {
                      window.browser.renameFolder(folder.id, name)
                      onRenameDone()
                    }}
                    onCancel={onRenameDone}
                  />
                </span>
              ) : (
                <>
                  <span className="pin-label">{folder.name}</span>
                  {count ? <span className="pin-count">{count}</span> : null}
                </>
              )}
            </div>
            {isOpen && (
              <div className="pin-children">
                {memberTabs.map(tabRow)}
                {memberBookmarks.map(bookmarkRow)}
                {count === 0 && <div className="folder-empty">Drag tabs here</div>}
              </div>
            )}
          </div>
        )
      })}

      {rootBookmarks.map(bookmarkRow)}
    </div>
  )
}
