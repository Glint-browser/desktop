import type { AppSettings } from '../shared/types'
import { loadJson, saveJson } from './store'

const FILE = 'settings.json'

const DEFAULTS: AppSettings = {
  theme: 'light',
  searchEngine: 'google',
  sidebarOpacity: 0.06,
  adblockEnabled: true,
  fingerprintEnabled: false
}

/** Persisted app settings (theme, search engine, chrome opacity). */
export class SettingsStore {
  private settings: AppSettings

  constructor() {
    this.settings = { ...DEFAULTS, ...loadJson<Partial<AppSettings>>(FILE, {}) }
  }

  get(): AppSettings {
    return this.settings
  }

  set(patch: Partial<AppSettings>): AppSettings {
    this.settings = { ...this.settings, ...patch }
    saveJson(FILE, this.settings)
    return this.settings
  }
}
