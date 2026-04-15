import { useCallback, useRef, useEffect, useMemo } from 'react'
import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import { useTabStore } from '../../stores/tabStore'
import type { MarkdownFormatState } from './index'

/* ────────────────────────────── Markdown → HTML ────────────────────────────── */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function parseMarkdownToHtml(md: string): string {
  // Pre-process: normalise line endings
  let src = md.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // ── Fenced code blocks (``` … ```) ──
  src = src.replace(/^```(\w*)\n([\s\S]*?)^```/gm, (_m, lang: string, code: string) => {
    const cls = lang ? ` class="language-${escapeHtml(lang)}"` : ''
    return `<pre class="md-code-block"><code${cls}>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`
  })

  // ── Inline code (protect from further processing) ──
  const inlineCodeMap: string[] = []
  src = src.replace(/`([^`\n]+?)`/g, (_m, code: string) => {
    const idx = inlineCodeMap.length
    inlineCodeMap.push(`<code class="md-inline-code">${escapeHtml(code)}</code>`)
    return `\x00IC${idx}\x00`
  })

  // ── Images ──
  src = src.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_m, alt: string, url: string, title: string) => {
    const t = title ? ` title="${escapeHtml(title)}"` : ''
    return `<img class="md-image" src="${escapeHtml(url)}" alt="${escapeHtml(alt)}"${t} />`
  })

  // ── Links ──
  src = src.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_m, text: string, url: string, title: string) => {
    const t = title ? ` title="${escapeHtml(title)}"` : ''
    return `<a class="md-link" href="${escapeHtml(url)}"${t}>${text}</a>`
  })

  // ── Horizontal rules ──
  src = src.replace(/^(?:---|\*\*\*|___)\s*$/gm, '<hr class="md-hr" />')

  // ── Tables ──
  src = src.replace(/^(\|.+\|)\n(\|[\s:|-]+\|)\n((?:\|.+\|\n?)+)/gm, (_m, headerRow: string, _sep: string, bodyRows: string) => {
    const parseRow = (row: string) =>
      row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
    const headers = parseRow(headerRow)
    const rows = bodyRows.trim().split('\n').map(parseRow)
    let html = '<table class="md-table"><thead><tr>'
    for (const h of headers) html += `<th>${inlineFormat(h)}</th>`
    html += '</tr></thead><tbody>'
    for (const row of rows) {
      html += '<tr>'
      for (const cell of row) html += `<td>${inlineFormat(cell)}</td>`
      html += '</tr>'
    }
    html += '</tbody></table>'
    return html
  })

  // Split into lines for block-level processing
  const lines = src.split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Already processed blocks (pre, table, hr, img that takes full line)
    if (line.startsWith('<pre ') || line.startsWith('<table ') || line.startsWith('<hr ')) {
      out.push(line)
      i++
      continue
    }

    // ── Headers ──
    const hMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (hMatch) {
      const level = hMatch[1].length
      out.push(`<h${level} class="md-h${level}">${inlineFormat(hMatch[2])}</h${level}>`)
      i++
      continue
    }

    // ── Blockquotes ──
    if (line.match(/^>\s?/)) {
      const bqLines: string[] = []
      while (i < lines.length && lines[i].match(/^>\s?/)) {
        bqLines.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      out.push(`<blockquote class="md-blockquote">${parseMarkdownToHtml(bqLines.join('\n'))}</blockquote>`)
      continue
    }

    // ── Task lists ──
    if (line.match(/^(\s*)[-*]\s+\[[ xX]\]\s/)) {
      const items: string[] = []
      while (i < lines.length && lines[i].match(/^(\s*)[-*]\s+\[[ xX]\]\s/)) {
        const m = lines[i].match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/)
        if (m) {
          const checked = m[2] !== ' '
          items.push(
            `<li class="md-task-item"><input type="checkbox" disabled ${checked ? 'checked' : ''} /><span>${inlineFormat(m[3])}</span></li>`
          )
        }
        i++
      }
      out.push(`<ul class="md-task-list">${items.join('')}</ul>`)
      continue
    }

    // ── Unordered lists ──
    if (line.match(/^(\s*)[-*+]\s+/)) {
      const items: string[] = []
      while (i < lines.length && lines[i].match(/^(\s*)[-*+]\s+/)) {
        const m = lines[i].match(/^(\s*)[-*+]\s+(.*)$/)
        if (m) items.push(`<li>${inlineFormat(m[2])}</li>`)
        i++
      }
      out.push(`<ul class="md-ul">${items.join('')}</ul>`)
      continue
    }

    // ── Ordered lists ──
    if (line.match(/^(\s*)\d+\.\s+/)) {
      const items: string[] = []
      while (i < lines.length && lines[i].match(/^(\s*)\d+\.\s+/)) {
        const m = lines[i].match(/^(\s*)\d+\.\s+(.*)$/)
        if (m) items.push(`<li>${inlineFormat(m[2])}</li>`)
        i++
      }
      out.push(`<ol class="md-ol">${items.join('')}</ol>`)
      continue
    }

    // ── Blank line ──
    if (line.trim() === '') {
      i++
      continue
    }

    // ── Paragraph ──
    const pLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].match(/^>\s?/) &&
      !lines[i].match(/^[-*+]\s+/) &&
      !lines[i].match(/^\d+\.\s+/) &&
      !lines[i].startsWith('<pre ') &&
      !lines[i].startsWith('<table ') &&
      !lines[i].startsWith('<hr ') &&
      !lines[i].match(/^(?:---|\*\*\*|___)\s*$/)
    ) {
      pLines.push(lines[i])
      i++
    }
    if (pLines.length > 0) {
      out.push(`<p class="md-p">${inlineFormat(pLines.join('<br />'))}</p>`)
    }
  }

  // Restore inline codes
  let result = out.join('\n')
  result = result.replace(/\x00IC(\d+)\x00/g, (_m, idx: string) => inlineCodeMap[parseInt(idx)])
  return result
}

function inlineFormat(s: string): string {
  return s
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/___(.+?)___/g, '<strong><em>$1</em></strong>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    // Strikethrough
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
}

/* ──────────────────────────── Toolbar helpers ──────────────────────────── */

type WrapAction =
  | { type: 'wrap'; before: string; after: string }
  | { type: 'line-prefix'; prefix: string }
  | { type: 'insert'; text: string }

const TOOLBAR_ACTIONS: Record<string, WrapAction> = {
  bold: { type: 'wrap', before: '**', after: '**' },
  italic: { type: 'wrap', before: '*', after: '*' },
  strikethrough: { type: 'wrap', before: '~~', after: '~~' },
  code: { type: 'wrap', before: '`', after: '`' },
  link: { type: 'wrap', before: '[', after: '](url)' },
  image: { type: 'insert', text: '![alt](url)' },
  codeblock: { type: 'insert', text: '\n```\n\n```\n' },
  blockquote: { type: 'line-prefix', prefix: '> ' },
  ul: { type: 'line-prefix', prefix: '- ' },
  ol: { type: 'line-prefix', prefix: '1. ' },
  task: { type: 'line-prefix', prefix: '- [ ] ' },
  hr: { type: 'insert', text: '\n---\n' },
  table: {
    type: 'insert',
    text: '\n| Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n| Cell 1 | Cell 2 | Cell 3 |\n| Cell 4 | Cell 5 | Cell 6 |\n| Cell 7 | Cell 8 | Cell 9 |\n',
  },
  h1: { type: 'line-prefix', prefix: '# ' },
  h2: { type: 'line-prefix', prefix: '## ' },
  h3: { type: 'line-prefix', prefix: '### ' },
  h4: { type: 'line-prefix', prefix: '#### ' },
  h5: { type: 'line-prefix', prefix: '##### ' },
  h6: { type: 'line-prefix', prefix: '###### ' },
}

function applyToolbarAction(
  textarea: HTMLTextAreaElement,
  actionKey: string,
  onChange: (v: string) => void
) {
  const action = TOOLBAR_ACTIONS[actionKey]
  if (!action) return
  const { selectionStart: s, selectionEnd: e, value } = textarea

  let newValue: string
  let newCursorStart: number
  let newCursorEnd: number

  if (action.type === 'wrap') {
    const sel = value.substring(s, e)
    const wrapped = action.before + (sel || 'text') + action.after
    newValue = value.substring(0, s) + wrapped + value.substring(e)
    newCursorStart = s + action.before.length
    newCursorEnd = newCursorStart + (sel || 'text').length
  } else if (action.type === 'line-prefix') {
    // Find the start of the current line
    const lineStart = value.lastIndexOf('\n', s - 1) + 1
    // Remove existing heading prefixes if applying a heading
    let lineEnd = value.indexOf('\n', s)
    if (lineEnd === -1) lineEnd = value.length
    const currentLine = value.substring(lineStart, lineEnd)
    const stripped = currentLine.replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '').replace(/^>\s*/, '').replace(/^- \[[ xX]\]\s+/, '')
    const newLine = action.prefix + stripped
    newValue = value.substring(0, lineStart) + newLine + value.substring(lineEnd)
    newCursorStart = lineStart + action.prefix.length
    newCursorEnd = lineStart + newLine.length
  } else {
    newValue = value.substring(0, s) + action.text + value.substring(e)
    newCursorStart = s + action.text.length
    newCursorEnd = newCursorStart
  }

  onChange(newValue)
  requestAnimationFrame(() => {
    textarea.focus()
    textarea.setSelectionRange(newCursorStart, newCursorEnd)
  })
}

/* ──────────────────────── Auto-close pairs ──────────────────────── */

const PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '`': '`',
  '"': '"',
  "'": "'",
}

/* ──────────────────────────── Preview CSS ──────────────────────────── */

const previewStyles = `
.md-preview {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: var(--text-primary, #cdd6f4);
  line-height: 1.75;
  font-size: 15px;
  max-width: 860px;
}
.md-preview h1, .md-preview h2, .md-preview h3,
.md-preview h4, .md-preview h5, .md-preview h6 {
  margin: 1.4em 0 0.6em; font-weight: 600; line-height: 1.3;
  color: var(--text-primary, #cdd6f4);
}
.md-preview .md-h1 { font-size: 2em; border-bottom: 1px solid var(--border, #45475a); padding-bottom: 0.3em; }
.md-preview .md-h2 { font-size: 1.55em; border-bottom: 1px solid var(--border, #45475a); padding-bottom: 0.25em; }
.md-preview .md-h3 { font-size: 1.3em; }
.md-preview .md-h4 { font-size: 1.12em; }
.md-preview .md-h5 { font-size: 1em; }
.md-preview .md-h6 { font-size: 0.9em; color: var(--text-secondary, #a6adc8); }
.md-preview .md-p { margin: 0.8em 0; }
.md-preview strong { font-weight: 700; color: var(--text-primary, #cdd6f4); }
.md-preview em { font-style: italic; }
.md-preview del { text-decoration: line-through; color: var(--text-muted, #6c7086); }
.md-preview a, .md-preview .md-link {
  color: var(--accent, #89b4fa); text-decoration: none;
}
.md-preview a:hover { text-decoration: underline; }
.md-preview .md-inline-code {
  background: var(--bg-surface, #313244);
  padding: 2px 6px; border-radius: 4px;
  font-family: "Cascadia Code", "Fira Code", Consolas, monospace;
  font-size: 0.88em;
  color: #f38ba8;
}
.md-preview .md-code-block {
  background: #11111b; border-radius: 6px;
  padding: 16px 18px; margin: 1em 0;
  overflow-x: auto; font-size: 13px; line-height: 1.6;
  border: 1px solid var(--border, #45475a);
}
.md-preview .md-code-block code {
  font-family: "Cascadia Code", "Fira Code", Consolas, monospace;
  color: #cdd6f4; background: none; padding: 0;
}
.md-preview .md-blockquote {
  border-left: 4px solid var(--accent, #89b4fa);
  padding: 4px 16px; margin: 1em 0;
  color: var(--text-secondary, #a6adc8);
  background: rgba(137, 180, 250, 0.04);
  border-radius: 0 4px 4px 0;
}
.md-preview .md-blockquote p { margin: 0.3em 0; }
.md-preview .md-ul, .md-preview .md-ol {
  padding-left: 24px; margin: 0.6em 0;
}
.md-preview .md-ul li, .md-preview .md-ol li {
  margin: 0.25em 0; line-height: 1.65;
}
.md-preview .md-task-list {
  list-style: none; padding-left: 4px; margin: 0.6em 0;
}
.md-preview .md-task-item {
  display: flex; align-items: baseline; gap: 8px; margin: 0.3em 0;
}
.md-preview .md-task-item input[type="checkbox"] {
  accent-color: var(--accent, #89b4fa);
  margin: 0; transform: translateY(1px);
}
.md-preview .md-hr {
  border: none; border-top: 1px solid var(--border, #45475a);
  margin: 1.8em 0;
}
.md-preview .md-table {
  border-collapse: collapse; width: 100%; margin: 1em 0;
  font-size: 14px;
}
.md-preview .md-table th, .md-preview .md-table td {
  border: 1px solid var(--border, #45475a);
  padding: 8px 12px; text-align: left;
}
.md-preview .md-table th {
  background: var(--bg-surface, #313244);
  font-weight: 600;
}
.md-preview .md-table tr:nth-child(even) td {
  background: rgba(49, 50, 68, 0.35);
}
.md-preview .md-image {
  max-width: 100%; border-radius: 6px; margin: 0.8em 0;
}
`

/* ────────────────────────────── Button defs ────────────────────────────── */

interface TBBtn { label: string; action: string; title: string }
interface TBSep { sep: true }
type TBItem = TBBtn | TBSep

const toolbarItems: TBItem[] = [
  { label: 'B', action: 'bold', title: 'Bold (Ctrl+B)' },
  { label: 'I', action: 'italic', title: 'Italic (Ctrl+I)' },
  { label: 'S', action: 'strikethrough', title: 'Strikethrough' },
  { sep: true },
  { label: 'H1', action: 'h1', title: 'Heading 1' },
  { label: 'H2', action: 'h2', title: 'Heading 2' },
  { label: 'H3', action: 'h3', title: 'Heading 3' },
  { label: 'H4', action: 'h4', title: 'Heading 4' },
  { label: 'H5', action: 'h5', title: 'Heading 5' },
  { label: 'H6', action: 'h6', title: 'Heading 6' },
  { sep: true },
  { label: '\u2022', action: 'ul', title: 'Bullet List' },
  { label: '1.', action: 'ol', title: 'Numbered List' },
  { label: '\u2611', action: 'task', title: 'Task List' },
  { sep: true },
  { label: '\uD83D\uDD17', action: 'link', title: 'Link (Ctrl+K)' },
  { label: '\uD83D\uDDBC', action: 'image', title: 'Image' },
  { sep: true },
  { label: '<>', action: 'code', title: 'Inline Code' },
  { label: '{ }', action: 'codeblock', title: 'Code Block' },
  { label: '\u201C', action: 'blockquote', title: 'Blockquote' },
  { label: '\u2014', action: 'hr', title: 'Horizontal Rule' },
  { label: '\u25A6', action: 'table', title: 'Table (3x3)' },
]

/* ──────────────────────────── Btn style ──────────────────────────── */
const btnBase: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: 11,
  borderRadius: 3,
  background: 'var(--bg-surface)',
  color: 'var(--text-secondary)',
  border: '1px solid transparent',
  cursor: 'pointer',
  lineHeight: '18px',
  fontFamily: 'inherit',
  minWidth: 22,
  textAlign: 'center',
}

/* ──────────────────────────────── Component ──────────────────────────────── */

export default function MarkdownEditor({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as MarkdownFormatState | undefined)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const lineNumRef = useRef<HTMLDivElement>(null)
  const scrollSyncRef = useRef(false)

  const handleChange = useCallback(
    (newContent: string) => {
      useFormatStore.getState().updateFormatState<MarkdownFormatState>(tabId, (prev) => ({
        ...prev,
        content: newContent,
      }))
      useTabStore.getState().setTabDirty(tabId, true)
    },
    [tabId]
  )

  const toggleMode = useCallback(() => {
    useFormatStore.getState().updateFormatState<MarkdownFormatState>(tabId, (prev) => ({
      ...prev,
      viewMode: prev.viewMode === 'split' ? 'edit' : prev.viewMode === 'edit' ? 'preview' : 'split',
    }))
  }, [tabId])

  /* ── Scroll sync ── */
  const syncScroll = useCallback(
    (source: 'editor' | 'preview') => {
      if (scrollSyncRef.current) return
      scrollSyncRef.current = true
      requestAnimationFrame(() => {
        const ed = editorRef.current
        const pv = previewRef.current
        if (!ed || !pv) {
          scrollSyncRef.current = false
          return
        }
        if (source === 'editor') {
          const ratio = ed.scrollTop / (ed.scrollHeight - ed.clientHeight || 1)
          pv.scrollTop = ratio * (pv.scrollHeight - pv.clientHeight)
          if (lineNumRef.current) lineNumRef.current.scrollTop = ed.scrollTop
        } else {
          const ratio = pv.scrollTop / (pv.scrollHeight - pv.clientHeight || 1)
          ed.scrollTop = ratio * (ed.scrollHeight - ed.clientHeight)
          if (lineNumRef.current) lineNumRef.current.scrollTop = ed.scrollTop
        }
        scrollSyncRef.current = false
      })
    },
    []
  )

  /* ── Key handler ── */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const ta = editorRef.current
      if (!ta) return
      const { selectionStart: s, selectionEnd: end, value } = ta

      // Tab → 2 spaces
      if (e.key === 'Tab') {
        e.preventDefault()
        const newVal = value.substring(0, s) + '  ' + value.substring(end)
        handleChange(newVal)
        requestAnimationFrame(() => {
          ta.setSelectionRange(s + 2, s + 2)
        })
        return
      }

      // Enter → auto-indent & continue list prefixes
      if (e.key === 'Enter') {
        const lineStart = value.lastIndexOf('\n', s - 1) + 1
        const currentLine = value.substring(lineStart, s)
        const indentMatch = currentLine.match(/^(\s*)/)
        const indent = indentMatch ? indentMatch[1] : ''

        // Continue list prefixes
        const listMatch = currentLine.match(/^(\s*)([-*+]|\d+\.)\s(\[[ xX]\]\s)?/)
        if (listMatch) {
          // If the current list item is empty, remove the prefix
          const contentAfterPrefix = currentLine.substring(listMatch[0].length).trim()
          if (contentAfterPrefix === '') {
            e.preventDefault()
            const newVal = value.substring(0, lineStart) + '\n' + value.substring(end)
            handleChange(newVal)
            requestAnimationFrame(() => {
              ta.setSelectionRange(lineStart + 1, lineStart + 1)
            })
            return
          }
          e.preventDefault()
          let prefix = listMatch[2]
          // Increment number for ordered lists
          if (prefix.match(/^\d+\.$/)) {
            prefix = parseInt(prefix) + 1 + '.'
          }
          const checkbox = listMatch[3] ? '[ ] ' : ''
          const insert = '\n' + indent + prefix + ' ' + checkbox
          const newVal = value.substring(0, s) + insert + value.substring(end)
          handleChange(newVal)
          requestAnimationFrame(() => {
            ta.setSelectionRange(s + insert.length, s + insert.length)
          })
          return
        }

        // Plain auto-indent
        if (indent) {
          e.preventDefault()
          const insert = '\n' + indent
          const newVal = value.substring(0, s) + insert + value.substring(end)
          handleChange(newVal)
          requestAnimationFrame(() => {
            ta.setSelectionRange(s + insert.length, s + insert.length)
          })
          return
        }
      }

      // Auto-close pairs
      if (PAIRS[e.key] && s === end) {
        e.preventDefault()
        const open = e.key
        const close = PAIRS[open]
        const newVal = value.substring(0, s) + open + close + value.substring(end)
        handleChange(newVal)
        requestAnimationFrame(() => {
          ta.setSelectionRange(s + 1, s + 1)
        })
        return
      }

      // Ctrl+B, Ctrl+I, Ctrl+K shortcuts
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        const key = e.key.toLowerCase()
        if (key === 'b') {
          e.preventDefault()
          applyToolbarAction(ta, 'bold', handleChange)
          return
        }
        if (key === 'i') {
          e.preventDefault()
          applyToolbarAction(ta, 'italic', handleChange)
          return
        }
        if (key === 'k') {
          e.preventDefault()
          applyToolbarAction(ta, 'link', handleChange)
          return
        }
      }
    },
    [handleChange]
  )

  /* ── Line numbers ── */
  const lineCount = useMemo(() => {
    if (!state) return 0
    return state.content.split('\n').length
  }, [state?.content])

  /* ── Word count & reading time ── */
  const { wordCount, readingTime } = useMemo(() => {
    if (!state) return { wordCount: 0, readingTime: '0 min' }
    const words = state.content.trim().split(/\s+/).filter(Boolean).length
    const mins = Math.max(1, Math.ceil(words / 238))
    return { wordCount: words, readingTime: `${mins} min read` }
  }, [state?.content])

  /* ── Preview HTML ── */
  const previewHtml = useMemo(() => {
    if (!state) return ''
    return parseMarkdownToHtml(state.content)
  }, [state?.content])

  /* ── Sync line numbers scroll ── */
  useEffect(() => {
    const ed = editorRef.current
    const ln = lineNumRef.current
    if (!ed || !ln) return
    const handler = () => {
      ln.scrollTop = ed.scrollTop
    }
    ed.addEventListener('scroll', handler, { passive: true })
    return () => ed.removeEventListener('scroll', handler)
  }, [state?.viewMode])

  if (!state)
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
        Loading...
      </div>
    )

  const showEditor = state.viewMode === 'split' || state.viewMode === 'edit'
  const showPreview = state.viewMode === 'split' || state.viewMode === 'preview'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── Inject preview styles ── */}
      <style>{previewStyles}</style>

      {/* ── Toolbar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '3px 8px',
          background: 'var(--bg-primary)',
          borderBottom: '1px solid var(--border)',
          gap: 3,
          flexWrap: 'wrap',
          minHeight: 28,
        }}
      >
        {/* View mode toggle */}
        <button
          onClick={toggleMode}
          style={{ ...btnBase, fontWeight: 600, marginRight: 4 }}
          title="Toggle view mode"
        >
          {state.viewMode === 'split' ? '\u25E7 Split' : state.viewMode === 'edit' ? '\u270F Edit' : '\u25CE Preview'}
        </button>

        <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 2px' }} />

        {/* Toolbar buttons */}
        {toolbarItems.map((item, idx) => {
          if ('sep' in item)
            return (
              <div key={`sep-${idx}`} style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 1px' }} />
            )
          return (
            <button
              key={item.action}
              title={item.title}
              style={{
                ...btnBase,
                fontWeight: item.action === 'bold' ? 700 : item.action === 'italic' ? 400 : undefined,
                fontStyle: item.action === 'italic' ? 'italic' : undefined,
                textDecoration: item.action === 'strikethrough' ? 'line-through' : undefined,
              }}
              onClick={() => {
                const ta = editorRef.current
                if (ta) applyToolbarAction(ta, item.action, handleChange)
              }}
            >
              {item.label}
            </button>
          )
        })}

        {/* Spacer + stats */}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {wordCount.toLocaleString()} words &middot; {readingTime}
        </span>
      </div>

      {/* ── Editor + Preview ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Editor pane with line numbers */}
        {showEditor && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              overflow: 'hidden',
              borderRight: showPreview ? '1px solid var(--border)' : 'none',
              position: 'relative',
            }}
          >
            {/* Line numbers */}
            <div
              ref={lineNumRef}
              style={{
                width: 44,
                overflow: 'hidden',
                background: 'var(--bg-secondary)',
                color: 'var(--text-muted)',
                fontFamily: '"Cascadia Code", "Fira Code", Consolas, monospace',
                fontSize: 14,
                lineHeight: '1.6',
                padding: '16px 0',
                textAlign: 'right',
                userSelect: 'none',
                borderRight: '1px solid var(--border)',
                flexShrink: 0,
              }}
            >
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i} style={{ paddingRight: 8, height: '1.6em' }}>
                  {i + 1}
                </div>
              ))}
            </div>

            {/* Textarea */}
            <textarea
              ref={editorRef}
              value={state.content}
              onChange={(e) => handleChange(e.target.value)}
              onScroll={() => syncScroll('editor')}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              style={{
                flex: 1,
                resize: 'none',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                border: 'none',
                outline: 'none',
                padding: '16px 16px 16px 12px',
                fontFamily: '"Cascadia Code", "Fira Code", Consolas, monospace',
                fontSize: 14,
                lineHeight: 1.6,
                tabSize: 2,
                whiteSpace: 'pre',
                overflowWrap: 'normal',
              }}
            />
          </div>
        )}

        {/* Preview pane */}
        {showPreview && (
          <div
            ref={previewRef}
            className="md-preview"
            onScroll={() => syncScroll('preview')}
            style={{
              flex: 1,
              overflow: 'auto',
              padding: '20px 32px',
              background: 'var(--bg-secondary)',
            }}
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        )}
      </div>
    </div>
  )
}
