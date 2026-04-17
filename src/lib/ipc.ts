// Thin typed wrapper around Tauri's `invoke`. Replaces the Electron
// `window.api.*` surface. Each exported function corresponds 1:1 to a
// #[tauri::command] in src-tauri/src/commands/.

import { invoke } from '@tauri-apps/api/core'

// ── Types mirror the Rust structs ────────────────────────────────────

export interface LoadedFile {
  path: string
  name: string
  bytes: number[] // serde serializes Vec<u8> as a JSON array of numbers
  size: number
}

export interface RecentEntry {
  path: string
  name: string
  format: string
  last_opened: number
}

export interface RenderedPage {
  width: number
  height: number
  png_bytes: number[]
}

// Small helper: convert the array-of-numbers bytes we get back from Tauri
// into a proper Uint8Array without a full copy loop.
export function bytesToUint8Array(bytes: number[]): Uint8Array {
  return Uint8Array.from(bytes)
}

// ── File ─────────────────────────────────────────────────────────────

export const fileApi = {
  async open(): Promise<LoadedFile | null> {
    return invoke<LoadedFile | null>('open_file_dialog')
  },
  async openPath(path: string): Promise<LoadedFile> {
    return invoke<LoadedFile>('open_file_path', { path })
  },
  async save(path: string, bytes: Uint8Array): Promise<void> {
    return invoke<void>('save_file', { path, bytes: Array.from(bytes) })
  },
  async saveAs(bytes: Uint8Array, suggestedName?: string): Promise<string | null> {
    return invoke<string | null>('save_file_dialog', {
      bytes: Array.from(bytes),
      suggestedName: suggestedName ?? null,
    })
  },
  async pickFolder(extensions?: string[], maxFiles?: number): Promise<LoadedFile[] | null> {
    return invoke<LoadedFile[] | null>('pick_folder', {
      extensions: extensions ?? null,
      maxFiles: maxFiles ?? null,
    })
  },
  async hash(path: string): Promise<string> {
    return invoke<string>('hash_file', { path })
  },
}

// ── Recent ───────────────────────────────────────────────────────────

export const recentApi = {
  async get(): Promise<RecentEntry[]> {
    return invoke<RecentEntry[]>('recent_get')
  },
  async add(path: string, name: string, format: string): Promise<RecentEntry[]> {
    return invoke<RecentEntry[]>('recent_add', { path, name, format })
  },
  async remove(path: string): Promise<RecentEntry[]> {
    return invoke<RecentEntry[]>('recent_remove', { path })
  },
  async clear(): Promise<void> {
    return invoke<void>('recent_clear')
  },
}

// ── PDF (stubs in M1, real in M2+) ───────────────────────────────────

export const pdfApi = {
  async pageCount(bytes: Uint8Array): Promise<number> {
    return invoke<number>('pdf_page_count', { bytes: Array.from(bytes) })
  },
  async renderPage(bytes: Uint8Array, pageIndex: number, scale: number): Promise<RenderedPage> {
    return invoke<RenderedPage>('pdf_render_page', {
      bytes: Array.from(bytes),
      pageIndex,
      scale,
    })
  },
  async extractText(bytes: Uint8Array, pageIndex: number): Promise<string> {
    return invoke<string>('pdf_extract_text', {
      bytes: Array.from(bytes),
      pageIndex,
    })
  },
}

// ── App ──────────────────────────────────────────────────────────────

export const appApi = {
  async version(): Promise<string> {
    return invoke<string>('app_version')
  },
}
