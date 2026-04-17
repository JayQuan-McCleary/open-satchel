// Global keyboard shortcuts. Registered once at app mount from App.tsx.

import { useTabStore } from '../stores/tabStore'
import { useUIStore } from '../stores/uiStore'
import { openFile, saveActiveTab, saveActiveTabAs, closeActiveTab } from './actions'

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
    if (matches(e, { ctrl: true, key: 'f' })) { e.preventDefault(); useUIStore.getState().openFindReplace('find'); return }
    // Ctrl+H: find & replace
    if (matches(e, { ctrl: true, key: 'h' })) { e.preventDefault(); useUIStore.getState().openFindReplace('replace'); return }
    // Ctrl+K: command palette
    if (matches(e, { ctrl: true, key: 'k' })) { e.preventDefault(); useUIStore.getState().setCommandPaletteOpen(true); return }
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
