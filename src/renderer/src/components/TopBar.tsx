import type { JSX } from 'react'
import {
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  Columns,
  DotsThree,
  PuzzlePiece,
  SidebarSimple
} from '@phosphor-icons/react'
import type { ExtensionInfo, TabState } from '../../../shared/types'

interface Props {
  active: TabState | null
  extensions: ExtensionInfo[]
  splitDisabled: boolean
  splitActive: boolean
  sidebarOpen: boolean
  onToggleSidebar: () => void
}

const ICON = 17

/** Slim top strip: window controls space + navigation buttons (Phosphor icons). */
export function TopBar({
  active,
  extensions,
  splitDisabled,
  splitActive,
  sidebarOpen,
  onToggleSidebar
}: Props): JSX.Element {
  return (
    <header className="topbar">
      <span className="win-space" />
      <button
        className="top-btn"
        onClick={onToggleSidebar}
        title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
      >
        <SidebarSimple size={ICON} />
      </button>
      <button
        className={`top-btn${splitActive ? ' on' : ''}`}
        disabled={splitDisabled}
        onClick={() => window.browser.toggleSplit()}
        title="Split view (⌘D)"
      >
        <Columns size={ICON} />
      </button>
      <button
        className="top-btn"
        disabled={!active?.canGoBack}
        onClick={() => active && window.browser.goBack(active.id)}
        title="Back"
      >
        <CaretLeft size={ICON} weight="bold" />
      </button>
      <button
        className="top-btn"
        disabled={!active?.canGoForward}
        onClick={() => active && window.browser.goForward(active.id)}
        title="Forward"
      >
        <CaretRight size={ICON} weight="bold" />
      </button>
      <button
        className="top-btn"
        disabled={!active}
        onClick={() => active && window.browser.reload(active.id)}
        title="Reload"
      >
        <ArrowClockwise size={ICON} />
      </button>

      <div className="topbar-right">
        {extensions.map((ext) => (
          <button
            key={ext.id}
            className="top-btn ext-btn"
            title={ext.name}
            onClick={() => ext.hasPopup && window.browser.openExtensionPopup(ext.id)}
          >
            {ext.icon ? (
              <img src={ext.icon} alt="" width={18} height={18} />
            ) : (
              <span className="ext-fallback">{ext.name.charAt(0).toUpperCase()}</span>
            )}
          </button>
        ))}
        <button
          className="top-btn"
          title="Extensions"
          onClick={() => window.browser.showContextMenu({ kind: 'extensions' })}
        >
          <PuzzlePiece size={ICON} />
        </button>
        <button
          className="top-btn"
          title="Menu"
          onClick={() => window.browser.showContextMenu({ kind: 'app' })}
        >
          <DotsThree size={ICON + 4} weight="bold" />
        </button>
      </div>
    </header>
  )
}
