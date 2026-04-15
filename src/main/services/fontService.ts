import { app, dialog } from 'electron'
import { join } from 'path'
import { readFile, writeFile, mkdir, copyFile, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { basename, extname } from 'path'

export interface FontEntry {
  id: string
  name: string
  fileName: string
  style: string
}

function getFontsDir(): string {
  return join(app.getPath('userData'), 'fonts')
}

function getManifestPath(): string {
  return join(getFontsDir(), 'fonts.json')
}

async function ensureFontsDir(): Promise<void> {
  const dir = getFontsDir()
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
}

async function readManifest(): Promise<FontEntry[]> {
  const p = getManifestPath()
  if (!existsSync(p)) return []
  try {
    const raw = await readFile(p, 'utf-8')
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

async function writeManifest(entries: FontEntry[]): Promise<void> {
  await ensureFontsDir()
  await writeFile(getManifestPath(), JSON.stringify(entries, null, 2), 'utf-8')
}

export async function getInstalledFonts(): Promise<FontEntry[]> {
  return readManifest()
}

export async function importFont(): Promise<FontEntry | null> {
  const result = await dialog.showOpenDialog({
    title: 'Import Font',
    filters: [
      { name: 'Font Files', extensions: ['ttf', 'otf', 'woff'] }
    ],
    properties: ['openFile']
  })

  if (result.canceled || result.filePaths.length === 0) return null

  const srcPath = result.filePaths[0]
  const originalName = basename(srcPath)
  const ext = extname(originalName)
  const fontName = basename(originalName, ext)

  await ensureFontsDir()

  const id = randomUUID()
  const destFileName = `${id}${ext}`
  const destPath = join(getFontsDir(), destFileName)

  await copyFile(srcPath, destPath)

  // Determine style from filename hints
  const lower = fontName.toLowerCase()
  let style = 'regular'
  if (lower.includes('bolditalic') || lower.includes('bold-italic')) {
    style = 'bold-italic'
  } else if (lower.includes('bold')) {
    style = 'bold'
  } else if (lower.includes('italic') || lower.includes('oblique')) {
    style = 'italic'
  }

  const entry: FontEntry = { id, name: fontName, fileName: destFileName, style }

  const manifest = await readManifest()
  manifest.push(entry)
  await writeManifest(manifest)

  return entry
}

export async function getFontBytes(fontId: string): Promise<Uint8Array> {
  const manifest = await readManifest()
  const entry = manifest.find((e) => e.id === fontId)
  if (!entry) throw new Error(`Font not found: ${fontId}`)

  const filePath = join(getFontsDir(), entry.fileName)
  const buffer = await readFile(filePath)
  return new Uint8Array(buffer)
}

export async function removeFont(fontId: string): Promise<void> {
  const manifest = await readManifest()
  const entry = manifest.find((e) => e.id === fontId)
  if (!entry) return

  const filePath = join(getFontsDir(), entry.fileName)
  if (existsSync(filePath)) {
    await unlink(filePath)
  }

  const filtered = manifest.filter((e) => e.id !== fontId)
  await writeManifest(filtered)
}
