import { create } from 'zustand'

// Generic per-tab undo/redo stack. Handlers push snapshots of their format
// state; undo/redo restore them. Pages/annotations/text edits all route
// through here.
//
// Kept minimal for M1. Individual handlers can wrap it with coalescing
// (e.g. debounce keystroke snapshots) if they need finer-grained control.

interface HistoryEntry<T = unknown> {
  label: string
  state: T
  timestamp: number
}

interface HistoryPerTab {
  past: HistoryEntry[]
  future: HistoryEntry[]
}

interface HistoryStoreState {
  byTab: Record<string, HistoryPerTab>

  push: <T>(tabId: string, label: string, state: T) => void
  undo: <T>(tabId: string) => T | undefined
  redo: <T>(tabId: string) => T | undefined
  canUndo: (tabId: string) => boolean
  canRedo: (tabId: string) => boolean
  clear: (tabId: string) => void
}

const MAX_HISTORY = 100

export const useHistoryStore = create<HistoryStoreState>((set, get) => ({
  byTab: {},

  push: (tabId, label, state) =>
    set((s) => {
      const current = s.byTab[tabId] ?? { past: [], future: [] }
      const past = [...current.past, { label, state, timestamp: Date.now() }]
      if (past.length > MAX_HISTORY) past.shift()
      return {
        byTab: { ...s.byTab, [tabId]: { past, future: [] } },
      }
    }),

  undo: <T,>(tabId: string): T | undefined => {
    const current = get().byTab[tabId]
    if (!current || current.past.length < 2) return undefined
    // `past` holds snapshots including the current one; undoing moves the
    // latest to `future` and returns the previous.
    const popped = current.past[current.past.length - 1]
    const prev = current.past[current.past.length - 2]
    const past = current.past.slice(0, -1)
    const future = [popped, ...current.future]
    set((s) => ({ byTab: { ...s.byTab, [tabId]: { past, future } } }))
    return prev.state as T
  },

  redo: <T,>(tabId: string): T | undefined => {
    const current = get().byTab[tabId]
    if (!current || current.future.length === 0) return undefined
    const [next, ...rest] = current.future
    const past = [...current.past, next]
    set((s) => ({ byTab: { ...s.byTab, [tabId]: { past, future: rest } } }))
    return next.state as T
  },

  canUndo: (tabId) => (get().byTab[tabId]?.past.length ?? 0) >= 2,
  canRedo: (tabId) => (get().byTab[tabId]?.future.length ?? 0) > 0,

  clear: (tabId) =>
    set((s) => {
      const { [tabId]: _dropped, ...rest } = s.byTab
      return { byTab: rest }
    }),
}))
