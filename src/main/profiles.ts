import { loadJson, saveJson } from './store'

const FILE = 'profiles.json'

/** Persisted list of named profiles (isolated sessions). */
export class ProfileStore {
  private names: string[] = loadJson<string[]>(FILE, [])

  list(): string[] {
    return this.names
  }

  add(name: string): void {
    const n = name.trim()
    if (n && !this.names.includes(n)) {
      this.names.push(n)
      saveJson(FILE, this.names)
    }
  }

  remove(name: string): void {
    this.names = this.names.filter((p) => p !== name)
    saveJson(FILE, this.names)
  }
}
