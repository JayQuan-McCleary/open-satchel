// Global keyboard shortcuts. Registered once at app mount from App.tsx.

import { useTabStore } from '../stores/tabStore'
import { useUIStore } from '../stores/uiStore'
import { openFile, saveActiveTab, saveActiveTabAs, closeActiveTab } from './actions'
import { undo as doUndo, redo as doRedo } from './undo-redo'
import { shouldEscapeRevertToSelect } from '../formats/pdf/clickDispatcher'

type Key = { ctrl?: boolean; shift?: boolean; alt?: boolean; key: string }

function matches(e: KeyboardEvent, k: Key): boolean {
  const ctrl = !!e.ctrlKey || !!e.metaKey
  return (
    e.key.toLowerCase() === k.key.toLowerCase() &&
    (k.ctrl ?? false) === ctrl &&
    (k.shift ?? false) === e.shiftKey &&
    (k.alt ?? false) === e.altKey
  )
}

export function registerGlobalShortcuts(): () => void {
  const handler = (e: KeyboardEvent) => {
    // Ctrl+O: open
    if (matches(e, { ctrl: true, key: 'o' })) { e.preventDefault(); void openFile(); return }
    // Ctrl+S: save
    if (matches(e, { ctrl: true, key: 's' })) { e.preventDefault(); void saveActiveTab(); return }
    // Ctrl+Shift+S: save as
    if (matches(e, { ctrl: true, shift: true, key: 's' })) { e.preventDefault(); void saveActiveTabAs(); return }
    // Ctrl+W: close tab
    if (matches(e, { ctrl: true, key: 'w' })) { e.preventDefault(); closeActiveTab(); return }
    // Ctrl+B: toggle sidebar
    if (matches(e, { ctrl: true, key: 'b' })) { e.preventDefault(); useUIStore.getState().toggleSidebar(); return }
    // Ctrl+F: find
    if (matches(e, { ctrl: true, key: 'f' })) { e.preventDefault(); useUIStore.getState().openFind(); return }
    // Ctrl+H: find & replace
    if (matches(e, { ctrl: true, key: 'h' })) { e.preventDefault(); useUIStore.getState().openReplace(); return }
    // Ctrl+K: command palette
    if (matches(e, { ctrl: true, key: 'k' })) { e.preventDefault(); useUIStore.getState().setCommandPaletteOpen(true); return }
    // Ctrl+Z: undo at the APP level (paragraph / page / fabric history).
    //
    // We don't bail on contenteditable because our per-paragraph
    // commit model is what the user cares about — reverting the
    // whole paragraph they just edited, not the last keystroke. The
    // browser's per-character undo inside the contenteditable is
    // redundant with our edit-session snapshot pattern.
    if (matches(e, { ctrl: true, key: 'z' })) {
      e.preventDefault()
      // Blur any active contenteditable first so the current edit
      // session flushes to history before we pop. Without this,
      // typing then Ctrl+Z would pop an EARLIER entry and leave the
      // in-flight change orphaned.
      const ae = document.activeElement as HTMLElement | null
      if (ae && ae.isContentEditable) ae.blur()
      doUndo()
      return
    }
    if (matches(e, { ctrl: true, shift: true, key: 'z' }) || matches(e, { ctrl: true, key: 'y' })) {
      e.preventDefault()
      const ae = document.activeElement as HTMLElement | null
      if (ae && ae.isContentEditable) ae.blur()
      doRedo()
      return
    }
    // Escape: modeless-editing escape hatch. When the user is stuck
    // in a non-primary tool (Highlight, Draw, Stamp, etc.) and nothing
    // is being actively edited, revert to Select — matching the
    // "press Esc to exit this tool" convention users expect from
    // Figma / Canva / Notion. Does NOT fire when a paragraph is in
    // edit mode (Escape on an active paragraph already resets its
    // text per EditableParagraphLayer's onKeyDown handler).
    if (e.key === 'Escape' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      const ae = document.activeElement as HTMLElement | null
      if (ae && ae.isContentEditable) return  // let the paragraph editor handle it
      const tool = useUIStore.getState().tool
      if (shouldEscapeRevertToSelect(tool)) {
        e.preventDefault()
        useUIStore.getState().setTool('select')
        return
      }
    }
    // Ctrl+Tab: next tab
    if (matches(e, { ctrl: true, key: 'Tab' })) {
      e.preventDefault()
      const { tabs, activeTabId, setActiveTab } = useTabStore.getState()
      if (tabs.length < 2 || !activeTabId) return
      const idx = tabs.findIndex((t) => t.id === activeTabId)
      const next = tabs[(idx + 1) % tabs.length]
      setActiveTab(next.id)
      return
    }
  }

  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}
