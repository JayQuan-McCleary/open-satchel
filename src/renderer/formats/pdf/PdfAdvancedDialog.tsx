import { useEffect, useState } from 'react'
import { useFormatStore } from '../../stores/formatStore'
import { useTabStore } from '../../stores/tabStore'
import type { PdfFormatState } from './index'
import {
  readMetadata, writeMetadata, stripMetadata,
  splitEveryN, splitPdf,
  compressPdf,
  pdfToImages, imagesToPdf,
  applyBatesNumbering,
  flattenForm,
  rotatePages,
  extractText,
  setPdfThumbnail, setPdfThumbnailFromPage,
} from '../../services/pdfOps'
import { pdfToWord } from '../../services/pdfToWord'
import {
  pdfToText, pdfToExcel, pdfToPpt,
  extractAllPictures, toImageOnlyPdf,
  insertPagesFromPdf, replacePagesFromPdf,
  applyPageBackground, addPageNumbers,
  exportHighlightsFromPages,
} from '../../services/pdfConvert'
import { readBookmarks, writeFlatBookmarks, type Bookmark } from '../../services/pdfBookmarks'
import { findAcrossPages, replaceAcrossPages, spellCheckPages, readPageAloud, stopReading } from '../../services/pdfTextOps'
import { comparePdfs } from '../../services/pdfCompare'
import { generateSelfSignedCert, signPdf, listSignatures, type CertIdentity } from '../../services/pdfSign'

interface Props {
  tabId: string
  onClose: () => void
}

type Section = 'metadata' | 'organize' | 'convert' | 'bookmarks' | 'text' | 'compare' | 'optimize' | 'sign' | 'pages' | 'highlights' | 'thumbnail'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'metadata', label: 'Metadata' },
  { id: 'thumbnail', label: 'Thumbnail' },
  { id: 'organize', label: 'Organize' },
  { id: 'pages', label: 'Pages' },
  { id: 'convert', label: 'Convert' },
  { id: 'bookmarks', label: 'Bookmarks' },
  { id: 'text', label: 'Text' },
  { id: 'highlights', label: 'Highlights' },
  { id: 'compare', label: 'Compare' },
  { id: 'sign', label: 'Sign' },
  { id: 'optimize', label: 'Optimize' },
]

function downloadBytes(name: string, bytes: Uint8Array, mime = 'application/pdf') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob = new Blob([bytes as any], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function PdfAdvancedDialog({ tabId, onClose }: Props) {
  const [section, setSection] = useState<Section>('metadata')
  const [status, setStatus] = useState<string>('')
  const state = useFormatStore((s) => s.data[tabId] as PdfFormatState | undefined)

  if (!state) return null

  return (
    <div data-testid="advanced-dialog" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: 'var(--bg-primary)', borderRadius: 8, padding: 0,
        border: '1px solid var(--border)', width: '72vw', maxWidth: 900, height: '72vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Advanced PDF Tools</h3>
          <button onClick={onClose} style={{ fontSize: 18, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <nav style={{ width: 140, borderRight: '1px solid var(--border)', padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                data-testid={`nav-${s.id}`}
                onClick={() => { setSection(s.id); setStatus('') }}
                style={{
                  padding: '6px 10px', textAlign: 'left', fontSize: 12, borderRadius: 4,
                  background: section === s.id ? 'var(--accent)' : 'transparent',
                  color: section === s.id ? 'var(--bg-primary)' : 'var(--text-primary)',
                  border: 'none', cursor: 'pointer',
                }}
              >{s.label}</button>
            ))}
          </nav>
          <div style={{ flex: 1, padding: 16, overflow: 'auto' }}>
            {section === 'metadata' && <MetadataSection state={state} tabId={tabId} onStatus={setStatus} />}
            {section === 'thumbnail' && <ThumbnailSection state={state} tabId={tabId} onStatus={setStatus} />}
            {section === 'organize' && <OrganizeSection state={state} tabId={tabId} onStatus={setStatus} />}
            {section === 'pages' && <PagesSection state={state} tabId={tabId} onStatus={setStatus} />}
            {section === 'convert' && <ConvertSection state={state} onStatus={setStatus} />}
            {section === 'bookmarks' && <BookmarksSection state={state} tabId={tabId} onStatus={setStatus} />}
            {section === 'text' && <TextSection state={state} tabId={tabId} onStatus={setStatus} />}
            {section === 'highlights' && <HighlightsSection state={state} onStatus={setStatus} />}
            {section === 'compare' && <CompareSection state={state} onStatus={setStatus} />}
            {section === 'sign' && <SignSection state={state} tabId={tabId} onStatus={setStatus} />}
            {section === 'optimize' && <OptimizeSection state={state} tabId={tabId} onStatus={setStatus} />}
          </div>
        </div>
        {status && (
          <div data-testid="advanced-status" style={{ padding: '6px 16px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-secondary)' }}>{status}</div>
        )}
      </div>
    </div>
  )
}

// ---------- Sections ----------

const inp = { width: '100%', padding: '6px 8px', fontSize: 12, background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3 } as React.CSSProperties
const label = { fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 } as React.CSSProperties
const btn = { padding: '6px 12px', fontSize: 12, background: 'var(--accent)', color: 'var(--bg-primary)', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 500 } as React.CSSProperties
const btnSecondary = { ...btn, background: 'var(--bg-surface)', color: 'var(--text-primary)' }
const row = { display: 'flex', gap: 8, marginTop: 10 } as React.CSSProperties

function MetadataSection({ state, tabId, onStatus }: { state: PdfFormatState; tabId: string; onStatus: (s: string) => void }) {
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [subject, setSubject] = useState('')
  const [keywords, setKeywords] = useState('')
  useEffect(() => {
    (async () => {
      const m = await readMetadata(state.pdfBytes)
      setTitle(m.title ?? ''); setAuthor(m.author ?? ''); setSubject(m.subject ?? ''); setKeywords(m.keywords?.join(', ') ?? '')
    })()
  }, [state.pdfBytes])

  const save = async () => {
    const updated = await writeMetadata(state.pdfBytes, {
      title, author, subject,
      keywords: keywords ? keywords.split(',').map((k) => k.trim()).filter(Boolean) : [],
    })
    useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({ ...prev, pdfBytes: updated }))
    useTabStore.getState().setTabDirty(tabId, true)
    onStatus(`Metadata saved to document (${updated.byteLength} bytes).`)
  }
  const strip = async () => {
    const stripped = await stripMetadata(state.pdfBytes)
    useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({ ...prev, pdfBytes: stripped }))
    useTabStore.getState().setTabDirty(tabId, true)
    setTitle(''); setAuthor(''); setSubject(''); setKeywords('')
    onStatus('Metadata stripped.')
  }

  return (
    <div data-testid="section-metadata">
      <h4 style={{ marginTop: 0, fontSize: 13 }}>Document Metadata</h4>
      <label style={label}>Title</label><input data-testid="meta-title" style={inp} value={title} onChange={(e) => setTitle(e.target.value)} />
      <label style={{ ...label, marginTop: 8 }}>Author</label><input data-testid="meta-author" style={inp} value={author} onChange={(e) => setAuthor(e.target.value)} />
      <label style={{ ...label, marginTop: 8 }}>Subject</label><input data-testid="meta-subject" style={inp} value={subject} onChange={(e) => setSubject(e.target.value)} />
      <label style={{ ...label, marginTop: 8 }}>Keywords (comma-separated)</label><input data-testid="meta-keywords" style={inp} value={keywords} onChange={(e) => setKeywords(e.target.value)} />
      <div style={row}>
        <button data-testid="meta-save" style={btn} onClick={save}>Save</button>
        <button data-testid="meta-strip" style={btnSecondary} onClick={strip}>Strip all metadata</button>
      </div>
    </div>
  )
}

function OrganizeSection({ state, tabId, onStatus }: { state: PdfFormatState; tabId: string; onStatus: (s: string) => void }) {
  const [n, setN] = useState(2)
  const [batesPrefix, setBatesPrefix] = useState('ACME-')
  const [batesStart, setBatesStart] = useState(1)
  const [rotateAll, setRotateAll] = useState<90 | 180 | 270>(90)

  const doSplit = async () => {
    const chunks = await splitEveryN(state.pdfBytes, n)
    chunks.forEach((bytes, i) => downloadBytes(`split-${i + 1}.pdf`, bytes))
    onStatus(`Split into ${chunks.length} files (downloaded).`)
  }
  const doBates = async () => {
    const stamped = await applyBatesNumbering(state.pdfBytes, { prefix: batesPrefix, start: batesStart, digits: 6 })
    useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({ ...prev, pdfBytes: stamped }))
    useTabStore.getState().setTabDirty(tabId, true)
    onStatus(`Bates numbering applied (${batesPrefix}${String(batesStart).padStart(6,'0')}+)`)
  }
  const doRotateAll = async () => {
    const rotated = await rotatePages(state.pdfBytes, rotateAll)
    useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({ ...prev, pdfBytes: rotated }))
    useTabStore.getState().setTabDirty(tabId, true)
    onStatus(`Rotated all pages ${rotateAll}° on the saved bytes.`)
  }
  const doFlatten = async () => {
    const flat = await flattenForm(state.pdfBytes)
    downloadBytes('flattened.pdf', flat)
    onStatus('Form fields flattened (downloaded).')
  }

  return (
    <div data-testid="section-organize">
      <h4 style={{ marginTop: 0, fontSize: 13 }}>Split PDF</h4>
      <label style={label}>Every N pages</label>
      <input data-testid="split-n" type="number" min={1} style={inp} value={n} onChange={(e) => setN(Number(e.target.value))} />
      <div style={row}><button data-testid="split-go" style={btn} onClick={doSplit}>Split & download</button></div>

      <h4 style={{ marginTop: 18, fontSize: 13 }}>Bates Numbering</h4>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 2 }}><label style={label}>Prefix</label><input data-testid="bates-prefix" style={inp} value={batesPrefix} onChange={(e) => setBatesPrefix(e.target.value)} /></div>
        <div style={{ flex: 1 }}><label style={label}>Start</label><input data-testid="bates-start" type="number" style={inp} value={batesStart} onChange={(e) => setBatesStart(Number(e.target.value))} /></div>
      </div>
      <div style={row}><button data-testid="bates-go" style={btn} onClick={doBates}>Apply Bates</button></div>

      <h4 style={{ marginTop: 18, fontSize: 13 }}>Rotate all pages</h4>
      <select data-testid="rot-angle" style={inp} value={rotateAll} onChange={(e) => setRotateAll(Number(e.target.value) as 90|180|270)}>
        <option value={90}>90°</option><option value={180}>180°</option><option value={270}>270°</option>
      </select>
      <div style={row}><button data-testid="rot-go" style={btn} onClick={doRotateAll}>Rotate all</button></div>

      <h4 style={{ marginTop: 18, fontSize: 13 }}>Flatten Form Fields</h4>
      <div style={row}><button data-testid="flatten-go" style={btnSecondary} onClick={doFlatten}>Flatten & download</button></div>
    </div>
  )
}

function ConvertSection({ state, onStatus }: { state: PdfFormatState; onStatus: (s: string) => void }) {
  const [scale, setScale] = useState(2)
  const toWord = async () => {
    const bytes = await pdfToWord(state.pdfBytes)
    downloadBytes('converted.docx', bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    onStatus(`PDF→Word exported (${bytes.byteLength} bytes).`)
  }
  const toExcel = async () => {
    const bytes = await pdfToExcel(state.pdfBytes)
    downloadBytes('converted.xlsx', bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    onStatus(`PDF→Excel exported (${bytes.byteLength} bytes).`)
  }
  const toPpt = async () => {
    const bytes = await pdfToPpt(state.pdfBytes)
    downloadBytes('converted.pptx', bytes, 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    onStatus(`PDF→PPT exported (${bytes.byteLength} bytes).`)
  }
  const toTxt = async () => {
    const text = await pdfToText(state.pdfBytes)
    const blob = new Uint8Array(new TextEncoder().encode(text))
    downloadBytes('converted.txt', blob, 'text/plain')
    onStatus(`PDF→TXT exported (${blob.byteLength} bytes).`)
  }
  const toImages = async () => {
    const imgs = await pdfToImages(state.pdfBytes, { scale })
    imgs.forEach((b, i) => downloadBytes(`page-${i + 1}.png`, b, 'image/png'))
    onStatus(`Exported ${imgs.length} PNGs.`)
  }
  const toImageOnly = async () => {
    const bytes = await toImageOnlyPdf(state.pdfBytes)
    downloadBytes('image-only.pdf', bytes)
    onStatus(`Image-only PDF exported (text now unselectable).`)
  }
  const extractPics = async () => {
    const pics = await extractAllPictures(state.pdfBytes, { scale: 2 })
    pics.forEach((b, i) => downloadBytes(`picture-${i + 1}.png`, b, 'image/png'))
    onStatus(`Extracted ${pics.length} picture(s).`)
  }
  const imagesToPdfFromPicker = async () => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = 'image/png,image/jpeg'; input.multiple = true
    input.onchange = async () => {
      const files = input.files ? Array.from(input.files) : []
      if (!files.length) return
      const arrays: Uint8Array[] = await Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer())))
      const out = await imagesToPdf(arrays)
      downloadBytes('from-images.pdf', out)
      onStatus(`Created PDF from ${arrays.length} image(s).`)
    }
    input.click()
  }
  return (
    <div data-testid="section-convert">
      <h4 style={{ marginTop: 0, fontSize: 13 }}>Convert</h4>
      <div style={row}><button data-testid="conv-word" style={btn} onClick={toWord}>PDF → Word (.docx)</button></div>
      <div style={row}><button data-testid="conv-excel" style={btn} onClick={toExcel}>PDF → Excel (.xlsx)</button></div>
      <div style={row}><button data-testid="conv-ppt" style={btn} onClick={toPpt}>PDF → PowerPoint (.pptx)</button></div>
      <div style={row}><button data-testid="conv-txt" style={btn} onClick={toTxt}>PDF → TXT</button></div>
      <div style={row}>
        <label style={{ ...label, marginBottom: 0, alignSelf: 'center' }}>PNG scale</label>
        <input data-testid="conv-scale" type="number" min={1} max={4} step={0.5} style={{ ...inp, width: 60 }} value={scale} onChange={(e) => setScale(Number(e.target.value))} />
        <button data-testid="conv-png" style={btn} onClick={toImages}>PDF → Images (PNG)</button>
      </div>
      <div style={row}><button data-testid="conv-imgonly" style={btnSecondary} onClick={toImageOnly}>To Image-only PDF</button></div>
      <div style={row}><button data-testid="conv-extract" style={btnSecondary} onClick={extractPics}>Extract Pictures</button></div>
      <div style={row}><button data-testid="conv-img2pdf" style={btnSecondary} onClick={imagesToPdfFromPicker}>Image(s) → PDF…</button></div>
    </div>
  )
}

function PagesSection({ state, tabId, onStatus }: { state: PdfFormatState; tabId: string; onStatus: (s: string) => void }) {
  const [pageNumFormat, setPageNumFormat] = useState<'N' | 'N of M' | 'Page N' | 'Page N of M'>('Page N of M')
  const [bgColor, setBgColor] = useState('#fafbf4')

  const addNumbers = async () => {
    const bytes = await addPageNumbers(state.pdfBytes, { format: pageNumFormat })
    useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({ ...prev, pdfBytes: bytes }))
    useTabStore.getState().setTabDirty(tabId, true)
    onStatus(`Page numbers added (${pageNumFormat}).`)
  }
  const applyBackground = async () => {
    const hex = bgColor.replace('#', '')
    const r = parseInt(hex.slice(0, 2), 16) / 255
    const g = parseInt(hex.slice(2, 4), 16) / 255
    const b = parseInt(hex.slice(4, 6), 16) / 255
    const bytes = await applyPageBackground(state.pdfBytes, { color: [r, g, b] })
    useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({ ...prev, pdfBytes: bytes }))
    useTabStore.getState().setTabDirty(tabId, true)
    onStatus(`Applied background color ${bgColor}.`)
  }
  const insertFromPicker = async () => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = 'application/pdf'
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return
      const srcBytes = new Uint8Array(await file.arrayBuffer())
      const bytes = await insertPagesFromPdf(state.pdfBytes, srcBytes, state.pageCount)
      useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({ ...prev, pdfBytes: bytes }))
      useTabStore.getState().setTabDirty(tabId, true)
      onStatus(`Inserted pages from ${file.name} at end.`)
    }
    input.click()
  }
  const replaceFromPicker = async () => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = 'application/pdf'
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return
      const srcBytes = new Uint8Array(await file.arrayBuffer())
      const bytes = await replacePagesFromPdf(state.pdfBytes, srcBytes, 1, 1, 1)
      useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({ ...prev, pdfBytes: bytes }))
      useTabStore.getState().setTabDirty(tabId, true)
      onStatus(`Replaced page 1 with page 1 of ${file.name}.`)
    }
    input.click()
  }

  return (
    <div data-testid="section-pages">
      <h4 style={{ marginTop: 0, fontSize: 13 }}>Page Numbers</h4>
      <select data-testid="pn-format" style={inp} value={pageNumFormat} onChange={(e) => setPageNumFormat(e.target.value as 'Page N of M')}>
        <option>Page N of M</option>
        <option>Page N</option>
        <option>N of M</option>
        <option>N</option>
      </select>
      <div style={row}><button data-testid="pn-go" style={btn} onClick={addNumbers}>Add page numbers</button></div>

      <h4 style={{ marginTop: 18, fontSize: 13 }}>Background Color</h4>
      <input data-testid="bg-color" type="color" style={{ ...inp, height: 32, padding: 0, border: 'none' }} value={bgColor} onChange={(e) => setBgColor(e.target.value)} />
      <div style={row}><button data-testid="bg-go" style={btn} onClick={applyBackground}>Apply background</button></div>

      <h4 style={{ marginTop: 18, fontSize: 13 }}>Insert / Replace Pages</h4>
      <div style={row}>
        <button data-testid="insert-pages" style={btnSecondary} onClick={insertFromPicker}>Insert from PDF…</button>
        <button data-testid="replace-pages" style={btnSecondary} onClick={replaceFromPicker}>Replace page 1…</button>
      </div>
    </div>
  )
}

function HighlightsSection({ state, onStatus }: { state: PdfFormatState; onStatus: (s: string) => void }) {
  const [items, setItems] = useState<Array<{ page: number; text: string }>>([])
  const run = async () => {
    const extr = await extractText(state.pdfBytes)
    const hls = exportHighlightsFromPages(state.pages, extr)
    setItems(hls)
    onStatus(`${hls.length} highlight(s) exported.`)
  }
  const download = () => {
    const content = items.map((h) => `Page ${h.page + 1}: ${h.text}`).join('\n')
    const blob = new Uint8Array(new TextEncoder().encode(content))
    downloadBytes('highlights.txt', blob, 'text/plain')
    onStatus('Highlights saved to highlights.txt.')
  }
  return (
    <div data-testid="section-highlights">
      <h4 style={{ marginTop: 0, fontSize: 13 }}>Export Highlights</h4>
      <div style={row}><button data-testid="hl-scan" style={btn} onClick={run}>Scan highlighted text</button></div>
      {items.length > 0 && (
        <>
          <div data-testid="hl-list" style={{ marginTop: 10, padding: 8, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 3, fontSize: 11, maxHeight: 200, overflow: 'auto' }}>
            {items.map((h, i) => (
              <div key={i}>Page {h.page + 1}: <em>{h.text}</em></div>
            ))}
          </div>
          <div style={row}><button data-testid="hl-save" style={btnSecondary} onClick={download}>Download as .txt</button></div>
        </>
      )}
    </div>
  )
}

function SignSection({ state, tabId, onStatus }: { state: PdfFormatState; tabId: string; onStatus: (s: string) => void }) {
  const [cn, setCn] = useState('My Name')
  const [org, setOrg] = useState('')
  const [reason, setReason] = useState('Approved')
  const [location, setLocation] = useState('')
  const [cert, setCert] = useState<{ p12: Uint8Array; passphrase: string; certPem: string } | null>(null)
  const [sigs, setSigs] = useState<Array<{ fieldName: string; signerName?: string; reason?: string; location?: string; signedAt?: string }>>([])

  useEffect(() => {
    (async () => setSigs(await listSignatures(state.pdfBytes)))()
  }, [state.pdfBytes])

  const gen = async () => {
    const identity: CertIdentity = { commonName: cn, organization: org || undefined }
    const c = await generateSelfSignedCert(identity)
    setCert(c)
    onStatus(`Self-signed cert generated for "${cn}" (passphrase auto-set).`)
  }
  const sign = async () => {
    if (!cert) { onStatus('Generate a cert first.'); return }
    const bytes = await signPdf(state.pdfBytes, cert.p12, cert.passphrase, { reason, location, signerName: cn })
    useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({ ...prev, pdfBytes: bytes }))
    useTabStore.getState().setTabDirty(tabId, true)
    setSigs(await listSignatures(bytes))
    onStatus(`Document signed by "${cn}".`)
  }
  const downloadP12 = () => {
    if (!cert) return
    downloadBytes(`${cn.replace(/\W+/g, '_')}.p12`, cert.p12, 'application/x-pkcs12')
    const pemBytes = new Uint8Array(new TextEncoder().encode(cert.certPem))
    downloadBytes(`${cn.replace(/\W+/g, '_')}-passphrase.txt`, new Uint8Array(new TextEncoder().encode(cert.passphrase)), 'text/plain')
    downloadBytes(`${cn.replace(/\W+/g, '_')}-public.pem`, pemBytes, 'application/x-pem-file')
    onStatus('Cert bundle + passphrase + public .pem downloaded.')
  }

  return (
    <div data-testid="section-sign">
      <h4 style={{ marginTop: 0, fontSize: 13 }}>Digital Signature (Self-Signed)</h4>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Generate a free self-signed certificate on your device and sign the PDF. Adobe Reader will show the signature as "valid but untrusted" (no CA chain).</div>

      <label style={label}>Common Name (signer)</label><input data-testid="sign-cn" style={inp} value={cn} onChange={(e) => setCn(e.target.value)} />
      <label style={{ ...label, marginTop: 8 }}>Organization (optional)</label><input data-testid="sign-org" style={inp} value={org} onChange={(e) => setOrg(e.target.value)} />
      <label style={{ ...label, marginTop: 8 }}>Reason</label><input data-testid="sign-reason" style={inp} value={reason} onChange={(e) => setReason(e.target.value)} />
      <label style={{ ...label, marginTop: 8 }}>Location</label><input data-testid="sign-location" style={inp} value={location} onChange={(e) => setLocation(e.target.value)} />

      <div style={row}>
        <button data-testid="sign-gen" style={btnSecondary} onClick={gen}>{cert ? 'Regenerate cert' : 'Generate cert'}</button>
        <button data-testid="sign-sign" style={btn} onClick={sign} disabled={!cert}>Sign document</button>
        {cert && <button data-testid="sign-download" style={btnSecondary} onClick={downloadP12}>Download cert bundle</button>}
      </div>

      {sigs.length > 0 && (
        <div data-testid="sign-list" style={{ marginTop: 14, padding: 8, background: 'var(--bg-surface)', borderRadius: 3, fontSize: 11 }}>
          <strong>Existing signatures ({sigs.length})</strong>
          {sigs.map((s, i) => (
            <div key={i} style={{ marginTop: 4 }}>
              {s.signerName ?? s.fieldName} · {s.reason ?? '—'} · {s.location ?? '—'} · {s.signedAt ?? '—'}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BookmarksSection({ state, tabId, onStatus }: { state: PdfFormatState; tabId: string; onStatus: (s: string) => void }) {
  const [bms, setBms] = useState<Bookmark[]>([])
  useEffect(() => { readBookmarks(state.pdfBytes).then(setBms) }, [state.pdfBytes])
  const update = (i: number, patch: Partial<Bookmark>) => setBms((prev) => prev.map((b, idx) => idx === i ? { ...b, ...patch } : b))
  const add = () => setBms((prev) => [...prev, { title: 'New bookmark', page: 0 }])
  const remove = (i: number) => setBms((prev) => prev.filter((_, idx) => idx !== i))
  const save = async () => {
    const bytes = await writeFlatBookmarks(state.pdfBytes, bms)
    useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({ ...prev, pdfBytes: bytes }))
    useTabStore.getState().setTabDirty(tabId, true)
    onStatus(`Wrote ${bms.length} bookmark(s) to document.`)
  }

  return (
    <div data-testid="section-bookmarks">
      <h4 style={{ marginTop: 0, fontSize: 13 }}>Bookmarks / Outline</h4>
      {bms.map((bm, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          <input data-testid={`bm-title-${i}`} style={inp} value={bm.title} onChange={(e) => update(i, { title: e.target.value })} />
          <input data-testid={`bm-page-${i}`} type="number" min={0} style={{ ...inp, width: 80 }} value={bm.page + 1} onChange={(e) => update(i, { page: Number(e.target.value) - 1 })} />
          <button onClick={() => remove(i)} style={{ ...btnSecondary, background: 'var(--danger)', color: '#fff' }}>✕</button>
        </div>
      ))}
      <div style={row}>
        <button data-testid="bm-add" style={btnSecondary} onClick={add}>+ Add bookmark</button>
        <button data-testid="bm-save" style={btn} onClick={save}>Save bookmarks</button>
      </div>
    </div>
  )
}

function TextSection({ state, tabId, onStatus }: { state: PdfFormatState; tabId: string; onStatus: (s: string) => void }) {
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)

  const doFind = () => {
    const matches = findAcrossPages(state.pages, find, { caseSensitive })
    onStatus(`${matches.length} match(es) across ${new Set(matches.map((m) => m.pageIndex)).size} page(s).`)
  }
  const doReplace = () => {
    const res = replaceAcrossPages(state.pages, find, replace, { caseSensitive })
    useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({ ...prev, pages: res.pages }))
    useTabStore.getState().setTabDirty(tabId, true)
    onStatus(`Replaced ${res.replacements} occurrence(s).`)
  }
  const doSpell = () => {
    const flags = spellCheckPages(state.pages)
    onStatus(`${flags.length} possible typo(s): ${flags.slice(0, 5).map((f) => f.word).join(', ')}${flags.length > 5 ? '…' : ''}`)
  }
  const doReadAloud = () => {
    const u = readPageAloud(state, 0)
    onStatus(u ? 'Speaking page 1…' : 'Nothing to read on page 1.')
  }
  const doStop = () => { stopReading(); onStatus('Stopped.') }

  return (
    <div data-testid="section-text">
      <h4 style={{ marginTop: 0, fontSize: 13 }}>Find &amp; Replace</h4>
      <label style={label}>Find</label><input data-testid="find-input" style={inp} value={find} onChange={(e) => setFind(e.target.value)} />
      <label style={{ ...label, marginTop: 8 }}>Replace with</label><input data-testid="replace-input" style={inp} value={replace} onChange={(e) => setReplace(e.target.value)} />
      <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <input type="checkbox" data-testid="find-case" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} /> Case sensitive
      </label>
      <div style={row}>
        <button data-testid="find-go" style={btnSecondary} onClick={doFind}>Find all</button>
        <button data-testid="replace-go" style={btn} onClick={doReplace}>Replace all</button>
      </div>

      <h4 style={{ marginTop: 18, fontSize: 13 }}>Spell Check</h4>
      <div style={row}><button data-testid="spell-go" style={btnSecondary} onClick={doSpell}>Scan for typos</button></div>

      <h4 style={{ marginTop: 18, fontSize: 13 }}>Read Aloud</h4>
      <div style={row}>
        <button data-testid="read-go" style={btnSecondary} onClick={doReadAloud}>Read page 1</button>
        <button data-testid="read-stop" style={btnSecondary} onClick={doStop}>Stop</button>
      </div>
    </div>
  )
}

function CompareSection({ state, onStatus }: { state: PdfFormatState; onStatus: (s: string) => void }) {
  const [result, setResult] = useState<null | { pages: number; inserted: number; deleted: number; similarity: number }>(null)
  const pickAndCompare = () => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = 'application/pdf'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const other = new Uint8Array(await file.arrayBuffer())
      const r = await comparePdfs(state.pdfBytes, other)
      setResult({ pages: r.pages.length, inserted: r.summary.inserted, deleted: r.summary.deleted, similarity: r.summary.similarity })
      onStatus(`Compared: ${Math.round(r.summary.similarity * 100)}% similar · +${r.summary.inserted} / −${r.summary.deleted} lines`)
    }
    input.click()
  }
  return (
    <div data-testid="section-compare">
      <h4 style={{ marginTop: 0, fontSize: 13 }}>Compare Documents</h4>
      <div style={row}><button data-testid="compare-pick" style={btn} onClick={pickAndCompare}>Pick second PDF…</button></div>
      {result && (
        <div data-testid="compare-result" style={{ marginTop: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
          <div>Pages compared: {result.pages}</div>
          <div>Lines inserted: <strong style={{ color: 'var(--success)' }}>+{result.inserted}</strong></div>
          <div>Lines deleted: <strong style={{ color: 'var(--danger)' }}>−{result.deleted}</strong></div>
          <div>Similarity: <strong>{(result.similarity * 100).toFixed(1)}%</strong></div>
        </div>
      )}
    </div>
  )
}

function ThumbnailSection({ state, tabId, onStatus }: { state: PdfFormatState; tabId: string; onStatus: (s: string) => void }) {
  const [sourcePage, setSourcePage] = useState(1)
  const [coverMode, setCoverMode] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [lastImage, setLastImage] = useState<Uint8Array | null>(null)

  // Previously-picked image persisted as data URL
  const urlOf = (bytes: Uint8Array, mime = 'image/png') => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return URL.createObjectURL(new Blob([bytes as any], { type: mime }))
  }

  const useSelectedPage = async () => {
    const bytes = await setPdfThumbnailFromPage(state.pdfBytes, sourcePage - 1, coverMode)
    // Also grab that page as a preview image for the UI
    const imgs = await pdfToImages(state.pdfBytes, { scale: 1 })
    const pngBytes = imgs[sourcePage - 1] ?? imgs[0]
    if (pngBytes) {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(urlOf(pngBytes))
      setLastImage(pngBytes)
    }
    useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({ ...prev, pdfBytes: bytes }))
    useTabStore.getState().setTabDirty(tabId, true)
    onStatus(`Thumbnail set from page ${sourcePage}${coverMode ? ' (+ cover page prepended)' : ''}.`)
  }

  const pickImage = () => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = 'image/png,image/jpeg'
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return
      const imageBytes = new Uint8Array(await file.arrayBuffer())
      const bytes = await setPdfThumbnail(state.pdfBytes, {
        imageBytes,
        pagesForEmbed: 'all',
        prependCoverPage: coverMode,
      })
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(urlOf(imageBytes, file.type || 'image/png'))
      setLastImage(imageBytes)
      useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({ ...prev, pdfBytes: bytes }))
      useTabStore.getState().setTabDirty(tabId, true)
      onStatus(`Thumbnail set from ${file.name}${coverMode ? ' (+ cover page prepended)' : ''}.`)
    }
    input.click()
  }

  return (
    <div data-testid="section-thumbnail">
      <h4 style={{ marginTop: 0, fontSize: 13 }}>Custom Thumbnail</h4>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
        Embeds a thumbnail image in the PDF (shown by Acrobat-class viewers) and optionally adds a cover page
        at the front of the document.
      </div>

      <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <input
          type="checkbox"
          data-testid="thumb-cover-mode"
          checked={coverMode}
          onChange={(e) => setCoverMode(e.target.checked)}
        />
        Also prepend as cover page (page 1)
      </label>

      <h5 style={{ fontSize: 12, marginBottom: 6 }}>Use a page from this PDF</h5>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input
          data-testid="thumb-page-num"
          type="number" min={1} max={state.pageCount}
          value={sourcePage}
          onChange={(e) => setSourcePage(Math.max(1, Math.min(state.pageCount, Number(e.target.value))))}
          style={{ ...inp, width: 80 }}
        />
        <button data-testid="thumb-use-page" onClick={useSelectedPage} style={btn}>Use page {sourcePage}</button>
      </div>

      <h5 style={{ fontSize: 12, marginBottom: 6 }}>Or upload your own image</h5>
      <div style={row}>
        <button data-testid="thumb-upload" onClick={pickImage} style={btnSecondary}>Choose PNG or JPG…</button>
      </div>

      {previewUrl && (
        <div data-testid="thumb-preview-box" style={{ marginTop: 14, padding: 8, background: 'var(--bg-surface)', borderRadius: 3 }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Current thumbnail</div>
          <img data-testid="thumb-preview" src={previewUrl} style={{ maxHeight: 140, display: 'block', border: '1px solid var(--border)', borderRadius: 3 }} />
          {lastImage && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
              {lastImage.byteLength.toLocaleString()} bytes · {lastImage[0] === 0x89 ? 'PNG' : 'JPG'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function OptimizeSection({ state, tabId, onStatus }: { state: PdfFormatState; tabId: string; onStatus: (s: string) => void }) {
  const before = state.pdfBytes.byteLength
  const run = async () => {
    const out = await compressPdf(state.pdfBytes)
    useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({ ...prev, pdfBytes: out }))
    useTabStore.getState().setTabDirty(tabId, true)
    onStatus(`Optimized: ${before} → ${out.byteLength} bytes (${(100 * (before - out.byteLength) / before).toFixed(1)}% saved).`)
  }
  return (
    <div data-testid="section-optimize">
      <h4 style={{ marginTop: 0, fontSize: 13 }}>Compress / Optimize</h4>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>Current size: <strong>{before.toLocaleString()} bytes</strong></div>
      <button data-testid="optimize-go" style={btn} onClick={run}>Optimize now</button>
    </div>
  )
}
