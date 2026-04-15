import { app } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'

export interface RecentFileEntry {
  path: string
  name: string
  format: string
  lastOpened: number
}

const MAX_RECENT = 20

function getRecentFilesPath(): string {
  return join(app.getPath('userData'), 'recent-files.json')
}

async function readStore(): Promise<RecentFileEntry[]> {
  const filePath = getRecentFilesPath()
  if (!existsSync(filePath)) return []
  try {
    const raw = await readFile(filePath, 'utf-8')
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

async function writeStore(entries: RecentFileEntry[]): Promise<void> {
  const filePath = getRecentFilesPath()
  await writeFile(filePath, JSON.stringify(entries, null, 2), 'utf-8')
}

export async function getRecentFiles(): Promise<RecentFileEntry[]> {
  return readStore()
}

export async function addRecentFile(path: string, name: string, format: string): Promise<void> {
  const entries = await readStore()
  // Remove existing entry for same path
  const filtered = entries.filter((e) => e.path !== path)
  // Add to front
  filtered.unshift({ path, name, format, lastOpened: Date.now() })
  // Trim to max
  await writeStore(filtered.slice(0, MAX_RECENT))
}

export async function removeRecentFile(path: string): Promise<void> {
  const entries = await readStore()
  await writeStore(entries.filter((e) => e.path !== path))
}

export async function clearRecentFiles(): Promise<void> {
  await writeStore([])
}
