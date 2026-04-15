import type { FormatHandler } from '../types'
import CodeEditor from './CodeEditor'
import { useFormatStore } from '../../stores/formatStore'

export interface CodeFormatState {
  content: string
  language: string
  originalContent: string
}

const LANG_MAP: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', ts: 'javascript', tsx: 'javascript',
  py: 'python', rb: 'python',
  json: 'json', jsonc: 'json',
  html: 'html', htm: 'html', xml: 'html', svg: 'html',
  css: 'css', scss: 'css', less: 'css',
  md: 'markdown', markdown: 'markdown',
  yaml: 'yaml', yml: 'yaml', toml: 'yaml',
  sql: 'sql',
  sh: 'shell', bash: 'shell', zsh: 'shell',
}

export const codeHandler: FormatHandler = {
  format: 'code',
  extensions: [
    'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h',
    'cs', 'php', 'swift', 'kt', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'r', 'lua',
    'yaml', 'yml', 'toml', 'ini', 'xml', 'json', 'jsonc', 'css', 'scss', 'less',
    'vue', 'svelte', 'dockerfile', 'makefile', 'env', 'gitignore', 'bat', 'cmd'
  ],
  displayName: 'Code',
  icon: '💻',
  Viewer: CodeEditor,

  load: async (tabId, bytes, filePath) => {
    const content = new TextDecoder().decode(bytes)
    const ext = filePath.split('.').pop()?.toLowerCase() || ''
    const language = LANG_MAP[ext] || 'plaintext'

    const state: CodeFormatState = { content, language, originalContent: content }
    useFormatStore.getState().setFormatState(tabId, state)
  },

  save: async (tabId) => {
    const state = useFormatStore.getState().getFormatState<CodeFormatState>(tabId)
    if (!state) throw new Error('No code state')
    return new TextEncoder().encode(state.content)
  },

  cleanup: (tabId) => useFormatStore.getState().clearFormatState(tabId),

  canConvertTo: ['pdf'],
  capabilities: { edit: true, annotate: false, search: true, zoom: false }
}

export const plaintextHandler: FormatHandler = {
  ...codeHandler,
  format: 'plaintext',
  extensions: ['txt', 'log', 'cfg', 'conf', 'properties'],
  displayName: 'Plain Text',
  icon: '📝',

  load: async (tabId, bytes, _filePath) => {
    const content = new TextDecoder().decode(bytes)
    const state: CodeFormatState = { content, language: 'plaintext', originalContent: content }
    useFormatStore.getState().setFormatState(tabId, state)
  }
}
