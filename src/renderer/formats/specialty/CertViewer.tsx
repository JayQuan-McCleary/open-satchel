import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import type { CertState } from './index'

export default function CertViewer({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as CertState | undefined)
  if (!state) return <div style={{ padding: 20 }}>Loading...</div>
  if (state.error) return <div style={{ padding: 20, color: 'var(--danger)' }}>Error: {state.error}</div>
  const info = state.info
  if (!info) return <div style={{ padding: 20 }}>No certificate info</div>

  const rows: [string, string | undefined][] = [
    ['Subject', info.subject],
    ['Issuer', info.issuer],
    ['Valid From', info.notBefore],
    ['Valid Until', info.notAfter],
    ['Serial Number', info.serialNumber],
    ['Public Key', info.publicKeyType],
    ['Signature Algorithm', info.signatureAlgorithm],
  ]

  return (
    <div style={{ height: '100%', overflow: 'auto', background: 'var(--bg-secondary)', padding: 20 }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <h3 style={{ marginTop: 0 }}>Certificate Details</h3>
        <table style={{ width: '100%', fontSize: 13 }}>
          <tbody>
            {rows.filter(([, v]) => v).map(([k, v]) => (
              <tr key={k} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 12px', fontWeight: 500, color: 'var(--text-secondary)', width: 180, verticalAlign: 'top' }}>{k}</td>
                <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 20 }}>
          <h4>Raw PEM</h4>
          <pre style={{ padding: 12, background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 11, overflow: 'auto' }}>{info.raw}</pre>
        </div>
      </div>
    </div>
  )
}
