import type { ComponentType } from 'react'
import type { DocumentFormat } from '../types/tabs'

export interface FormatViewerProps {
  tabId: string
}

export interface FormatHandler {
  format: DocumentFormat
  extensions: string[]
  displayName: string
  icon: string

  /** Main content viewer/editor component */
  Viewer: ComponentType<FormatViewerProps>

  /** Optional sidebar component (e.g., page thumbnails, TOC) */
  Sidebar?: ComponentType<FormatViewerProps>

  /** Optional extra toolbar items for this format */
  ToolbarExtras?: ComponentType<FormatViewerProps>

  /** Load file bytes into format-specific state in formatStore */
  load: (tabId: string, bytes: Uint8Array, filePath: string) => Promise<void>

  /** Serialize current state back to file bytes for saving */
  save: (tabId: string) => Promise<Uint8Array>

  /** Cleanup when tab is closed */
  cleanup?: (tabId: string) => void

  /** Formats this format can be converted to */
  canConvertTo: DocumentFormat[]

  /** What this format supports */
  capabilities: {
    edit: boolean
    annotate: boolean
    search: boolean
    zoom: boolean
  }
}
