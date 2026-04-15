import type { Editor } from '@tiptap/react'

// Module-level registry to share TipTap editor instances between
// DocxEditor (Viewer) and DocxToolbar (ToolbarExtras) by tabId.
export const editorRegistry = new Map<string, Editor>()
