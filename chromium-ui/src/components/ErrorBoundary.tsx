import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Short name of the surface, e.g. "sidebar" or "settings". */
  surface: string
}

interface State {
  error: Error | null
}

/**
 * The side panel IS the browser's tab UI — there is no native tab strip — so an
 * uncaught render error must never leave the user with a blank panel and no way
 * back. This catches it, shows the error, and offers a reload; reloading the
 * panel document re-mounts everything from chrome.* state.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[glint] ${this.props.surface} crashed`, error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return <CrashScreen surface={this.props.surface} error={this.state.error} />
  }
}

function CrashScreen({ surface, error }: { surface: string; error: Error }): JSX.Element {
  return (
    <div className="crash" role="alert">
      <div className="crash-title">The Glint {surface} hit an error</div>
      <div className="crash-msg">{error.message || String(error)}</div>
      <div className="crash-actions">
        <button className="dlg-btn" onClick={() => window.location.reload()}>
          Reload
        </button>
        <button
          className="dlg-btn"
          onClick={() =>
            void navigator.clipboard.writeText(`${error.message}\n${error.stack ?? ''}`)
          }
        >
          Copy error
        </button>
      </div>
    </div>
  )
}
