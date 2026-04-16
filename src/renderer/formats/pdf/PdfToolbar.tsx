import { useState } from 'react'
import type { FormatViewerProps } from '../types'
import { useUIStore } from '../../stores/uiStore'
import { useFormatStore } from '../../stores/formatStore'
import { useTabStore } from '../../stores/tabStore'
import type { Tool } from '../../types/pdf'
import type { PdfFormatState } from './index'
import { STAMPS } from '../../components/editor/StampTool'
import WatermarkDialog, { type WatermarkOptions } from './WatermarkDialog'
import PasswordDialog from './PasswordDialog'
import PdfPageManager from './PdfPageManager'
import PdfMergeDialog from './PdfMergeDialog'
import OcrDialog from './OcrDialog'
import HeaderFooterDialog from './HeaderFooterDialog'
import FontPicker from './FontPicker'
import PageSizeDialog from './PageSizeDialog'
import PdfAdvancedDialog from './PdfAdvancedDialog'
import SnipPinDialog from './SnipPinDialog'
import BatchDialog from './BatchDialog'
import VisualCompareDialog from './VisualCompareDialog'
import { useViewerFeatures } from '../../services/viewerFeatures'
import { useFormatStore as useFS } from '../../stores/formatStore'

type RibbonTab = 'Home' | 'Insert' | 'Annotate' | 'Review' | 'Protect' | 'Pages' | 'Tools' | 'FillSign' | 'Batch'

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 48, 60, 72]

const LINE_SPACINGS = [1.0, 1.15, 1.5, 2.0]

export default function PdfToolbar({ tabId }: FormatViewerProps) {
  const ui = useUIStore()
  const vf = useViewerFeatures()
  const [ribbonTab, setRibbonTab] = useState<RibbonTab>('Home')
  const [showWatermark, setShowWatermark] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showPageManager, setShowPageManager] = useState(false)
  const [showMerge, setShowMerge] = useState(false)
  const [showOcr, setShowOcr] = useState(false)
  const [showHeaderFooter, setShowHeaderFooter] = useState(false)
  const [showPageSize, setShowPageSize] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showSnipPin, setShowSnipPin] = useState(false)
  const [showBatchPrint, setShowBatchPrint] = useState(false)
  const [showBatchRename, setShowBatchRename] = useState(false)
  const [showFileCollect, setShowFileCollect] = useState(false)
  const [showVisualCompare, setShowVisualCompare] = useState(false)

  const handleWatermark = (text: string, options: WatermarkOptions) => {
    useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({
      ...prev,
      pages: prev.pages.map((p) => {
        const existing = p.fabricJSON as any || { version: '6.4.0', objects: [] }
        return {
          ...p,
          fabricJSON: {
            ...existing,
            objects: [...(existing.objects || []), {
              type: 'textbox', text, left: 200, top: 350,
              fontSize: options.fontSize, fill: options.color, opacity: options.opacity,
              angle: options.angle, fontFamily: 'Impact, sans-serif', fontWeight: 'bold',
              textAlign: 'center', width: 400, selectable: true, editable: false
            }]
          }
        }
      })
    }))
    useTabStore.getState().setTabDirty(tabId, true)
    setShowWatermark(false)
  }

  const handlePassword = (userPassword: string, ownerPassword: string) => {
    useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({
      ...prev, encryption: { userPassword, ownerPassword }
    } as any))
    useTabStore.getState().setTabDirty(tabId, true)
    setShowPassword(false)
  }

  const ribbonTabs: RibbonTab[] = ['Home', 'Insert', 'Annotate', 'Review', 'FillSign', 'Protect', 'Pages', 'Tools', 'Batch']
  const tabLabel = (t: RibbonTab) => t === 'FillSign' ? 'Fill & Sign' : t

  return (
    <div style={{ background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Tab strip */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {ribbonTabs.map((tab) => (
          <button key={tab} onClick={() => setRibbonTab(tab)} style={{
            padding: '4px 16px', fontSize: 11, fontWeight: ribbonTab === tab ? 600 : 400,
            color: ribbonTab === tab ? 'var(--accent)' : 'var(--text-secondary)',
            borderBottom: ribbonTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
            background: 'transparent', cursor: 'pointer', transition: 'all 0.1s'
          }}
            onMouseEnter={(e) => { if (ribbonTab !== tab) e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >{tabLabel(tab)}</button>
        ))}
      </div>

      {/* Ribbon content. Horizontal scroll lets narrow windows reach every
          group; vertical stays visible so portaled popovers (FontPicker) and
          any future tooltips are not clipped. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, flex: 1, padding: '0 4px', overflowX: 'auto', overflowY: 'visible' }}>
        {ribbonTab === 'Home' && (
          <>
            <RibbonGroup label="Select">
              <RBtn text="Select" active={ui.tool === 'select'} onClick={() => ui.setTool('select')} />
            </RibbonGroup>
            <RibbonGroup label="Text">
              <RBtn text="Edit Text" active={ui.tool === 'edit_text'}
                onClick={() => ui.setTool(ui.tool === 'edit_text' ? 'select' : 'edit_text')} />
              <RBtn text="Add Text" active={ui.tool === 'text'} onClick={() => ui.setTool('text')} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
                <FontPicker />
                <select value={ui.textOptions.fontSize}
                  onChange={(e) => ui.setTextOptions({ fontSize: Number(e.target.value) })}
                  style={{ width: 48, fontSize: 10, padding: '2px 4px' }}>
                  {FONT_SIZES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <input type="color" value={ui.textOptions.color}
                  onChange={(e) => ui.setTextOptions({ color: e.target.value })}
                  style={{ width: 20, height: 18, border: 'none', cursor: 'pointer', padding: 0 }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <MiniBtn text="B" active={ui.textOptions.bold} onClick={() => ui.setTextOptions({ bold: !ui.textOptions.bold })} bold />
                <MiniBtn text="I" active={ui.textOptions.italic} onClick={() => ui.setTextOptions({ italic: !ui.textOptions.italic })} italic />
                <MiniBtn text="U" active={ui.textOptions.underline} onClick={() => ui.setTextOptions({ underline: !ui.textOptions.underline })} />
                <MiniBtn text="S" active={ui.textOptions.strikethrough} onClick={() => ui.setTextOptions({ strikethrough: !ui.textOptions.strikethrough })} />
                <span style={{ width: 1, height: 14, background: 'var(--border)', margin: '0 2px' }} />
                <MiniBtn text="&#8676;" active={ui.textOptions.textAlign === 'left'} onClick={() => ui.setTextOptions({ textAlign: 'left' })} />
                <MiniBtn text="&#8700;" active={ui.textOptions.textAlign === 'center'} onClick={() => ui.setTextOptions({ textAlign: 'center' })} />
                <MiniBtn text="&#8677;" active={ui.textOptions.textAlign === 'right'} onClick={() => ui.setTextOptions({ textAlign: 'right' })} />
                <span style={{ width: 1, height: 14, background: 'var(--border)', margin: '0 2px' }} />
                <select value={ui.textOptions.lineHeight}
                  onChange={(e) => ui.setTextOptions({ lineHeight: Number(e.target.value) })}
                  style={{ width: 46, fontSize: 10, padding: '2px 2px' }}
                  title="Line spacing">
                  {LINE_SPACINGS.map((s) => (
                    <option key={s} value={s}>{s.toFixed(s === 1 ? 1 : 2)}</option>
                  ))}
                </select>
              </div>
            </RibbonGroup>
            <RibbonGroup label="Draw">
              <RBtn text="Freehand" active={ui.tool === 'draw'} onClick={() => ui.setTool('draw')} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <input type="color" value={ui.drawingOptions.color}
                  onChange={(e) => ui.setDrawingOptions({ color: e.target.value })}
                  style={{ width: 20, height: 18, border: 'none', cursor: 'pointer', padding: 0 }} />
                <input type="range" min={1} max={20} value={ui.drawingOptions.width}
                  onChange={(e) => ui.setDrawingOptions({ width: Number(e.target.value) })}
                  style={{ width: 50, accentColor: 'var(--accent)' }} />
              </div>
            </RibbonGroup>
            <RibbonGroup label="Sign">
              <RBtn text="Signature" active={ui.tool === 'signature'} onClick={() => ui.setTool('signature')} />
            </RibbonGroup>
          </>
        )}

        {ribbonTab === 'Insert' && (
          <>
            <RibbonGroup label="Content">
              <RBtn text="Image" active={ui.tool === 'image'} onClick={() => ui.setTool('image')} />
              <RBtn text="Sticky Note" active={ui.tool === 'sticky_note'} onClick={() => ui.setTool('sticky_note')} />
            </RibbonGroup>
            <RibbonGroup label="Page Layout">
              <RBtn text="Headers & Footers" onClick={() => setShowHeaderFooter(true)} />
              <span style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.3 }}>Add page numbers,<br/>dates, custom text</span>
            </RibbonGroup>
            <RibbonGroup label="Shapes">
              <RBtn text="Rectangle" active={ui.tool === 'shape_rect'} onClick={() => ui.setTool('shape_rect')} />
              <RBtn text="Ellipse" active={ui.tool === 'shape_circle'} onClick={() => ui.setTool('shape_circle')} />
              <RBtn text="Line" active={ui.tool === 'shape_line'} onClick={() => ui.setTool('shape_line')} />
              <RBtn text="Arrow" active={ui.tool === 'shape_arrow'} onClick={() => ui.setTool('shape_arrow')} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                <input type="color" value={ui.shapeColor} onChange={(e) => ui.setShapeColor(e.target.value)}
                  style={{ width: 20, height: 18, border: 'none', cursor: 'pointer', padding: 0 }} />
                <input type="range" min={1} max={8} value={ui.shapeStrokeWidth}
                  onChange={(e) => ui.setShapeStrokeWidth(Number(e.target.value))}
                  style={{ width: 50, accentColor: 'var(--accent)' }} />
              </div>
            </RibbonGroup>
            <RibbonGroup label="Stamps">
              {STAMPS.slice(0, 5).map((s, i) => (
                <RBtn key={i} text={s.text} active={ui.tool === 'stamp' && ui.selectedStamp === i}
                  onClick={() => { ui.setSelectedStamp(i); ui.setTool('stamp') }}
                  color={s.color} small />
              ))}
              {STAMPS.slice(5).map((s, i) => (
                <RBtn key={i + 5} text={s.text} active={ui.tool === 'stamp' && ui.selectedStamp === i + 5}
                  onClick={() => { ui.setSelectedStamp(i + 5); ui.setTool('stamp') }}
                  color={s.color} small />
              ))}
            </RibbonGroup>
            <RibbonGroup label="Media">
              <RBtn text="Link" active={ui.tool === 'link'} onClick={() => ui.setTool('link')} />
              <RBtn text="Audio" active={ui.tool === 'audio'} onClick={() => ui.setTool('audio')} />
              <RBtn text="Video" active={ui.tool === 'video'} onClick={() => ui.setTool('video')} />
            </RibbonGroup>
          </>
        )}

        {ribbonTab === 'Annotate' && (
          <>
            <RibbonGroup label="Highlight">
              <RBtn text="Highlight" active={ui.tool === 'highlight'} onClick={() => ui.setTool('highlight')} />
              <RBtn text="Highlight Area" active={ui.tool === 'highlight_area'} onClick={() => ui.setTool('highlight_area')} />
              <RBtn text="Underline" active={ui.tool === 'underline'} onClick={() => ui.setTool('underline')} />
              <RBtn text="Strikethrough" active={ui.tool === 'strikethrough'} onClick={() => ui.setTool('strikethrough')} />
              <div style={{ display: 'flex', gap: 3, marginTop: 2 }}>
                {['#f9e2af', '#a6e3a1', '#89b4fa', '#f38ba8', '#cba6f7'].map((c) => (
                  <button key={c} onClick={() => ui.setHighlightColor(c)} style={{
                    width: 16, height: 16, borderRadius: 2, border: c === ui.highlightColor ? '2px solid #fff' : '1px solid var(--border)',
                    background: c, cursor: 'pointer', padding: 0
                  }} />
                ))}
              </div>
            </RibbonGroup>
            <RibbonGroup label="Comment">
              <RBtn text="Text Box" active={ui.tool === 'textbox_note'} onClick={() => ui.setTool('textbox_note')} />
              <RBtn text="Insert Text" active={ui.tool === 'insert_text_marker'} onClick={() => ui.setTool('insert_text_marker')} />
              <RBtn text="Replace Text" active={ui.tool === 'replace_text_marker'} onClick={() => ui.setTool('replace_text_marker')} />
              <RBtn text="Wipe Off" active={ui.tool === 'wipe_off'} onClick={() => ui.setTool('wipe_off')} />
            </RibbonGroup>
            <RibbonGroup label="Redaction">
              <RBtn text="Redact" active={ui.tool === 'redact'} onClick={() => ui.setTool('redact')} />
            </RibbonGroup>
            <RibbonGroup label="Measure">
              <RBtn text="Measure" active={ui.tool === 'measure'} onClick={() => ui.setTool('measure')} />
            </RibbonGroup>
            <RibbonGroup label="View">
              <RBtn text={vf.hideAnnotations ? 'Show Annotations' : 'Hide Annotations'}
                active={vf.hideAnnotations}
                onClick={() => vf.setHideAnnotations(!vf.hideAnnotations)} />
            </RibbonGroup>
          </>
        )}

        {ribbonTab === 'Review' && (
          <>
            <RibbonGroup label="Find">
              <RBtn text="Search" active={ui.searchVisible} onClick={() => ui.toggleSearch()} />
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Ctrl+F</span>
            </RibbonGroup>
            <RibbonGroup label="Print">
              <RBtn text="Print" onClick={() => window.api?.print?.pdf ? window.api.print.pdf() : window.print()} />
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Ctrl+P</span>
            </RibbonGroup>
            <RibbonGroup label="Text Recognition">
              <RBtn text="OCR" onClick={() => setShowOcr(true)} />
              <span style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.3 }}>Extract text from<br/>scanned pages</span>
            </RibbonGroup>
          </>
        )}

        {ribbonTab === 'Protect' && (
          <>
            <RibbonGroup label="Watermark">
              <RBtn text="Add Watermark" onClick={() => setShowWatermark(true)} />
            </RibbonGroup>
            <RibbonGroup label="Encrypt">
              <RBtn text="Password Protect" onClick={() => setShowPassword(true)} />
            </RibbonGroup>
            <RibbonGroup label="Certificate">
              <RBtn text="Certificate Signature" onClick={() => setShowAdvanced(true)} />
              <RBtn text="Manage Certificates" onClick={() => setShowAdvanced(true)} />
              <RBtn text="Validate Signature" onClick={() => setShowAdvanced(true)} />
            </RibbonGroup>
            <RibbonGroup label="Time Stamp">
              <RBtn text="Time Stamp" active={ui.tool === 'fill_timestamp'} onClick={() => ui.setTool('fill_timestamp')} />
            </RibbonGroup>
          </>
        )}

        {ribbonTab === 'FillSign' && (
          <>
            <RibbonGroup label="Marks">
              <RBtn text="Text Comment" active={ui.tool === 'textbox_note'} onClick={() => ui.setTool('textbox_note')} />
              <RBtn text="✕ Cross" active={ui.tool === 'fill_cross'} onClick={() => ui.setTool('fill_cross')} />
              <RBtn text="✓ Check" active={ui.tool === 'fill_check'} onClick={() => ui.setTool('fill_check')} />
              <RBtn text="◯ Circle" active={ui.tool === 'fill_circle'} onClick={() => ui.setTool('fill_circle')} />
              <RBtn text="─ Line" active={ui.tool === 'fill_line'} onClick={() => ui.setTool('fill_line')} />
              <RBtn text="• Dot" active={ui.tool === 'fill_dot'} onClick={() => ui.setTool('fill_dot')} />
            </RibbonGroup>
            <RibbonGroup label="Insert">
              <RBtn text="Add Picture" active={ui.tool === 'image'} onClick={() => ui.setTool('image')} />
              <RBtn text="Add Date" active={ui.tool === 'fill_date'} onClick={() => ui.setTool('fill_date')} />
            </RibbonGroup>
            <RibbonGroup label="Signature">
              <RBtn text="Add Signature" active={ui.tool === 'signature'} onClick={() => ui.setTool('signature')} />
              <RBtn text="Add Initials" active={ui.tool === 'fill_initials'} onClick={() => ui.setTool('fill_initials')} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Initials:</span>
                <input
                  type="text"
                  value={ui.initials}
                  onChange={(e) => ui.setInitials(e.target.value.slice(0, 4))}
                  style={{ width: 40, fontSize: 11, padding: '1px 4px' }}
                  maxLength={4}
                />
              </div>
            </RibbonGroup>
            <RibbonGroup label="Certificate">
              <RBtn text="Certificate Signature" onClick={() => setShowAdvanced(true)} />
            </RibbonGroup>
          </>
        )}

        {ribbonTab === 'Pages' && (
          <>
            <RibbonGroup label="Manage">
              <RBtn text="Page Manager" onClick={() => setShowPageManager(true)} />
              <span style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.3 }}>Reorder, rotate,<br/>delete pages</span>
            </RibbonGroup>
            <RibbonGroup label="Combine">
              <RBtn text="Merge PDFs" onClick={() => setShowMerge(true)} />
              <span style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.3 }}>Combine multiple<br/>PDFs into one</span>
            </RibbonGroup>
            <RibbonGroup label="Size">
              <RBtn text="Page Size" onClick={() => setShowPageSize(true)} />
              <span style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.3 }}>Change page<br/>dimensions</span>
            </RibbonGroup>
          </>
        )}

        {ribbonTab === 'Tools' && (
          <>
            <RibbonGroup label="Advanced">
              <RBtn text="Advanced Tools…" onClick={() => setShowAdvanced(true)} />
            </RibbonGroup>
            <RibbonGroup label="Document">
              <RBtn text="PDF Compressor" onClick={() => setShowAdvanced(true)} />
              <RBtn text="Merge PDF" onClick={() => setShowMerge(true)} />
              <RBtn text="Split PDF" onClick={() => setShowAdvanced(true)} />
            </RibbonGroup>
            <RibbonGroup label="Text">
              <RBtn text="Extract Text" onClick={() => setShowAdvanced(true)} />
              <RBtn text="Find &amp; Replace" onClick={() => setShowAdvanced(true)} />
            </RibbonGroup>
            <RibbonGroup label="Capture">
              <RBtn text="Snip &amp; Pin" onClick={() => setShowSnipPin(true)} />
            </RibbonGroup>
            <RibbonGroup label="Compare">
              <RBtn text="Compare Docs" onClick={() => setShowVisualCompare(true)} />
            </RibbonGroup>
            <RibbonGroup label="Batch">
              <RBtn text="Batch Rename" onClick={() => setShowBatchRename(true)} />
              <RBtn text="Batch Print" onClick={() => setShowBatchPrint(true)} />
              <RBtn text="File Collect" onClick={() => setShowFileCollect(true)} />
            </RibbonGroup>
            <RibbonGroup label="Layout">
              <RBtn text="Form Designer" active={ui.tool === 'form_designer'}
                onClick={() => ui.setTool(ui.tool === 'form_designer' ? 'select' : 'form_designer')} />
              <RBtn text="Rulers" active={ui.showRulers} onClick={() => ui.toggleRulers()} />
              <RBtn text="Grid" active={ui.showGrid} onClick={() => ui.toggleGrid()} />
              <RBtn text="Layers" active={ui.showLayers} onClick={() => ui.toggleLayers()} />
            </RibbonGroup>
            <RibbonGroup label="View">
              <RBtn text={vf.autoScroll ? 'Stop Auto Scroll' : 'Auto Scroll'}
                active={vf.autoScroll}
                onClick={() => vf.setAutoScroll(!vf.autoScroll)} />
              <RBtn text={vf.eyeProtection ? 'Normal View' : 'Eye Protection'}
                active={vf.eyeProtection}
                onClick={() => vf.setEyeProtection(!vf.eyeProtection)} />
            </RibbonGroup>
          </>
        )}

        {ribbonTab === 'Batch' && (
          <>
            <RibbonGroup label="Convert">
              <RBtn text="PDF → Word" onClick={() => setShowAdvanced(true)} />
              <RBtn text="PDF → PPT" onClick={() => setShowAdvanced(true)} />
              <RBtn text="PDF → Excel" onClick={() => setShowAdvanced(true)} />
              <RBtn text="To Image-only PDF" onClick={() => setShowAdvanced(true)} />
            </RibbonGroup>
            <RibbonGroup label="Document">
              <RBtn text="Compress" onClick={() => setShowAdvanced(true)} />
              <RBtn text="Merge PDF" onClick={() => setShowMerge(true)} />
              <RBtn text="Split PDF" onClick={() => setShowAdvanced(true)} />
            </RibbonGroup>
            <RibbonGroup label="Multi-file">
              <RBtn text="Batch PDF Printing" onClick={() => setShowBatchPrint(true)} />
              <RBtn text="Batch Rename Files" onClick={() => setShowBatchRename(true)} />
            </RibbonGroup>
          </>
        )}
      </div>

      {showWatermark && <WatermarkDialog onClose={() => setShowWatermark(false)} onApply={handleWatermark} />}
      {showPassword && <PasswordDialog onClose={() => setShowPassword(false)} onApply={handlePassword} />}
      {showPageManager && <PdfPageManager tabId={tabId} onClose={() => setShowPageManager(false)} />}
      {showMerge && <PdfMergeDialog onClose={() => setShowMerge(false)} />}
      {showOcr && <OcrDialog tabId={tabId} onClose={() => setShowOcr(false)} />}
      {showHeaderFooter && <HeaderFooterDialog tabId={tabId} onClose={() => setShowHeaderFooter(false)} />}
      {showPageSize && <PageSizeDialog tabId={tabId} onClose={() => setShowPageSize(false)} />}
      {showAdvanced && <PdfAdvancedDialog tabId={tabId} onClose={() => setShowAdvanced(false)} />}
      {showSnipPin && <SnipPinDialog tabId={tabId} onClose={() => setShowSnipPin(false)} />}
      {showBatchPrint && <BatchDialog mode="print" onClose={() => setShowBatchPrint(false)} />}
      {showBatchRename && <BatchDialog mode="rename" onClose={() => setShowBatchRename(false)} />}
      {showFileCollect && <BatchDialog mode="collect" onClose={() => setShowFileCollect(false)} />}
      {showVisualCompare && (() => {
        const st = useFS.getState().data[tabId] as PdfFormatState | undefined
        return st ? <VisualCompareDialog leftBytes={st.pdfBytes} onClose={() => setShowVisualCompare(false)} /> : null
      })()}
    </div>
  )
}

/* ---- Ribbon building blocks ---- */

function RibbonGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
      padding: '4px 10px', borderRight: '1px solid var(--border)',
      gap: 2, minWidth: 0
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center' }}>
        {children}
      </div>
      <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 'auto' }}>
        {label}
      </span>
    </div>
  )
}

// Ribbon controls use onMouseDown={preventDefault} so a click does not pull
// focus away from an in-edit Fabric Textbox. Without this, clicking e.g.
// the B button while typing exits editing mode and can feel like the
// textbox "deselected".
const preventFocusSteal = (e: React.MouseEvent<HTMLButtonElement>) => e.preventDefault()

function RBtn({ text, active, onClick, color, small, bold: _bold, italic: _italic }: {
  text: string; active?: boolean; onClick?: () => void; color?: string; small?: boolean; bold?: boolean; italic?: boolean
}) {
  return (
    <button onClick={onClick} onMouseDown={preventFocusSteal} style={{
      padding: small ? '2px 6px' : '3px 10px',
      fontSize: small ? 9 : 11,
      borderRadius: 3,
      background: active ? 'var(--accent)' : 'var(--bg-surface)',
      color: active ? 'var(--bg-primary)' : color || 'var(--text-primary)',
      fontWeight: active ? 600 : 400,
      cursor: 'pointer', border: 'none', whiteSpace: 'nowrap',
      transition: 'all 0.1s'
    }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-surface)' }}
    >{text}</button>
  )
}

function MiniBtn({ text, active, onClick, bold, italic }: {
  text: string; active?: boolean; onClick?: () => void; bold?: boolean; italic?: boolean
}) {
  return (
    <button onClick={onClick} onMouseDown={preventFocusSteal} style={{
      width: 20, height: 20, fontSize: 11, borderRadius: 2,
      background: active ? 'var(--accent)' : 'var(--bg-surface)',
      color: active ? 'var(--bg-primary)' : 'var(--text-primary)',
      fontWeight: bold ? 700 : 400, fontStyle: italic ? 'italic' : 'normal',
      cursor: 'pointer', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>{text}</button>
  )
}
