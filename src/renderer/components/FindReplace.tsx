import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useUIStore } from '../stores/uiStore'
import { useTabStore } from '../stores/tabStore'
import { useFormatStore } from '../stores/formatStore'
import type { MarkdownFormatState } from '../formats/markdown/index'
import type { CodeFormatState } from '../formats/code/index'
import type { HtmlFormatState } from '../formats/html/index'
import type { CsvFormatState } from '../formats/csv/index'
import type { DocxFormatState } from '../formats/docx/index'

// ── Helpers ──────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getSearchableText(format: string, tabId: string): string | null {
  const store = useFormatStore.getState()

  switch (format) {
    case 'markdown': {
      const s = store.getFormatState<MarkdownFormatState>(tabId)
      return s?.content ?? null
    }
    case 'code':
    case 'plaintext': {
      const s = store.getFormatState<CodeFormatState>(tabId)
      return s?.content ?? null
    }
    case 'html': {
      const s = store.getFormatState<HtmlFormatState>(tabId)
      return s?.content ?? null
    }
    case 'csv': {
      const s = store.getFormatState<CsvFormatState>(tabId)
      if (!s) return null
      const lines = [s.headers.join(s.delimiter), ...s.rows.map((r) => r.join(s.delimiter))]
      return lines.join('\n')
    }
    case 'docx': {
      const s = store.getFormatState<DocxFormatState>(tabId)
      if (!s) return null
      // Strip HTML tags to get plain text for searching
      const tmp = document.createElement('div')
      tmp.innerHTML = s.html
      return tmp.textContent || tmp.innerText || ''
    }
    default:
      return null
  }
}

function findAllMatches(
  text: string,
  query: string,
  caseSensitive: boolean,
  useRegex: boolean,
  wholeWord: boolean
): { start: number; end: number }[] {
  if (!query) return []

  let pattern: string
  let flags = 'g'
  if (!caseSensitive) flags += 'i'

  if (useRegex) {
    pattern = query
  } else {
    pattern = escapeRegex(query)
  }

  if (wholeWord) {
    pattern = `\\b${pattern}\\b`
  }

  try {
    const re = new RegExp(pattern, flags)
    const results: { start: number; end: number }[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue }
      results.push({ start: m.index, end: m.index + m[0].length })
    }
    return results
  } catch {
    return []
  }
}

// ── Styles ───────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 8,
  zIndex: 100,
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '8px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
  minWidth: 340,
  fontSize: 12,
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '4px 8px',
  fontSize: 12,
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  color: 'var(--text-primary)',
  outline: 'none',
  minWidth: 0,
}

const btnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  borderRadius: 4,
  border: 'none',
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontSize: 12,
  flexShrink: 0,
}

const btnActiveStyle: React.CSSProperties = {
  ...btnStyle,
  background: 'var(--accent)',
  color: 'var(--bg-primary)',
}

const actionBtnStyle: React.CSSProperties = {
  padding: '3px 10px',
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  fontSize: 11,
  whiteSpace: 'nowrap',
}

// ── Component ────────────────────────────────────────────────────────

export default function FindReplace() {
  const findReplaceOpen = useUIStore((s) => s.findReplaceOpen)
  const findReplaceMode = useUIStore((s) => s.findReplaceMode)
  const closeFindReplace = useUIStore((s) => s.closeFindReplace)

  const activeTabId = useTabStore((s) => s.activeTabId)
  const tabs = useTabStore((s) => s.tabs)
  const activeTab = tabs.find((t) => t.id === activeTabId)

  // Subscribe to format store changes so matches update live
  const formatData = useFormatStore((s) => s.data)

  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)

  const findInputRef = useRef<HTMLInputElement>(null)
  const showReplace = findReplaceMode === 'replace'

  // Focus the find input when panel opens
  useEffect(() => {
    if (findReplaceOpen && findInputRef.current) {
      findInputRef.current.focus()
      findInputRef.current.select()
    }
  }, [findReplaceOpen, findReplaceMode])

  // Get matches
  const matches = useMemo(() => {
    if (!findReplaceOpen || !activeTab || !activeTabId || !query) return []
    // Reference formatData to trigger re-computation when content changes
    void formatData
    const text = getSearchableText(activeTab.format, activeTabId)
    if (!text) return []
    return findAllMatches(text, query, caseSensitive, useRegex, wholeWord)
  }, [findReplaceOpen, activeTab, activeTabId, query, caseSensitive, useRegex, wholeWord, formatData])

  // Clamp current index
  useEffect(() => {
    if (matches.length === 0) {
      setCurrentIndex(0)
    } else if (currentIndex >= matches.length) {
      setCurrentIndex(matches.length - 1)
    }
  }, [matches.length, currentIndex])

  const goNext = useCallback(() => {
    if (matches.length === 0) return
    setCurrentIndex((i) => (i + 1) % matches.length)
  }, [matches.length])

  const goPrev = useCallback(() => {
    if (matches.length === 0) return
    setCurrentIndex((i) => (i - 1 + matches.length) % matches.length)
  }, [matches.length])

  // Replace the current match
  const replaceOne = useCallback(() => {
    if (!activeTab || !activeTabId || matches.length === 0) return
    const match = matches[currentIndex]
    if (!match) return

    const store = useFormatStore.getState()
    const format = activeTab.format

    if (format === 'markdown') {
      store.updateFormatState<MarkdownFormatState>(activeTabId, (prev) => {
        const before = prev.content.slice(0, match.start)
        const after = prev.content.slice(match.end)
        return { ...prev, content: before + replacement + after }
      })
    } else if (format === 'code' || format === 'plaintext') {
      store.updateFormatState<CodeFormatState>(activeTabId, (prev) => {
        const before = prev.content.slice(0, match.start)
        const after = prev.content.slice(match.end)
        return { ...prev, content: before + replacement + after }
      })
    } else if (format === 'html') {
      store.updateFormatState<HtmlFormatState>(activeTabId, (prev) => {
        const before = prev.content.slice(0, match.start)
        const after = prev.content.slice(match.end)
        return { ...prev, content: before + replacement + after }
      })
    }

    useTabStore.getState().setTabDirty(activeTabId, true)
  }, [activeTab, activeTabId, matches, currentIndex, replacement])

  // Replace all matches
  const replaceAll = useCallback(() => {
    if (!activeTab || !activeTabId || matches.length === 0 || !query) return

    const store = useFormatStore.getState()
    const format = activeTab.format

    let flags = 'g'
    if (!caseSensitive) flags += 'i'
    let pattern: string
    if (useRegex) {
      pattern = query
    } else {
      pattern = escapeRegex(query)
    }
    if (wholeWord) pattern = `\\b${pattern}\\b`

    try {
      const re = new RegExp(pattern, flags)

      if (format === 'markdown') {
        store.updateFormatState<MarkdownFormatState>(activeTabId, (prev) => ({
          ...prev,
          content: prev.content.replace(re, replacement)
        }))
      } else if (format === 'code' || format === 'plaintext') {
        store.updateFormatState<CodeFormatState>(activeTabId, (prev) => ({
          ...prev,
          content: prev.content.replace(re, replacement)
        }))
      } else if (format === 'html') {
        store.updateFormatState<HtmlFormatState>(activeTabId, (prev) => ({
          ...prev,
          content: prev.content.replace(re, replacement)
        }))
      }

      useTabStore.getState().setTabDirty(activeTabId, true)
      setCurrentIndex(0)
    } catch {
      // Invalid regex, ignore
    }
  }, [activeTab, activeTabId, matches.length, query, replacement, caseSensitive, useRegex, wholeWord])

  // Handle Escape and Enter in inputs
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeFindReplace()
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (e.ctrlKey) {
          replaceOne()
        } else {
          goNext()
        }
      } else if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault()
        goPrev()
      }
    },
    [closeFindReplace, goNext, goPrev, replaceOne]
  )

  if (!findReplaceOpen) return null

  // For PDF, we don't render our own panel -- the PDF viewer has its own search
  if (activeTab?.format === 'pdf') {
    // Trigger the existing PDF search instead
    useUIStore.getState().setSearchVisible(true)
    useUIStore.getState().closeFindReplace()
    return null
  }

  const matchLabel = matches.length > 0
    ? `${currentIndex + 1} of ${matches.length}`
    : query
      ? 'No results'
      : ''

  return (
    <div style={panelStyle} onKeyDown={handleKeyDown}>
      {/* Find row */}
      <div style={rowStyle}>
        <input
          ref={findInputRef}
          style={inputStyle}
          type="text"
          placeholder="Find..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setCurrentIndex(0) }}
          spellCheck={false}
        />
        <span style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          minWidth: 60,
          textAlign: 'center',
          whiteSpace: 'nowrap',
          userSelect: 'none',
        }}>
          {matchLabel}
        </span>

        {/* Case sensitive */}
        <button
          style={caseSensitive ? btnActiveStyle : btnStyle}
          onClick={() => setCaseSensitive((v) => !v)}
          title="Match Case"
        >
          Aa
        </button>
        {/* Whole word */}
        <button
          style={wholeWord ? btnActiveStyle : btnStyle}
          onClick={() => setWholeWord((v) => !v)}
          title="Whole Word"
        >
          W
        </button>
        {/* Regex */}
        <button
          style={useRegex ? btnActiveStyle : btnStyle}
          onClick={() => setUseRegex((v) => !v)}
          title="Regular Expression"
        >
          .*
        </button>

        {/* Prev / Next */}
        <button style={btnStyle} onClick={goPrev} title="Previous Match (Shift+Enter)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
        </button>
        <button style={btnStyle} onClick={goNext} title="Next Match (Enter)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
        </button>

        {/* Close */}
        <button style={btnStyle} onClick={closeFindReplace} title="Close (Escape)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>

      {/* Replace row */}
      {showReplace && (
        <div style={rowStyle}>
          <input
            style={inputStyle}
            type="text"
            placeholder="Replace..."
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            spellCheck={false}
          />
          <button style={actionBtnStyle} onClick={replaceOne} title="Replace (Ctrl+Enter)">
            Replace
          </button>
          <button style={actionBtnStyle} onClick={replaceAll} title="Replace All">
            All
          </button>
        </div>
      )}
    </div>
  )
}
