import { useEffect, useRef, useState, useCallback } from 'react'
import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import { useUIStore } from '../../stores/uiStore'
import type { PdfFormatState } from './index'
import PageRenderer from './PageRenderer'
import PdfSearchBar from './PdfSearchBar'
import { usePdfDocument } from '../../components/viewer/usePdfDocument'
import { useViewerFeatures, installAutoScroll, EYE_PROTECTION_FILTER } from '../../services/viewerFeatures'

export default function PdfViewer({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as PdfFormatState | undefined)
  const setCurrentPage = useUIStore((s) => s.setCurrentPage)
  const searchVisible = useUIStore((s) => s.searchVisible)
  const setSearchVisible = useUIStore((s) => s.setSearchVisible)
  const containerRef = useRef<HTMLDivElement>(null)
  const pdfDoc = usePdfDocument(state?.pdfBytes ?? null)
  const [searchMatches, setSearchMatches] = useState(0)

  // Viewer feature flags (eye protection, auto-scroll, hide annotations)
  const eyeProtection = useViewerFeatures((s) => s.eyeProtection)
  const autoScroll = useViewerFeatures((s) => s.autoScroll)
  const autoScrollSpeed = useViewerFeatures((s) => s.autoScrollSpeed)
  const hideAnnotations = useViewerFeatures((s) => s.hideAnnotations)

  // Install / cancel auto-scroll interval on the viewport container
  useEffect(() => {
    installAutoScroll(containerRef.current, autoScrollSpeed, autoScroll)
    return () => installAutoScroll(null, 0, false)
  }, [autoScroll, autoScrollSpeed])

  // Toggle a class on the container so a stylesheet rule can hide the
  // fabric upper-canvas layer (annotations) without unmounting it.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.classList.toggle('satchel-hide-annotations', hideAnnotations)
  }, [hideAnnotations])

  const visiblePages = state?.pages.filter((p) => !p.deleted) ?? []

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = Number((entry.target as HTMLElement).dataset.pageDisplayIndex)
            if (!isNaN(idx)) setCurrentPage(idx)
          }
        }
      },
      { root: container, threshold: 0.5 }
    )
    const pageEls = container.querySelectorAll('[data-page-display-index]')
    pageEls.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [visiblePages.length, setCurrentPage])

  // Ctrl+F to toggle search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        useUIStore.getState().toggleSearch()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleSearch = useCallback(async (query: string, _matchIndex: number) => {
    if (!pdfDoc || query.length < 2) { setSearchMatches(0); return }
    let total = 0
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i)
      const textContent = await page.getTextContent()
      const text = textContent.items.map((item: any) => item.str).join(' ')
      const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      const matches = text.match(regex)
      if (matches) total += matches.length
      page.cleanup()
    }
    setSearchMatches(total)
  }, [pdfDoc])

  if (!pdfDoc || !state) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
        Loading PDF...
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <PdfSearchBar
        visible={searchVisible}
        onClose={() => setSearchVisible(false)}
        onSearch={handleSearch}
        totalMatches={searchMatches}
      />
      <div
        ref={containerRef}
        data-testid="pdf-viewer-scroll"
        style={{
          overflow: 'auto', height: '100%', width: '100%',
          display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 0',
          filter: eyeProtection ? EYE_PROTECTION_FILTER : undefined,
        }}
      >
        {visiblePages.map((page, displayIndex) => (
          <PageRenderer
            key={page.pageIndex}
            tabId={tabId}
            pdfDoc={pdfDoc}
            pageIndex={page.pageIndex}
            displayIndex={displayIndex}
            rotation={page.rotation}
          />
        ))}
      </div>
    </div>
  )
}
