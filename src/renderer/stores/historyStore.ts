import { create } from 'zustand'

interface HistoryEntry {
  pageIndex: number
  fabricJSON: Record<string, unknown>
}

interface HistoryState {
  undoStack: HistoryEntry[]
  redoStack: HistoryEntry[]
  pushUndo: (entry: HistoryEntry) => void
  undo: () => HistoryEntry | null
  redo: () => HistoryEntry | null
  clear: () => void
}

const MAX_HISTORY = 50

export const useHistoryStore = create<HistoryState>((set, get) => ({
  undoStack: [],
  redoStack: [],

  pushUndo: (entry) =>
    set((state) => ({
      undoStack: [...state.undoStack.slice(-MAX_HISTORY + 1), entry],
      redoStack: [] // Clear redo on new action
    })),

  undo: () => {
    const state = get()
    if (state.undoStack.length === 0) return null
    const entry = state.undoStack[state.undoStack.length - 1]
    set({
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, entry]
    })
    return entry
  },

  redo: () => {
    const state = get()
    if (state.redoStack.length === 0) return null
    const entry = state.redoStack[state.redoStack.length - 1]
    set({
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, entry]
    })
    return entry
  },

  clear: () => set({ undoStack: [], redoStack: [] })
}))
