import { useEffect, useMemo, useState, type JSX } from 'react'
import { ClockCounterClockwise, Trash, X } from '@phosphor-icons/react'
import type { HistoryEntry } from '../../../shared/types'

/** Full-screen, browsable history: search, grouped by day, per-item + clear-all. */
export function History({ onClose }: { onClose: () => void }): JSX.Element {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<HistoryEntry[]>([])

  const load = (q: string): void => void window.browser.getAllHistory(q).then(setItems)
  useEffect(() => load(''), [])
  useEffect(() => {
    const t = setTimeout(() => load(query), 150)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const remove = (url: string): void => {
    setItems((cur) => cur.filter((h) => h.url !== url))
    window.browser.deleteHistory(url)
  }
  const clearAll = (): void => {
    setItems([])
    window.browser.clearHistory()
  }

  // Group entries under day headers (Today / Yesterday / date).
  const groups = useMemo(() => groupByDay(items), [items])

  return (
    <div className="settings-backdrop" onMouseDown={onClose}>
      <div className="settings history" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-content history-content">
          <button className="settings-close" title="Close" onClick={onClose}>
            <X size={16} weight="bold" />
          </button>
          <div className="history-head">
            <h2>
              <ClockCounterClockwise size={22} weight="fill" /> History
            </h2>
            <input
              className="history-search"
              value={query}
              placeholder="Search history"
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
            />
            {items.length > 0 && (
              <button className="settings-btn danger" onClick={clearAll}>
                Clear all
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <div className="history-empty">
              {query ? 'No matching history.' : 'No history yet.'}
            </div>
          ) : (
            <div className="history-list">
              {groups.map(([label, entries]) => (
                <div key={label} className="history-group">
                  <div className="history-day">{label}</div>
                  {entries.map((h) => (
                    <div className="history-row" key={h.url + h.ts}>
                      <img
                        className="history-favicon"
                        src={h.favicon || fallbackIcon}
                        alt=""
                        width={16}
                        height={16}
                        onError={(e) => (e.currentTarget.src = fallbackIcon)}
                      />
                      <button
                        className="history-link"
                        title={h.url}
                        onClick={() => {
                          window.browser.createTab(h.url)
                          onClose()
                        }}
                      >
                        <span className="history-title">{h.title || h.url}</span>
                        <span className="history-url">{prettyUrl(h.url)}</span>
                      </button>
                      <span className="history-time">{time(h.ts)}</span>
                      <button
                        className="history-del"
                        title="Remove from history"
                        onClick={() => remove(h.url)}
                      >
                        <Trash size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const fallbackIcon =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="4" fill="%23c9c9d0"/></svg>'

function prettyUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname)
  } catch {
    return url
  }
}

function time(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function dayLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const same = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString()
  if (same(d, today)) return 'Today'
  if (same(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
}

function groupByDay(items: HistoryEntry[]): [string, HistoryEntry[]][] {
  const map = new Map<string, HistoryEntry[]>()
  for (const h of items) {
    const label = dayLabel(h.ts)
    const arr = map.get(label)
    if (arr) arr.push(h)
    else map.set(label, [h])
  }
  return [...map.entries()]
}
