// Unified batch operations dialog: PDF Print, PDF Rename, File Collect,
// batch conversion. Accepts a file-picker selection, runs the chosen
// op over each file, and either downloads results or opens Print.

import { useState } from 'react'
import { compressPdf } from '../../services/pdfOps'
import { pdfToText, pdfToExcel, pdfToPpt, toImageOnlyPdf } from '../../services/pdfConvert'
import { pdfToWord } from '../../services/pdfToWord'

type Mode = 'print' | 'rename' | 'collect' | 'convert'

interface Props {
  mode: Mode
  onClose: () => void
}

async function download(_name: string, bytes: Uint8Array, _mime = 'application/octet-stream') {
  await window.api.file.saveAs(bytes)
}

const title: Record<Mode, string> = {
  print: 'Batch PDF Printing',
  rename: 'Batch Rename Files',
  collect: 'File Collect',
  convert: 'Batch Convert',
}

export default function BatchDialog({ mode, onClose }: Props) {
  const [files, setFiles] = useState<File[]>([])
  const [pattern, setPattern] = useState('{name}-{n}')
  const [prefix, setPrefix] = useState('')
  const [target, setTarget] = useState<'word' | 'ppt' | 'excel' | 'txt' | 'imgonly' | 'compress'>('compress')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const pick = () => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = 'application/pdf'; input.multiple = true
    input.onchange = () => { setFiles(input.files ? Array.from(input.files) : []) }
    input.click()
  }

  const pickFolder = async () => {
    if (!window.api?.folder?.pick) { setStatus('Folder pick requires Electron.'); return }
    const result = await window.api.folder.pick(['.pdf'])
    if (!result || result.length === 0) { setStatus('No PDF files found in folder.'); return }
    // Convert IPC results to File-like objects for the existing pipeline
    const fileList = result.map(f => new File([f.bytes], f.name, { type: 'application/pdf' }))
    setFiles(fileList)
    setStatus(`Found ${fileList.length} PDF(s) in folder.`)
  }

  const runPrint = async () => {
    setBusy(true)
    for (const f of files) {
      const bytes = new Uint8Array(await f.arrayBuffer())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blob = new Blob([bytes as any], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const w = window.open(url, '_blank')
      if (w) setTimeout(() => { try { w.print() } catch {} }, 800)
    }
    setStatus(`Opened ${files.length} file(s) for printing.`)
    setBusy(false)
  }

  const runRename = async () => {
    setBusy(true)
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const name = pattern.replace('{name}', f.name.replace(/\.pdf$/i, '')).replace('{n}', String(i + 1).padStart(3, '0')).replace('{prefix}', prefix) + '.pdf'
      const buf = await f.arrayBuffer()
      await download(name, new Uint8Array(buf), 'application/pdf')
    }
    setStatus(`Renamed & downloaded ${files.length} file(s).`)
    setBusy(false)
  }

  const runCollect = async () => {
    setBusy(true)
    // "Collect" = zip-less grouping — just re-download each file with a common prefix
    for (let i = 0; i < files.length; i++) {
      const bytes = new Uint8Array(await files[i].arrayBuffer())
      await download(`${prefix || 'collected'}-${String(i + 1).padStart(3, '0')}.pdf`, bytes, 'application/pdf')
    }
    setStatus(`Collected ${files.length} file(s) into prefix "${prefix || 'collected'}".`)
    setBusy(false)
  }

  const runConvert = async () => {
    setBusy(true)
    for (let i = 0; i < files.length; i++) {
      const bytes = new Uint8Array(await files[i].arrayBuffer())
      const base = files[i].name.replace(/\.pdf$/i, '')
      try {
        if (target === 'compress') await download(`${base}-compressed.pdf`, await compressPdf(bytes), 'application/pdf')
        else if (target === 'word') await download(`${base}.docx`, await pdfToWord(bytes), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        else if (target === 'ppt') await download(`${base}.pptx`, await pdfToPpt(bytes), 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
        else if (target === 'excel') await download(`${base}.xlsx`, await pdfToExcel(bytes), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        else if (target === 'txt') { const t = await pdfToText(bytes); await download(`${base}.txt`, new Uint8Array(new TextEncoder().encode(t)), 'text/plain') }
        else if (target === 'imgonly') await download(`${base}-image-only.pdf`, await toImageOnlyPdf(bytes), 'application/pdf')
      } catch (e) { setStatus(`Failed on ${files[i].name}: ${(e as Error).message}`) }
    }
    setStatus(`Converted ${files.length} file(s) → ${target}.`)
    setBusy(false)
  }

  const run = () => {
    if (files.length === 0) { setStatus('Pick files first.'); return }
    if (mode === 'print') return runPrint()
    if (mode === 'rename') return runRename()
    if (mode === 'collect') return runCollect()
    if (mode === 'convert') return runConvert()
  }

  return (
    <div data-testid={`batch-${mode}`} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}
         onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'var(--bg-primary)', borderRadius:8, padding:16, minWidth:460, border:'1px solid var(--border)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>{title[mode]}</h3>
          <button onClick={onClose} style={{ fontSize: 18, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button data-testid="batch-pick" onClick={pick} style={{ padding: '6px 12px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
            Pick PDFs… ({files.length} selected)
          </button>
          <button data-testid="batch-pick-folder" onClick={pickFolder} style={{ padding: '6px 12px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
            Pick Folder…
          </button>
        </div>
        {mode === 'rename' && (
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Pattern (use {'{name}'}, {'{n}'}, {'{prefix}'})</label>
            <input data-testid="batch-pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} style={{ width: '100%', padding: 6, background:'var(--bg-surface)', color:'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3 }} />
            <label style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6, display: 'block' }}>Prefix</label>
            <input data-testid="batch-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} style={{ width: '100%', padding: 6, background:'var(--bg-surface)', color:'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3 }} />
          </div>
        )}
        {mode === 'collect' && (
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Output prefix</label>
            <input data-testid="batch-collect-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="collected" style={{ width: '100%', padding: 6, background:'var(--bg-surface)', color:'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3 }} />
          </div>
        )}
        {mode === 'convert' && (
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Target format</label>
            <select data-testid="batch-target" value={target} onChange={(e) => setTarget(e.target.value as 'compress')} style={{ width: '100%', padding: 6, background:'var(--bg-surface)', color:'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3 }}>
              <option value="compress">Compress (PDF)</option>
              <option value="word">PDF → Word (.docx)</option>
              <option value="ppt">PDF → PowerPoint (.pptx)</option>
              <option value="excel">PDF → Excel (.xlsx)</option>
              <option value="txt">PDF → TXT</option>
              <option value="imgonly">To Image-only PDF</option>
            </select>
          </div>
        )}
        <div style={{ display:'flex', gap:8, marginTop: 14 }}>
          <button data-testid="batch-run" onClick={run} disabled={busy || files.length === 0} style={{ padding: '6px 12px', background: 'var(--accent)', color: 'var(--bg-primary)', border: 'none', borderRadius: 4, cursor: busy ? 'wait' : 'pointer' }}>
            {busy ? 'Working…' : 'Run'}
          </button>
        </div>
        {status && <div data-testid="batch-status" style={{ marginTop: 10, fontSize: 11, color: 'var(--text-secondary)' }}>{status}</div>}
      </div>
    </div>
  )
}
