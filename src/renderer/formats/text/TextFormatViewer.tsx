// Unified viewer for structured text formats (JSON, YAML, TOML, XML, BIB, INI).
// Split view: editable source on left, parsed tree on right.

import { useState, useCallback, useMemo } from 'react'
import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import { useTabStore } from '../../stores/tabStore'
import type { TextFormatState } from './index'
import jsYaml from 'js-yaml'
import tomlParser from '@iarna/toml'
import { XMLParser } from 'fast-xml-parser'

type ViewMode = 'source' | 'tree' | 'split'

export default function TextFormatViewer({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as TextFormatState | undefined)
  const [mode, setMode] = useState<ViewMode>('split')
  const [filter, setFilter] = useState('')

  const handleChange = useCallback((newContent: string) => {
    // Re-parse on change
    let parsed: unknown
    let parseError: string | undefined
    try {
      if (state?.language === 'json') parsed = JSON.parse(newContent)
      else if (state?.language === 'yaml') parsed = jsYaml.load(newContent)
      else if (state?.language === 'toml') parsed = tomlParser.parse(newContent)
      else if (state?.language === 'xml') {
        parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' }).parse(newContent)
      }
    } catch (err) { parseError = (err as Error).message }

    useFormatStore.getState().updateFormatState<TextFormatState>(tabId, (prev) => ({
      ...prev, content: newContent, parsed, parseError
    }))
    useTabStore.getState().setTabDirty(tabId, true)
  }, [tabId, state?.language])

  const filtered = useMemo(() => {
    if (!filter || !state?.parsed) return state?.parsed
    return filterByPath(state.parsed, filter)
  }, [filter, state?.parsed])

  if (!state) return <div style={{ padding: 20, color: 'var(--text-muted)' }}>Loading...</div>

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)' }}>
      <div style={{ display: 'flex', gap: 6, padding: 6, borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
        <button style={tabBtn(mode === 'source')} onClick={() => setMode('source')}>Source</button>
        <button style={tabBtn(mode === 'split')} onClick={() => setMode('split')}>Split</button>
        <button style={tabBtn(mode === 'tree')} onClick={() => setMode('tree')}>Tree</button>
        {state.parsed !== undefined && (
          <input placeholder="Filter path (e.g., foo.bar[0])" value={filter} onChange={e => setFilter(e.target.value)}
            style={{ flex: 1, padding: '4px 8px', fontSize: 12, background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-primary)' }} />
        )}
        {state.parseError && <span style={{ fontSize: 11, color: 'var(--danger)' }}>Parse error: {state.parseError.substring(0, 80)}</span>}
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {(mode === 'source' || mode === 'split') && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: mode === 'split' ? '1px solid var(--border)' : 'none' }}>
            <textarea
              value={state.content}
              onChange={(e) => handleChange(e.target.value)}
              spellCheck={false}
              style={{
                flex: 1, width: '100%', resize: 'none',
                background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                border: 'none', outline: 'none', padding: '12px 16px',
                fontFamily: '"Cascadia Code", "Consolas", monospace',
                fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre', overflowWrap: 'normal', overflowX: 'auto'
              }}
            />
          </div>
        )}

        {(mode === 'tree' || mode === 'split') && state.parsed !== undefined && (
          <div style={{ flex: 1, overflow: 'auto', padding: 12, fontSize: 12, fontFamily: '"Cascadia Code", monospace' }}>
            <TreeView data={filtered ?? state.parsed} />
          </div>
        )}
      </div>
    </div>
  )
}

function tabBtn(active: boolean): React.CSSProperties {
  return {
    padding: '4px 12px', fontSize: 12, cursor: 'pointer',
    background: active ? 'var(--accent)' : 'var(--bg-surface)',
    color: active ? 'var(--bg-primary)' : 'var(--text-primary)',
    border: '1px solid var(--border)', borderRadius: 3,
  }
}

function TreeView({ data, depth = 0, path = '' }: { data: unknown; depth?: number; path?: string }) {
  if (data === null) return <span style={{ color: '#f38ba8' }}>null</span>
  if (data === undefined) return <span style={{ color: 'var(--text-muted)' }}>undefined</span>
  if (typeof data === 'string') return <span style={{ color: '#a6e3a1' }}>"{data}"</span>
  if (typeof data === 'number') return <span style={{ color: '#fab387' }}>{data}</span>
  if (typeof data === 'boolean') return <span style={{ color: '#cba6f7' }}>{String(data)}</span>

  if (Array.isArray(data)) {
    if (data.length === 0) return <span>[]</span>
    return (
      <div style={{ marginLeft: depth === 0 ? 0 : 14 }}>
        <span style={{ color: 'var(--text-muted)' }}>[{data.length}]</span>
        {data.map((item, i) => (
          <div key={i}>
            <span style={{ color: '#89dceb' }}>{i}: </span>
            <TreeView data={item} depth={depth + 1} path={`${path}[${i}]`} />
          </div>
        ))}
      </div>
    )
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data as object)
    if (entries.length === 0) return <span>{'{}'}</span>
    return (
      <div style={{ marginLeft: depth === 0 ? 0 : 14 }}>
        {entries.map(([key, value]) => (
          <div key={key}>
            <span style={{ color: '#89b4fa' }}>{key}: </span>
            <TreeView data={value} depth={depth + 1} path={path ? `${path}.${key}` : key} />
          </div>
        ))}
      </div>
    )
  }

  return <span>{String(data)}</span>
}

function filterByPath(data: unknown, path: string): unknown {
  if (!path.trim()) return data
  const parts = path.split(/[.\[\]]+/).filter(Boolean)
  let current: any = data
  for (const part of parts) {
    if (current == null) return undefined
    current = current[part] ?? current[parseInt(part)]
  }
  return current
}
