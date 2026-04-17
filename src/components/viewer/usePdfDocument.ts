import { useEffect, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'

// Set worker source
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString()

export function usePdfDocument(pdfBytes: Uint8Array | null): PDFDocumentProxy | null {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)

  useEffect(() => {
    if (!pdfBytes) {
      setPdfDoc(null)
      return
    }

    let cancelled = false
    let doc: PDFDocumentProxy | null = null

    const load = async () => {
      try {
        doc = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise
        if (!cancelled) {
          setPdfDoc(doc)
        } else {
          doc.destroy()
        }
      } catch (err) {
        console.error('Failed to load PDF:', err)
      }
    }

    load()

    return () => {
      cancelled = true
      if (doc) doc.destroy()
    }
  }, [pdfBytes])

  return pdfDoc
}
