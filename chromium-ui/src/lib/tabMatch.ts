import type { TabState } from '../types'

/** Hostname without a leading www, or '' if the URL can't be parsed. */
function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Normalized host + path (trailing slashes removed), lowercased. */
function norm(url: string): string {
  try {
    const u = new URL(url)
    return (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '')).toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

/** Find an already-open tab for a URL: exact (normalized) first, then same site. */
export function findOpenTab(tabs: TabState[], url: string): TabState | undefined {
  const n = norm(url)
  const h = host(url)
  return tabs.find((t) => norm(t.url) === n) ?? (h ? tabs.find((t) => host(t.url) === h) : undefined)
}

/** True if two URLs point at the same site (hostname). */
export function isSameSite(a: string, b: string): boolean {
  const h = host(a)
  return h !== '' && h === host(b)
}
