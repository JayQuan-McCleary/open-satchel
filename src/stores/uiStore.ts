import { create } from 'zustand'

// Global UI state: sidebar visibility, theme, active modal, find panel,
// etc. Anything that isn't per-tab lives here.

export type FindReplaceMode = 'find' | 'replace'

interface UIState {
  sidebarOpen: boolean
  theme: 'dark' | 'light'

  findReplaceOpen: boolean
  findReplaceMode: FindReplaceMode

  commandPaletteOpen: boolean

  // Split-view support (used from M7 onward; harmless in M1)
  splitViewEnabled: boolean
}

interface UIActions {
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setTheme: (t: 'dark' | 'light') => void

  openFindReplace: (mode: FindReplaceMode) => void
  closeFindReplace: () => void

  setCommandPaletteOpen: (open: boolean) => void

  setSplitViewEnabled: (enabled: boolean) => void
}

export const useUIStore = create<UIState & UIActions>((set) => ({
  sidebarOpen: true,
  theme: 'dark',
  findReplaceOpen: false,
  findReplaceMode: 'find',
  commandPaletteOpen: false,
  splitViewEnabled: false,

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setTheme: (t) => set({ theme: t }),

  openFindReplace: (mode) => set({ findReplaceOpen: true, findReplaceMode: mode }),
  closeFindReplace: () => set({ findReplaceOpen: false }),

  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

  setSplitViewEnabled: (enabled) => set({ splitViewEnabled: enabled }),
}))
