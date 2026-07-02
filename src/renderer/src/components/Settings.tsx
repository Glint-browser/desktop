import { useEffect, useState, type JSX } from 'react'
import {
  Gear,
  IdentificationBadge,
  Info,
  MagnifyingGlass,
  Palette,
  PuzzlePiece,
  ShieldCheck,
  Trash,
  X
} from '@phosphor-icons/react'
import type { AppSettings, ExtensionInfo, SearchEngine, ThemeSource } from '../../../shared/types'

interface Props {
  settings: AppSettings
  profiles: string[]
  extensions: ExtensionInfo[]
  onClose: () => void
}

type Category =
  | 'general'
  | 'appearance'
  | 'search'
  | 'privacy'
  | 'profiles'
  | 'extensions'
  | 'about'

const CATEGORIES: { id: Category; label: string; icon: JSX.Element }[] = [
  { id: 'general', label: 'General', icon: <Gear size={18} /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={18} /> },
  { id: 'search', label: 'Search', icon: <MagnifyingGlass size={18} /> },
  { id: 'privacy', label: 'Privacy', icon: <ShieldCheck size={18} /> },
  { id: 'profiles', label: 'Profiles', icon: <IdentificationBadge size={18} /> },
  { id: 'extensions', label: 'Extensions', icon: <PuzzlePiece size={18} /> },
  { id: 'about', label: 'About', icon: <Info size={18} /> }
]

const set = (patch: Partial<AppSettings>): void => void window.browser.setSettings(patch)

export function Settings({ settings, profiles, extensions, onClose }: Props): JSX.Element {
  const [cat, setCat] = useState<Category>('general')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="settings-backdrop" onMouseDown={onClose}>
      <div className="settings" onMouseDown={(e) => e.stopPropagation()}>
        <nav className="settings-rail">
          <div className="settings-title">Settings</div>
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              className={`settings-cat${cat === c.id ? ' active' : ''}`}
              onClick={() => setCat(c.id)}
            >
              {c.icon}
              <span>{c.label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-content">
          <button className="settings-close" title="Close" onClick={onClose}>
            <X size={16} weight="bold" />
          </button>
          {cat === 'general' && <GeneralPane />}
          {cat === 'appearance' && <AppearancePane settings={settings} />}
          {cat === 'search' && <SearchPane settings={settings} />}
          {cat === 'privacy' && <PrivacyPane settings={settings} />}
          {cat === 'profiles' && <ProfilesPane profiles={profiles} />}
          {cat === 'extensions' && <ExtensionsPane extensions={extensions} />}
          {cat === 'about' && <AboutPane />}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

/** An on/off toggle switch. */
function Toggle({
  value,
  onChange
}: {
  value: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <button
      className={`toggle${value ? ' on' : ''}`}
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
    >
      <span className="toggle-knob" />
    </button>
  )
}

/** A segmented single-choice control. */
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

function GeneralPane(): JSX.Element {
  return (
    <Section title="General">
      <div className="settings-row">
        <div>
          <div className="row-label">Startup</div>
          <div className="row-desc">Glint restores your workspaces and tabs from the last session.</div>
        </div>
      </div>
    </Section>
  )
}

function AppearancePane({ settings }: { settings: AppSettings }): JSX.Element {
  return (
    <Section title="Appearance">
      <div className="settings-row">
        <div>
          <div className="row-label">Theme</div>
          <div className="row-desc">Follow the system or force light/dark chrome.</div>
        </div>
        <Segmented<ThemeSource>
          value={settings.theme}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' }
          ]}
          onChange={(theme) => set({ theme })}
        />
      </div>
      <div className="settings-row">
        <div>
          <div className="row-label">Sidebar transparency</div>
          <div className="row-desc">How much your wallpaper shows through the chrome.</div>
        </div>
        <div className="slider">
          <span className="slider-end">Clear</span>
          <input
            type="range"
            min={0}
            max={0.5}
            step={0.02}
            value={settings.sidebarOpacity}
            onChange={(e) => set({ sidebarOpacity: parseFloat(e.target.value) })}
          />
          <span className="slider-end">Solid</span>
        </div>
      </div>
    </Section>
  )
}

function SearchPane({ settings }: { settings: AppSettings }): JSX.Element {
  return (
    <Section title="Search">
      <div className="settings-row">
        <div>
          <div className="row-label">Default search engine</div>
          <div className="row-desc">Used when you type a query in the address bar.</div>
        </div>
        <Segmented<SearchEngine>
          value={settings.searchEngine}
          options={[
            { value: 'google', label: 'Google' },
            { value: 'duckduckgo', label: 'DuckDuckGo' },
            { value: 'bing', label: 'Bing' }
          ]}
          onChange={(searchEngine) => set({ searchEngine })}
        />
      </div>
    </Section>
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
    <Section title="Privacy">
      <div className="settings-row">
        <div>
          <div className="row-label">Block ads &amp; trackers</div>
          <div className="row-desc">
            uBlock-style blocking (EasyList &amp; uBO filters). Reload pages after changing.
          </div>
        </div>
        <Toggle value={settings.adblockEnabled} onChange={(v) => set({ adblockEnabled: v })} />
      </div>
      <div className="settings-row">
        <div>
          <div className="row-label">Randomize fingerprint</div>
          <div className="row-desc">
            Spoof the user agent, canvas, WebGL and navigator values to resist tracking. May
            break some sites; reload after changing.
          </div>
        </div>
        <Toggle
          value={settings.fingerprintEnabled}
          onChange={(v) => set({ fingerprintEnabled: v })}
        />
      </div>
      <div className="settings-row">
        <div>
          <div className="row-label">Browsing history</div>
          <div className="row-desc">Clear the history used by the command palette.</div>
        </div>
        <button className="settings-btn danger" onClick={() => clear('history')}>
          {done === 'history' ? 'Cleared' : 'Clear history'}
        </button>
      </div>
      <div className="settings-row">
        <div>
          <div className="row-label">Bookmarks & folders</div>
          <div className="row-desc">Remove all saved bookmarks and folders.</div>
        </div>
        <button className="settings-btn danger" onClick={() => clear('bookmarks')}>
          {done === 'bookmarks' ? 'Cleared' : 'Clear bookmarks'}
        </button>
      </div>
    </Section>
  )
}

function ProfilesPane({ profiles }: { profiles: string[] }): JSX.Element {
  const [name, setName] = useState('')
  const create = (): void => {
    const n = name.trim()
    if (n) {
      window.browser.createProfile(n)
      setName('')
    }
  }
  return (
    <Section title="Profiles">
      <div className="settings-row">
        <div>
          <div className="row-label">New profile</div>
          <div className="row-desc">
            An isolated session (separate cookies/logins). Open a URL in one with{' '}
            <code>/profile Name &lt;url&gt;</code> in the command palette.
          </div>
        </div>
        <div className="profile-create">
          <input
            className="profile-input"
            value={name}
            placeholder="Profile name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          <button className="settings-btn" onClick={create}>
            Create
          </button>
        </div>
      </div>

      {profiles.length === 0 ? (
        <div className="settings-row">
          <div className="row-desc">No profiles yet.</div>
        </div>
      ) : (
        profiles.map((p) => (
          <div className="settings-row" key={p}>
            <div className="profile-item">
              <span className="profile-dot" style={{ background: profileColor(p) }}>
                {p.slice(0, 4).toUpperCase()}
              </span>
              <span className="row-label">{p}</span>
            </div>
            <button
              className="settings-btn danger icon"
              title={`Delete "${p}" and clear its data`}
              onClick={() => window.browser.deleteProfile(p)}
            >
              <Trash size={14} />
            </button>
          </div>
        ))
      )}
    </Section>
  )
}

/** Deterministic color for a profile badge (matches the tab badge). */
function profileColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return `hsl(${h % 360}, 62%, 48%)`
}

function ExtensionsPane({ extensions }: { extensions: ExtensionInfo[] }): JSX.Element {
  const [storeUrl, setStoreUrl] = useState('')
  const [status, setStatus] = useState<{ kind: 'busy' | 'error' | 'ok'; text: string } | null>(
    null
  )
  const install = async (): Promise<void> => {
    const url = storeUrl.trim()
    if (!url || status?.kind === 'busy') return
    setStatus({ kind: 'busy', text: 'Installing…' })
    const err = await window.browser.installExtensionFromStore(url)
    if (err) setStatus({ kind: 'error', text: err })
    else {
      setStatus({ kind: 'ok', text: 'Installed.' })
      setStoreUrl('')
      setTimeout(() => setStatus(null), 2000)
    }
  }
  return (
    <Section title="Extensions">
      <div className="settings-row">
        <div>
          <div className="row-label">Install from Chrome Web Store</div>
          <div className="row-desc">
            Paste an extension&#39;s Web Store link — Glint downloads and installs it. Note:
            some extensions need Chrome APIs Electron doesn&#39;t support (e.g. uBlock Origin;
            Glint&#39;s built-in blocker replaces it).
          </div>
        </div>
        <div className="profile-create">
          <input
            className="profile-input"
            value={storeUrl}
            placeholder="chromewebstore.google.com/…"
            onChange={(e) => setStoreUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && install()}
          />
          <button className="settings-btn" onClick={install} disabled={status?.kind === 'busy'}>
            {status?.kind === 'busy' ? 'Installing…' : 'Install'}
          </button>
        </div>
      </div>
      {status && status.kind !== 'busy' && (
        <div className="settings-row">
          <div className={`row-desc${status.kind === 'error' ? ' error-text' : ''}`}>
            {status.text}
          </div>
        </div>
      )}
      <div className="settings-row">
        <div>
          <div className="row-label">Load an unpacked extension</div>
          <div className="row-desc">
            Add a local extension folder or a <code>.crx</code> file from disk.
          </div>
        </div>
        <button className="settings-btn" onClick={() => window.browser.addExtension()}>
          Add extension…
        </button>
      </div>

      {extensions.length === 0 ? (
        <div className="settings-row">
          <div className="row-desc">No extensions installed.</div>
        </div>
      ) : (
        extensions.map((e) => (
          <div className="settings-row" key={e.id}>
            <div className="profile-item">
              {e.icon ? (
                <img className="ext-list-icon" src={e.icon} alt="" width={24} height={24} />
              ) : (
                <span className="profile-dot">{e.name.charAt(0).toUpperCase()}</span>
              )}
              <span className="row-label">{e.name}</span>
            </div>
            <button
              className="settings-btn danger icon"
              title={`Remove "${e.name}"`}
              onClick={() => window.browser.removeExtension(e.id)}
            >
              <Trash size={14} />
            </button>
          </div>
        ))
      )}
    </Section>
  )
}

function AboutPane(): JSX.Element {
  return (
    <Section title="About">
      <div className="settings-row">
        <div>
          <div className="row-label">Glint Browser</div>
          <div className="row-desc">A fast, workspace-based browser built on Electron + Chromium.</div>
        </div>
      </div>
    </Section>
  )
}
