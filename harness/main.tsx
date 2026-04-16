// Ribbon + canvas stress-test harness. Runs the real PdfToolbar AND the
// real PdfViewer (which mounts FabricCanvas) in a plain browser by stubbing
// the Electron IPC surface. Generates a blank one-page PDF in-memory with
// pdf-lib so the viewer has something to render and Fabric canvas can
// receive mouse events.

// --- Stub window.api BEFORE any app module imports it ---
;(window as unknown as { api: unknown }).api = {
  file: {
    open: async () => null,
    openPath: async () => null,
    openMultiple: async () => null,
    pickImages: async () => [],
    save: async () => true,
    saveAs: async () => null,
  },
  recent: {
    get: async () => [],
    add: async () => {},
    remove: async () => {},
    clear: async () => {},
  },
  font: {
    list: async () => [],
    getBytes: async () => new Uint8Array(),
    subset: async () => new Uint8Array(),
    import: async () => null,
    remove: async () => {},
  },
  pdf: {
    merge: async (arr: unknown[]) => arr[0],
  },
  folder: {
    pick: async () => null,
  },
  print: {
    pdf: async () => true,
  },
  capture: {
    screen: async () => null,
  },
  on: () => () => {},
}

import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { PDFDocument } from 'pdf-lib'
import '../src/renderer/styles/global.css'
import PdfToolbar from '../src/renderer/formats/pdf/PdfToolbar'
import PdfViewer from '../src/renderer/formats/pdf/PdfViewer'
import PdfSidebar from '../src/renderer/formats/pdf/PdfSidebar'
import { useTabStore } from '../src/renderer/stores/tabStore'
import { useFormatStore } from '../src/renderer/stores/formatStore'
import { useUIStore } from '../src/renderer/stores/uiStore'
import { useHistoryStore } from '../src/renderer/stores/historyStore'
import type { PdfFormatState } from '../src/renderer/formats/pdf'
import * as pdfOps from '../src/renderer/services/pdfOps'
import * as pdfToWord from '../src/renderer/services/pdfToWord'
import * as pdfTextOps from '../src/renderer/services/pdfTextOps'
import * as pdfBookmarks from '../src/renderer/services/pdfBookmarks'
import * as pdfCompare from '../src/renderer/services/pdfCompare'
import * as pdfForms from '../src/renderer/services/pdfForms'
import * as pdfRedact from '../src/renderer/services/pdfRedact'
import * as pdfSign from '../src/renderer/services/pdfSign'
import * as pdfConvert from '../src/renderer/services/pdfConvert'
import * as viewerFeatures from '../src/renderer/services/viewerFeatures'
import * as canvasTools from '../src/renderer/components/editor/CanvasTools'
import * as formDesigner from '../src/renderer/components/editor/FormDesignerTool'
import * as pdfLib from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist'
import { applyMeasureTool } from '../src/renderer/components/editor/MeasureTool'
import * as contentStreamParser from '../src/renderer/services/contentStreamParser'
import * as pdfTextExtract from '../src/renderer/services/pdfTextExtract'
import * as cmapResolver from '../src/renderer/services/cmapResolver'
import * as pdfImageOps from '../src/renderer/services/pdfImageOps'
import * as pdfFlatten from '../src/renderer/services/pdfFlatten'
import * as actionWizard from '../src/renderer/services/actionWizard'
import * as pdfAccessibility from '../src/renderer/services/pdfAccessibility'
import * as pdfAValidation from '../src/renderer/services/pdfAValidation'
import { pixelDiffPages } from '../src/renderer/services/pdfCompare'
import LayersPanel from '../src/renderer/components/editor/LayersPanel'

// Expose all services + libs to the harness driver.
Object.assign(window as unknown as Record<string, unknown>, {
  __pdfOps: pdfOps,
  __pdfToWord: pdfToWord,
  __pdfTextOps: pdfTextOps,
  __pdfBookmarks: pdfBookmarks,
  __pdfCompare: pdfCompare,
  __pdfForms: pdfForms,
  __pdfRedact: pdfRedact,
  __pdfSign: pdfSign,
  __pdfConvert: pdfConvert,
  __viewerFeatures: viewerFeatures,
  __canvasTools: canvasTools,
  __formDesigner: formDesigner,
  __pdfLib: pdfLib,
  __pdfjs: pdfjs,
  __applyMeasureTool: applyMeasureTool,
  __contentStreamParser: contentStreamParser,
  __pdfTextExtract: pdfTextExtract,
  __cmapResolver: cmapResolver,
  __pdfImageOps: pdfImageOps,
  __pdfFlatten: pdfFlatten,
  __actionWizard: actionWizard,
  __pdfAccessibility: pdfAccessibility,
  __pdfAValidation: pdfAValidation,
  __pixelDiffPages: pixelDiffPages,
})

// Capture full console.error argument lists (React substitutes through %s
// so normal filtering loses the actual message text).
;(window as unknown as { __errorLog: unknown[] }).__errorLog = []
const _origErr = console.error.bind(console)
console.error = (...args: unknown[]) => {
  try {
    ;(window as unknown as { __errorLog: unknown[] }).__errorLog.push(
      args.map((a) => {
        if (a instanceof Error) return `Error: ${a.message}\n${a.stack?.split('\n').slice(0,5).join('\n')}`
        if (typeof a === 'object') { try { return JSON.stringify(a) } catch { return String(a) } }
        return String(a)
      }).join(' | ')
    )
  } catch {}
  _origErr(...args)
}

// Expose live Zustand stores and format constants to the browser test driver.
;(window as unknown as { __stores: unknown }).__stores = {
  ui: useUIStore,
  tab: useTabStore,
  format: useFormatStore,
  history: useHistoryStore,
}

// Walk the React fiber tree from each `canvas.lower-canvas` DOM node up to
// the component that owns it, extract any fabric Canvas instance stored in
// a useRef, and return the PAGE's canvas (identified by PDF page width).
// We can't just grab the first lower-canvas because the SignatureDialog
// also mounts an inner fabric canvas while open.
;(window as unknown as { __getFabric: (opts?: { minWidth?: number }) => unknown }).__getFabric = (opts) => {
  const minWidth = opts?.minWidth ?? 500 // exclude the 400px signature pad
  const candidates: unknown[] = []
  const els = [...document.querySelectorAll('canvas.lower-canvas')] as Element[]
  for (const el of els) {
    const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber'))
    if (!fiberKey) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fiber: any = (el as any)[fiberKey]
    while (fiber) {
      let hook = fiber.memoizedState
      while (hook) {
        const val = hook.memoizedState
        if (val && typeof val === 'object' && 'current' in val) {
          const cur = val.current
          if (cur && typeof cur.add === 'function' && typeof cur.toJSON === 'function' && typeof cur.fire === 'function') {
            candidates.push(cur)
          }
        }
        hook = hook.next
      }
      fiber = fiber.return
    }
  }
  // Prefer a canvas wider than minWidth (rules out the signature pad)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wide = candidates.find((c: any) => c.width > minWidth)
  return wide ?? candidates[0] ?? null
}

const TAB_ID = 'harness-tab'

async function generateBlankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 1; i <= 4; i++) {
    const page = doc.addPage([612, 792]) // US letter
    page.drawText(`Harness Test Page ${i}`, { x: 50, y: 740, size: 18 })
    page.drawText(`This is page ${i} of 4`, { x: 50, y: 700, size: 12 })
  }
  return await doc.save()
}

function HarnessApp() {
  const [pdfReady, setPdfReady] = useState(false)
  const [fabricCanvas, setFabricCanvas] = useState<unknown>(null)
  const tool = useUIStore((s) => s.tool)
  const textOptions = useUIStore((s) => s.textOptions)

  // Poll for the PDF-page fabric canvas becoming available (PdfViewer
  // mounts it asynchronously after pdfjs finishes page layout).
  useEffect(() => {
    if (!pdfReady) return
    let cancelled = false
    const tick = () => {
      if (cancelled) return
      const fc = (window as unknown as { __getFabric?: () => unknown }).__getFabric?.()
      if (fc) setFabricCanvas(fc)
      else setTimeout(tick, 100)
    }
    tick()
    return () => { cancelled = true }
  }, [pdfReady])

  useEffect(() => {
    (async () => {
      const bytes = await generateBlankPdf()
      useTabStore.setState({
        tabs: [{ id: TAB_ID, filePath: null, fileName: 'harness.pdf', format: 'pdf', isDirty: false }],
        activeTabId: TAB_ID,
      })
      const seed: PdfFormatState = {
        pdfBytes: bytes,
        pageCount: 4,
        pages: Array.from({ length: 4 }, (_, i) => ({ pageIndex: i, rotation: 0 as const, deleted: false, fabricJSON: null, formValues: null })),
      }
      useFormatStore.getState().setFormatState(TAB_ID, seed)
      setPdfReady(true)
    })()
  }, [])

  return (
    <div style={{ background: 'var(--bg-secondary)', height: '100vh', color: 'var(--text-primary)', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: 6, fontSize: 12, borderBottom: '1px solid var(--border)', display: 'flex', gap: 12 }}>
        <strong>Harness (full)</strong>
        <span>tool=<b>{tool}</b></span>
        <span>bold=<b>{String(textOptions.bold)}</b></span>
        <span>italic=<b>{String(textOptions.italic)}</b></span>
        <span>font=<b>{textOptions.fontFamily}</b></span>
      </div>

      <div
        data-testid="ribbon-wrapper"
        style={{ height: 80, flexShrink: 0, borderBottom: '2px dashed var(--accent)', overflow: 'hidden', background: 'var(--bg-primary)' }}
      >
        {pdfReady && <PdfToolbar tabId={TAB_ID} />}
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        <div data-testid="sidebar-wrapper" style={{ width: 160, flexShrink: 0, overflow: 'auto', background: 'var(--bg-primary)', borderRight: '1px solid var(--border)' }}>
          {pdfReady && <PdfSidebar tabId={TAB_ID} />}
        </div>
        <div data-testid="viewer-wrapper" style={{ flex: 1, background: 'var(--bg-secondary)' }}>
          {pdfReady && <PdfViewer tabId={TAB_ID} />}
        </div>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HarnessApp />
  </React.StrictMode>
)
