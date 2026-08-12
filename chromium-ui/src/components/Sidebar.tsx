import { useEffect, useState, type DragEvent, type JSX } from 'react'
import { Check, DownloadSimple, FolderOpen, FolderPlus, LinkSimple, Plus, Star } from '@phosphor-icons/react'
import type { BrowserState, TabState } from '../types'
import { TabItem } from './TabItem'
import { PinnedBookmarks } from './PinnedBookmarks'
import { Favorites } from './Favorites'
import { InlineRename } from './InlineRename'

interface Props {
  state: BrowserState
  spaceTabs: TabState[]
  active: TabState | null
  collapsed: boolean
  onOpenPalette: () => void
  renamingSpaceId: string | null
  renamingFolderId: string | null
  onRenameDone: () => void
  /** Arc-style workspace switch animation direction (null = no animation). */
  slide?: 'left' | 'right' | null
}

export function Sidebar({
  state,
  spaceTabs,
  active,
  collapsed,
  onOpenPalette,
  renamingSpaceId,
  renamingFolderId,
  onRenameDone,
  slide = null
}: Props): JSX.Element {
  const activeSpace = state.spaces.find((s) => s.id === state.activeSpaceId) ?? null
  const [dragId, setDragId] = useState<string | null>(null)
  // Drop indicator: insertion index + pixel Y (relative to the tab list).
  const [drop, setDrop] = useState<{ index: number; y: number } | null>(null)

  // Reset drag state at the start of EVERY drag (a list TabItem re-sets dragId
  // right after, in its own onDragStart) and clear on drag end. This prevents a
  // stale dragId from a previous drag making the list think it's a reorder.
  useEffect(() => {
    const clear = (): void => {
      setDragId(null)
      setDrop(null)
    }
    window.addEventListener('dragstart', clear, true)
    window.addEventListener('dragend', clear, true)
    return () => {
      window.removeEventListener('dragstart', clear, true)
      window.removeEventListener('dragend', clear, true)
    }
  }, [])

  // Everything is scoped to the ACTIVE workspace (spaces don't share tabs/folders).
  // favorite → icon row; loose pinned rows + folders live in PinnedBookmarks;
  // the plain list shows the rest of the active space's (unpinned) tabs.
  const favoriteTabs = spaceTabs.filter((t) => t.pinned && t.favorite)
  const listTabs = spaceTabs.filter((t) => !t.pinned)
  const spaceFolders = state.bookmarkFolders.filter((f) => f.spaceId === state.activeSpaceId)

  // Position the drop line by pixel (absolute overlay) so it never shifts the
  // rows — inserting an in-flow line caused the target index to jitter.
  const onItemDragOver = (e: DragEvent, index: number): void => {
    if (!dragId) return
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    const r = el.getBoundingClientRect()
    const after = e.clientY > r.top + r.height / 2
    setDrop({ index: after ? index + 1 : index, y: el.offsetTop + (after ? el.offsetHeight : 0) })
  }

  const onListDragOver = (e: DragEvent): void => {
    if (!e.dataTransfer.types.includes('text/glint-tab')) return
    e.preventDefault() // allow the drop (reorder a list tab, or unpin a pinned tab)
    // Show the insertion line only when reordering within the list.
    if (dragId && e.target === e.currentTarget) {
      const items = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.tab-item')
      const last = items[items.length - 1]
      setDrop({ index: listTabs.length, y: last ? last.offsetTop + last.offsetHeight : 0 })
    }
  }

  const onListDrop = (e: DragEvent): void => {
    e.preventDefault()
    const tabId = e.dataTransfer.getData('text/glint-tab')
    if (tabId) {
      // Decide by the dropped tab itself, not by (possibly stale) dragId.
      if (listTabs.some((t) => t.id === tabId)) finishReorder(tabId)
      else window.browser.unpinTab(tabId) // a pinned tab dropped here → unpin
    }
    setDragId(null)
    setDrop(null)
  }

  const finishReorder = (tabId: string): void => {
    if (!drop || !state.activeSpaceId) return
    const listIds = listTabs.map((t) => t.id)
    const from = listIds.indexOf(tabId)
    if (from === -1) return
    const without = listIds.filter((id) => id !== tabId)
    const insertAt = from < drop.index ? drop.index - 1 : drop.index
    without.splice(insertAt, 0, tabId)
    // Rebuild the full space order, keeping pinned tabs in their slots.
    let q = 0
    const full = spaceTabs.map((t) => (t.pinned ? t.id : without[q++]))
    window.browser.reorderTabs(state.activeSpaceId, full)
  }

  const hasBookmarks = state.bookmarks.length > 0 || state.bookmarkFolders.length > 0

  // Rename may target a not-yet-active space (Zen-style rename from a dot):
  // resolve it independently of activeSpace so the input survives the switch.
  const renamingSpace = renamingSpaceId
    ? (state.spaces.find((s) => s.id === renamingSpaceId) ?? null)
    : null

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-inner">
      <AddressBar active={active} bookmarks={state.bookmarks} />

      <div
        key={renamingSpaceId ?? state.activeSpaceId ?? 'none'}
        className={`space-pane${slide ? ` slide-${slide}` : ''}`}
      >
      <Favorites pinnedTabs={favoriteTabs} activeTabId={state.activeTabId} />

      <div className="space-header">
        {renamingSpace ? (
          <InlineRename
            initial={renamingSpace.name}
            onSubmit={(name) => {
              window.browser.renameSpace(renamingSpace.id, name)
              onRenameDone()
            }}
            onCancel={onRenameDone}
          />
        ) : (
          <span
            className="space-name"
            onContextMenu={(e) => {
              e.preventDefault()
              if (activeSpace) window.browser.showContextMenu({ kind: 'space', id: activeSpace.id })
            }}
          >
            {activeSpace?.name ?? 'My Space'}
          </span>
        )}
        <span className="space-actions">
          <button
            className="mini-btn"
            title="New folder"
            onClick={() => window.browser.createFolder()}
          >
            <FolderPlus size={16} />
          </button>
        </span>
      </div>

      <PinnedBookmarks
        bookmarks={state.bookmarks}
        folders={spaceFolders}
        allTabs={state.tabs}
        spaceTabs={spaceTabs}
        active={active}
        activeTabId={state.activeTabId}
        renamingFolderId={renamingFolderId}
        onRenameDone={onRenameDone}
      />

      {hasBookmarks && <div className="divider" />}

      <button className="new-tab" onClick={onOpenPalette}>
        <Plus size={16} weight="bold" /> New Tab
      </button>

      <div className="tab-list" onDragOver={onListDragOver} onDrop={onListDrop}>
        {drop && <div className="drop-line" style={{ top: drop.y }} />}
        {listTabs.map((tab, i) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === state.activeTabId}
            inSplit={state.splitTabIds.includes(tab.id)}
            isDragging={dragId === tab.id}
            onDragStart={() => setDragId(tab.id)}
            onDragEnd={() => {
              setDragId(null)
              setDrop(null)
            }}
            onDragOverItem={(e) => onItemDragOver(e, i)}
          />
        ))}
      </div>
      </div>

      <BottomBar state={state} />
      </div>
    </aside>
  )
}

/** Bottom strip: downloads at the left, one dot per workspace, new-space. */
function BottomBar({ state }: { state: BrowserState }): JSX.Element {
  const [dropSpace, setDropSpace] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  useEffect(() => {
    const clear = (): void => setDropSpace(null)
    window.addEventListener('dragend', clear, true)
    return () => window.removeEventListener('dragend', clear, true)
  }, [])
  // Subtle indicator while something is downloading.
  useEffect(() => {
    const refresh = (): void => {
      chrome.downloads
        .search({ state: 'in_progress' })
        .then((items) => setDownloading(items.length > 0))
        .catch(() => {})
    }
    refresh()
    chrome.downloads.onCreated.addListener(refresh)
    chrome.downloads.onChanged.addListener(refresh)
    return () => {
      chrome.downloads.onCreated.removeListener(refresh)
      chrome.downloads.onChanged.removeListener(refresh)
    }
  }, [])
  return (
    <div className="bottom-bar">
      <DownloadsButton downloading={downloading} />
      <div className="space-dots">
        {state.spaces.map((s) => (
          <button
            key={s.id}
            className={`dot${s.id === state.activeSpaceId ? ' active' : ''}${dropSpace === s.id ? ' drop' : ''}`}
            style={{ background: s.color }}
            title={`${s.name} — right-click for options, drop a tab to move it`}
            onClick={() => window.browser.activateSpace(s.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              window.browser.showContextMenu({ kind: 'space', id: s.id })
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('text/glint-tab')) {
                e.preventDefault()
                setDropSpace(s.id)
              }
            }}
            onDragLeave={() => setDropSpace((d) => (d === s.id ? null : d))}
            onDrop={(e) => {
              e.preventDefault()
              const tabId = e.dataTransfer.getData('text/glint-tab')
              if (tabId) window.browser.moveTabToSpace(tabId, s.id)
              setDropSpace(null)
            }}
          />
        ))}
      </div>
      <button
        className="bottom-add"
        title="New Workspace"
        onClick={() => window.browser.createSpace()}
      >
        <Plus size={16} />
      </button>
    </div>
  )
}

function AddressBar({
  active,
  bookmarks
}: {
  active: TabState | null
  bookmarks: BrowserState['bookmarks']
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!editing) setValue(active?.url ?? '')
  }, [active?.url, editing])

  const isBookmarked = !!active && bookmarks.some((b) => b.url === active.url)

  const copyLink = (): void => {
    if (!active || active.isNewTabPage) return
    window.browser.copyToClipboard(active.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const submit = (): void => {
    if (active && value.trim()) window.browser.navigate(active.id, value)
    setEditing(false)
  }

  const toggleBookmark = (): void => {
    if (!active || active.isNewTabPage) return
    if (isBookmarked) window.browser.removeBookmark({ url: active.url })
    else window.browser.addBookmark(active.url, active.title, active.favicon)
  }

  return (
    <div className="address-bar">
      <input
        className="address-input"
        value={editing ? value : displayUrl(active)}
        placeholder="Search or enter address"
        onFocus={(e) => {
          setEditing(true)
          setValue(active && !active.isNewTabPage ? active.url : '')
          e.currentTarget.select()
        }}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
      <button
        className={`addr-star${copied ? ' on' : ''}`}
        disabled={!active || active.isNewTabPage}
        title={copied ? 'Copied!' : 'Copy link'}
        onClick={copyLink}
      >
        {copied ? <Check size={15} weight="bold" /> : <LinkSimple size={15} />}
      </button>
      <button
        className={`addr-star${isBookmarked ? ' on' : ''}`}
        disabled={!active || active.isNewTabPage}
        title={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
        onClick={toggleBookmark}
      >
        <Star size={15} weight={isBookmarked ? 'fill' : 'regular'} />
      </button>
    </div>
  )
}

/** Clean host-first label; blank for the new-tab page. */
function displayUrl(active: TabState | null): string {
  if (!active || active.isNewTabPage) return ''
  try {
    const u = new URL(active.url)
    return u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname)
  } catch {
    return active.url
  }
}


/** Bottom-left downloads button with a Glint-styled popover (no page jump). */
function DownloadsButton({ downloading }: { downloading: boolean }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <span className="dl-wrap">
      {open && <DownloadsPopover onClose={() => setOpen(false)} />}
      <button
        className={`bottom-add bottom-dl${downloading ? ' active' : ''}`}
        title="Downloads"
        onClick={() => setOpen((o) => !o)}
      >
        <DownloadSimple size={16} />
      </button>
    </span>
  )
}

function basename(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i === -1 ? path : path.slice(i + 1)
}

function prettyBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  const units = ['B', 'kB', 'MB', 'GB']
  let u = 0
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024
    u++
  }
  return `${n.toFixed(n >= 10 || u === 0 ? 0 : 1)} ${units[u]}`
}

function DownloadsPopover({ onClose }: { onClose: () => void }): JSX.Element {
  const [items, setItems] = useState<chrome.downloads.DownloadItem[]>([])

  useEffect(() => {
    let alive = true
    const refresh = (): void => {
      chrome.downloads
        .search({ orderBy: ['-startTime'], limit: 8 })
        .then((list) => {
          if (alive) setItems(list.filter((d) => d.filename))
        })
        .catch(() => {})
    }
    refresh()
    const tick = setInterval(refresh, 600)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      alive = false
      clearInterval(tick)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <>
      <div className="dl-backdrop" onMouseDown={onClose} />
      <div className="dl-pop">
        <div className="dl-head">Downloads</div>
        {items.length === 0 && <div className="dl-empty">No downloads yet</div>}
        {items.map((d) => {
          const active = d.state === 'in_progress'
          const pct =
            active && d.totalBytes > 0
              ? Math.round((d.bytesReceived / d.totalBytes) * 100)
              : null
          return (
            <div
              key={d.id}
              className={`dl-row${d.state === 'interrupted' ? ' broken' : ''}`}
              title={d.filename}
              onClick={() => {
                if (d.state === 'complete') chrome.downloads.open(d.id)
              }}
            >
              <span className="dl-name">{basename(d.filename)}</span>
              {active ? (
                <span className="dl-meta">
                  {pct !== null ? `${pct}%` : prettyBytes(d.bytesReceived)}
                </span>
              ) : (
                <span className="dl-meta">
                  {d.state === 'interrupted' ? 'Failed' : prettyBytes(d.fileSize)}
                </span>
              )}
              <button
                className="dl-show"
                title="Show in Finder"
                onClick={(e) => {
                  e.stopPropagation()
                  chrome.downloads.show(d.id)
                }}
              >
                <FolderOpen size={14} />
              </button>
              {active && pct !== null && (
                <span className="dl-bar" style={{ width: `${pct}%` }} />
              )}
            </div>
          )
        })}
        <button
          className="dl-all"
          onClick={() => {
            chrome.tabs.create({ url: 'chrome://downloads' })
            onClose()
          }}
        >
          View all downloads
        </button>
      </div>
    </>
  )
}
