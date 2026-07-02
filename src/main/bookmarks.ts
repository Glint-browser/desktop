import { randomUUID } from 'crypto'
import type { Bookmark, BookmarkFolder } from '../shared/types'
import { loadJson, saveJson } from './store'

const FILE = 'bookmarks.json'

interface Persisted {
  bookmarks: Bookmark[]
  folders: BookmarkFolder[]
}

/** Persisted pinned bookmarks + folders (the sidebar workspace bookmarks). */
export class BookmarkStore {
  private bookmarks: Bookmark[]
  private folders: BookmarkFolder[]

  constructor() {
    const raw = loadJson<Persisted | Bookmark[]>(FILE, { bookmarks: [], folders: [] })
    // Migrate the old flat-array format.
    const data: Persisted = Array.isArray(raw) ? { bookmarks: raw, folders: [] } : raw
    this.bookmarks = (data.bookmarks ?? []).map((b) => ({ ...b, folderId: b.folderId ?? null }))
    this.folders = data.folders ?? []
  }

  list(): Bookmark[] {
    return this.bookmarks
  }

  listFolders(): BookmarkFolder[] {
    return this.folders
  }

  has(url: string): boolean {
    return this.bookmarks.some((b) => b.url === url)
  }

  add(url: string, title: string, favicon: string | null, folderId: string | null = null): void {
    if (!url || this.has(url)) return
    const fid = folderId && this.folders.some((f) => f.id === folderId) ? folderId : null
    this.bookmarks.push({ id: randomUUID(), url, title: title || url, favicon, folderId: fid })
    this.persist()
  }

  removeById(id: string): void {
    this.bookmarks = this.bookmarks.filter((b) => b.id !== id)
    this.persist()
  }

  removeByUrl(url: string): void {
    this.bookmarks = this.bookmarks.filter((b) => b.url !== url)
    this.persist()
  }

  /** Move a bookmark into a folder (or to the root when folderId is null). */
  move(id: string, folderId: string | null): void {
    const b = this.bookmarks.find((x) => x.id === id)
    if (!b) return
    b.folderId = folderId && this.folders.some((f) => f.id === folderId) ? folderId : null
    this.persist()
  }

  addFolder(name: string | undefined, spaceId: string): void {
    if (!spaceId) return
    this.folders.push({ id: randomUUID(), name: name?.trim() || 'New Folder', spaceId })
    this.persist()
  }

  renameFolder(id: string, name: string): void {
    const folder = this.folders.find((f) => f.id === id)
    if (!folder || !name.trim()) return
    folder.name = name.trim()
    this.persist()
  }

  /** Delete a folder; its bookmarks fall back to the root. */
  removeFolder(id: string): void {
    this.folders = this.folders.filter((f) => f.id !== id)
    for (const b of this.bookmarks) if (b.folderId === id) b.folderId = null
    this.persist()
  }

  clear(): void {
    this.bookmarks = []
    this.folders = []
    this.persist()
  }

  private persist(): void {
    saveJson(FILE, { bookmarks: this.bookmarks, folders: this.folders } satisfies Persisted)
  }
}
