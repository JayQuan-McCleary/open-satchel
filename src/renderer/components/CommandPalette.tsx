import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useUIStore } from '../stores/uiStore'
import { useTabStore } from '../stores/tabStore'
import { openFile, saveFile, saveFileAs, closeActiveTab } from '../App'
import type { Tool } from '../types/pdf'

interface Command {
  id: string
  label: string
  shortcut?: string
  category: string
  action: () => void
}

function fuzzyMatch(query: string, text: string): boolean {
  const lq = query.toLowerCase()
  const lt = text.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < lt.length && qi < lq.length; ti++) {
    if (lt[ti] === lq[qi]) qi++
  }
  return qi === lq.length
}

export default function CommandPalette() {
  const open = useUIStore((s) => s.commandPaletteOpen)
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const setTool = useUIStore((s) => s.setTool)
  const zoomIn = useUIStore((s) => s.zoomIn)
  const zoomOut = useUIStore((s) => s.zoomOut)
  const resetZoom = useUIStore((s) => s.resetZoom)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const toggleTheme = useUIStore((s) => s.toggleTheme)

  const activeTabId = useTabStore((s) => s.activeTabId)
  const tabs = useTabStore((s) => s.tabs)
  const activeTab = tabs.find((t) => t.id === activeTabId)

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [
      // File operations
      { id: 'open-file', label: 'Open File', shortcut: 'Ctrl+O', category: 'File', action: openFile },
      { id: 'save', label: 'Save', shortcut: 'Ctrl+S', category: 'File', action: saveFile },
      { id: 'save-as', label: 'Save As', shortcut: 'Ctrl+Shift+S', category: 'File', action: saveFileAs },
      { id: 'close-tab', label: 'Close Tab', shortcut: 'Ctrl+W', category: 'File', action: closeActiveTab },

      // View
      { id: 'toggle-sidebar', label: 'Toggle Sidebar', shortcut: 'Ctrl+B', category: 'View', action: toggleSidebar },
      { id: 'zoom-in', label: 'Zoom In', shortcut: 'Ctrl+=', category: 'View', action: zoomIn },
      { id: 'zoom-out', label: 'Zoom Out', shortcut: 'Ctrl+-', category: 'View', action: zoomOut },
      { id: 'reset-zoom', label: 'Reset Zoom', shortcut: 'Ctrl+0', category: 'View', action: resetZoom },
      { id: 'toggle-theme', label: 'Toggle Theme', category: 'View', action: toggleTheme },

      // Navigation
      {
        id: 'next-tab', label: 'Next Tab', shortcut: 'Ctrl+Tab', category: 'Navigation',
        action: () => {
          const { tabs: t, activeTabId: a, setActiveTab } = useTabStore.getState()
          if (t.length <= 1) return
          const idx = t.findIndex((x) => x.id === a)
          setActiveTab(t[(idx + 1) % t.length].id)
        }
      },
      {
        id: 'prev-tab', label: 'Previous Tab', shortcut: 'Ctrl+Shift+Tab', category: 'Navigation',
        action: () => {
          const { tabs: t, activeTabId: a, setActiveTab } = useTabStore.getState()
          if (t.length <= 1) return
          const idx = t.findIndex((x) => x.id === a)
          setActiveTab(t[(idx - 1 + t.length) % t.length].id)
        }
      },
    ]

    // Go to Tab 1-9
    for (let i = 1; i <= 9; i++) {
      cmds.push({
        id: `go-tab-${i}`, label: `Go to Tab ${i}`, shortcut: `Ctrl+${i}`, category: 'Navigation',
        action: () => {
          const { tabs: t, setActiveTab } = useTabStore.getState()
          if (i - 1 < t.length) setActiveTab(t[i - 1].id)
        }
      })
    }

    // PDF tools (only when a PDF tab is active)
    if (activeTab?.format === 'pdf') {
      const pdfTools: { label: string; tool: Tool; key?: string }[] = [
        { label: 'Select', tool: 'select', key: 'V' },
        { label: 'Text', tool: 'text', key: 'T' },
        { label: 'Draw', tool: 'draw', key: 'D' },
        { label: 'Highlight', tool: 'highlight' },
        { label: 'Rectangle', tool: 'shape_rect' },
        { label: 'Circle', tool: 'shape_circle' },
        { label: 'Line', tool: 'shape_line' },
        { label: 'Arrow', tool: 'shape_arrow' },
        { label: 'Signature', tool: 'signature' },
        { label: 'Stamp', tool: 'stamp' },
        { label: 'Sticky Note', tool: 'sticky_note' },
        { label: 'Image', tool: 'image', key: 'I' },
      ]
      for (const t of pdfTools) {
        cmds.push({
          id: `tool-${t.tool}`,
          label: `Tool: ${t.label}`,
          shortcut: t.key,
          category: 'Tools',
          action: () => setTool(t.tool)
        })
      }
    }

    // Markdown view toggle
    if (activeTab?.format === 'markdown') {
      cmds.push({
        id: 'md-toggle-view',
        label: 'Toggle View Mode',
        category: 'Format',
        action: () => {
          // Dispatched via a custom event that the markdown viewer can listen to
          window.dispatchEvent(new CustomEvent('command:toggleMarkdownView'))
        }
      })
    }

    return cmds
  }, [activeTab, setTool, zoomIn, zoomOut, resetZoom, toggleSidebar, toggleTheme])

  const filtered = useMemo(() => {
    if (!query.trim()) return commands
    return commands.filter((c) =>
      fuzzyMatch(query, c.label) || fuzzyMatch(query, c.category)
    )
  }, [query, commands])

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      // Focus input after render
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Keep selected index in bounds
  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1))
    }
  }, [filtered.length, selectedIndex])

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const item = listRef.current.children[selectedIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const execute = useCallback((cmd: Command) => {
    setOpen(false)
    // Defer so the palette closes before the action runs
    requestAnimationFrame(() => cmd.action())
  }, [setOpen])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (filtered[selectedIndex]) execute(filtered[selectedIndex])
        break
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        break
    }
  }, [filtered, selectedIndex, execute, setOpen])

  if (!open) return null

  // Group commands by category for display
  let lastCategory = ''

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', justifyContent: 'center', paddingTop: '15vh'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 500, height: 'fit-content', maxHeight: '60vh',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderTop: '2px solid var(--accent)',
          borderRadius: 8,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)'
        }}
      >
        {/* Search input */}
        <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0) }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            style={{
              width: '100%', padding: '8px 12px', fontSize: 14,
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--text-primary)', outline: 'none'
            }}
          />
        </div>

        {/* Command list */}
        <div ref={listRef} style={{ overflow: 'auto', padding: '4px 0' }}>
          {filtered.length === 0 && (
            <div style={{ padding: '16px 12px', color: 'var(--text-muted)', textAlign: 'center', fontSize: 12 }}>
              No commands found
            </div>
          )}
          {filtered.map((cmd, i) => {
            const showCategory = cmd.category !== lastCategory
            lastCategory = cmd.category

            return (
              <div key={cmd.id}>
                {showCategory && (
                  <div style={{
                    padding: '6px 16px 2px', fontSize: 10, fontWeight: 600,
                    color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em'
                  }}>
                    {cmd.category}
                  </div>
                )}
                <div
                  onClick={() => execute(cmd)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 16px', cursor: 'pointer', fontSize: 13,
                    background: i === selectedIndex ? 'var(--bg-hover)' : 'transparent',
                    color: i === selectedIndex ? 'var(--text-primary)' : 'var(--text-secondary)',
                    transition: 'background 0.05s'
                  }}
                >
                  <span>{cmd.label}</span>
                  {cmd.shortcut && (
                    <span style={{
                      fontSize: 11, color: 'var(--text-muted)',
                      background: 'var(--bg-surface)', padding: '1px 6px',
                      borderRadius: 3, fontFamily: 'monospace'
                    }}>
                      {cmd.shortcut}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
