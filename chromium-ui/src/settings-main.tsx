import './adapter' // installs window.browser
import { StrictMode, useEffect, useState, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import type { AppSettings } from './types'
import { Settings } from './components/Settings'
import { ErrorBoundary } from './components/ErrorBoundary'
import { applyThemeAttribute } from './workspaces'
import './styles.css'

/** Full-page Vivaldi-style settings: the Settings card floats on the gray
 *  ground, exactly like the Electron overlay but as its own tab. */
function SettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    const apply = (s: AppSettings): void => {
      setSettings(s)
      applyThemeAttribute(s.theme)
    }
    window.browser.getSettings().then(apply)
    return window.browser.onSettingsChanged(apply)
  }, [])

  const close = (): void => {
    chrome.tabs.getCurrent().then((tab) => {
      if (tab?.id !== undefined) chrome.tabs.remove(tab.id)
    })
  }

  if (!settings) return <></>
  return <Settings settings={settings} onClose={close} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary surface="settings">
      <SettingsPage />
    </ErrorBoundary>
  </StrictMode>
)
