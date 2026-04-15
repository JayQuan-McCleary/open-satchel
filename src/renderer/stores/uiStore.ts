import { create } from 'zustand'
import type { UIState, Tool, DrawingOptions, TextOptions } from '../types/pdf'

interface UIActions {
  setCurrentPage: (page: number) => void
  setZoom: (zoom: number) => void
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
  setTool: (tool: Tool) => void
  toggleSidebar: () => void
  setDrawingOptions: (opts: Partial<DrawingOptions>) => void
  setTextOptions: (opts: Partial<TextOptions>) => void
  setHighlightColor: (color: string) => void
  setShapeColor: (color: string) => void
  setShapeStrokeWidth: (width: number) => void
  setNoteColor: (color: string) => void
  setSelectedStamp: (index: number) => void
  setInitials: (v: string) => void
  toggleSearch: () => void
  setSearchVisible: (v: boolean) => void
  toggleTheme: () => void
  toggleCommandPalette: () => void
  setCommandPaletteOpen: (v: boolean) => void
  openFind: () => void
  openReplace: () => void
  closeFindReplace: () => void
  setAutoSaveEnabled: (v: boolean) => void
  setAutoSaveInterval: (ms: number) => void
  setAutoSaveStatus: (s: 'idle' | 'saving' | 'saved') => void
  toggleAutoSave: () => void
}

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0]

export const useUIStore = create<UIState & UIActions>((set) => ({
  currentPage: 0,
  zoom: 1.0,
  tool: 'select',
  sidebarOpen: true,
  drawingOptions: { color: '#000000', width: 2, opacity: 1 },
  textOptions: {
    fontFamily: 'Helvetica',
    fontSize: 16,
    color: '#000000',
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    textAlign: 'left' as const,
    lineHeight: 1.2,
    charSpacing: 0
  },
  highlightColor: '#f9e2af',
  shapeColor: '#f38ba8',
  shapeStrokeWidth: 2,
  noteColor: '#f9e2af',
  selectedStamp: 0,
  initials: 'AB',
  searchVisible: false,
  theme: 'dark',
  commandPaletteOpen: false,
  findReplaceOpen: false,
  findReplaceMode: 'find',
  autoSaveEnabled: true,
  autoSaveInterval: 30000,
  autoSaveStatus: 'idle',

  setCurrentPage: (page) => set({ currentPage: page }),
  setZoom: (zoom) => set({ zoom: Math.max(0.25, Math.min(4.0, zoom)) }),
  zoomIn: () =>
    set((state) => {
      const next = ZOOM_STEPS.find((s) => s > state.zoom)
      return { zoom: next ?? state.zoom }
    }),
  zoomOut: () =>
    set((state) => {
      const prev = [...ZOOM_STEPS].reverse().find((s) => s < state.zoom)
      return { zoom: prev ?? state.zoom }
    }),
  resetZoom: () => set({ zoom: 1.0 }),
  setTool: (tool) => set({ tool }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setDrawingOptions: (opts) =>
    set((state) => ({ drawingOptions: { ...state.drawingOptions, ...opts } })),
  setTextOptions: (opts) =>
    set((state) => ({ textOptions: { ...state.textOptions, ...opts } })),
  setHighlightColor: (color) => set({ highlightColor: color }),
  setShapeColor: (color) => set({ shapeColor: color }),
  setShapeStrokeWidth: (width) => set({ shapeStrokeWidth: width }),
  setNoteColor: (color) => set({ noteColor: color }),
  setSelectedStamp: (index) => set({ selectedStamp: index }),
  setInitials: (v) => set({ initials: v }),
  toggleSearch: () => set((s) => ({ searchVisible: !s.searchVisible })),
  setSearchVisible: (v) => set({ searchVisible: v }),
  toggleTheme: () =>
    set((state) => {
      const next = state.theme === 'dark' ? 'light' : 'dark'
      document.documentElement.dataset.theme = next
      return { theme: next }
    }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  setCommandPaletteOpen: (v) => set({ commandPaletteOpen: v }),
  openFind: () => set({ findReplaceOpen: true, findReplaceMode: 'find' }),
  openReplace: () => set({ findReplaceOpen: true, findReplaceMode: 'replace' }),
  closeFindReplace: () => set({ findReplaceOpen: false }),
  setAutoSaveEnabled: (v) => set({ autoSaveEnabled: v }),
  setAutoSaveInterval: (ms) => set({ autoSaveInterval: ms }),
  setAutoSaveStatus: (s) => set({ autoSaveStatus: s }),
  toggleAutoSave: () => set((state) => ({ autoSaveEnabled: !state.autoSaveEnabled }))
}))
