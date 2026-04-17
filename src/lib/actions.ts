// High-level app actions invoked from the toolbar, shortcuts, and command
// palette. Keep these side-effectful and UI-aware so UI components stay lean.

import { fileApi, recentApi, bytesToUint8Array } from './ipc'
import { useTabStore } from '../stores/tabStore'
import { useFormatStore } from '../stores/formatStore'
import { detectFormat } from '../types/tabs'
import { getHandler, getHandlerForExtension } from '../formats/registry'

export async function openFile(): Promise<void> {
  const loaded = await fileApi.open()
  if (!loaded) return
  await openLoadedFile(loaded.path, loaded.name, bytesToUint8Array(loaded.bytes))
}

export async function openFromPath(path: string): Promise<void> {
  const loaded = await fileApi.openPath(path)
  await openLoadedFile(loaded.path, loaded.name, bytesToUint8Array(loaded.bytes))
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
    await recentApi.add(path, name, format)
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
    await fileApi.save(tab.filePath, bytes)
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
  const newPath = await fileApi.saveAs(bytes, tab.fileName)
  if (!newPath) return

  const newName = newPath.split(/[/\\]/).pop() ?? tab.fileName
  setTabFilePath(activeTabId, newPath, newName)
  setTabDirty(activeTabId, false)
  try {
    await recentApi.add(newPath, newName, tab.format)
  } catch (err) {
    console.warn('[recent] add failed', err)
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
