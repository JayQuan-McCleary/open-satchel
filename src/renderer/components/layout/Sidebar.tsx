import { useEffect, useRef, useState, useCallback } from 'react'
import { useDocumentStore } from '../../stores/documentStore'
import { useUIStore } from '../../stores/uiStore'

export default function Sidebar() {
  const pages = useDocumentStore((s) => s.pages)
  const pdfBytes = useDocumentStore((s) => s.pdfBytes)
  const rotatePage = useDocumentStore((s) => s.rotatePage)
  const deletePage = useDocumentStore((s) => s.deletePage)
  const restorePage = useDocumentStore((s) => s.restorePage)
  const currentPage = useUIStore((s) => s.currentPage)
  const setCurrentPage = useUIStore((s) => s.setCurrentPage)

  return (
    <div style={{
      background: 'var(--bg-primary)',
      borderRight: '1px solid var(--border)',
      overflowY: 'auto',
      padding: 8
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
        Pages
      </div>
      {pages.map((page, i) => (
        <PageThumbnail
          key={page.pageIndex}
          pageIndex={page.pageIndex}
          displayIndex={i}
          deleted={page.deleted}
          rotation={page.rotation}
          active={currentPage === i}
          pdfBytes={pdfBytes!}
          onClick={() => setCurrentPage(i)}
          onRotate={() => rotatePage(page.pageIndex)}
          onDelete={() => deletePage(page.pageIndex)}
          onRestore={() => restorePage(page.pageIndex)}
        />
      ))}
    </div>
  )
}

function PageThumbnail({
  pageIndex,
  displayIndex,
  deleted,
  rotation,
  active,
  pdfBytes,
  onClick,
  onRotate,
  onDelete,
  onRestore
}: {
  pageIndex: number
  displayIndex: number
  deleted: boolean
  rotation: number
  active: boolean
  pdfBytes: Uint8Array
  onClick: () => void
  onRotate: () => void
  onDelete: () => void
  onRestore: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [rendered, setRendered] = useState(false)

  const renderThumbnail = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas || rendered) return

    const pdfjsLib = await import('pdfjs-dist')
    const doc = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise
    const page = await doc.getPage(pageIndex + 1)
    const viewport = page.getViewport({ scale: 0.2, rotation })
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')!
    await page.render({ canvasContext: ctx, viewport }).promise
    page.cleanup()
    doc.destroy()
    setRendered(true)
  }, [pdfBytes, pageIndex, rotation, rendered])

  useEffect(() => {
    renderThumbnail()
  }, [renderThumbnail])

  // Re-render when rotation changes
  useEffect(() => {
    setRendered(false)
  }, [rotation])

  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        padding: 4,
        marginBottom: 4,
        borderRadius: 4,
        border: active ? '2px solid var(--accent)' : '2px solid transparent',
        opacity: deleted ? 0.3 : 1,
        cursor: 'pointer',
        background: active ? 'var(--bg-surface)' : 'transparent'
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: '100%', display: 'block', borderRadius: 2 }}
      />
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 2,
        fontSize: 10,
        color: 'var(--text-muted)'
      }}>
        <span>{displayIndex + 1}</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <button
            title="Rotate"
            onClick={(e) => { e.stopPropagation(); onRotate() }}
            style={{ fontSize: 10, padding: '1px 3px', borderRadius: 2 }}
          >
            ↻
          </button>
          {deleted ? (
            <button
              title="Restore"
              onClick={(e) => { e.stopPropagation(); onRestore() }}
              style={{ fontSize: 10, padding: '1px 3px', borderRadius: 2, color: 'var(--success)' }}
            >
              ↩
            </button>
          ) : (
            <button
              title="Delete"
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              style={{ fontSize: 10, padding: '1px 3px', borderRadius: 2, color: 'var(--danger)' }}
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
