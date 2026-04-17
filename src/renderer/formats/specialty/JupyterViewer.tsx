import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import type { JupyterState, JupyterCell } from './index'

export default function JupyterViewer({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as JupyterState | undefined)
  if (!state) return <div style={{ padding: 20 }}>Loading...</div>

  return (
    <div style={{ height: '100%', overflow: 'auto', background: 'var(--bg-secondary)', padding: 20 }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {state.cells.map((cell, i) => <CellView key={i} cell={cell} />)}
      </div>
    </div>
  )
}

function CellView({ cell }: { cell: JupyterCell }) {
  if (cell.type === 'markdown') {
    // Very simple markdown rendering (headings + paragraphs)
    const html = simpleMarkdown(cell.source)
    return <div style={{ marginBottom: 12, padding: 12, background: '#fff', color: '#000', borderRadius: 4 }} dangerouslySetInnerHTML={{ __html: html }} />
  }
  if (cell.type === 'code') {
    return (
      <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
        <div style={{ width: 40, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right', paddingTop: 10 }}>
          [{cell.executionCount ?? ' '}]
        </div>
        <div style={{ flex: 1 }}>
          <pre style={{ padding: 10, background: '#1e1e2e', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12, overflow: 'auto', color: '#cdd6f4' }}>{cell.source}</pre>
          {cell.outputs && cell.outputs.map((out: any, oi: number) => (
            <div key={oi} style={{ padding: 8, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderTop: 'none', fontSize: 11, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
              {renderOutput(out)}
            </div>
          ))}
        </div>
      </div>
    )
  }
  return <pre style={{ padding: 10, fontSize: 11, color: 'var(--text-muted)' }}>{cell.source}</pre>
}

function renderOutput(out: any): string {
  if (out.output_type === 'stream') return Array.isArray(out.text) ? out.text.join('') : out.text
  if (out.output_type === 'execute_result' || out.output_type === 'display_data') {
    if (out.data?.['text/plain']) return Array.isArray(out.data['text/plain']) ? out.data['text/plain'].join('') : out.data['text/plain']
    return JSON.stringify(out.data, null, 2)
  }
  if (out.output_type === 'error') return `${out.ename}: ${out.evalue}\n${(out.traceback || []).join('\n')}`
  return JSON.stringify(out, null, 2)
}

function simpleMarkdown(md: string): string {
  let html = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  html = html.replace(/^###### (.*)$/gm, '<h6>$1</h6>')
  html = html.replace(/^##### (.*)$/gm, '<h5>$1</h5>')
  html = html.replace(/^#### (.*)$/gm, '<h4>$1</h4>')
  html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  html = html.replace(/`(.+?)`/g, '<code>$1</code>')
  html = html.replace(/\n\n/g, '</p><p>')
  return '<p>' + html + '</p>'
}
