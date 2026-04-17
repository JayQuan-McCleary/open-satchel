// Text-based format handlers: JSON, YAML, TOML, XML, LOG, DIFF, INI, BIB, LaTeX.
// All reuse the CodeEditor component with language-specific parsing for validation.

import type { FormatHandler } from '../types'
import CodeEditor from '../code/CodeEditor'
import TextFormatViewer from './TextFormatViewer'
import { useFormatStore } from '../../stores/formatStore'

export interface TextFormatState {
  content: string
  language: string
  originalContent: string
  /** Optional parsed structure for viewers that render trees/tables */
  parsed?: unknown
  /** Any parse errors to surface to the user */
  parseError?: string
}

function makeHandler(
  format: string,
  displayName: string,
  icon: string,
  extensions: string[],
  language: string,
  parse?: (content: string) => unknown
): FormatHandler {
  return {
    format: format as any,
    extensions,
    displayName,
    icon,
    Viewer: parse ? TextFormatViewer : CodeEditor,
    load: async (tabId, bytes, _filePath) => {
      const content = new TextDecoder().decode(bytes)
      let parsed: unknown
      let parseError: string | undefined
      if (parse) {
        try { parsed = parse(content) } catch (err) { parseError = (err as Error).message }
      }
      const state: TextFormatState = { content, language, originalContent: content, parsed, parseError }
      useFormatStore.getState().setFormatState(tabId, state)
    },
    save: async (tabId) => {
      const state = useFormatStore.getState().getFormatState<TextFormatState>(tabId)
      if (!state) throw new Error('No state')
      return new TextEncoder().encode(state.content)
    },
    cleanup: (tabId) => useFormatStore.getState().clearFormatState(tabId),
    canConvertTo: ['pdf'],
    capabilities: { edit: true, annotate: false, search: true, zoom: false }
  }
}

// JSON: also handles JSONC, JSON5, JSONL
export const jsonHandler: FormatHandler = makeHandler(
  'json', 'JSON', '{}', ['json', 'jsonc', 'json5', 'jsonl', 'ndjson'], 'json',
  (content) => {
    // Try regular JSON first
    try { return JSON.parse(content) }
    catch {
      // Try JSONL (one JSON per line)
      const lines = content.split('\n').filter(l => l.trim())
      try { return lines.map(l => JSON.parse(l)) }
      catch (err) { throw err }
    }
  }
)

// YAML (async-loaded; parsed on open and on edit)
import jsYaml from 'js-yaml'
import tomlParser from '@iarna/toml'
import { XMLParser } from 'fast-xml-parser'

export const yamlHandler: FormatHandler = makeHandler(
  'yaml', 'YAML', '⚙', ['yaml', 'yml'], 'yaml',
  (content) => jsYaml.load(content)
)

// TOML
export const tomlHandler: FormatHandler = makeHandler(
  'toml', 'TOML', '⚙', ['toml'], 'toml',
  (content) => tomlParser.parse(content)
)

// XML
export const xmlHandler: FormatHandler = makeHandler(
  'xml', 'XML', '</>', ['xml'], 'xml',
  (content) => {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' })
    return parser.parse(content)
  }
)

// LOG — plain text viewer with regex filter (no parsing)
export const logHandler: FormatHandler = makeHandler(
  'log', 'Log File', '📜', ['log'], 'log'
)

// DIFF/PATCH — syntax highlighted (no parsing)
export const diffHandler: FormatHandler = makeHandler(
  'diff', 'Diff/Patch', '±', ['diff', 'patch'], 'diff'
)

// INI / ENV / CONF
export const iniHandler: FormatHandler = makeHandler(
  'ini', 'Config', '⚙', ['ini', 'env', 'conf'], 'ini',
  (content) => {
    // Simple key=value parser
    const result: Record<string, Record<string, string>> = { default: {} }
    let section = 'default'
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        section = trimmed.slice(1, -1)
        if (!result[section]) result[section] = {}
        continue
      }
      const eq = trimmed.indexOf('=')
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim()
        const val = trimmed.slice(eq + 1).trim()
        result[section][key] = val
      }
    }
    return result
  }
)

// BIB — BibTeX citation manager
export const bibHandler: FormatHandler = makeHandler(
  'bib', 'BibTeX', '📚', ['bib', 'bibtex'], 'bibtex',
  (content) => {
    // Simple BibTeX entry parser
    const entries: Array<{ type: string; key: string; fields: Record<string, string> }> = []
    const regex = /@(\w+)\s*\{\s*([^,]+),([\s\S]*?)\n\}/g
    let match
    while ((match = regex.exec(content)) !== null) {
      const [, type, key, body] = match
      const fields: Record<string, string> = {}
      const fieldRegex = /(\w+)\s*=\s*[{"]([^}"]*)[}"]/g
      let fm
      while ((fm = fieldRegex.exec(body)) !== null) {
        fields[fm[1]] = fm[2]
      }
      entries.push({ type, key: key.trim(), fields })
    }
    return entries
  }
)

// LaTeX (.tex)
export const texHandler: FormatHandler = makeHandler(
  'tex', 'LaTeX', 'ƒ', ['tex', 'latex', 'ltx'], 'latex'
)
