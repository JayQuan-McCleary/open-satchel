import { useEffect, useRef } from 'react'
import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import type { PdfFormatState } from './index'

export default function PdfSidebar({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as PdfFormatState | undefined)
  const currentPage = useUIStore((s) => s.currentPage)
  const setCurrentPage = useUIStore((s) => s.setCurrentPage)

  if (!state) return null

  const rotatePage = (pageIndex: number) => {
    useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({
      ...prev,
      pages: prev.pages.map((p) =>
        p.pageIndex === pageIndex
          ? { ...p, rotation: ((p.rotation + 90) % 360) as 0 | 90 | 180 | 270 }
          : p
      )
    }))
    useTabStore.getState().setTabDirty(tabId, true)
  }

  const deletePage = (pageIndex: number) => {
    useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({
      ...prev,
      pages: prev.pages.map((p) =>
        p.pageIndex === pageIndex ? { ...p, deleted: true } : p
      )
    }))
    useTabStore.getState().setTabDirty(tabId, true)
  }

  const restorePage = (pageIndex: number) => {
    useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({
      ...prev,
      pages: prev.pages.map((p) =>
        p.pageIndex === pageIndex ? { ...p, deleted: false } : p
      )
    }))
    useTabStore.getState().setTabDirty(tabId, true)
  }

  return (
    <div style={{
      background: 'var(--bg-primary)', borderRight: '1px solid var(--border)',
      overflowY: 'auto', padding: 8
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
        Pages
      </div>
      {state.pages.map((page, i) => (
        <PageThumbnail
          key={page.pageIndex}
          pageIndex={page.pageIndex}
          displayIndex={i}
          deleted={page.deleted}
          rotation={page.rotation}
          active={currentPage === i}
          pdfBytes={state.pdfBytes}
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
  pageIndex, displayIndex, deleted, rotation, active, pdfBytes,
  onClick, onRotate, onDelete, onRestore
}: {
  pageIndex: number; displayIndex: number; deleted: boolean; rotation: number;
  active: boolean; pdfBytes: Uint8Array;
  onClick: () => void; onRotate: () => void; onDelete: () => void; onRestore: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    const render = async () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const pdfjsLib = await import('pdfjs-dist')
      const doc = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise
      if (cancelled) { doc.destroy(); return }
      const page = await doc.getPage(pageIndex + 1)
      if (cancelled) { page.cleanup(); doc.destroy(); return }
      // Combine intrinsic page rotation with user rotation (pdfjs overrides, not adds)
      const intrinsicRotation = (page as any).rotate || 0
      const effectiveRotation = (intrinsicRotation + rotation) % 360
      const viewport = page.getViewport({ scale: 0.2, rotation: effectiveRotation })
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')!
      await page.render({ canvasContext: ctx, viewport }).promise
      page.cleanup()
      doc.destroy()
    }
    render()
    return () => { cancelled = true }
  }, [pdfBytes, pageIndex, rotation])

  return (
    <div onClick={onClick} style={{
      position: 'relative', padding: 4, marginBottom: 4, borderRadius: 4,
      border: active ? '2px solid var(--accent)' : '2px solid transparent',
      opacity: deleted ? 0.3 : 1, cursor: 'pointer',
      background: active ? 'var(--bg-surface)' : 'transparent'
    }}>
      <canvas ref={canvasRef} style={{ width: '100%', display: 'block', borderRadius: 2 }} />
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginTop: 2, fontSize: 10, color: 'var(--text-muted)'
      }}>
        <span>{displayIndex + 1}</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <button title="Rotate" onClick={(e) => { e.stopPropagation(); onRotate() }}
            style={{ fontSize: 10, padding: '1px 3px', borderRadius: 2 }}>↻</button>
          {deleted ? (
            <button title="Restore" onClick={(e) => { e.stopPropagation(); onRestore() }}
              style={{ fontSize: 10, padding: '1px 3px', borderRadius: 2, color: 'var(--success)' }}>↩</button>
          ) : (
            <button title="Delete" onClick={(e) => { e.stopPropagation(); onDelete() }}
              style={{ fontSize: 10, padding: '1px 3px', borderRadius: 2, color: 'var(--danger)' }}>✕</button>
          )}
        </div>
      </div>
    </div>
  )
}
