import './adapter' // installs window.browser
import { StrictMode, useEffect, useState, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import type { AppSettings } from './types'
import { Settings } from './components/Settings'
import './styles.css'

/** Full-page Vivaldi-style settings: the Settings card floats on the gray
 *  ground, exactly like the Electron overlay but as its own tab. */
function SettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    window.browser.getSettings().then(setSettings)
    return window.browser.onSettingsChanged(setSettings)
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
    <SettingsPage />
  </StrictMode>
)
