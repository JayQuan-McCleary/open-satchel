import { useState } from 'react'
import { useTabStore } from '../stores/tabStore'
import { getHandler } from '../formats/registry'
import { getAvailableConversions, convert, type ConversionTarget } from '../services/conversionService'
import { openFileFromPath } from '../App'

interface Props {
  onClose: () => void
}

export default function ConvertDialog({ onClose }: Props) {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const tabs = useTabStore((s) => s.tabs)
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const [converting, setConverting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)

  if (!activeTab) return null

  const conversions = getAvailableConversions(activeTab.format)

  const handleConvert = async (target: ConversionTarget) => {
    if (!activeTab || !activeTabId) return

    setConverting(true)
    setError(null)
    setProgress(`Converting to ${target.label}...`)

    try {
      const handler = getHandler(activeTab.format)
      if (!handler) throw new Error('No handler for current format')

      // Get current file bytes
      const sourceBytes = await handler.save(activeTabId)

      // Perform conversion
      const resultBytes = await convert(activeTab.format, target.format, sourceBytes)

      setProgress('Saving...')

      // Save as dialog
      const savePath = await window.api.file.saveAs(resultBytes)
      if (savePath) {
        await openFileFromPath(savePath, resultBytes)
        onClose()
      }
    } catch (err) {
      setError(`Conversion failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setConverting(false)
      setProgress(null)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: 'var(--bg-primary)', borderRadius: 8, padding: 24,
        border: '1px solid var(--border)', minWidth: 420, maxWidth: 560
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)' }}>
            Convert {activeTab.fileName}
          </h3>
          <button onClick={onClose} style={{
            fontSize: 18, background: 'transparent', border: 'none',
            color: 'var(--text-secondary)', cursor: 'pointer'
          }}>x</button>
        </div>

        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 16px' }}>
          Choose a target format to convert your file:
        </p>

        {/* Conversion targets grid */}
        {conversions.length === 0 ? (
          <div style={{
            padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12,
            border: '1px solid var(--border)', borderRadius: 6
          }}>
            No conversions available for this file format.
          </div>
        ) : (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
            gap: 10, marginBottom: 16
          }}>
            {conversions.map((target) => (
              <button
                key={target.format}
                onClick={() => handleConvert(target)}
                disabled={converting}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  gap: 8, padding: 16, borderRadius: 8,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  cursor: converting ? 'not-allowed' : 'pointer',
                  opacity: converting ? 0.5 : 1,
                  transition: 'border-color 0.15s, background 0.15s'
                }}
                onMouseEnter={(e) => {
                  if (!converting) {
                    e.currentTarget.style.borderColor = 'var(--accent)'
                    e.currentTarget.style.background = 'var(--bg-hover, var(--bg-surface))'
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)'
                  e.currentTarget.style.background = 'var(--bg-surface)'
                }}
              >
                <span style={{ fontSize: 24 }}>{target.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {target.label}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  .{target.extension}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Progress indicator */}
        {progress && (
          <div style={{
            padding: '10px 14px', borderRadius: 4, marginBottom: 12,
            background: 'var(--bg-surface)', color: 'var(--text-secondary)',
            fontSize: 12, display: 'flex', alignItems: 'center', gap: 8
          }}>
            <span style={{
              display: 'inline-block', width: 14, height: 14,
              border: '2px solid var(--accent)', borderTopColor: 'transparent',
              borderRadius: '50%', animation: 'spin 0.8s linear infinite'
            }} />
            {progress}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            padding: '8px 12px', borderRadius: 4, marginBottom: 12,
            background: 'rgba(243, 139, 168, 0.15)', color: 'var(--danger)', fontSize: 12
          }}>
            {error}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '8px 16px', background: 'var(--bg-surface)', borderRadius: 4,
            border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 12
          }}>
            Close
          </button>
        </div>

        {/* Spinner animation */}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  )
}
