// Electron `window.api` shim, implemented on top of Tauri IPC.
//
// Why: the PDF codebase ported from the Electron archive calls window.api.*
// in dozens of places. Rather than rewrite every call site, we expose the
// same surface on `window.api` but route everything through Tauri.
//
// This file must be imported in main.tsx BEFORE any code that reads
// window.api (all format handlers, dialogs, services).
//
// Contract: we match the archive's preload/index.ts exactly. Return shapes,
// argument order, everything. If the archive expected { bytes, path }, we
// return { bytes, path }. Some bits (font management, screen capture) are
// stubbed because their Rust backends aren't wired yet.

import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { PDFDocument } from 'pdf-lib'

/** LoadedFile shape as returned by Rust `LoadedFile` struct. */
interface LoadedFileRust {
  path: string
  name: string
  bytes: number[] // serde Vec<u8> crosses the wire as number[]
  size: number
}

function toBytes(b: number[] | Uint8Array): Uint8Array {
  if (b instanceof Uint8Array) return b
  return Uint8Array.from(b)
}

function fromBytes(b: Uint8Array): number[] {
  // Structured clone would be faster but Tauri invoke args serialize to JSON.
  return Array.from(b)
}

// The archive's preload returns { bytes, path } — no name. Components that
// need the name derive it from the path. We preserve this shape even though
// our Rust LoadedFile struct also carries `name`.
interface FilePair {
  bytes: Uint8Array
  path: string
}

function adaptLoaded(r: LoadedFileRust | null): FilePair | null {
  if (!r) return null
  return { path: r.path, bytes: toBytes(r.bytes) }
}

async function openFile(): Promise<FilePair | null> {
  const r = await invoke<LoadedFileRust | null>('open_file_dialog')
  return adaptLoaded(r)
}

async function openFilePath(path: string): Promise<FilePair> {
  const r = await invoke<LoadedFileRust>('open_file_path', { path })
  return { path: r.path, bytes: toBytes(r.bytes) }
}

async function saveFile(bytes: Uint8Array, path: string): Promise<void> {
  await invoke('save_file', { path, bytes: fromBytes(bytes) })
}

async function saveFileAs(bytes: Uint8Array): Promise<string | null> {
  return invoke<string | null>('save_file_dialog', {
    bytes: fromBytes(bytes),
    suggestedName: null,
  })
}

// Multi-file open. Backs the archive's PdfMergeDialog and similar.
// We call the Tauri plugin-dialog directly for multi-select (no Rust command
// needed — plugin-dialog handles it).
async function openMultiple(): Promise<FilePair[] | null> {
  const picked = await openDialog({ multiple: true })
  if (!picked) return null
  const paths = Array.isArray(picked) ? picked : [picked]
  const out: FilePair[] = []
  for (const entry of paths) {
    // tauri-plugin-dialog returns strings in multi-select mode
    const p = typeof entry === 'string' ? entry : (entry as { path: string }).path
    const r = await invoke<LoadedFileRust>('open_file_path', { path: p })
    out.push({ path: r.path, bytes: toBytes(r.bytes) })
  }
  return out
}

// Pick images. Uses a filtered multi-select; caller gets {bytes, name}[].
async function pickImages(): Promise<{ bytes: Uint8Array; name: string }[] | null> {
  const picked = await openDialog({
    multiple: true,
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico'] },
    ],
  })
  if (!picked) return null
  const paths = Array.isArray(picked) ? picked : [picked]
  const out: { bytes: Uint8Array; name: string }[] = []
  for (const entry of paths) {
    // tauri-plugin-dialog returns strings in multi-select mode
    const p = typeof entry === 'string' ? entry : (entry as { path: string }).path
    const r = await invoke<LoadedFileRust>('open_file_path', { path: p })
    out.push({ bytes: toBytes(r.bytes), name: r.name })
  }
  return out
}

// Folder pick — returns files with bytes loaded, filtered by extensions.
async function pickFolder(
  extensions?: string[],
): Promise<{ path: string; name: string; bytes: Uint8Array }[] | null> {
  const r = await invoke<LoadedFileRust[] | null>('pick_folder', {
    extensions: extensions ?? null,
    maxFiles: null,
  })
  if (!r) return null
  return r.map((f) => ({ path: f.path, name: f.name, bytes: toBytes(f.bytes) }))
}

// PDF operations implemented in JS via pdf-lib. We could push these to
// Rust for perf but they're small one-shot operations — staying in JS keeps
// the bundle simpler. Swap to Rust when/if the merge/split perf matters.
async function pdfMerge(bytesArray: Uint8Array[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create()
  for (const bytes of bytesArray) {
    const src = await PDFDocument.load(bytes)
    const copied = await merged.copyPages(src, src.getPageIndices())
    copied.forEach((p) => merged.addPage(p))
  }
  return new Uint8Array(await merged.save())
}

async function pdfSplit(
  bytes: Uint8Array,
  ranges: [number, number][],
): Promise<Uint8Array[]> {
  const src = await PDFDocument.load(bytes)
  const out: Uint8Array[] = []
  for (const [start, end] of ranges) {
    const part = await PDFDocument.create()
    const indices: number[] = []
    for (let i = start; i <= end; i++) indices.push(i)
    const copied = await part.copyPages(src, indices)
    copied.forEach((p) => part.addPage(p))
    out.push(new Uint8Array(await part.save()))
  }
  return out
}

// --- Recent files, direct pass-through to Rust ---

interface RecentEntryRust {
  path: string
  name: string
  format: string
  last_opened: number
}

interface RecentEntry {
  path: string
  name: string
  format: string
  lastOpened: number
}

function adaptRecent(r: RecentEntryRust): RecentEntry {
  return { path: r.path, name: r.name, format: r.format, lastOpened: r.last_opened * 1000 }
}

async function recentGet(): Promise<RecentEntry[]> {
  const rs = await invoke<RecentEntryRust[]>('recent_get')
  return rs.map(adaptRecent)
}

async function recentAdd(path: string, name: string, format: string): Promise<void> {
  await invoke('recent_add', { path, name, format })
}

async function recentRemove(path: string): Promise<void> {
  await invoke('recent_remove', { path })
}

async function recentClear(): Promise<void> {
  await invoke('recent_clear')
}

// --- Fonts: system enumeration + imported font store ---
//
// Backed by Rust commands in src-tauri/src/commands/font.rs. We expose
// the same `font.*` surface the Electron preload had so PDF handler and
// editSerializer don't need changes. Bytes cross the IPC as number[] and
// are boxed back to Uint8Array here.

interface FontInfoRust {
  id: string
  name: string
  family: string
  style: string
  file_name: string
  path: string
  source: 'system' | 'imported'
}

function adaptFontEntry(f: FontInfoRust): { id: string; name: string; fileName: string; style: string } {
  return { id: f.id, name: f.name, fileName: f.file_name, style: f.style }
}

// `font.list()` returns ONLY user-imported fonts (matches Electron archive
// semantics: fontStore FontFace-loads every entry into the browser, which
// must NOT include all ~200 system fonts). For system fonts use
// `font.listSystem()` which is lazy-friendly.
async function fontList(): Promise<{ id: string; name: string; fileName: string; style: string }[]> {
  const imported = await invoke<FontInfoRust[]>('font_imported_list').catch(() => [])
  return imported.map(adaptFontEntry)
}

async function fontListSystem(): Promise<{ id: string; name: string; family: string; style: string; fileName: string }[]> {
  const system = await invoke<FontInfoRust[]>('font_list_system').catch(() => [])
  return system.map((f) => ({
    id: f.id,
    name: f.name,
    family: f.family,
    style: f.style,
    fileName: f.file_name,
  }))
}

async function fontImport(): Promise<{ id: string; name: string; fileName: string; style: string } | null> {
  const r = await invoke<FontInfoRust | null>('font_import_file')
  return r ? adaptFontEntry(r) : null
}

async function fontGetBytes(fontId: string): Promise<Uint8Array> {
  const raw = await invoke<number[]>('font_get_bytes', { id: fontId })
  return Uint8Array.from(raw)
}

// Font subsetting isn't done in Rust yet — we'd need a subset-font-like
// crate that works on Windows without native deps. Pass bytes through
// unchanged for now; editSerializer will embed the full font, producing
// a larger but correct PDF.
async function fontSubset(fontId: string, _glyphs: string): Promise<Uint8Array> {
  return fontGetBytes(fontId)
}

async function fontRemove(id: string): Promise<void> {
  // Only imported fonts are removable.
  if (!id.startsWith('imported:')) return
  await invoke('font_imported_remove', { id })
}

/** Scan a PDF for its embedded fonts. Returns PostScript names + family
 *  guesses. Used by the paragraph editor to decide whether to fall back
 *  to a system font or to the original. */
async function fontScanPdf(bytes: Uint8Array): Promise<{ psName: string; family: string; subsetted: boolean }[]> {
  const raw = await invoke<Array<{ ps_name: string; family: string; subsetted: boolean }>>(
    'font_scan_pdf',
    { bytes: fromBytes(bytes) },
  )
  return raw.map((r) => ({ psName: r.ps_name, family: r.family, subsetted: r.subsetted }))
}

// --- Native print + screen capture: best-effort shims ---

async function printPdf(_opts?: { silent?: boolean; printBackground?: boolean; copies?: number }): Promise<boolean> {
  // TODO(M4): wire tauri-plugin-printer or a desktop capture route.
  window.print()
  return true
}

async function captureScreen(): Promise<Uint8Array | null> {
  // TODO(M4): wire tauri's desktop capture. Return null to signal unsupported;
  // SnipPinDialog handles that gracefully with an error toast.
  return null
}

// --- Menu event bridge ---
// The Electron main process emitted menu events via `webContents.send`.
// Tauri's menu bindings aren't wired in M2. Return a no-op cleanup so
// callers don't blow up — their keyboard shortcuts still work.

function on(_channel: string, _cb: (...args: unknown[]) => void): () => void {
  return () => {}
}

// --- Assemble and install ---

const api = {
  file: {
    open: openFile,
    openPath: openFilePath,
    save: saveFile,
    saveAs: saveFileAs,
    openMultiple,
    pickImages,
  },
  pdf: {
    merge: pdfMerge,
    split: pdfSplit,
  },
  recent: {
    get: recentGet,
    add: recentAdd,
    remove: recentRemove,
    clear: recentClear,
  },
  font: {
    list: fontList,
    listSystem: fontListSystem,
    import: fontImport,
    getBytes: fontGetBytes,
    subset: fontSubset,
    remove: fontRemove,
    scanPdf: fontScanPdf,
  },
  folder: {
    pick: pickFolder,
  },
  print: {
    pdf: printPdf,
  },
  capture: {
    screen: captureScreen,
  },
  on,
}

// Install exactly once; hot-module reload is fine because assignment is
// idempotent.
if (typeof window !== 'undefined') {
  ;(window as unknown as { api: typeof api }).api = api
}

export type SatchelAPI = typeof api

// Make TypeScript happy when other files reference `window.api`.
declare global {
  interface Window {
    api: SatchelAPI
  }
}
