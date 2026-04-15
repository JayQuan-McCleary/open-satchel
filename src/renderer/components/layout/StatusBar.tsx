import { CSSProperties, useMemo } from 'react'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { useFormatStore } from '../../stores/formatStore'
import { FORMAT_NAMES, FORMAT_ICONS } from '../../types/tabs'
import type { MarkdownFormatState } from '../../formats/markdown/index'
import type { CodeFormatState } from '../../formats/code/index'
import type { HtmlFormatState } from '../../formats/html/index'
import type { CsvFormatState } from '../../formats/csv/index'
import type { XlsxFormatState } from '../../formats/xlsx/index'
import type { PdfFormatState } from '../../formats/pdf/index'
import { getPageSizeName } from '../../constants/pageSizes'
import type { ImageFormatState } from '../../formats/image/index'

interface Props {
  style?: CSSProperties
}

// ── Separator ────────────────────────────────────────────────────────

function Sep() {
  return (
    <span style={{
      width: 1,
      height: 14,
      background: 'var(--border)',
      flexShrink: 0,
    }} />
  )
}

// ── Helpers ──────────────────────────────────────────────────────────

function countWordsAndChars(text: string): { words: number; chars: number; lines: number } {
  const chars = text.length
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  const lines = text.split('\n').length
  return { words, chars, lines }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Component ────────────────────────────────────────────────────────

export default function StatusBar({ style }: Props) {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const zoom = useUIStore((s) => s.zoom)
  const theme = useUIStore((s) => s.theme)
  const toggleTheme = useUIStore((s) => s.toggleTheme)
  const autoSaveEnabled = useUIStore((s) => s.autoSaveEnabled)
  const autoSaveStatus = useUIStore((s) => s.autoSaveStatus)
  const toggleAutoSave = useUIStore((s) => s.toggleAutoSave)
  const formatData = useFormatStore((s) => s.data)

  const format = activeTab?.format

  // Compute center info based on format
  const centerInfo = useMemo(() => {
    if (!activeTab || !activeTabId) return null
    // Reference formatData so useMemo recomputes when content changes
    void formatData

    const store = useFormatStore.getState()

    switch (format) {
      case 'markdown': {
        const s = store.getFormatState<MarkdownFormatState>(activeTabId)
        if (!s) return null
        const { words, chars, lines } = countWordsAndChars(s.content)
        return `Ln ${lines}, Col 1  |  Words: ${words.toLocaleString()}  |  Chars: ${chars.toLocaleString()}`
      }
      case 'code':
      case 'plaintext': {
        const s = store.getFormatState<CodeFormatState>(activeTabId)
        if (!s) return null
        const { words, chars, lines } = countWordsAndChars(s.content)
        return `Ln ${lines}, Col 1  |  Words: ${words.toLocaleString()}  |  Chars: ${chars.toLocaleString()}`
      }
      case 'html': {
        const s = store.getFormatState<HtmlFormatState>(activeTabId)
        if (!s) return null
        const { words, chars, lines } = countWordsAndChars(s.content)
        return `Ln ${lines}, Col 1  |  Words: ${words.toLocaleString()}  |  Chars: ${chars.toLocaleString()}`
      }
      case 'csv': {
        const s = store.getFormatState<CsvFormatState>(activeTabId)
        if (!s) return null
        const rows = s.rows.length
        const cols = s.headers.length
        const cells = rows * cols
        return `Rows: ${rows.toLocaleString()}, Cols: ${cols}, Cells: ${cells.toLocaleString()}`
      }
      case 'xlsx': {
        const s = store.getFormatState<XlsxFormatState>(activeTabId)
        if (!s || s.sheets.length === 0) return null
        const sheet = s.sheets[s.activeSheet]
        if (!sheet) return null
        const rows = sheet.data.length
        const cols = sheet.data[0]?.length ?? 0
        return `Sheet: ${sheet.name}, Rows: ${rows}, Cols: ${cols}`
      }
      case 'pdf': {
        const s = store.getFormatState<PdfFormatState>(activeTabId)
        if (!s) return null
        const currentPage = useUIStore.getState().currentPage
        const page = s.pages[currentPage]
        const pw = page?.pageSize?.width
        const ph = page?.pageSize?.height
        let pageSizeLabel = ''
        if (pw && ph) {
          const name = getPageSizeName(pw, ph)
          pageSizeLabel = name ? `  |  ${name} (${Math.round(pw)} x ${Math.round(ph)} pt)` : `  |  ${Math.round(pw)} x ${Math.round(ph)} pt`
        }
        return `Page ${currentPage + 1} of ${s.pageCount}${pageSizeLabel}`
      }
      case 'image': {
        const s = store.getFormatState<ImageFormatState>(activeTabId)
        if (!s) return null
        const size = formatFileSize(s.imageBytes.length)
        return `Size: ${size}`
      }
      default:
        return null
    }
  }, [activeTab, activeTabId, format, formatData])

  // Auto-save status color
  const autoSaveColor = autoSaveStatus === 'saving'
    ? 'var(--warning)'
    : autoSaveStatus === 'saved'
      ? 'var(--success)'
      : 'var(--text-muted)'

  const autoSaveLabel = autoSaveStatus === 'saving'
    ? 'Saving...'
    : autoSaveStatus === 'saved'
      ? 'Auto-saved'
      : autoSaveEnabled
        ? 'Auto-save'
        : 'Auto-save off'

  const containerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 12px',
    background: 'var(--bg-primary)',
    borderTop: '1px solid var(--border)',
    fontSize: 11,
    color: 'var(--text-muted)',
    height: '100%',
    userSelect: 'none',
    ...style,
  }

  const sectionStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  }

  const hoverBtnStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    padding: '2px 4px',
    borderRadius: 3,
    fontSize: 11,
    gap: 4,
  }

  return (
    <div style={containerStyle}>
      {/* ── Left side ─────────────────────────────────────────── */}
      <div style={sectionStyle}>
        {activeTab && (
          <>
            <span>{FORMAT_ICONS[activeTab.format]} {FORMAT_NAMES[activeTab.format]}</span>
            <Sep />
            <span>UTF-8</span>
            <Sep />
            <span>LF</span>
          </>
        )}
        {!activeTab && <span>No file open</span>}
      </div>

      {/* ── Center ────────────────────────────────────────────── */}
      <div style={sectionStyle}>
        {centerInfo && <span>{centerInfo}</span>}
      </div>

      {/* ── Right side ────────────────────────────────────────── */}
      <div style={sectionStyle}>
        {/* Auto-save toggle */}
        <button
          onClick={toggleAutoSave}
          title={autoSaveEnabled ? 'Auto-save enabled (click to disable)' : 'Auto-save disabled (click to enable)'}
          style={{ ...hoverBtnStyle, opacity: autoSaveEnabled ? 1 : 0.5 }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        >
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: autoSaveColor,
            display: 'inline-block', flexShrink: 0,
          }} />
          {autoSaveLabel}
        </button>

        <Sep />

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          style={{
            ...hoverBtnStyle,
            width: 22,
            height: 22,
            fontSize: 14,
            padding: 0,
            lineHeight: 1,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)'
            e.currentTarget.style.color = 'var(--text-primary)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--text-muted)'
          }}
        >
          {theme === 'dark' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
          )}
        </button>

        <Sep />

        {/* Zoom */}
        {activeTab && <span>{Math.round(zoom * 100)}%</span>}

        {/* Unsaved dot */}
        {activeTab?.isDirty && (
          <>
            <Sep />
            <span
              style={{ color: 'var(--warning)', fontSize: 16, lineHeight: 1 }}
              title="Unsaved changes"
            >
              {'\u2022'}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
