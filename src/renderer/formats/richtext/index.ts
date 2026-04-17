// Rich text formats: RTF, FB2 — convert to HTML and edit with TipTap.

import type { FormatHandler } from '../types'
import RichTextViewer from './RichTextViewer'
import { useFormatStore } from '../../stores/formatStore'

export interface RichTextFormatState {
  html: string
  originalHtml: string
  sourceType: 'rtf' | 'fb2'
  rawContent: string  // original RTF/XML string for re-save
}

// Minimal RTF → HTML converter (handles basic formatting: bold, italic, underline, paragraphs)
function rtfToHtml(rtf: string): string {
  let html = rtf

  // Strip RTF header/font table/color table (approximate)
  html = html.replace(/\{\\fonttbl[^}]*(?:\{[^}]*\}[^}]*)*\}/g, '')
  html = html.replace(/\{\\colortbl[^}]*\}/g, '')
  html = html.replace(/\{\\stylesheet[^}]*(?:\{[^}]*\}[^}]*)*\}/g, '')
  html = html.replace(/\{\\\*\\[^}]*\}/g, '')

  // Formatting commands
  const replacements: [RegExp, string][] = [
    [/\\par\b/g, '</p><p>'],
    [/\\line\b/g, '<br>'],
    [/\\b\s/g, '<b>'],  [/\\b0/g, '</b>'],
    [/\\i\s/g, '<i>'],  [/\\i0/g, '</i>'],
    [/\\ul\s/g, '<u>'], [/\\ulnone/g, '</u>'],
    [/\\'([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))],
  ]
  for (const [re, rep] of replacements) {
    html = html.replace(re, rep as any)
  }

  // Remove remaining control words and braces
  html = html.replace(/\\[a-zA-Z]+-?\d*\s?/g, '')
  html = html.replace(/[{}]/g, '')
  html = html.trim()
  if (!html.startsWith('<p>')) html = '<p>' + html
  if (!html.endsWith('</p>')) html = html + '</p>'
  return html
}

// Basic HTML → RTF converter
function htmlToRtf(html: string): string {
  let rtf = '{\\rtf1\\ansi\\deff0\n'
  // Strip HTML tags, keep basic formatting
  let body = html
    .replace(/<p[^>]*>/gi, '\\par\n')
    .replace(/<\/p>/gi, '')
    .replace(/<br[^>]*>/gi, '\\line\n')
    .replace(/<b[^>]*>/gi, '{\\b ')
    .replace(/<\/b>/gi, '}')
    .replace(/<strong[^>]*>/gi, '{\\b ')
    .replace(/<\/strong>/gi, '}')
    .replace(/<i[^>]*>/gi, '{\\i ')
    .replace(/<\/i>/gi, '}')
    .replace(/<em[^>]*>/gi, '{\\i ')
    .replace(/<\/em>/gi, '}')
    .replace(/<u[^>]*>/gi, '{\\ul ')
    .replace(/<\/u>/gi, '}')
    .replace(/<[^>]+>/g, '')  // strip remaining tags

  rtf += body + '\n}'
  return rtf
}

// FictionBook (.fb2) — XML with structure similar to epub
async function fb2ToHtml(xml: string): Promise<string> {
  const { XMLParser } = await import('fast-xml-parser')
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' })
  try {
    const doc = parser.parse(xml)
    const book = doc.FictionBook || doc.fictionbook
    if (!book) return '<p>Could not parse FB2</p>'
    const body = book.body
    if (!body) return '<p>No body found</p>'

    const renderNode = (node: any): string => {
      if (typeof node === 'string') return escapeHtml(node)
      if (Array.isArray(node)) return node.map(renderNode).join('')
      if (!node || typeof node !== 'object') return String(node ?? '')

      let html = ''
      for (const [key, value] of Object.entries(node)) {
        if (key.startsWith('@') || key.startsWith('#')) continue
        const content = renderNode(value)
        switch (key) {
          case 'title': html += `<h2>${content}</h2>`; break
          case 'p': html += `<p>${content}</p>`; break
          case 'section': html += `<section>${content}</section>`; break
          case 'emphasis': html += `<em>${content}</em>`; break
          case 'strong': html += `<strong>${content}</strong>`; break
          case 'subtitle': html += `<h3>${content}</h3>`; break
          default: html += content
        }
      }
      if (node['#text']) html += escapeHtml(node['#text'])
      return html
    }

    return renderNode(body)
  } catch (err) {
    return `<p style="color:red">FB2 parse error: ${(err as Error).message}</p>`
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export const rtfHandler: FormatHandler = {
  format: 'rtf',
  extensions: ['rtf'],
  displayName: 'Rich Text',
  icon: '📃',
  Viewer: RichTextViewer,

  load: async (tabId, bytes, _filePath) => {
    const rawContent = new TextDecoder().decode(bytes)
    const html = rtfToHtml(rawContent)
    const state: RichTextFormatState = { html, originalHtml: html, sourceType: 'rtf', rawContent }
    useFormatStore.getState().setFormatState(tabId, state)
  },

  save: async (tabId) => {
    const state = useFormatStore.getState().getFormatState<RichTextFormatState>(tabId)
    if (!state) throw new Error('No state')
    return new TextEncoder().encode(htmlToRtf(state.html))
  },

  cleanup: (tabId) => useFormatStore.getState().clearFormatState(tabId),
  canConvertTo: ['pdf', 'html'],
  capabilities: { edit: true, annotate: false, search: true, zoom: false }
}

export const fb2Handler: FormatHandler = {
  format: 'fb2',
  extensions: ['fb2'],
  displayName: 'FictionBook',
  icon: '📖',
  Viewer: RichTextViewer,

  load: async (tabId, bytes, _filePath) => {
    const rawContent = new TextDecoder().decode(bytes)
    const html = await fb2ToHtml(rawContent)
    const state: RichTextFormatState = { html, originalHtml: html, sourceType: 'fb2', rawContent }
    useFormatStore.getState().setFormatState(tabId, state)
  },

  save: async (tabId) => {
    const state = useFormatStore.getState().getFormatState<RichTextFormatState>(tabId)
    if (!state) throw new Error('No state')
    // FB2 save: for now, wrap the HTML in a minimal FB2 structure
    const fb2 = `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description><title-info><book-title>Edited</book-title></title-info></description>
  <body>${state.html}</body>
</FictionBook>`
    return new TextEncoder().encode(fb2)
  },

  cleanup: (tabId) => useFormatStore.getState().clearFormatState(tabId),
  canConvertTo: ['pdf', 'html'],
  capabilities: { edit: true, annotate: false, search: true, zoom: false }
}
