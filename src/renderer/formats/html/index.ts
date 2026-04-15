import type { FormatHandler } from '../types'
import HtmlViewer from './HtmlViewer'
import { useFormatStore } from '../../stores/formatStore'

export interface HtmlFormatState {
  content: string
  originalContent: string
  viewMode: 'preview' | 'source' | 'split'
}

export const htmlHandler: FormatHandler = {
  format: 'html',
  extensions: ['html', 'htm'],
  displayName: 'HTML',
  icon: '🌐',
  Viewer: HtmlViewer,

  load: async (tabId, bytes) => {
    const content = new TextDecoder().decode(bytes)
    const state: HtmlFormatState = { content, originalContent: content, viewMode: 'split' }
    useFormatStore.getState().setFormatState(tabId, state)
  },

  save: async (tabId) => {
    const state = useFormatStore.getState().getFormatState<HtmlFormatState>(tabId)
    if (!state) throw new Error('No HTML state')
    return new TextEncoder().encode(state.content)
  },

  cleanup: (tabId) => useFormatStore.getState().clearFormatState(tabId),

  canConvertTo: ['pdf'],
  capabilities: { edit: true, annotate: false, search: true, zoom: false }
}
