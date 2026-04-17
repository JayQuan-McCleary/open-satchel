// Archive format handler: ZIP, TAR, TAR.GZ, 7Z, RAR, GZ, BZ2
// Browse entries, view file contents without extracting.

import type { FormatHandler } from '../types'
import ArchiveViewer from './ArchiveViewer'
import { useFormatStore } from '../../stores/formatStore'

export interface ArchiveEntry {
  name: string
  path: string
  size: number
  compressedSize: number
  isDirectory: boolean
  date?: Date
  bytes?: Uint8Array
}

export interface ArchiveFormatState {
  bytes: Uint8Array
  filename: string
  archiveType: 'zip' | 'tar' | 'gz' | '7z' | 'rar' | 'bz2' | 'unknown'
  entries: ArchiveEntry[]
  error?: string
}

function detectArchiveType(filename: string): ArchiveFormatState['archiveType'] {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.zip')) return 'zip'
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar'
  if (lower.endsWith('.tar')) return 'tar'
  if (lower.endsWith('.gz')) return 'gz'
  if (lower.endsWith('.7z')) return '7z'
  if (lower.endsWith('.rar')) return 'rar'
  if (lower.endsWith('.bz2')) return 'bz2'
  return 'unknown'
}

async function parseArchive(bytes: Uint8Array, type: ArchiveFormatState['archiveType']): Promise<ArchiveEntry[]> {
  if (type === 'zip') {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(bytes)
    const entries: ArchiveEntry[] = []
    for (const [path, file] of Object.entries(zip.files)) {
      const f = file as any
      entries.push({
        name: path.split('/').pop() || path,
        path,
        size: f._data?.uncompressedSize ?? 0,
        compressedSize: f._data?.compressedSize ?? 0,
        isDirectory: f.dir,
        date: f.date,
      })
    }
    return entries
  }

  if (type === 'tar') {
    const tarStream = await import('tar-stream')
    const entries: ArchiveEntry[] = []
    return new Promise((resolve, reject) => {
      try {
        const extract = tarStream.extract()
        extract.on('entry', (header: any, stream: any, next: any) => {
          entries.push({
            name: header.name.split('/').pop() || header.name,
            path: header.name,
            size: header.size,
            compressedSize: header.size,
            isDirectory: header.type === 'directory',
            date: header.mtime,
          })
          stream.on('end', next)
          stream.resume()
        })
        extract.on('finish', () => resolve(entries))
        extract.on('error', reject)
        extract.end(Buffer.from(bytes))
      } catch (err) { reject(err) }
    })
  }

  // 7Z, RAR, GZ, BZ2 — show metadata only (full extraction requires native modules)
  return [{
    name: `[${type.toUpperCase()} archive]`,
    path: '',
    size: bytes.byteLength,
    compressedSize: bytes.byteLength,
    isDirectory: false,
  }]
}

export const archiveHandler: FormatHandler = {
  format: 'archive',
  extensions: ['zip', 'tar', 'tgz', 'gz', '7z', 'rar', 'bz2'],
  displayName: 'Archive',
  icon: '🗜',
  Viewer: ArchiveViewer,

  load: async (tabId, bytes, filePath) => {
    const filename = filePath.split(/[/\\]/).pop() || 'archive'
    const archiveType = detectArchiveType(filename)
    let entries: ArchiveEntry[] = []
    let error: string | undefined
    try {
      entries = await parseArchive(bytes, archiveType)
    } catch (err) { error = (err as Error).message }

    const state: ArchiveFormatState = { bytes, filename, archiveType, entries, error }
    useFormatStore.getState().setFormatState(tabId, state)
  },

  save: async (tabId) => {
    const state = useFormatStore.getState().getFormatState<ArchiveFormatState>(tabId)
    if (!state) throw new Error('No archive state')
    return state.bytes // Archives are read-only
  },

  cleanup: (tabId) => useFormatStore.getState().clearFormatState(tabId),
  canConvertTo: [],
  capabilities: { edit: false, annotate: false, search: true, zoom: false }
}
