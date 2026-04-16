import { useState, useRef, useCallback } from 'react'
import { useFormatStore } from '../../stores/formatStore'
import { useUIStore } from '../../stores/uiStore'
import type { PdfFormatState } from './index'

interface Props {
  tabId: string
  onClose: () => void
}

type OcrLanguage = { code: string; label: string }
type OcrScope = 'current' | 'all'
type OcrDpi = 150 | 300 | 600
type OcrOutputMode = 'clipboard' | 'newtab' | 'searchable'

const LANGUAGES: OcrLanguage[] = [
  { code: 'eng', label: 'English' },
  { code: 'fra', label: 'French' },
  { code: 'deu', label: 'German' },
  { code: 'spa', label: 'Spanish' },
  { code: 'ita', label: 'Italian' },
  { code: 'por', label: 'Portuguese' },
  { code: 'nld', label: 'Dutch' },
  { code: 'pol', label: 'Polish' },
  { code: 'rus', label: 'Russian' },
  { code: 'chi_sim', label: 'Chinese (Simplified)' },
  { code: 'chi_tra', label: 'Chinese (Traditional)' },
  { code: 'jpn', label: 'Japanese' },
  { code: 'kor', label: 'Korean' },
  { code: 'ara', label: 'Arabic' },
]

export default function OcrDialog({ tabId, onClose }: Props) {
  const [language, setLanguage] = useState('eng')
  const [scope, setScope] = useState<OcrScope>('current')
  const [dpi, setDpi] = useState<OcrDpi>(300)
  const [outputMode, setOutputMode] = useState<OcrOutputMode>('clipboard')
  const [progress, setProgress] = useState(0)
  const [statusText, setStatusText] = useState('')
  const [running, setRunning] = useState(false)
  const cancelRef = useRef(false)

  const labelStyle: React.CSSProperties = {
    fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4
  }
  const radioLabelStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
    color: 'var(--text-primary)', cursor: 'pointer'
  }

  const runOcr = useCallback(async () => {
    cancelRef.current = false
    setRunning(true)
    setProgress(0)
    setStatusText('Initializing...')

    try {
      const Tesseract = await import('tesseract.js')
      const pdfjsLib = await import('pdfjs-dist')

      const state = useFormatStore.getState().getFormatState<PdfFormatState>(tabId)
      if (!state) throw new Error('No PDF state')

      const doc = await pdfjsLib.getDocument({ data: state.pdfBytes.slice() }).promise
      const currentPage = useUIStore.getState().currentPage
      const visiblePages = state.pages.filter(p => !p.deleted)

      let pagesToProcess: number[]
      if (scope === 'current') {
        const visPage = visiblePages[currentPage]
        pagesToProcess = visPage ? [visPage.pageIndex + 1] : [1]
      } else {
        pagesToProcess = visiblePages.map(p => p.pageIndex + 1)
      }

      const allText: string[] = []
      // For searchable mode, collect word-level OCR data per page
      const ocrPageData: { pageNum: number; words: { text: string; x: number; y: number; w: number; h: number }[]; vpWidth: number; vpHeight: number }[] = []
      const scale = dpi / 72

      for (let i = 0; i < pagesToProcess.length; i++) {
        if (cancelRef.current) {
          setStatusText('Cancelled')
          break
        }

        const pageNum = pagesToProcess[i]
        setStatusText(`Processing page ${i + 1} of ${pagesToProcess.length}...`)

        const page = await doc.getPage(pageNum)
        const viewport = page.getViewport({ scale })

        const canvas = new OffscreenCanvas(
          Math.floor(viewport.width),
          Math.floor(viewport.height)
        )
        const ctx = canvas.getContext('2d')!
        await page.render({ canvasContext: ctx as any, viewport }).promise

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

        const pageProgress = (pct: number) => {
          const overall = (i + pct) / pagesToProcess.length
          setProgress(Math.round(overall * 100))
        }

        const result = await Tesseract.recognize(imageData as any, language, {
          logger: (m: any) => {
            if (m.status === 'recognizing text') {
              pageProgress(m.progress)
            }
          }
        })

        // Use block-level data for layout preservation when available
        if (result.data.blocks && result.data.blocks.length > 0) {
          // Sort blocks by vertical position, then reconstruct with spacing
          const blocks = [...result.data.blocks].sort((a: any, b: any) => a.bbox.y0 - b.bbox.y0)
          const layoutText = blocks.map((block: any) => {
            if (!block.paragraphs) return block.text || ''
            return block.paragraphs.map((para: any) => {
              if (!para.lines) return para.text || ''
              return para.lines.map((line: any) => {
                if (!line.words) return line.text || ''
                // Preserve horizontal spacing by detecting column gaps
                const words = [...line.words].sort((a: any, b: any) => a.bbox.x0 - b.bbox.x0)
                let text = ''
                for (let w = 0; w < words.length; w++) {
                  if (w > 0) {
                    const gap = words[w].bbox.x0 - words[w - 1].bbox.x1
                    // Large gap = tab/column separator
                    text += gap > 30 ? '\t' : ' '
                  }
                  text += words[w].text
                }
                return text
              }).join('\n')
            }).join('\n\n')
          }).join('\n\n\n')
          allText.push(layoutText)
        } else {
          allText.push(result.data.text)
        }

        // Collect word bounding boxes for searchable PDF mode
        if (outputMode === 'searchable' && result.data.words) {
          const words = result.data.words.map((w: any) => ({
            text: w.text,
            x: w.bbox.x0 / scale,   // convert back to PDF points
            y: w.bbox.y0 / scale,
            w: (w.bbox.x1 - w.bbox.x0) / scale,
            h: (w.bbox.y1 - w.bbox.y0) / scale,
          }))
          ocrPageData.push({ pageNum, words, vpWidth: viewport.width / scale, vpHeight: viewport.height / scale })
        }

        page.cleanup()
      }

      doc.destroy()

      if (cancelRef.current) {
        setRunning(false)
        return
      }

      const fullText = allText.join('\n\n--- Page Break ---\n\n')

      if (outputMode === 'clipboard') {
        await navigator.clipboard.writeText(fullText)
        setStatusText('Text copied to clipboard!')
        setProgress(100)
        setTimeout(() => onClose(), 1200)
      } else if (outputMode === 'newtab') {
        const blob = new Blob([fullText], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        window.open(url, '_blank')
        setStatusText('Text opened in new tab!')
        setProgress(100)
        setTimeout(() => onClose(), 1200)
      } else {
        // Searchable PDF: embed invisible text layer behind page content
        setStatusText('Building searchable PDF...')
        try {
          const { PDFDocument: PDFDoc, rgb: pdfRgb, StandardFonts: StdFonts } = await import('pdf-lib')
          const pdfDoc = await PDFDoc.load(state.pdfBytes)
          const font = await pdfDoc.embedFont(StdFonts.Helvetica)

          for (const pageData of ocrPageData) {
            const pdfPageIdx = pageData.pageNum - 1
            if (pdfPageIdx >= pdfDoc.getPageCount()) continue
            const pdfPage = pdfDoc.getPage(pdfPageIdx)
            const { height: pageH } = pdfPage.getSize()

            for (const word of pageData.words) {
              if (!word.text.trim()) continue
              const fontSize = Math.max(4, Math.min(word.h * 0.8, 20))
              // Position: convert top-left canvas coords to PDF bottom-left coords
              const pdfY = pageH - word.y - word.h
              pdfPage.drawText(word.text, {
                x: word.x,
                y: pdfY,
                size: fontSize,
                font,
                color: pdfRgb(0, 0, 0),
                opacity: 0, // invisible — searchable only
              })
            }
          }

          const out = await pdfDoc.save()
          useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({
            ...prev, pdfBytes: out, pageCount: pdfDoc.getPageCount()
          }))
          useTabStore.getState().setTabDirty(tabId, true)
          setStatusText(`Searchable PDF created! ${ocrPageData.reduce((s, p) => s + p.words.length, 0)} words embedded.`)
          setProgress(100)
          setTimeout(() => onClose(), 1500)
        } catch (err: any) {
          setStatusText(`Error creating searchable PDF: ${err.message}`)
        }
      }
    } catch (err: any) {
      if (!cancelRef.current) {
        setStatusText(`Error: ${err.message}`)
      }
    } finally {
      setRunning(false)
    }
  }, [tabId, language, scope, dpi, outputMode, onClose])

  const handleCancel = () => {
    if (running) {
      cancelRef.current = true
      setStatusText('Cancelling...')
    } else {
      onClose()
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{
        background: 'var(--bg-primary)', borderRadius: 8, padding: 24,
        border: '1px solid var(--border)', minWidth: 420, maxWidth: 480
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>OCR - Text Recognition</h3>
          <button onClick={onClose} style={{ fontSize: 18, background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}>
            &#x2715;
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Language */}
          <div>
            <label style={labelStyle}>Language</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}
              disabled={running}
              style={{ width: '100%', padding: '6px 8px', fontSize: 12 }}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label} ({l.code})</option>
              ))}
            </select>
          </div>

          {/* Scope */}
          <div>
            <label style={labelStyle}>Scope</label>
            <div style={{ display: 'flex', gap: 16 }}>
              <label style={radioLabelStyle}>
                <input type="radio" name="ocr-scope" checked={scope === 'current'}
                  onChange={() => setScope('current')} disabled={running} />
                Current page
              </label>
              <label style={radioLabelStyle}>
                <input type="radio" name="ocr-scope" checked={scope === 'all'}
                  onChange={() => setScope('all')} disabled={running} />
                All pages
              </label>
            </div>
          </div>

          {/* DPI */}
          <div>
            <label style={labelStyle}>DPI (Resolution)</label>
            <select value={dpi} onChange={(e) => setDpi(Number(e.target.value) as OcrDpi)}
              disabled={running}
              style={{ width: '100%', padding: '6px 8px', fontSize: 12 }}>
              <option value={150}>150 DPI (Fast)</option>
              <option value={300}>300 DPI (Default)</option>
              <option value={600}>600 DPI (High Quality)</option>
            </select>
          </div>

          {/* Output Mode */}
          <div>
            <label style={labelStyle}>Output</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={radioLabelStyle}>
                <input type="radio" name="ocr-output" checked={outputMode === 'clipboard'}
                  onChange={() => setOutputMode('clipboard')} disabled={running} />
                Extract text to clipboard
              </label>
              <label style={radioLabelStyle}>
                <input type="radio" name="ocr-output" checked={outputMode === 'newtab'}
                  onChange={() => setOutputMode('newtab')} disabled={running} />
                Extract text to new tab
              </label>
              <label style={radioLabelStyle}>
                <input type="radio" name="ocr-output" checked={outputMode === 'searchable'}
                  onChange={() => setOutputMode('searchable')} disabled={running} />
                Make PDF searchable
              </label>
            </div>
          </div>

          {/* Progress */}
          {running && (
            <div>
              <div style={{
                height: 6, borderRadius: 3, background: 'var(--bg-surface)', overflow: 'hidden'
              }}>
                <div style={{
                  height: '100%', width: `${progress}%`,
                  background: 'var(--accent)', borderRadius: 3,
                  transition: 'width 0.2s ease'
                }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                {progress}% - {statusText}
              </div>
            </div>
          )}

          {/* Status text when not running but has status */}
          {!running && statusText && (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              {statusText}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={handleCancel}
            style={{ padding: '8px 16px', background: 'var(--bg-surface)', borderRadius: 4, border: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}>
            {running ? 'Cancel' : 'Close'}
          </button>
          <button onClick={runOcr} disabled={running}
            style={{
              padding: '8px 16px', background: running ? 'var(--bg-surface)' : 'var(--accent)',
              color: 'var(--bg-primary)', borderRadius: 4, fontWeight: 600, border: 'none',
              cursor: running ? 'default' : 'pointer', opacity: running ? 0.5 : 1
            }}>
            {running ? 'Processing...' : 'Start OCR'}
          </button>
        </div>
      </div>
    </div>
  )
}
