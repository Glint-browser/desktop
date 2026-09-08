import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import {
  Gear,
  IdentificationBadge,
  Info,
  Keyboard,
  MagnifyingGlass,
  Palette,
  PuzzlePiece,
  ShieldCheck,
  Trash
} from '@phosphor-icons/react'
import type { AppSettings, ExtensionInfo, SearchEngine, ThemeSource , UpdateStatus } from '../types'
import { exportBackupJson, importBackupJson } from '../lib/backup'

// Vivaldi-style settings: a full-window page with a searchable category rail,
// ALL-CAPS section headers with rules, and grouped controls — rendered in the
// Glint light palette. Opened as its own popup window from the app menu (⌘,).

interface Props {
  settings: AppSettings
  onClose: () => void
}

type Category =
  | 'general'
  | 'appearance'
  | 'search'
  | 'privacy'
  | 'profiles'
  | 'keyboard'
  | 'extensions'
  | 'about'

const CATEGORIES: { id: Category; label: string; icon: JSX.Element; color: string }[] = [
  { id: 'general', label: 'General', icon: <Gear size={16} weight="fill" />, color: '#8f5be8' },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: <Palette size={16} weight="fill" />,
    color: '#e06f9c'
  },
  {
    id: 'search',
    label: 'Search',
    icon: <MagnifyingGlass size={16} weight="bold" />,
    color: '#3fb0c4'
  },
  {
    id: 'privacy',
    label: 'Privacy and Security',
    icon: <ShieldCheck size={16} weight="fill" />,
    color: '#3fa15c'
  },
  {
    id: 'profiles',
    label: 'Profiles',
    icon: <IdentificationBadge size={16} weight="fill" />,
    color: '#ec8a3b'
  },
  {
    id: 'keyboard',
    label: 'Keyboard',
    icon: <Keyboard size={16} weight="fill" />,
    color: '#4a7dfc'
  },
  {
    id: 'extensions',
    label: 'Extensions',
    icon: <PuzzlePiece size={16} weight="fill" />,
    color: '#e25c4a'
  },
  { id: 'about', label: 'About', icon: <Info size={16} weight="bold" />, color: '#8f8f94' }
]

/** Searchable index: every row a query can hit, and where it lives. */
const SEARCH_INDEX: { cat: Category; label: string; hint: string }[] = [
  { cat: 'general', label: 'Startup', hint: 'session restore workspaces tabs' },
  { cat: 'general', label: 'Browser settings', hint: 'native chrome settings' },
  { cat: 'appearance', label: 'Theme', hint: 'system light dark mode' },
  { cat: 'search', label: 'Default search engine', hint: 'google duckduckgo bing address' },
  { cat: 'privacy', label: 'Block ads & trackers', hint: 'ublock origin lite adblock filter' },
  { cat: 'privacy', label: 'Browsing history', hint: 'clear delete palette' },
  { cat: 'privacy', label: 'Bookmarks & folders', hint: 'clear delete' },
  { cat: 'profiles', label: 'Glint profiles', hint: 'isolated sessions accounts /profile' },
  { cat: 'profiles', label: 'Browser profiles', hint: 'people accounts native' },
  { cat: 'keyboard', label: 'Command palette', hint: 'shortcut cmd t hotkey' },
  { cat: 'keyboard', label: 'Switch workspace', hint: 'arrow keys next previous space' },
  { cat: 'keyboard', label: 'Settings shortcut', hint: 'cmd comma hotkey' },
  { cat: 'extensions', label: 'Chrome Web Store', hint: 'install addons' },
  { cat: 'extensions', label: 'Installed extensions', hint: 'remove manage developer' },
  { cat: 'about', label: 'Version', hint: 'chromium glint update' }
]

const set = (patch: Partial<AppSettings>): void => void window.browser.setSettings(patch)

const openTab = (url: string): void => void chrome.tabs.create({ url })

/** Fires a glint:// command that the fork intercepts natively (theme, search
 *  engine). The navigation is swallowed by the browser — the page stays. */
const applyNative = (path: string): void => {
  window.location.href = `glint://${path}`
}

export function Settings({ settings, onClose }: Props): JSX.Element {
  const [cat, setCat] = useState<Category>('general')
  const [query, setQuery] = useState('')

  useEffect(() => {
    const label = CATEGORIES.find((c) => c.id === cat)?.label ?? ''
    document.title = `Glint Settings: ${label}`
  }, [cat])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    return SEARCH_INDEX.filter(
      (r) => r.label.toLowerCase().includes(q) || r.hint.includes(q)
    )
  }, [query])

  return (
    <div className="vsettings">
      <nav className="vsettings-rail">
        <input
          className="vsettings-search"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="vsettings-cats">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              className={`vsettings-cat${cat === c.id && !hits ? ' active' : ''}`}
              onClick={() => {
                setQuery('')
                setCat(c.id)
              }}
            >
              <span className="vsettings-cat-icon" style={{ color: c.color }}>
                {c.icon}
              </span>
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="vsettings-content">
        {hits ? (
          <SearchResults
            hits={hits}
            onJump={(target) => {
              setQuery('')
              setCat(target)
            }}
          />
        ) : (
          <>
            {cat === 'general' && <GeneralPane />}
            {cat === 'appearance' && <AppearancePane settings={settings} />}
            {cat === 'search' && <SearchPane settings={settings} />}
            {cat === 'privacy' && <PrivacyPane settings={settings} />}
            {cat === 'profiles' && <ProfilesPane />}
            {cat === 'keyboard' && <KeyboardPane />}
            {cat === 'extensions' && <ExtensionsPane />}
            {cat === 'about' && <AboutPane />}
          </>
        )}
      </div>
    </div>
  )
}

function SearchResults({
  hits,
  onJump
}: {
  hits: { cat: Category; label: string; hint: string }[]
  onJump: (cat: Category) => void
}): JSX.Element {
  return (
    <VSection title="SEARCH RESULTS">
      {hits.length === 0 && <div className="row-desc">No settings match.</div>}
      {hits.map((h) => {
        const c = CATEGORIES.find((x) => x.id === h.cat)!
        return (
          <button
            key={`${h.cat}-${h.label}`}
            className="vsettings-hit"
            onClick={() => onJump(h.cat)}
          >
            <span className="vsettings-cat-icon" style={{ color: c.color }}>
              {c.icon}
            </span>
            <span className="row-label">{h.label}</span>
            <span className="row-desc">{c.label}</span>
          </button>
        )
      })}
    </VSection>
  )
}

/** ALL-CAPS section header with a rule, Vivaldi style. */
function VSection({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className="vsection">
      <h3 className="vsection-title">{title}</h3>
      {children}
    </section>
  )
}

/** Two-column grid of setting groups inside a section. */
function VGrid({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="vgrid">{children}</div>
}

function VGroup({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="vgroup">
      <div className="vgroup-label">{label}</div>
      {children}
    </div>
  )
}

function Check({
  checked,
  label,
  onChange
}: {
  checked: boolean
  label: string
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <label className="vcheck">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}): JSX.Element {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panes
// ---------------------------------------------------------------------------

function GeneralPane(): JSX.Element {
  return (
    <>
      <VSection title="STARTUP">
        <VGrid>
          <VGroup label="Startup with">
            <div className="row-desc">
              Glint restores your workspaces and tabs from the last session.
            </div>
          </VGroup>
          <VGroup label="Profile Management">
            <button
              className="settings-btn"
              onClick={() => openTab('chrome://settings/people')}
            >
              Manage Profiles
            </button>
          </VGroup>
        </VGrid>
      </VSection>
      <VSection title="BROWSER">
        <VGrid>
          <VGroup label="Native settings">
            <div className="row-desc">Everything not covered here lives in Chromium.</div>
            <button className="settings-btn" onClick={() => openTab('chrome://settings')}>
              Open browser settings
            </button>
          </VGroup>
          <VGroup label="Updates">
            <UpdatesRow />
          </VGroup>
        </VGrid>
      </VSection>
      <VSection title="BACKUP & RESTORE">
        <VGrid>
          <VGroup label="Your spaces & pins">
            <BackupRow />
          </VGroup>
        </VGrid>
      </VSection>
    </>
  )
}

function BackupRow(): JSX.Element {
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const doExport = async (): Promise<void> => {
    try {
      const json = await exportBackupJson()
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      const a = document.createElement('a')
      const stamp = new Date().toISOString().slice(0, 10)
      a.href = url
      a.download = `glint-backup-${stamp}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMsg({ kind: 'ok', text: 'Backup downloaded.' })
    } catch {
      setMsg({ kind: 'err', text: 'Could not export.' })
    }
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const b = await importBackupJson(await file.text())
      setMsg({ kind: 'ok', text: `Restored ${b.workspaces.length} spaces. Reopening…` })
      setTimeout(() => window.location.reload(), 900)
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Import failed.' })
    }
  }

  return (
    <>
      <div className="row-desc">
        Export your workspaces, pins and settings to a file, or restore them from
        one. Glint also keeps an automatic backup that survives a crash.
      </div>
      <div className="settings-btn-row">
        <button className="settings-btn" onClick={() => void doExport()}>
          Export backup…
        </button>
        <label className="settings-btn" style={{ cursor: 'pointer' }}>
          Import backup…
          <input
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => void onFile(e)}
          />
        </label>
      </div>
      {msg && (
        <div className={`row-desc${msg.kind === 'err' ? ' danger' : ''}`}>{msg.text}</div>
      )}
    </>
  )
}

function UpdatesRow(): JSX.Element {
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    void window.browser.getAppVersion().then(setVersion)
    return window.browser.onUpdateStatus(setStatus)
  }, [])

  // The native self-updater writes progress straight into the extension's
  // value store, which does NOT fire storage.onChanged — poll instead so
  // the download progress and the restart button actually appear.
  useEffect(() => {
    let live = true
    const read = async (): Promise<void> => {
      const { glintUpdateStatus } = await chrome.storage.local.get('glintUpdateStatus')
      if (!live || !glintUpdateStatus) return
      const s = glintUpdateStatus as { state: string; percent?: number; message?: string }
      if (s.state === 'downloading') {
        setStatus({ state: 'downloading', percent: s.percent ?? 0 })
      } else if (s.state === 'downloaded') {
        const { updateInfo } = await chrome.storage.local.get('updateInfo')
        setStatus({
          state: 'downloaded',
          version: (updateInfo as { version?: string } | null)?.version ?? ''
        })
      } else if (s.state === 'error') {
        setStatus({ state: 'error', message: s.message ?? 'Update failed' })
      }
    }
    void read()
    const id = setInterval(read, 1000)
    return () => {
      live = false
      clearInterval(id)
    }
  }, [])

  const check = async (): Promise<void> => {
    setStatus({ state: 'checking' })
    setStatus(await window.browser.checkForUpdates())
  }

  return (
    <>
      <div className="row-desc">
        Glint {version}
        {status?.state === 'available' && ` — version ${status.version} is available`}
        {status?.state === 'not-available' && ' — up to date'}
        {status?.state === 'checking' && ' — checking…'}
        {status?.state === 'downloading' && ` — downloading… ${status.percent}%`}
        {status?.state === 'downloaded' && ' — ready to install'}
        {status?.state === 'error' && ` — ${status.message}`}
      </div>
      {status?.state === 'downloaded' ? (
        <button className="settings-btn" onClick={() => applyNative('update-restart')}>
          Restart Glint to update
        </button>
      ) : status?.state === 'downloading' ? (
        <button className="settings-btn" disabled>
          Downloading… {status.percent}%
        </button>
      ) : status?.state === 'available' ? (
        <button className="settings-btn" onClick={() => void window.browser.installUpdate()}>
          Download Glint {status.version}
        </button>
      ) : (
        <button className="settings-btn" onClick={() => void check()}>
          Check for updates
        </button>
      )}
    </>
  )
}

function AppearancePane({ settings }: { settings: AppSettings }): JSX.Element {
  return (
    <>
      <VSection title="THEME">
        <VGrid>
          <VGroup label="Color scheme">
            <Segmented<ThemeSource>
              value={settings.theme}
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' }
              ]}
              onChange={(theme) => {
                set({ theme })
                applyNative(`set-theme/${theme}`)
              }}
            />
          </VGroup>
        </VGrid>
      </VSection>
    </>
  )
}

function SearchPane({ settings }: { settings: AppSettings }): JSX.Element {
  return (
    <VSection title="SEARCH ENGINE">
      <VGrid>
        <VGroup label="Default search engine">
          <div className="row-desc">Used when you type a query in the sidebar address bar.</div>
          <Segmented<SearchEngine>
            value={settings.searchEngine}
            options={[
              { value: 'google', label: 'Google' },
              { value: 'duckduckgo', label: 'DuckDuckGo' },
              { value: 'bing', label: 'Bing' }
            ]}
            onChange={(searchEngine) => {
              set({ searchEngine })
              applyNative(`set-search/${searchEngine}`)
            }}
          />
        </VGroup>
      </VGrid>
    </VSection>
  )
}

function PrivacyPane({ settings }: { settings: AppSettings }): JSX.Element {
  const [done, setDone] = useState<string | null>(null)
  const clear = (what: 'history' | 'bookmarks'): void => {
    if (what === 'history') window.browser.clearHistory()
    else window.browser.clearBookmarks()
    setDone(what)
    setTimeout(() => setDone(null), 1500)
  }
  return (
    <>
      <VSection title="TRACKING PROTECTION">
        <VGrid>
          <VGroup label="Block ads & trackers">
            <div className="row-desc">
              Glint ships with uBlock Origin Lite built in. Reload open pages after
              changing.
            </div>
            <Check
              checked={settings.adblockEnabled}
              label="Enable ad & tracker blocking"
              onChange={(v) => {
                set({ adblockEnabled: v })
                applyNative(`set-adblock/${v ? 'on' : 'off'}`)
              }}
            />
          </VGroup>
          <VGroup label="Blocker settings">
            <div className="row-desc">Filter lists, per-site rules and more.</div>
            <button className="settings-btn" onClick={() => applyNative('adblock-settings')}>
              Open adblock settings
            </button>
          </VGroup>
        </VGrid>
      </VSection>
      <VSection title="BROWSING DATA">
        <VGrid>
          <VGroup label="History">
            <div className="row-desc">Clear the history used by the command palette.</div>
            <button className="settings-btn danger" onClick={() => clear('history')}>
              {done === 'history' ? 'Cleared' : 'Clear history'}
            </button>
          </VGroup>
          <VGroup label="Bookmarks & folders">
            <div className="row-desc">Remove all saved Glint bookmarks and folders.</div>
            <button className="settings-btn danger" onClick={() => clear('bookmarks')}>
              {done === 'bookmarks' ? 'Cleared' : 'Clear bookmarks'}
            </button>
          </VGroup>
        </VGrid>
      </VSection>
    </>
  )
}

/** Deterministic color for a profile badge (same hash as the tab badge). */
function profileColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return `hsl(${h % 360}, 62%, 48%)`
}

function ProfilesPane(): JSX.Element {
  // The native side appends the current Glint profile list when it opens
  // this window (settings.html?glintProfiles=a,b,c).
  const [glintProfiles, setGlintProfiles] = useState<string[]>(() =>
    (new URLSearchParams(window.location.search).get('glintProfiles') ?? '')
      .split(',')
      .map((s) => decodeURIComponent(s))
      .filter(Boolean)
  )

  // Two-step confirm rather than window.confirm(): deleting a profile wipes
  // its logins for good, and JS dialogs are unreliable in Glint's chromeless
  // windows (they are silently suppressed in some contexts).
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const removeProfile = (name: string): void => {
    if (pendingDelete !== name) {
      setPendingDelete(name)
      return
    }
    applyNative(`delete-profile/${encodeURIComponent(name)}`)
    setGlintProfiles((list) => list.filter((n) => n !== name))
    setPendingDelete(null)
  }

  return (
    <>
      <VSection title="GLINT PROFILES">
        <VGrid>
          <VGroup label="Isolated sessions">
            <div className="row-desc">
              Open a page in a profile with <code>/profile Name url</code> in the command
              palette (⌘T). New names create a profile automatically; logins persist.
            </div>
          </VGroup>
        </VGrid>
        {glintProfiles.length === 0 ? (
          <div className="row-desc" style={{ marginTop: 10 }}>
            No Glint profiles yet.
          </div>
        ) : (
          glintProfiles.map((name) => (
            <div className="vext-row" key={name}>
              <span className="profile-dot" style={{ background: profileColor(name) }}>
                {name.slice(0, 4).toUpperCase()}
              </span>
              <span className="row-label">{name}</span>
              {pendingDelete === name ? (
                <>
                  <span className="row-desc" style={{ margin: '0 8px 0 auto' }}>
                    Delete “{name}” and its logins?
                  </span>
                  <button className="settings-btn" onClick={() => setPendingDelete(null)}>
                    Cancel
                  </button>
                  <button className="settings-btn danger" onClick={() => removeProfile(name)}>
                    Delete
                  </button>
                </>
              ) : (
                <button
                  className="settings-btn danger icon"
                  title={`Delete "${name}"`}
                  onClick={() => removeProfile(name)}
                >
                  <Trash size={14} />
                </button>
              )}
            </div>
          ))
        )}
      </VSection>
      <VSection title="BROWSER PROFILES">
        <VGrid>
          <VGroup label="Native profiles">
            <div className="row-desc">
              Full browser profiles: separate extensions, history and windows.
            </div>
            <button className="settings-btn" onClick={() => openTab('chrome://settings/people')}>
              Manage Profiles
            </button>
          </VGroup>
        </VGrid>
      </VSection>
    </>
  )
}

function KeyboardPane(): JSX.Element {
  const shortcuts: { keys: string; what: string }[] = [
    { keys: '⌘T', what: 'Command palette (search tabs, history, open URLs)' },
    { keys: '⌥⌘←/→', what: 'Previous / next workspace' },
    { keys: '⌘,', what: 'Glint settings' },
    { keys: '⌘W', what: 'Close tab' },
    { keys: '⌘N', what: 'New window' },
    { keys: '⌘F', what: 'Find in page' }
  ]
  return (
    <VSection title="SHORTCUTS">
      {shortcuts.map((s) => (
        <div className="vshortcut" key={s.keys}>
          <kbd>{s.keys}</kbd>
          <span>{s.what}</span>
        </div>
      ))}
    </VSection>
  )
}

function ExtensionsPane(): JSX.Element {
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([])

  const load = useCallback((): void => {
    chrome.management.getAll().then((list) => {
      setExtensions(
        list
          .filter((e) => e.type === 'extension' && e.id !== chrome.runtime.id)
          .map((e) => ({
            id: e.id,
            name: e.name,
            icon: e.icons?.at(-1)?.url ?? null,
            hasPopup: false
          }))
      )
    })
  }, [])

  useEffect(load, [load])

  const remove = (id: string): void => {
    void chrome.management
      .uninstall(id, { showConfirmDialog: true })
      .then(load)
      .catch(() => {}) // user cancelled
  }

  return (
    <>
      <VSection title="GET EXTENSIONS">
        <VGrid>
          <VGroup label="Chrome Web Store">
            <div className="row-desc">Every Chrome extension works natively in Glint.</div>
            <button
              className="settings-btn"
              onClick={() => openTab('https://chromewebstore.google.com')}
            >
              Open Web Store
            </button>
          </VGroup>
          <VGroup label="Advanced management">
            <div className="row-desc">Developer mode, unpacked extensions, site access.</div>
            <button className="settings-btn" onClick={() => openTab('chrome://extensions')}>
              Manage extensions
            </button>
          </VGroup>
        </VGrid>
      </VSection>
      <VSection title="INSTALLED">
        {extensions.length === 0 ? (
          <div className="row-desc">No extensions installed.</div>
        ) : (
          extensions.map((e) => (
            <div className="vext-row" key={e.id}>
              {e.icon ? (
                <img className="ext-list-icon" src={e.icon} alt="" width={22} height={22} />
              ) : (
                <span className="profile-dot">{e.name.charAt(0).toUpperCase()}</span>
              )}
              <span className="row-label">{e.name}</span>
              <button
                className="settings-btn danger icon"
                title={`Remove "${e.name}"`}
                onClick={() => remove(e.id)}
              >
                <Trash size={14} />
              </button>
            </div>
          ))
        )}
      </VSection>
    </>
  )
}

function AboutPane(): JSX.Element {
  const [version, setVersion] = useState<string>('')

  useEffect(() => {
    window.browser.getAppVersion().then(setVersion)
  }, [])

  const chromiumVersion = navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? ''

  return (
    <VSection title="ABOUT GLINT">
      <VGrid>
        <VGroup label="Glint Browser">
          <div className="row-desc">
            A fast, workspace-based browser built on Chromium
            {chromiumVersion && <> {chromiumVersion}</>}.
          </div>
        </VGroup>
        <VGroup label="Glint UI">
          <div className="row-desc">Version {version}.</div>
        </VGroup>
      </VGrid>
    </VSection>
  )
}
