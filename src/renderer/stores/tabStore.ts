import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import type { TabDescriptor, DocumentFormat } from '../types/tabs'

interface TabActions {
  openTab: (filePath: string | null, fileName: string, format: DocumentFormat) => string
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  setTabDirty: (id: string, dirty: boolean) => void
  setTabFilePath: (id: string, path: string, name: string) => void
  reorderTabs: (fromIndex: number, toIndex: number) => void
}

interface TabState {
  tabs: TabDescriptor[]
  activeTabId: string | null
}

export const useTabStore = create<TabState & TabActions>((set, get) => ({
  tabs: [],
  activeTabId: null,

  openTab: (filePath, fileName, format) => {
    // Check if file is already open
    if (filePath) {
      const existing = get().tabs.find((t) => t.filePath === filePath)
      if (existing) {
        set({ activeTabId: existing.id })
        return existing.id
      }
    }

    const id = uuid()
    const tab: TabDescriptor = { id, filePath, fileName, format, isDirty: false }
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: id
    }))
    return id
  },

  closeTab: (id) =>
    set((state) => {
      const tabs = state.tabs.filter((t) => t.id !== id)
      let activeTabId = state.activeTabId
      if (activeTabId === id) {
        // Activate the next tab, or the previous, or null
        const closedIndex = state.tabs.findIndex((t) => t.id === id)
        if (tabs.length > 0) {
          activeTabId = tabs[Math.min(closedIndex, tabs.length - 1)].id
        } else {
          activeTabId = null
        }
      }
      return { tabs, activeTabId }
    }),

  setActiveTab: (id) => set({ activeTabId: id }),

  setTabDirty: (id, dirty) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, isDirty: dirty } : t))
    })),

  setTabFilePath: (id, path, name) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, filePath: path, fileName: name } : t))
    })),

  reorderTabs: (fromIndex, toIndex) =>
    set((state) => {
      const tabs = [...state.tabs]
      const [moved] = tabs.splice(fromIndex, 1)
      tabs.splice(toIndex, 0, moved)
      return { tabs }
    })
}))
