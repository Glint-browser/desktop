import type { DragEvent, JSX } from 'react'
import { X } from '@phosphor-icons/react'
import type { TabState } from '../types'

interface Props {
  tab: TabState
  isActive: boolean
  inSplit: boolean
  isDragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onDragOverItem: (e: DragEvent) => void
}

export function TabItem({
  tab,
  isActive,
  inSplit,
  isDragging,
  onDragStart,
  onDragEnd,
  onDragOverItem
}: Props): JSX.Element {
  const label = tab.isNewTabPage ? 'New Tab' : tab.title || displayHost(tab.url) || 'New Tab'
  const className =
    'tab-item' +
    (isActive ? ' active' : '') +
    (inSplit ? ' split' : '') +
    (isDragging ? ' dragging' : '')

  return (
    <div
      className={className}
      draggable
      onDragStart={(e) => {
        // Carry the tab id so other drop targets (favorites, folders) can read it.
        e.dataTransfer.setData('text/glint-tab', tab.id)
        e.dataTransfer.effectAllowed = 'copyMove'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onDragOver={onDragOverItem}
      onClick={() => window.browser.activateTab(tab.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        window.browser.showContextMenu({ kind: 'tab', id: tab.id })
      }}
      title={label}
    >
      <span className="tab-favicon">
        {tab.isLoading ? (
          <span className="spinner" />
        ) : tab.favicon ? (
          <img src={tab.favicon} alt="" width={18} height={18} />
        ) : (
          <span className="favicon-fallback" />
        )}
      </span>
      <span className="tab-title">{label}</span>
      {tab.profile && (
        <span
          className="tab-profile"
          style={{ background: profileColor(tab.profile) }}
          title={`Profile: ${tab.profile}`}
        >
          {tab.profile.slice(0, 5).toUpperCase()}
        </span>
      )}
      <button
        className="tab-close"
        title="Close tab"
        onClick={(e) => {
          e.stopPropagation()
          window.browser.closeTab(tab.id)
        }}
      >
        <X size={13} weight="bold" />
      </button>
    </div>
  )
}

/** Deterministic color for a profile name (so the badge is stable per profile). */
function profileColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return `hsl(${h % 360}, 62%, 48%)`
}

function displayHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}
