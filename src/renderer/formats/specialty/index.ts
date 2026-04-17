// Specialty format handlers: SVG, TIFF, HEIC, SQLite, Jupyter, Cert, Subtitle, Font, DjVu, MOBI.
// Each has a simple viewer appropriate to the format.

import type { FormatHandler } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import SvgViewer from './SvgViewer'
import TiffViewer from './TiffViewer'
import HeicViewer from './HeicViewer'
import SqliteViewer from './SqliteViewer'
import JupyterViewer from './JupyterViewer'
import CertViewer from './CertViewer'
import SubtitleEditor from './SubtitleEditor'
import FontViewer from './FontViewer'
import DjvuViewer from './DjvuViewer'
import MobiViewer from './MobiViewer'

// ── SVG ───────────────────────────────────────────────────────────
export interface SvgState { svg: string; originalSvg: string }
export const svgHandler: FormatHandler = {
  format: 'svg', extensions: ['svg'], displayName: 'SVG', icon: '🎨',
  Viewer: SvgViewer,
  load: async (tabId, bytes) => {
    const svg = new TextDecoder().decode(bytes)
    useFormatStore.getState().setFormatState(tabId, { svg, originalSvg: svg })
  },
  save: async (tabId) => {
    const s = useFormatStore.getState().getFormatState<SvgState>(tabId)
    if (!s) throw new Error('No state')
    return new TextEncoder().encode(s.svg)
  },
  cleanup: (tabId) => useFormatStore.getState().clearFormatState(tabId),
  canConvertTo: ['pdf'],
  capabilities: { edit: true, annotate: false, search: true, zoom: true }
}

// ── TIFF ──────────────────────────────────────────────────────────
export interface TiffState { bytes: Uint8Array; pages: ImageData[]; activePage: number }
export const tiffHandler: FormatHandler = {
  format: 'tiff', extensions: ['tiff', 'tif'], displayName: 'TIFF', icon: '🖼',
  Viewer: TiffViewer,
  load: async (tabId, bytes) => {
    const UTIF = await import('utif2')
    const ifds = UTIF.decode(bytes)
    const pages: ImageData[] = []
    for (const ifd of ifds) {
      UTIF.decodeImage(bytes, ifd)
      const rgba = UTIF.toRGBA8(ifd)
      pages.push(new ImageData(new Uint8ClampedArray(rgba), ifd.width, ifd.height))
    }
    useFormatStore.getState().setFormatState(tabId, { bytes, pages, activePage: 0 })
  },
  save: async (tabId) => {
    const s = useFormatStore.getState().getFormatState<TiffState>(tabId)
    if (!s) throw new Error('No state')
    return s.bytes
  },
  cleanup: (tabId) => useFormatStore.getState().clearFormatState(tabId),
  canConvertTo: ['pdf', 'image'],
  capabilities: { edit: false, annotate: false, search: false, zoom: true }
}

// ── HEIC ──────────────────────────────────────────────────────────
export interface HeicState { blob: Blob; dataUrl: string; originalBytes: Uint8Array }
export const heicHandler: FormatHandler = {
  format: 'heic', extensions: ['heic', 'heif'], displayName: 'HEIC', icon: '🖼',
  Viewer: HeicViewer,
  load: async (tabId, bytes) => {
    try {
      const heic2any = (await import('heic2any')).default
      const blob = await heic2any({
        blob: new Blob([bytes], { type: 'image/heic' }),
        toType: 'image/jpeg', quality: 0.9,
      }) as Blob
      const dataUrl = await blobToDataUrl(blob)
      useFormatStore.getState().setFormatState(tabId, { blob, dataUrl, originalBytes: bytes })
    } catch (err) {
      useFormatStore.getState().setFormatState(tabId, { blob: new Blob(), dataUrl: '', originalBytes: bytes })
    }
  },
  save: async (tabId) => {
    const s = useFormatStore.getState().getFormatState<HeicState>(tabId)
    if (!s) throw new Error('No state')
    return s.originalBytes
  },
  cleanup: (tabId) => useFormatStore.getState().clearFormatState(tabId),
  canConvertTo: ['image', 'pdf'],
  capabilities: { edit: false, annotate: false, search: false, zoom: true }
}

// ── SQLite ────────────────────────────────────────────────────────
export interface SqliteState {
  bytes: Uint8Array
  tables: { name: string; sql: string; rowCount: number }[]
  activeTable: string | null
  queryResult: { columns: string[]; rows: any[][] } | null
  error?: string
}
export const sqliteHandler: FormatHandler = {
  format: 'sqlite', extensions: ['sqlite', 'db', 'sqlite3'], displayName: 'SQLite DB', icon: '🗃',
  Viewer: SqliteViewer,
  load: async (tabId, bytes) => {
    try {
      const initSqlJs = (await import('sql.js')).default
      const SQL = await initSqlJs({ locateFile: (f: string) => `/${f}` })
      const db = new SQL.Database(bytes)
      const tables = db.exec("SELECT name, sql FROM sqlite_master WHERE type='table'")
      const list: { name: string; sql: string; rowCount: number }[] = []
      if (tables[0]) {
        for (const row of tables[0].values) {
          const name = String(row[0])
          const sql = String(row[1] || '')
          const countRes = db.exec(`SELECT COUNT(*) FROM "${name}"`)
          const rowCount = countRes[0] ? Number(countRes[0].values[0][0]) : 0
          list.push({ name, sql, rowCount })
        }
      }
      db.close()
      useFormatStore.getState().setFormatState(tabId, {
        bytes, tables: list, activeTable: list[0]?.name ?? null, queryResult: null
      })
    } catch (err) {
      useFormatStore.getState().setFormatState(tabId, {
        bytes, tables: [], activeTable: null, queryResult: null, error: (err as Error).message
      })
    }
  },
  save: async (tabId) => {
    const s = useFormatStore.getState().getFormatState<SqliteState>(tabId)
    if (!s) throw new Error('No state')
    return s.bytes
  },
  cleanup: (tabId) => useFormatStore.getState().clearFormatState(tabId),
  canConvertTo: [],
  capabilities: { edit: false, annotate: false, search: true, zoom: false }
}

// ── Jupyter ───────────────────────────────────────────────────────
export interface JupyterCell {
  type: 'code' | 'markdown' | 'raw'
  source: string
  outputs?: any[]
  executionCount?: number | null
}
export interface JupyterState {
  cells: JupyterCell[]
  metadata: any
  bytes: Uint8Array
}
export const jupyterHandler: FormatHandler = {
  format: 'jupyter', extensions: ['ipynb'], displayName: 'Jupyter', icon: '📓',
  Viewer: JupyterViewer,
  load: async (tabId, bytes) => {
    const text = new TextDecoder().decode(bytes)
    try {
      const nb = JSON.parse(text)
      const cells: JupyterCell[] = (nb.cells || []).map((c: any) => ({
        type: c.cell_type,
        source: Array.isArray(c.source) ? c.source.join('') : (c.source || ''),
        outputs: c.outputs,
        executionCount: c.execution_count,
      }))
      useFormatStore.getState().setFormatState(tabId, { cells, metadata: nb.metadata, bytes })
    } catch {
      useFormatStore.getState().setFormatState(tabId, { cells: [], metadata: {}, bytes })
    }
  },
  save: async (tabId) => {
    const s = useFormatStore.getState().getFormatState<JupyterState>(tabId)
    if (!s) throw new Error('No state')
    return s.bytes
  },
  cleanup: (tabId) => useFormatStore.getState().clearFormatState(tabId),
  canConvertTo: ['pdf', 'html'],
  capabilities: { edit: false, annotate: false, search: true, zoom: false }
}

// ── Certificate ───────────────────────────────────────────────────
export interface CertInfo {
  subject?: string
  issuer?: string
  notBefore?: string
  notAfter?: string
  serialNumber?: string
  publicKeyType?: string
  signatureAlgorithm?: string
  raw: string
  fingerprintSha256?: string
}
export interface CertState { info: CertInfo | null; raw: Uint8Array; error?: string }
export const certHandler: FormatHandler = {
  format: 'cert', extensions: ['pem', 'crt', 'cer', 'key', 'p12', 'pfx', 'asc'], displayName: 'Certificate', icon: '🔐',
  Viewer: CertViewer,
  load: async (tabId, bytes, filePath) => {
    try {
      const forge = await import('node-forge')
      const raw = new TextDecoder().decode(bytes)
      const ext = filePath.toLowerCase().split('.').pop() || ''
      let info: CertInfo | null = null

      if (ext === 'p12' || ext === 'pfx') {
        info = { raw: '[P12/PFX - password required to read]', subject: '(encrypted)' }
      } else if (raw.includes('BEGIN CERTIFICATE')) {
        const cert = forge.pki.certificateFromPem(raw)
        info = {
          subject: cert.subject.attributes.map(a => `${a.shortName}=${a.value}`).join(', '),
          issuer: cert.issuer.attributes.map(a => `${a.shortName}=${a.value}`).join(', '),
          notBefore: cert.validity.notBefore.toISOString(),
          notAfter: cert.validity.notAfter.toISOString(),
          serialNumber: cert.serialNumber,
          publicKeyType: (cert.publicKey as any).n ? 'RSA' : 'Unknown',
          signatureAlgorithm: cert.signatureOid,
          raw,
        }
      } else if (raw.includes('BEGIN RSA PRIVATE KEY') || raw.includes('BEGIN PRIVATE KEY')) {
        info = { raw, subject: '(RSA Private Key)' }
      } else if (raw.includes('BEGIN PGP')) {
        info = { raw, subject: '(PGP Block)' }
      } else {
        info = { raw, subject: '(Unknown format)' }
      }
      useFormatStore.getState().setFormatState(tabId, { info, raw: bytes })
    } catch (err) {
      useFormatStore.getState().setFormatState(tabId, {
        info: null, raw: bytes, error: (err as Error).message,
      })
    }
  },
  save: async (tabId) => {
    const s = useFormatStore.getState().getFormatState<CertState>(tabId)
    if (!s) throw new Error('No state')
    return s.raw
  },
  cleanup: (tabId) => useFormatStore.getState().clearFormatState(tabId),
  canConvertTo: [],
  capabilities: { edit: false, annotate: false, search: true, zoom: false }
}

// ── Subtitles (SRT, VTT, ASS) ─────────────────────────────────────
export interface SubtitleEntry { index: number; start: number; end: number; text: string }
export interface SubtitleState {
  entries: SubtitleEntry[]
  format: 'srt' | 'vtt' | 'ass'
  raw: string
}

function parseSrt(text: string): SubtitleEntry[] {
  const entries: SubtitleEntry[] = []
  const blocks = text.replace(/\r\n/g, '\n').split(/\n\n+/)
  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 2) continue
    const idx = parseInt(lines[0])
    const m = lines[1].match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/)
    if (!m) continue
    const start = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000
    const end = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000
    entries.push({ index: idx || entries.length + 1, start, end, text: lines.slice(2).join('\n') })
  }
  return entries
}

function serializeSrt(entries: SubtitleEntry[]): string {
  return entries.map((e) => {
    const fmt = (s: number) => {
      const h = Math.floor(s / 3600)
      const m = Math.floor((s % 3600) / 60)
      const sec = Math.floor(s % 60)
      const ms = Math.floor((s * 1000) % 1000)
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`
    }
    return `${e.index}\n${fmt(e.start)} --> ${fmt(e.end)}\n${e.text}\n`
  }).join('\n')
}

export const subtitleHandler: FormatHandler = {
  format: 'subtitle', extensions: ['srt', 'vtt', 'ass', 'ssa'], displayName: 'Subtitles', icon: '💬',
  Viewer: SubtitleEditor,
  load: async (tabId, bytes, filePath) => {
    const raw = new TextDecoder().decode(bytes)
    const ext = filePath.toLowerCase().split('.').pop() || 'srt'
    const format = (ext === 'vtt' ? 'vtt' : ext === 'ass' || ext === 'ssa' ? 'ass' : 'srt') as 'srt' | 'vtt' | 'ass'
    const entries = format === 'srt' || format === 'vtt' ? parseSrt(raw.replace(/^WEBVTT\n+/, '')) : []
    useFormatStore.getState().setFormatState(tabId, { entries, format, raw })
  },
  save: async (tabId) => {
    const s = useFormatStore.getState().getFormatState<SubtitleState>(tabId)
    if (!s) throw new Error('No state')
    if (s.format === 'srt' || s.format === 'vtt') {
      const out = s.format === 'vtt' ? 'WEBVTT\n\n' + serializeSrt(s.entries).replace(/,/g, '.') : serializeSrt(s.entries)
      return new TextEncoder().encode(out)
    }
    return new TextEncoder().encode(s.raw) // ASS preserved as-is
  },
  cleanup: (tabId) => useFormatStore.getState().clearFormatState(tabId),
  canConvertTo: [],
  capabilities: { edit: true, annotate: false, search: true, zoom: false }
}

// ── Fonts (TTF, OTF, WOFF, WOFF2) ─────────────────────────────────
export interface FontState {
  bytes: Uint8Array
  name?: string
  glyphCount?: number
  unitsPerEm?: number
  familyName?: string
  style?: string
  weight?: number
  sampleSvgs?: { char: string; svg: string }[]
  error?: string
}
export const fontHandler: FormatHandler = {
  format: 'font', extensions: ['ttf', 'otf', 'woff', 'woff2'], displayName: 'Font', icon: 'A',
  Viewer: FontViewer,
  load: async (tabId, bytes) => {
    try {
      const opentype = await import('opentype.js')
      const font = opentype.parse(bytes.buffer)
      const sampleChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split('')
      const sampleSvgs = sampleChars.map(char => ({
        char,
        svg: font.getPath(char, 0, 60, 50).toSVG(2)
      }))
      useFormatStore.getState().setFormatState(tabId, {
        bytes,
        name: font.names.fullName?.en || 'Unknown',
        glyphCount: font.glyphs.length,
        unitsPerEm: font.unitsPerEm,
        familyName: font.names.fontFamily?.en,
        style: font.names.fontSubfamily?.en,
        weight: font.tables.os2?.usWeightClass,
        sampleSvgs,
      })
    } catch (err) {
      useFormatStore.getState().setFormatState(tabId, { bytes, error: (err as Error).message })
    }
  },
  save: async (tabId) => {
    const s = useFormatStore.getState().getFormatState<FontState>(tabId)
    if (!s) throw new Error('No state')
    return s.bytes
  },
  cleanup: (tabId) => useFormatStore.getState().clearFormatState(tabId),
  canConvertTo: [],
  capabilities: { edit: false, annotate: false, search: false, zoom: false }
}

// ── DjVu (read-only) ──────────────────────────────────────────────
export interface DjvuState { bytes: Uint8Array; pageCount: number }
export const djvuHandler: FormatHandler = {
  format: 'djvu', extensions: ['djvu', 'djv'], displayName: 'DjVu', icon: '📄',
  Viewer: DjvuViewer,
  load: async (tabId, bytes) => {
    // djvu.js is heavy and complex — for now just show metadata
    useFormatStore.getState().setFormatState(tabId, { bytes, pageCount: 0 })
  },
  save: async (tabId) => {
    const s = useFormatStore.getState().getFormatState<DjvuState>(tabId)
    if (!s) throw new Error('No state')
    return s.bytes
  },
  cleanup: (tabId) => useFormatStore.getState().clearFormatState(tabId),
  canConvertTo: [],
  capabilities: { edit: false, annotate: false, search: false, zoom: true }
}

// ── MOBI / AZW3 (read-only metadata) ──────────────────────────────
export interface MobiState { bytes: Uint8Array; title?: string; author?: string; text?: string }
export const mobiHandler: FormatHandler = {
  format: 'mobi', extensions: ['mobi', 'azw3', 'azw'], displayName: 'Kindle', icon: '📖',
  Viewer: MobiViewer,
  load: async (tabId, bytes) => {
    // Parse the MOBI header for title (basic)
    const raw = new Uint8Array(bytes.buffer)
    let title = ''
    try {
      // MOBI has a PalmDB header, then MOBI-specific records
      // Title is typically in the first few hundred bytes as null-terminated string
      const headerText = new TextDecoder('utf-8', { fatal: false }).decode(raw.slice(0, 300))
      const nameMatch = headerText.match(/[A-Za-z][A-Za-z0-9 ,.'-]{4,80}/)
      if (nameMatch) title = nameMatch[0]
    } catch {}
    useFormatStore.getState().setFormatState(tabId, { bytes, title })
  },
  save: async (tabId) => {
    const s = useFormatStore.getState().getFormatState<MobiState>(tabId)
    if (!s) throw new Error('No state')
    return s.bytes
  },
  cleanup: (tabId) => useFormatStore.getState().clearFormatState(tabId),
  canConvertTo: [],
  capabilities: { edit: false, annotate: false, search: false, zoom: false }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.readAsDataURL(blob)
  })
}
