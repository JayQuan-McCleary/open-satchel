// High-level app actions invoked from the toolbar, shortcuts, and command
// palette. Keep these side-effectful and UI-aware so UI components stay lean.
//
// All IPC goes through `window.api.*` (installed by electron-api-shim.ts),
// which is dual-mode: Tauri in production/dev, browser fallbacks in
// zenlink/manual-browser testing. Do NOT import from lib/ipc.ts here — it
// calls Tauri invoke directly and would bypass browser mode.

import { useTabStore } from '../stores/tabStore'
import { useFormatStore } from '../stores/formatStore'
import { detectFormat } from '../types/tabs'
import { getHandler, getHandlerForExtension } from '../formats/registry'

export async function openFile(): Promise<void> {
  const loaded = await window.api.file.open()
  if (!loaded) return
  const name = loaded.path.split(/[/\\]/).pop() ?? loaded.path
  await openLoadedFile(loaded.path, name, loaded.bytes)
}

// Open a file from a known path. If bytes are passed, skip the disk read —
// callers that just produced the bytes (merge output, convert output) can
// pass them directly to avoid a round-trip through the OS file cache.
export async function openFromPath(path: string, preloadedBytes?: Uint8Array): Promise<void> {
  if (preloadedBytes) {
    const name = path.split(/[/\\]/).pop() ?? path
    await openLoadedFile(path, name, preloadedBytes)
    return
  }
  const loaded = await window.api.file.openPath(path)
  const name = loaded.path.split(/[/\\]/).pop() ?? loaded.path
  await openLoadedFile(loaded.path, name, loaded.bytes)
}

async function openLoadedFile(path: string, name: string, bytes: Uint8Array): Promise<void> {
  const format = detectFormat(path)
  if (!format) {
    console.warn(`[open] unknown format for ${path}`)
    return
  }
  const handler = getHandler(format) ?? getHandlerForExtension(path.split('.').pop() ?? '')
  if (!handler) {
    console.warn(`[open] no handler registered for format ${format}`)
    return
  }

  const tabId = useTabStore.getState().openTab(path, name, format)
  await handler.load(tabId, bytes, path)
  try {
    await window.api.recent.add(path, name, format)
  } catch (err) {
    console.warn('[recent] add failed', err)
  }
}

export async function saveActiveTab(): Promise<void> {
  const { activeTabId, tabs, setTabDirty } = useTabStore.getState()
  if (!activeTabId) return
  const tab = tabs.find((t) => t.id === activeTabId)
  if (!tab) return
  const handler = getHandler(tab.format)
  if (!handler) return

  const bytes = await handler.save(activeTabId)
  if (tab.filePath) {
    await window.api.file.save(bytes, tab.filePath)
    setTabDirty(activeTabId, false)
  } else {
    await saveActiveTabAs()
  }
}

export async function saveActiveTabAs(): Promise<void> {
  const { activeTabId, tabs, setTabDirty, setTabFilePath } = useTabStore.getState()
  if (!activeTabId) return
  const tab = tabs.find((t) => t.id === activeTabId)
  if (!tab) return
  const handler = getHandler(tab.format)
  if (!handler) return

  const bytes = await handler.save(activeTabId)
  const newPath = await window.api.file.saveAs(bytes)
  if (!newPath) return

  const newName = newPath.split(/[/\\]/).pop() ?? tab.fileName
  setTabFilePath(activeTabId, newPath, newName)
  setTabDirty(activeTabId, false)
  try {
    await window.api.recent.add(newPath, newName, tab.format)
  } catch (err) {
    console.warn('[recent] add failed', err)
  }
}

// Save a specific tab by id. Used by useAutoSave and anywhere else that
// needs to save a non-active tab (e.g. "save all").
export async function saveTabById(tabId: string): Promise<void> {
  const { tabs, setTabDirty } = useTabStore.getState()
  const tab = tabs.find((t) => t.id === tabId)
  if (!tab) return
  const handler = getHandler(tab.format)
  if (!handler) return
  const bytes = await handler.save(tabId)
  if (tab.filePath) {
    await window.api.file.save(bytes, tab.filePath)
    setTabDirty(tabId, false)
  }
}

export function closeActiveTab(): void {
  const { activeTabId, closeTab } = useTabStore.getState()
  if (!activeTabId) return
  const format = useFormatStore.getState()
  // Clean up the format state first, then close the tab.
  const tab = useTabStore.getState().tabs.find((t) => t.id === activeTabId)
  if (tab) {
    const handler = getHandler(tab.format)
    handler?.cleanup?.(activeTabId)
  }
  format.clearFormatState(activeTabId)
  closeTab(activeTabId)
}
