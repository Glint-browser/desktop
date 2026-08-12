import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { ClockCounterClockwise, IdentificationBadge, MagnifyingGlass } from '@phosphor-icons/react'
import type { HistoryEntry, TabState } from '../types'

/**
 * Parse `/profile Work gmail.com` → {name, url}. A known multi-word profile name
 * is matched as a prefix (so `Client A` works without quotes); otherwise the
 * first word is the name and the rest is the URL.
 */
function parseProfile(q: string, profiles: string[]): { name: string; url: string } | null {
  const rest = q.trim().replace(/^\/profile\s+/i, '')
  if (rest === q.trim()) return null // nothing typed after "/profile "
  const lower = rest.toLowerCase()
  const known = profiles
    .filter((p) => lower.startsWith(p.toLowerCase() + ' '))
    .sort((a, b) => b.length - a.length)[0]
  if (known) {
    const url = rest.slice(known.length).trim()
    if (url) return { name: known, url }
  }
  const m = rest.match(/^(\S+)\s+(.+)$/)
  return m ? { name: m[1], url: m[2].trim() } : null
}

interface Props {
  mode: 'tab' | 'address'
  tabs: TabState[]
  profiles: string[]
  activeTabId: string | null
  onClose: () => void
}

type Row =
  | { kind: 'open'; query: string }
  | { kind: 'tab'; tab: TabState }
  | { kind: 'history'; entry: HistoryEntry }
  | { kind: 'profile'; name: string; url: string }
  | { kind: 'profile-name'; name: string }
  | { kind: 'profile-hint' }

/**
 * Glint command palette (⌘T / ⌘L). Type to filter open tabs in the current
 * space or to open a URL / web search. ↑/↓ to move, Enter to run, Esc to close.
 */
export function CommandPalette({ mode, tabs, profiles, activeTabId, onClose }: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // In address mode, seed the field with the active tab's URL for quick editing.
  useEffect(() => {
    if (mode === 'address') {
      const url = tabs.find((t) => t.id === activeTabId)?.url ?? ''
      if (url && !url.startsWith('data:')) setQuery(url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [historyHits, setHistoryHits] = useState<HistoryEntry[]>([])

  // Query browsing history (debounced) as the user types.
  useEffect(() => {
    const id = setTimeout(() => {
      window.browser.searchHistory(query.trim()).then(setHistoryHits)
    }, 120)
    return () => clearTimeout(id)
  }, [query])

  const rows = useMemo<Row[]>(() => {
    // Slash command: /profile "Name" <url> — open a URL in an isolated profile.
    if (/^\/profile\b/i.test(query.trim())) {
      const parsed = parseProfile(query, profiles)
      if (parsed) return [{ kind: 'profile', ...parsed }]
      // Still typing: suggest existing profile names (filtered) + the syntax hint.
      const partial = query
        .replace(/^\/profile\s*/i, '')
        .replace(/^"/, '')
        .toLowerCase()
      const names = profiles.filter((p) => p.toLowerCase().includes(partial))
      return [
        ...names.map((name) => ({ kind: 'profile-name' as const, name })),
        { kind: 'profile-hint' }
      ]
    }
    const q = query.trim().toLowerCase()
    const tabMatches = q
      ? tabs.filter((t) => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q))
      : tabs
    const openUrls = new Set(tabs.map((t) => t.url))
    const out: Row[] = []
    if (q) out.push({ kind: 'open', query: query.trim() })
    out.push(...tabMatches.map((tab) => ({ kind: 'tab' as const, tab })))
    // History entries not already open as a tab.
    for (const entry of historyHits) {
      if (!openUrls.has(entry.url)) out.push({ kind: 'history', entry })
    }
    return out
  }, [query, tabs, historyHits])

  // Keep selection within bounds as the list changes.
  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(0, rows.length - 1)))
  }, [rows.length])

  const run = (row: Row | undefined): void => {
    if (!row || row.kind === 'profile-hint') return
    if (row.kind === 'profile-name') {
      // Prefill the command with the chosen profile; user then types the URL.
      setQuery(`/profile ${row.name} `)
      inputRef.current?.focus()
      return
    }
    if (row.kind === 'tab') {
      window.browser.activateTab(row.tab.id)
    } else if (row.kind === 'history') {
      window.browser.createTab(row.entry.url)
    } else if (row.kind === 'profile') {
      window.browser.openInProfile(row.name, row.url)
    } else {
      window.browser.createTab().then((id) => window.browser.navigate(id, row.query))
    }
    onClose()
  }

  const rowKey = (row: Row): string =>
    row.kind === 'tab'
      ? `tab-${row.tab.id}`
      : row.kind === 'history'
        ? `h-${row.entry.url}`
        : row.kind === 'profile'
          ? 'profile'
          : row.kind === 'profile-name'
            ? `pn-${row.name}`
            : row.kind === 'profile-hint'
              ? 'profile-hint'
              : 'open'

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          placeholder="Search tabs, enter a URL, or search the web…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSel((s) => Math.min(s + 1, rows.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((s) => Math.max(s - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              run(rows[sel])
            }
          }}
        />
        <div className="palette-list">
          {rows.map((row, i) => (
            <div
              key={rowKey(row)}
              className={`palette-row${i === sel ? ' active' : ''}`}
              onMouseEnter={() => setSel(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                run(row)
              }}
            >
              {row.kind === 'open' && (
                <>
                  <span className="palette-icon">
                    <MagnifyingGlass size={16} />
                  </span>
                  <span className="palette-label">Open “{row.query}”</span>
                  <span className="palette-meta">URL or search</span>
                </>
              )}
              {row.kind === 'tab' && (
                <>
                  <span className="palette-icon">
                    {row.tab.favicon ? <img src={row.tab.favicon} alt="" width={16} height={16} /> : '•'}
                  </span>
                  <span className="palette-label">{row.tab.title || row.tab.url || 'New Tab'}</span>
                  <span className="palette-meta">Switch</span>
                </>
              )}
              {row.kind === 'history' && (
                <>
                  <span className="palette-icon">
                    {row.entry.favicon ? (
                      <img src={row.entry.favicon} alt="" width={16} height={16} />
                    ) : (
                      <ClockCounterClockwise size={16} />
                    )}
                  </span>
                  <span className="palette-label">{row.entry.title || row.entry.url}</span>
                  <span className="palette-meta">History</span>
                </>
              )}
              {row.kind === 'profile' && (
                <>
                  <span className="palette-icon">
                    <IdentificationBadge size={16} />
                  </span>
                  <span className="palette-label">
                    Open {row.url} in {row.name}
                  </span>
                  <span className="palette-meta">Profile</span>
                </>
              )}
              {row.kind === 'profile-name' && (
                <>
                  <span className="palette-icon">
                    <IdentificationBadge size={16} />
                  </span>
                  <span className="palette-label">{row.name}</span>
                  <span className="palette-meta">Profile</span>
                </>
              )}
              {row.kind === 'profile-hint' && (
                <>
                  <span className="palette-icon">
                    <IdentificationBadge size={16} />
                  </span>
                  <span className="palette-label">/profile Name &lt;url&gt;</span>
                  <span className="palette-meta">Isolated login</span>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
