import { useEffect, useRef, useState } from 'react'
import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { useHistoryStore } from '../../stores/historyStore'
import type { PdfFormatState } from './index'

export default function PdfSidebar({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as PdfFormatState | undefined)
  const currentPage = useUIStore((s) => s.currentPage)
  const setCurrentPage = useUIStore((s) => s.setCurrentPage)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  if (!state) return null

  const snapshotPages = () => {
    const s = useFormatStore.getState().data[tabId] as PdfFormatState | undefined
    if (s) useHistoryStore.getState().pushUndo({ type: 'pages', tabId, pages: JSON.parse(JSON.stringify(s.pages)) })
  }

  const rotatePage = (pageIndex: number) => {
    snapshotPages()
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
    snapshotPages()
    useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({
      ...prev,
      pages: prev.pages.map((p) =>
        p.pageIndex === pageIndex ? { ...p, deleted: true } : p
      )
    }))
    useTabStore.getState().setTabDirty(tabId, true)
  }

  const restorePage = (pageIndex: number) => {
    snapshotPages()
    useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({
      ...prev,
      pages: prev.pages.map((p) =>
        p.pageIndex === pageIndex ? { ...p, deleted: false } : p
      )
    }))
    useTabStore.getState().setTabDirty(tabId, true)
  }

  const handleDragStart = (i: number) => setDragIndex(i)
  const handleDragOver = (e: React.DragEvent, i: number) => { e.preventDefault(); setDragOverIndex(i) }
  const handleDrop = (targetIndex: number) => {
    if (dragIndex === null || dragIndex === targetIndex) { setDragIndex(null); setDragOverIndex(null); return }
    snapshotPages()
    useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => {
      const updated = [...prev.pages]
      const [moved] = updated.splice(dragIndex, 1)
      updated.splice(targetIndex, 0, moved)
      return { ...prev, pages: updated }
    })
    useTabStore.getState().setTabDirty(tabId, true)
    setDragIndex(null); setDragOverIndex(null)
  }
  const handleDragEnd = () => { setDragIndex(null); setDragOverIndex(null) }

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
          isDragging={dragIndex === i}
          isDragOver={dragOverIndex === i}
          onClick={() => setCurrentPage(i)}
          onRotate={() => rotatePage(page.pageIndex)}
          onDelete={() => deletePage(page.pageIndex)}
          onRestore={() => restorePage(page.pageIndex)}
          onDragStart={() => handleDragStart(i)}
          onDragOver={(e) => handleDragOver(e, i)}
          onDrop={() => handleDrop(i)}
          onDragEnd={handleDragEnd}
        />
      ))}
    </div>
  )
}

function PageThumbnail({
  pageIndex, displayIndex, deleted, rotation, active, pdfBytes,
  isDragging, isDragOver,
  onClick, onRotate, onDelete, onRestore,
  onDragStart, onDragOver, onDrop, onDragEnd
}: {
  pageIndex: number; displayIndex: number; deleted: boolean; rotation: number;
  active: boolean; pdfBytes: Uint8Array;
  isDragging: boolean; isDragOver: boolean;
  onClick: () => void; onRotate: () => void; onDelete: () => void; onRestore: () => void;
  onDragStart: () => void; onDragOver: (e: React.DragEvent) => void; onDrop: () => void; onDragEnd: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const render = async () => {
      const canvas = canvasRef.current
      if (!canvas) return
      try {
        const pdfjsLib = await import('pdfjs-dist')
        // Ensure worker is configured (guard for harness/dev environments)
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href
        }
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
        setError(false)
      } catch (err) {
        if (cancelled) return
        console.error('Thumbnail render error for page', pageIndex, err)
        setError(true)
        const ctx = canvas.getContext('2d')
        if (ctx) {
          canvas.width = 122; canvas.height = 158
          ctx.fillStyle = '#2a2a3a'
          ctx.fillRect(0, 0, 122, 158)
          ctx.fillStyle = '#f38ba8'
          ctx.font = 'bold 20px sans-serif'
          ctx.textAlign = 'center'
          ctx.fillText('!', 61, 86)
        }
      }
    }
    render()
    return () => { cancelled = true }
  }, [pdfBytes, pageIndex, rotation])

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onClick}
      style={{
        position: 'relative', padding: 4, marginBottom: 4, borderRadius: 4,
        border: isDragOver ? '2px dashed var(--accent)' : active ? '2px solid var(--accent)' : '2px solid transparent',
        opacity: isDragging ? 0.4 : deleted ? 0.3 : 1, cursor: 'grab',
        background: active ? 'var(--bg-surface)' : 'transparent',
        transition: 'opacity 0.15s, border-color 0.15s'
      }}
    >
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
