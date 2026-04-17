import { useEffect } from 'react'
import { useUIStore } from '../stores/uiStore'
import { useTabStore } from '../stores/tabStore'
import { useHistoryStore } from '../stores/historyStore'
import { useFormatStore } from '../stores/formatStore'
import { openFile, saveFile, saveFileAs, closeActiveTab } from '../App'
import type { PdfFormatState } from '../formats/pdf'

export function useKeyboardShortcuts() {
  const setTool = useUIStore((s) => s.setTool)
  const zoomIn = useUIStore((s) => s.zoomIn)
  const zoomOut = useUIStore((s) => s.zoomOut)
  const resetZoom = useUIStore((s) => s.resetZoom)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette)
  const openFind = useUIStore((s) => s.openFind)
  const openReplace = useUIStore((s) => s.openReplace)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      const shift = e.shiftKey
      const target = e.target as HTMLElement

      // Don't intercept when typing in inputs (unless it's a global shortcut)
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

      // Global shortcuts (work even in inputs)
      if (ctrl && !shift && e.key === 'f') { e.preventDefault(); openFind(); return }
      if (ctrl && !shift && e.key === 'h') { e.preventDefault(); openReplace(); return }
      if (ctrl && !shift && e.key === 'k') { e.preventDefault(); toggleCommandPalette(); return }
      if (ctrl && !shift && e.key === 'p') { e.preventDefault(); toggleCommandPalette(); return }
      if (ctrl && !shift && e.key === 'o') { e.preventDefault(); openFile(); return }
      if (ctrl && shift && e.key === 'S') { e.preventDefault(); saveFileAs(); return }
      if (ctrl && !shift && e.key === 's') { e.preventDefault(); saveFile(); return }
      if (ctrl && e.key === 'w') { e.preventDefault(); closeActiveTab(); return }

      // Undo/Redo for page-level operations
      if (ctrl && !shift && e.key === 'z') {
        const hs = useHistoryStore.getState()
        if (hs.undoStack.length > 0) {
          const entry = hs.undoStack[hs.undoStack.length - 1]
          if (entry.type === 'pages') {
            e.preventDefault()
            // Save current state to redo before restoring
            const cur = useFormatStore.getState().data[entry.tabId] as PdfFormatState | undefined
            const currentSnapshot = cur ? JSON.parse(JSON.stringify(cur.pages)) : []
            useHistoryStore.setState({
              undoStack: hs.undoStack.slice(0, -1),
              redoStack: [...hs.redoStack, { type: 'pages', tabId: entry.tabId, pages: currentSnapshot }]
            })
            useFormatStore.getState().updateFormatState<PdfFormatState>(entry.tabId, (prev) => ({
              ...prev, pages: entry.pages
            }))
            return
          }
        }
      }
      if (ctrl && (e.key === 'y' || (shift && e.key === 'Z'))) {
        const hs = useHistoryStore.getState()
        if (hs.redoStack.length > 0) {
          const entry = hs.redoStack[hs.redoStack.length - 1]
          if (entry.type === 'pages') {
            e.preventDefault()
            // Save current state to undo before restoring
            const cur = useFormatStore.getState().data[entry.tabId] as PdfFormatState | undefined
            const currentSnapshot = cur ? JSON.parse(JSON.stringify(cur.pages)) : []
            useHistoryStore.setState({
              redoStack: hs.redoStack.slice(0, -1),
              undoStack: [...hs.undoStack, { type: 'pages', tabId: entry.tabId, pages: currentSnapshot }]
            })
            useFormatStore.getState().updateFormatState<PdfFormatState>(entry.tabId, (prev) => ({
              ...prev, pages: entry.pages
            }))
            return
          }
        }
      }

      // Tab cycling
      if (ctrl && e.key === 'Tab') {
        e.preventDefault()
        const { tabs, activeTabId, setActiveTab } = useTabStore.getState()
        if (tabs.length <= 1) return
        const idx = tabs.findIndex((t) => t.id === activeTabId)
        const next = shift
          ? (idx - 1 + tabs.length) % tabs.length
          : (idx + 1) % tabs.length
        setActiveTab(tabs[next].id)
        return
      }

      // Ctrl+1-9 to switch tabs
      if (ctrl && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        const { tabs, setActiveTab } = useTabStore.getState()
        const idx = parseInt(e.key) - 1
        if (idx < tabs.length) setActiveTab(tabs[idx].id)
        return
      }

      // Don't intercept tool shortcuts when typing
      if (isTyping) return

      // Zoom
      if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomIn(); return }
      if (ctrl && e.key === '-') { e.preventDefault(); zoomOut(); return }
      if (ctrl && e.key === '0') { e.preventDefault(); resetZoom(); return }
      if (ctrl && e.key === 'b') { e.preventDefault(); toggleSidebar(); return }

      // Tool shortcuts (no modifier, not while typing)
      if (!ctrl && !shift) {
        switch (e.key) {
          case 'v': case 'V': setTool('select'); return
          case 't': case 'T': setTool('text'); return
          case 'd': case 'D': setTool('draw'); return
          case 'i': case 'I': setTool('image'); return
          case 'Escape': setTool('select'); return
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setTool, zoomIn, zoomOut, resetZoom, toggleSidebar, toggleCommandPalette, openFind, openReplace])
}
