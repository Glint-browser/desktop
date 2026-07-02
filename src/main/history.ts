import type { HistoryEntry } from '../shared/types'
import { loadJson, saveJsonDebounced } from './store'

const FILE = 'history.json'
const MAX = 3000

/** Browsing history, newest first, capped and searchable. */
export class HistoryStore {
  private items: HistoryEntry[] = loadJson<HistoryEntry[]>(FILE, [])

  /** Record a visit, deduping consecutive hits on the same URL. */
  record(entry: Omit<HistoryEntry, 'ts'>): void {
    if (!entry.url || entry.url.startsWith('data:') || entry.url === 'about:blank') return
    const top = this.items[0]
    if (top && top.url === entry.url) {
      top.title = entry.title || top.title
      top.favicon = entry.favicon ?? top.favicon
      top.ts = Date.now()
    } else {
      this.items.unshift({ ...entry, ts: Date.now() })
      if (this.items.length > MAX) this.items.length = MAX
    }
    saveJsonDebounced(FILE, () => this.items)
  }

  clear(): void {
    this.items = []
    saveJsonDebounced(FILE, () => this.items)
  }

  /** All visits (newest first), optionally filtered — for the History page. */
  all(query = '', limit = 1000): HistoryEntry[] {
    const q = query.trim().toLowerCase()
    const items = q
      ? this.items.filter(
          (h) => h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q)
        )
      : this.items
    return items.slice(0, limit)
  }

  /** Remove every visit to a URL. */
  remove(url: string): void {
    this.items = this.items.filter((h) => h.url !== url)
    saveJsonDebounced(FILE, () => this.items)
  }

  /** Most recent matches for a query (empty query returns recent history). */
  search(query: string, limit = 8): HistoryEntry[] {
    const q = query.trim().toLowerCase()
    const matches = q
      ? this.items.filter(
          (h) => h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q)
        )
      : this.items
    // De-duplicate by URL, keeping the most recent.
    const seen = new Set<string>()
    const out: HistoryEntry[] = []
    for (const h of matches) {
      if (seen.has(h.url)) continue
      seen.add(h.url)
      out.push(h)
      if (out.length >= limit) break
    }
    return out
  }
}
