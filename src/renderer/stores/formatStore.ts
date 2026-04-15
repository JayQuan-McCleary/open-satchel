import { create } from 'zustand'

// Generic per-tab format-specific state store
// Each format handler stores its own state shape here, keyed by tabId

interface FormatStoreState {
  data: Record<string, unknown>
  setFormatState: (tabId: string, state: unknown) => void
  getFormatState: <T>(tabId: string) => T | undefined
  updateFormatState: <T>(tabId: string, updater: (prev: T) => T) => void
  clearFormatState: (tabId: string) => void
}

export const useFormatStore = create<FormatStoreState>((set, get) => ({
  data: {},

  setFormatState: (tabId, state) =>
    set((s) => ({ data: { ...s.data, [tabId]: state } })),

  getFormatState: <T>(tabId: string): T | undefined =>
    get().data[tabId] as T | undefined,

  updateFormatState: <T>(tabId: string, updater: (prev: T) => T) =>
    set((s) => {
      const prev = s.data[tabId] as T
      if (prev === undefined) return s
      return { data: { ...s.data, [tabId]: updater(prev) } }
    }),

  clearFormatState: (tabId) =>
    set((s) => {
      const { [tabId]: _, ...rest } = s.data
      return { data: rest }
    })
}))
