import { useEffect } from 'react'
import AppShell from './components/layout/AppShell'
import { useUIStore } from './stores/uiStore'
import { useTabStore } from './stores/tabStore'
import { useFormatStore } from './stores/formatStore'
import { getHandler } from './formats/registry'
import { detectFormat } from './types/tabs'
import { registerAllFormats } from './formats/registerAll'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useAutoSave } from './hooks/useAutoSave'
import { useDragDrop } from './hooks/useDragDrop'

// Register all format handlers on startup
registerAllFormats()

export async function openFile() {
  const result = await window.api.file.open()
  if (!result) return
  await openFileFromPath(result.path, result.bytes)
}

export async function openFileFromPath(filePath: string, bytes: Uint8Array) {
  const format = detectFormat(filePath)
  const fileName = filePath.split(/[/\\]/).pop() || 'Untitled'
  const handler = getHandler(format)

  const tabId = useTabStore.getState().openTab(filePath, fileName, format)

  if (handler) {
    await handler.load(tabId, bytes, filePath)
  }

  // Track in recent files
  window.api.recent.add(filePath, fileName, format).catch(() => {})
}

export async function saveTabById(tabId: string): Promise<void> {
  const tab = useTabStore.getState().tabs.find((t) => t.id === tabId)
  if (!tab) return

  const handler = getHandler(tab.format)
  if (!handler) return

  const bytes = await handler.save(tabId)
  if (tab.filePath) {
    await window.api.file.save(bytes, tab.filePath)
    useTabStore.getState().setTabDirty(tabId, false)
  }
}

export async function saveFile() {
  const { activeTabId, tabs } = useTabStore.getState()
  if (!activeTabId) return
  const tab = tabs.find((t) => t.id === activeTabId)
  if (!tab) return

  const handler = getHandler(tab.format)
  if (!handler) return

  try {
    const bytes = await handler.save(activeTabId)
    if (tab.filePath) {
      await window.api.file.save(bytes, tab.filePath)
      useTabStore.getState().setTabDirty(activeTabId, false)
    } else {
      const newPath = await window.api.file.saveAs(bytes)
      if (newPath) {
        const name = newPath.split(/[/\\]/).pop() || tab.fileName
        useTabStore.getState().setTabFilePath(activeTabId, newPath, name)
        useTabStore.getState().setTabDirty(activeTabId, false)
      }
    }
  } catch (err) {
    console.error('Save failed:', err)
  }
}

export async function saveFileAs() {
  const { activeTabId, tabs } = useTabStore.getState()
  if (!activeTabId) return
  const tab = tabs.find((t) => t.id === activeTabId)
  if (!tab) return

  const handler = getHandler(tab.format)
  if (!handler) return

  try {
    const bytes = await handler.save(activeTabId)
    const newPath = await window.api.file.saveAs(bytes)
    if (newPath) {
      const name = newPath.split(/[/\\]/).pop() || tab.fileName
      useTabStore.getState().setTabFilePath(activeTabId, newPath, name)
      useTabStore.getState().setTabDirty(activeTabId, false)
    }
  } catch (err) {
    console.error('Save As failed:', err)
  }
}

export function closeActiveTab() {
  const { activeTabId } = useTabStore.getState()
  if (!activeTabId) return
  const tab = useTabStore.getState().tabs.find((t) => t.id === activeTabId)
  if (!tab) return

  // Cleanup format state
  const handler = getHandler(tab.format)
  if (handler?.cleanup) handler.cleanup(activeTabId)

  useTabStore.getState().closeTab(activeTabId)
}

// --- New document creation functions ---

export function newDocument() {
  const tabId = useTabStore.getState().openTab(null, 'Untitled.docx', 'docx')
  const handler = getHandler('docx')
  if (handler) {
    // Create empty DOCX by setting HTML state directly
    useFormatStore.getState().setFormatState(tabId, {
      html: '<p></p>',
      originalHtml: '<p></p>'
    })
  }
  useTabStore.getState().setTabDirty(tabId, true)
}

export function newSpreadsheet() {
  const tabId = useTabStore.getState().openTab(null, 'Untitled.xlsx', 'xlsx')
  const minCols = 26
  const minRows = 50
  const emptySheet = {
    name: 'Sheet1',
    data: Array.from({ length: minRows }, () => new Array(minCols).fill('')),
    colWidths: new Array(minCols).fill(80)
  }
  useFormatStore.getState().setFormatState(tabId, {
    workbook: null,
    sheets: [emptySheet],
    activeSheet: 0,
    selectedCell: { row: 0, col: 0 },
    editingCell: null
  })
  useTabStore.getState().setTabDirty(tabId, true)
}

export function newMarkdown() {
  const tabId = useTabStore.getState().openTab(null, 'Untitled.md', 'markdown')
  useFormatStore.getState().setFormatState(tabId, {
    content: '',
    originalContent: '',
    viewMode: 'split'
  })
  useTabStore.getState().setTabDirty(tabId, true)
}

export default function App() {
  const { zoomIn, zoomOut, resetZoom, toggleSidebar } = useUIStore()
  const { isDragging } = useDragDrop()

  useKeyboardShortcuts()
  useAutoSave()

  useEffect(() => {
    const cleanups: (() => void)[] = []

    cleanups.push(window.api.on('menu:open', openFile))
    cleanups.push(window.api.on('menu:save', saveFile))
    cleanups.push(window.api.on('menu:saveAs', saveFileAs))
    cleanups.push(window.api.on('menu:closeTab', closeActiveTab))
    cleanups.push(window.api.on('menu:zoomIn', () => zoomIn()))
    cleanups.push(window.api.on('menu:zoomOut', () => zoomOut()))
    cleanups.push(window.api.on('menu:zoomReset', () => resetZoom()))
    cleanups.push(window.api.on('menu:toggleSidebar', () => toggleSidebar()))

    return () => cleanups.forEach((c) => c())
  }, [zoomIn, zoomOut, resetZoom, toggleSidebar])

  return (
    <>
      <AppShell />
      {isDragging && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          background: 'rgba(59, 130, 246, 0.12)',
          backdropFilter: 'blur(2px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <div style={{
            border: '3px dashed rgba(59, 130, 246, 0.6)',
            borderRadius: 16,
            padding: '48px 64px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            background: 'rgba(59, 130, 246, 0.06)',
          }}>
            <div style={{ fontSize: 40, opacity: 0.8 }}>+</div>
            <div style={{
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--text-primary)',
              opacity: 0.9,
            }}>
              Drop files here
            </div>
            <div style={{
              fontSize: 12,
              color: 'var(--text-muted)',
            }}>
              PDF, Word, Excel, Images, Markdown, Code, and more
            </div>
          </div>
        </div>
      )}
    </>
  )
}
