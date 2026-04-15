import type { FormatHandler } from '../types'
import MarkdownEditor from './MarkdownEditor'
import MarkdownToolbar from './MarkdownToolbar'
import { useFormatStore } from '../../stores/formatStore'

export interface MarkdownFormatState {
  content: string
  originalContent: string
  viewMode: 'split' | 'edit' | 'preview'
}

export const markdownHandler: FormatHandler = {
  format: 'markdown',
  extensions: ['md', 'markdown', 'mdx'],
  displayName: 'Markdown',
  icon: '📑',
  Viewer: MarkdownEditor,
  ToolbarExtras: MarkdownToolbar,

  load: async (tabId, bytes) => {
    const content = new TextDecoder().decode(bytes)
    const state: MarkdownFormatState = { content, originalContent: content, viewMode: 'split' }
    useFormatStore.getState().setFormatState(tabId, state)
  },

  save: async (tabId) => {
    const state = useFormatStore.getState().getFormatState<MarkdownFormatState>(tabId)
    if (!state) throw new Error('No markdown state')
    return new TextEncoder().encode(state.content)
  },

  cleanup: (tabId) => useFormatStore.getState().clearFormatState(tabId),

  canConvertTo: ['pdf', 'html'],
  capabilities: { edit: true, annotate: false, search: true, zoom: false }
}
