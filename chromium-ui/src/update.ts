/**
 * Glint update check against GitHub Releases. The extension's manifest
 * version IS the Glint version (bumped by scripts/publish-release.sh); the
 * baked-in component ships with the browser, so it tracks the app.
 */
export const UPDATE_REPO = 'Glint-browser/desktop'

export interface UpdateInfo {
  version: string
  url: string
  /** Direct .zip asset — the native self-updater downloads this. */
  zipUrl?: string
}

function newerThan(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

/** Fetches the latest release; stores UpdateInfo (or null) in storage. */
export async function runUpdateCheck(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`,
      { headers: { Accept: 'application/vnd.github+json' } }
    )
    if (!res.ok) return null
    const rel = await res.json()
    const latest = String(rel.tag_name ?? '').replace(/^v/, '')
    const current = chrome.runtime.getManifest().version
    if (!latest || !newerThan(latest, current)) {
      await chrome.storage.local.set({ updateInfo: null })
      return null
    }
    const assets = rel.assets as
      | { name?: string; browser_download_url?: string }[]
      | undefined
    const dmg = assets?.find((a) => a.name?.endsWith('.dmg'))
    const zip = assets?.find((a) => a.name?.endsWith('.zip'))
    const info: UpdateInfo = {
      version: latest,
      url:
        dmg?.browser_download_url ??
        rel.html_url ??
        `https://github.com/${UPDATE_REPO}/releases/latest`,
      zipUrl: zip?.browser_download_url
    }
    await chrome.storage.local.set({ updateInfo: info })
    return info
  } catch {
    return null // offline — next alarm retries
  }
}
