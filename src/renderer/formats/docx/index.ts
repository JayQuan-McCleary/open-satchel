import type { FormatHandler } from '../types'
import DocxEditor from './DocxEditor'
import DocxToolbar from './DocxToolbar'
import { useFormatStore } from '../../stores/formatStore'
import mammoth from 'mammoth'
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ExternalHyperlink,
  ImageRun,
  BorderStyle,
  LevelFormat,
  convertInchesToTwip
} from 'docx'

export interface DocxFormatState {
  html: string
  originalHtml: string
}

export const docxHandler: FormatHandler = {
  format: 'docx',
  extensions: ['docx', 'doc'],
  displayName: 'Word Document',
  icon: '📝',
  Viewer: DocxEditor,
  ToolbarExtras: DocxToolbar,

  load: async (tabId, bytes) => {
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer
    const result = await mammoth.convertToHtml(
      { arrayBuffer },
      {
        convertImage: mammoth.images.imgElement((image) =>
          image.read('base64').then((data) => ({
            src: `data:${image.contentType};base64,${data}`
          }))
        )
      }
    )
    const html = result.value
    const state: DocxFormatState = { html, originalHtml: html }
    useFormatStore.getState().setFormatState(tabId, state)
  },

  save: async (tabId) => {
    const state = useFormatStore.getState().getFormatState<DocxFormatState>(tabId)
    if (!state) throw new Error('No DOCX state')

    const doc = htmlToDocx(state.html)
    const buffer = await Packer.toBuffer(doc)
    return new Uint8Array(buffer)
  },

  cleanup: (tabId) => useFormatStore.getState().clearFormatState(tabId),

  canConvertTo: ['pdf', 'html', 'markdown'],
  capabilities: { edit: true, annotate: false, search: true, zoom: false }
}

// ── HTML → DOCX conversion ──────────────────────────────────────────

const HEADING_MAP: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  H1: HeadingLevel.HEADING_1,
  H2: HeadingLevel.HEADING_2,
  H3: HeadingLevel.HEADING_3,
  H4: HeadingLevel.HEADING_4,
  H5: HeadingLevel.HEADING_5,
  H6: HeadingLevel.HEADING_6
}

function htmlToDocx(html: string): Document {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const children = parseChildren(doc.body)

  return new Document({
    numbering: {
      config: [
        {
          reference: 'bullet-list',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '\u2022',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } }
            }
          ]
        },
        {
          reference: 'ordered-list',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } }
            }
          ]
        }
      ]
    },
    sections: [{ children }]
  })
}

type DocxChild = Paragraph | Table

function parseChildren(parent: Node): DocxChild[] {
  const result: DocxChild[] = []

  for (let i = 0; i < parent.childNodes.length; i++) {
    const node = parent.childNodes[i]

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim()
      if (text) {
        result.push(new Paragraph({ children: [new TextRun(text)] }))
      }
      continue
    }

    if (node.nodeType !== Node.ELEMENT_NODE) continue
    const el = node as HTMLElement
    const tag = el.tagName.toUpperCase()

    if (tag in HEADING_MAP) {
      result.push(
        new Paragraph({
          heading: HEADING_MAP[tag],
          children: parseInlineChildren(el)
        })
      )
    } else if (tag === 'P') {
      result.push(
        new Paragraph({
          alignment: getAlignment(el),
          children: parseInlineChildren(el)
        })
      )
    } else if (tag === 'BLOCKQUOTE') {
      const inner = parseChildren(el)
      for (const child of inner) {
        if (child instanceof Paragraph) {
          result.push(
            new Paragraph({
              indent: { left: convertInchesToTwip(0.5) },
              children: parseInlineChildren(el)
            })
          )
        } else {
          result.push(child)
        }
      }
      if (inner.length === 0) {
        result.push(
          new Paragraph({
            indent: { left: convertInchesToTwip(0.5) },
            children: parseInlineChildren(el)
          })
        )
      }
    } else if (tag === 'UL') {
      result.push(...parseList(el, 'bullet-list'))
    } else if (tag === 'OL') {
      result.push(...parseList(el, 'ordered-list'))
    } else if (tag === 'TABLE') {
      const table = parseTable(el)
      if (table) result.push(table)
    } else if (tag === 'IMG') {
      const img = parseImage(el as HTMLImageElement)
      if (img) {
        result.push(new Paragraph({ children: [img] }))
      }
    } else if (tag === 'HR') {
      result.push(
        new Paragraph({
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999' }
          },
          spacing: { after: 200 }
        })
      )
    } else if (tag === 'PRE') {
      const codeEl = el.querySelector('code')
      const text = codeEl ? codeEl.textContent || '' : el.textContent || ''
      const lines = text.split('\n')
      for (const line of lines) {
        result.push(
          new Paragraph({
            children: [
              new TextRun({
                text: line,
                font: 'Courier New',
                size: 20
              })
            ]
          })
        )
      }
    } else if (tag === 'BR') {
      result.push(new Paragraph({}))
    } else if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'MAIN' || tag === 'HEADER' || tag === 'FOOTER' || tag === 'NAV' || tag === 'ASIDE') {
      result.push(...parseChildren(el))
    } else {
      // Fallback: treat as paragraph
      const runs = parseInlineChildren(el)
      if (runs.length > 0) {
        result.push(new Paragraph({ children: runs }))
      }
    }
  }

  return result
}

function parseList(el: HTMLElement, reference: string): Paragraph[] {
  const items: Paragraph[] = []
  const listItems = el.querySelectorAll(':scope > li')
  listItems.forEach((li) => {
    items.push(
      new Paragraph({
        numbering: { reference, level: 0 },
        children: parseInlineChildren(li as HTMLElement)
      })
    )
  })
  return items
}

type InlineChild = TextRun | ExternalHyperlink | ImageRun

function parseInlineChildren(parent: HTMLElement): InlineChild[] {
  const runs: InlineChild[] = []

  for (let i = 0; i < parent.childNodes.length; i++) {
    const node = parent.childNodes[i]

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || ''
      if (text) {
        runs.push(new TextRun({ text }))
      }
      continue
    }

    if (node.nodeType !== Node.ELEMENT_NODE) continue
    const el = node as HTMLElement
    const tag = el.tagName.toUpperCase()

    if (tag === 'STRONG' || tag === 'B') {
      runs.push(...wrapRuns(el, { bold: true }))
    } else if (tag === 'EM' || tag === 'I') {
      runs.push(...wrapRuns(el, { italics: true }))
    } else if (tag === 'U') {
      runs.push(...wrapRuns(el, { underline: { type: 'single' as const } }))
    } else if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') {
      runs.push(...wrapRuns(el, { strike: true }))
    } else if (tag === 'SUP') {
      runs.push(...wrapRuns(el, { superScript: true }))
    } else if (tag === 'SUB') {
      runs.push(...wrapRuns(el, { subScript: true }))
    } else if (tag === 'CODE') {
      runs.push(
        new TextRun({
          text: el.textContent || '',
          font: 'Courier New',
          size: 20
        })
      )
    } else if (tag === 'A') {
      const href = el.getAttribute('href') || ''
      runs.push(
        new ExternalHyperlink({
          link: href,
          children: [
            new TextRun({
              text: el.textContent || href,
              style: 'Hyperlink'
            })
          ]
        })
      )
    } else if (tag === 'IMG') {
      const img = parseImage(el as HTMLImageElement)
      if (img) runs.push(img)
    } else if (tag === 'BR') {
      runs.push(new TextRun({ break: 1 }))
    } else if (tag === 'SPAN') {
      // Recurse into spans preserving inline formatting
      runs.push(...parseInlineChildren(el))
    } else {
      // Fallback: just grab text
      const text = el.textContent || ''
      if (text) runs.push(new TextRun({ text }))
    }
  }

  return runs
}

function wrapRuns(
  el: HTMLElement,
  style: Record<string, unknown>
): TextRun[] {
  const runs: TextRun[] = []
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i]
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || ''
      if (text) {
        runs.push(new TextRun({ text, ...style }))
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as HTMLElement
      const childTag = child.tagName.toUpperCase()
      // Merge nested formatting
      const merged = { ...style }
      if (childTag === 'STRONG' || childTag === 'B') merged.bold = true
      if (childTag === 'EM' || childTag === 'I') merged.italics = true
      if (childTag === 'U') merged.underline = { type: 'single' as const }
      if (childTag === 'S' || childTag === 'DEL') merged.strike = true
      runs.push(...wrapRuns(child, merged))
    }
  }
  return runs
}

function parseTable(el: HTMLElement): Table | null {
  const rows: TableRow[] = []
  const trElements = el.querySelectorAll('tr')

  trElements.forEach((tr) => {
    const cells: TableCell[] = []
    const cellElements = tr.querySelectorAll('td, th')

    cellElements.forEach((cell) => {
      cells.push(
        new TableCell({
          children: [new Paragraph({ children: parseInlineChildren(cell as HTMLElement) })],
          width: { size: 100 / cellElements.length, type: WidthType.PERCENTAGE }
        })
      )
    })

    if (cells.length > 0) {
      rows.push(new TableRow({ children: cells }))
    }
  })

  if (rows.length === 0) return null
  return new Table({ rows })
}

function parseImage(img: HTMLImageElement): ImageRun | null {
  const src = img.getAttribute('src') || ''
  if (!src.startsWith('data:')) return null

  try {
    const [meta, b64] = src.split(',')
    if (!b64) return null
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

    const width = parseInt(img.getAttribute('width') || '400', 10)
    const height = parseInt(img.getAttribute('height') || '300', 10)

    return new ImageRun({
      data: bytes,
      transformation: { width, height },
      type: meta.includes('png') ? 'png' : 'jpg'
    })
  } catch {
    return null
  }
}

function getAlignment(el: HTMLElement): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  const align = el.style.textAlign || el.getAttribute('align')
  switch (align) {
    case 'center': return AlignmentType.CENTER
    case 'right': return AlignmentType.RIGHT
    case 'justify': return AlignmentType.JUSTIFIED
    default: return undefined
  }
}
