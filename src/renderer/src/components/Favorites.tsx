import { useEffect, useState, type DragEvent, type JSX } from 'react'
import type { TabState } from '../../../shared/types'

interface Props {
  pinnedTabs: TabState[]
  activeTabId: string | null
}

/**
 * Icon-only row of pinned tabs (favorites), above the workspace name. A pinned
 * tab is a real tab shown as an icon — clicking it just activates that tab
 * (it shows "inactive" when you're not on it). Drag a tab here to pin it;
 * right-click to unpin.
 */
export function Favorites({ pinnedTabs, activeTabId }: Props): JSX.Element {
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    const clear = (): void => setDragOver(false)
    window.addEventListener('dragend', clear, true)
    return () => window.removeEventListener('dragend', clear, true)
  }, [])

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    const id = e.dataTransfer.getData('text/glint-tab')
    if (id) window.browser.pinTab(id, null, true) // top icon favorite
  }

  return (
    <div
      className={`favorites-row${dragOver ? ' drag' : ''}${pinnedTabs.length === 0 ? ' empty' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('text/glint-tab')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {pinnedTabs.map((tab) => {
        const label = tab.title || tab.url || 'Tab'
        return (
          <button
            key={tab.id}
            className={`fav-tile${tab.id === activeTabId ? ' active' : ''}`}
            title={label}
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
          >
            {tab.favicon ? (
              <img src={tab.favicon} alt="" width={20} height={20} />
            ) : (
              <span className="fav-fallback">{label.charAt(0).toUpperCase()}</span>
            )}
          </button>
        )
      })}
      {pinnedTabs.length === 0 && <span className="fav-hint">Drag tabs here to pin</span>}
    </div>
  )
}
