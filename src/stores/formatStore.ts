import { create } from 'zustand'

// Per-tab format-specific state. Each format handler owns the shape of its
// own slice; we keep it untyped here to avoid a giant union. Handlers use
// `getFormatState<MyState>(tabId)` to get back a typed view.
//
// This matches the Electron-era pattern so porting handlers is mechanical.

interface FormatStoreState {
  data: Record<string, unknown>
  setFormatState: <T = unknown>(tabId: string, state: T) => void
  getFormatState: <T>(tabId: string) => T | undefined
  updateFormatState: <T>(tabId: string, updater: (prev: T) => T) => void
  clearFormatState: (tabId: string) => void
}

export const useFormatStore = create<FormatStoreState>((set, get) => ({
  data: {},

  setFormatState: (tabId, state) =>
    set((s) => ({ data: { ...s.data, [tabId]: state } })),

  getFormatState: <T,>(tabId: string): T | undefined =>
    get().data[tabId] as T | undefined,

  updateFormatState: <T,>(tabId: string, updater: (prev: T) => T) =>
    set((s) => {
      const prev = s.data[tabId] as T | undefined
      if (prev === undefined) return s
      return { data: { ...s.data, [tabId]: updater(prev) } }
    }),

  clearFormatState: (tabId) =>
    set((s) => {
      const { [tabId]: _dropped, ...rest } = s.data
      return { data: rest }
    }),
}))
