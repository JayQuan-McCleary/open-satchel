// PDF Content Stream Tokenizer, Parser, and Serializer
//
// Parses decompressed PDF content stream bytes into structured operators,
// enabling true text editing at the content-stream level. This is the
// foundation for Acrobat-parity body text editing.
//
// PDF content streams use postfix notation:
//   BT /F1 12 Tf 100 700 Td (Hello) Tj ET
//
// Reference: ISO 32000-1:2008, Section 7.8.2 (Content Streams)

import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib'
import pako from 'pako'

// ── Types ──────────────────────────────────────────────────────────

export interface PdfString {
  type: 'literal' | 'hex'
  value: Uint8Array      // raw bytes (decoded from hex or literal escapes)
  decoded: string         // best-effort UTF-8/Latin-1 decode
}

export type TJArrayElement = {
  kind: 'string'
  value: PdfString
} | {
  kind: 'number'
  value: number
}

export interface ContentStreamOp {
  operator: string
  args: unknown[]         // numbers, PdfString, TJArrayElement[], PDFName strings
  byteOffset: number
  byteLength: number
}

export interface TextState {
  fontName: string
  fontSize: number
  x: number
  y: number
  lineX: number           // x set by Td/TD/Tm (for T* line start)
  lineY: number
}

export interface TextRun {
  text: string
  rawString: PdfString
  fontName: string
  fontSize: number
  x: number
  y: number
  opIndex: number
  isTJ: boolean           // true if part of a TJ array
  tjElementIndex?: number // index within TJ array
}

export interface ParsedContentStream {
  operators: ContentStreamOp[]
  textRuns: TextRun[]
  rawBytes: Uint8Array
}

// ── Tokenizer ──────────────────────────────────────────────────────

const enum CharCode {
  Space = 0x20,
  Tab = 0x09,
  LF = 0x0A,
  CR = 0x0D,
  FormFeed = 0x0C,
  Null = 0x00,
  LeftParen = 0x28,
  RightParen = 0x29,
  LessThan = 0x3C,
  GreaterThan = 0x3E,
  LeftBracket = 0x5B,
  RightBracket = 0x5D,
  Slash = 0x2F,
  Percent = 0x25,
  Backslash = 0x5C,
  Plus = 0x2B,
  Minus = 0x2D,
  Dot = 0x2E,
  Zero = 0x30,
  Nine = 0x39,
  A_upper = 0x41,
  F_upper = 0x46,
  a_lower = 0x61,
  f_lower = 0x66,
  n_lower = 0x6E,
  r_lower = 0x72,
  t_lower = 0x74,
  b_lower = 0x62,
}

type Token =
  | { type: 'number'; value: number; offset: number; length: number }
  | { type: 'string'; value: PdfString; offset: number; length: number }
  | { type: 'name'; value: string; offset: number; length: number }
  | { type: 'operator'; value: string; offset: number; length: number }
  | { type: 'array_start'; offset: number; length: number }
  | { type: 'array_end'; offset: number; length: number }

function isWhitespace(c: number): boolean {
  return c === CharCode.Space || c === CharCode.Tab || c === CharCode.LF ||
         c === CharCode.CR || c === CharCode.FormFeed || c === CharCode.Null
}

function isDigit(c: number): boolean {
  return c >= CharCode.Zero && c <= CharCode.Nine
}

function isHexDigit(c: number): boolean {
  return isDigit(c) ||
    (c >= CharCode.A_upper && c <= CharCode.F_upper) ||
    (c >= CharCode.a_lower && c <= CharCode.f_lower)
}

function isDelimiter(c: number): boolean {
  return c === CharCode.LeftParen || c === CharCode.RightParen ||
    c === CharCode.LessThan || c === CharCode.GreaterThan ||
    c === CharCode.LeftBracket || c === CharCode.RightBracket ||
    c === CharCode.Slash || c === CharCode.Percent
}

function hexVal(c: number): number {
  if (c >= CharCode.Zero && c <= CharCode.Nine) return c - CharCode.Zero
  if (c >= CharCode.A_upper && c <= CharCode.F_upper) return c - CharCode.A_upper + 10
  if (c >= CharCode.a_lower && c <= CharCode.f_lower) return c - CharCode.a_lower + 10
  return 0
}

export function tokenize(bytes: Uint8Array): Token[] {
  const tokens: Token[] = []
  let i = 0
  const len = bytes.length

  while (i < len) {
    // Skip whitespace
    while (i < len && isWhitespace(bytes[i])) i++
    if (i >= len) break

    const start = i
    const c = bytes[i]

    // Comment: skip to end of line
    if (c === CharCode.Percent) {
      while (i < len && bytes[i] !== CharCode.LF && bytes[i] !== CharCode.CR) i++
      continue
    }

    // Literal string: (...)
    if (c === CharCode.LeftParen) {
      i++ // skip (
      let depth = 1
      const raw: number[] = []
      while (i < len && depth > 0) {
        const ch = bytes[i]
        if (ch === CharCode.Backslash && i + 1 < len) {
          i++ // skip backslash
          const esc = bytes[i]
          if (esc === CharCode.n_lower) { raw.push(CharCode.LF); i++ }
          else if (esc === CharCode.r_lower) { raw.push(CharCode.CR); i++ }
          else if (esc === CharCode.t_lower) { raw.push(CharCode.Tab); i++ }
          else if (esc === CharCode.b_lower) { raw.push(0x08); i++ }
          else if (esc === CharCode.LeftParen) { raw.push(CharCode.LeftParen); i++ }
          else if (esc === CharCode.RightParen) { raw.push(CharCode.RightParen); i++ }
          else if (esc === CharCode.Backslash) { raw.push(CharCode.Backslash); i++ }
          else if (esc >= CharCode.Zero && esc <= CharCode.Zero + 7) {
            // Octal escape: up to 3 digits
            let octal = esc - CharCode.Zero
            if (i + 1 < len && bytes[i + 1] >= CharCode.Zero && bytes[i + 1] <= CharCode.Zero + 7) {
              i++; octal = octal * 8 + (bytes[i] - CharCode.Zero)
              if (i + 1 < len && bytes[i + 1] >= CharCode.Zero && bytes[i + 1] <= CharCode.Zero + 7) {
                i++; octal = octal * 8 + (bytes[i] - CharCode.Zero)
              }
            }
            raw.push(octal & 0xFF)
            i++
          } else if (esc === CharCode.LF) {
            i++ // line continuation
            if (i < len && bytes[i] === CharCode.CR) i++
          } else if (esc === CharCode.CR) {
            i++ // line continuation
            if (i < len && bytes[i] === CharCode.LF) i++
          } else {
            raw.push(esc); i++ // unknown escape, pass through
          }
        } else if (ch === CharCode.LeftParen) { depth++; raw.push(ch); i++ }
        else if (ch === CharCode.RightParen) { depth--; if (depth > 0) raw.push(ch); i++ }
        else { raw.push(ch); i++ }
      }
      const value = new Uint8Array(raw)
      tokens.push({
        type: 'string',
        value: { type: 'literal', value, decoded: decodePdfBytes(value) },
        offset: start,
        length: i - start,
      })
      continue
    }

    // Hex string: <...>
    if (c === CharCode.LessThan && i + 1 < len && bytes[i + 1] !== CharCode.LessThan) {
      i++ // skip <
      const hexChars: number[] = []
      while (i < len && bytes[i] !== CharCode.GreaterThan) {
        if (isHexDigit(bytes[i])) hexChars.push(bytes[i])
        i++
      }
      if (i < len) i++ // skip >
      // Pad odd-length hex strings with trailing 0
      if (hexChars.length % 2 !== 0) hexChars.push(CharCode.Zero)
      const value = new Uint8Array(hexChars.length / 2)
      for (let j = 0; j < value.length; j++) {
        value[j] = (hexVal(hexChars[j * 2]) << 4) | hexVal(hexChars[j * 2 + 1])
      }
      tokens.push({
        type: 'string',
        value: { type: 'hex', value, decoded: decodePdfBytes(value) },
        offset: start,
        length: i - start,
      })
      continue
    }

    // Name: /Something
    if (c === CharCode.Slash) {
      i++ // skip /
      let name = ''
      while (i < len && !isWhitespace(bytes[i]) && !isDelimiter(bytes[i])) {
        if (bytes[i] === 0x23 && i + 2 < len) { // #XX hex escape in names
          name += String.fromCharCode((hexVal(bytes[i + 1]) << 4) | hexVal(bytes[i + 2]))
          i += 3
        } else {
          name += String.fromCharCode(bytes[i])
          i++
        }
      }
      tokens.push({ type: 'name', value: name, offset: start, length: i - start })
      continue
    }

    // Array delimiters
    if (c === CharCode.LeftBracket) {
      tokens.push({ type: 'array_start', offset: start, length: 1 })
      i++
      continue
    }
    if (c === CharCode.RightBracket) {
      tokens.push({ type: 'array_end', offset: start, length: 1 })
      i++
      continue
    }

    // Number or operator
    if (isDigit(c) || c === CharCode.Plus || c === CharCode.Minus || c === CharCode.Dot) {
      // Try to parse as number
      const numStart = i
      if (c === CharCode.Plus || c === CharCode.Minus) i++
      let hasDot = false
      if (i < len && bytes[i] === CharCode.Dot) { hasDot = true; i++ }
      let hasDigits = false
      while (i < len && isDigit(bytes[i])) { hasDigits = true; i++ }
      if (!hasDot && i < len && bytes[i] === CharCode.Dot) { hasDot = true; i++; while (i < len && isDigit(bytes[i])) { hasDigits = true; i++ } }

      if (hasDigits) {
        const numStr = new TextDecoder().decode(bytes.slice(numStart, i))
        tokens.push({ type: 'number', value: parseFloat(numStr), offset: numStart, length: i - numStart })
        continue
      }
      // Not a valid number, fall through to operator
      i = numStart
    }

    // Inline image: BI ... ID <data> EI — skip the entire block
    if (c === 0x42 && i + 1 < len && bytes[i + 1] === 0x49) { // 'B','I'
      // Check if it's actually BI operator (followed by whitespace)
      if (i + 2 >= len || isWhitespace(bytes[i + 2]) || isDelimiter(bytes[i + 2])) {
        // Find ID (image data start)
        let j = i + 2
        while (j < len - 1) {
          if (bytes[j] === 0x49 && bytes[j + 1] === 0x44 && (j + 2 >= len || isWhitespace(bytes[j + 2]))) {
            // Found ID, now find EI
            j += 2
            if (j < len && isWhitespace(bytes[j])) j++ // skip whitespace after ID
            // Scan for EI preceded by whitespace
            while (j < len - 1) {
              if (bytes[j] === 0x45 && bytes[j + 1] === 0x49 && (j === 0 || isWhitespace(bytes[j - 1])) && (j + 2 >= len || isWhitespace(bytes[j + 2]) || isDelimiter(bytes[j + 2]))) {
                j += 2
                break
              }
              j++
            }
            break
          }
          j++
        }
        // Emit the entire BI..EI block as a single operator
        tokens.push({ type: 'operator', value: '__inline_image', offset: start, length: j - start })
        i = j
        continue
      }
    }

    // Operator keyword (alphabetic)
    {
      const opStart = i
      while (i < len && !isWhitespace(bytes[i]) && !isDelimiter(bytes[i])) i++
      if (i > opStart) {
        const op = new TextDecoder().decode(bytes.slice(opStart, i))
        tokens.push({ type: 'operator', value: op, offset: opStart, length: i - opStart })
      } else {
        i++ // skip unrecognized byte
      }
    }
  }

  return tokens
}

// ── Parser ─────────────────────────────────────────────────────────

// Text-related operators that we need to understand
const TEXT_OPS = new Set([
  'BT', 'ET', 'Tf', 'Tm', 'Td', 'TD', 'T*', 'Tj', 'TJ',
  'Tc', 'Tw', 'Tz', 'TL', 'Ts', 'Tr', "'", '"'
])

export function parseContentStream(bytes: Uint8Array): ParsedContentStream {
  const tokens = tokenize(bytes)
  const operators: ContentStreamOp[] = []
  const textRuns: TextRun[] = []

  // Text state machine
  const state: TextState = { fontName: '', fontSize: 12, x: 0, y: 0, lineX: 0, lineY: 0 }
  let inText = false

  const argStack: unknown[] = []
  let argStart = -1

  for (const token of tokens) {
    if (token.type === 'number' || token.type === 'string' || token.type === 'name') {
      if (argStart < 0) argStart = token.offset
      if (token.type === 'number') argStack.push(token.value)
      else if (token.type === 'string') argStack.push(token.value)
      else argStack.push(token.value) // name as string
      continue
    }

    if (token.type === 'array_start') {
      // Collect array elements until array_end
      if (argStart < 0) argStart = token.offset
      // We'll handle arrays by continuing to push to argStack with a marker
      argStack.push('__array_start')
      continue
    }

    if (token.type === 'array_end') {
      // Collect everything since __array_start into an array
      const arr: TJArrayElement[] = []
      while (argStack.length > 0) {
        const top = argStack.pop()
        if (top === '__array_start') break
        if (typeof top === 'number') arr.unshift({ kind: 'number', value: top })
        else if (top && typeof top === 'object' && 'type' in (top as object)) {
          arr.unshift({ kind: 'string', value: top as PdfString })
        }
      }
      argStack.push(arr)
      continue
    }

    if (token.type === 'operator') {
      const op = token.value
      const args = [...argStack]
      const opByteOffset = argStart >= 0 ? argStart : token.offset
      const opByteLength = (token.offset + token.length) - opByteOffset

      operators.push({
        operator: op,
        args,
        byteOffset: opByteOffset,
        byteLength: opByteLength,
      })

      const opIdx = operators.length - 1

      // Update text state
      if (op === 'BT') { inText = true; state.x = 0; state.y = 0; state.lineX = 0; state.lineY = 0 }
      else if (op === 'ET') { inText = false }
      else if (op === 'Tf' && args.length >= 2) {
        state.fontName = String(args[0])
        state.fontSize = Number(args[1])
      }
      else if (op === 'Tm' && args.length >= 6) {
        state.x = Number(args[4])
        state.y = Number(args[5])
        state.lineX = state.x
        state.lineY = state.y
      }
      else if (op === 'Td' && args.length >= 2) {
        state.x = state.lineX + Number(args[0])
        state.y = state.lineY + Number(args[1])
        state.lineX = state.x
        state.lineY = state.y
      }
      else if (op === 'TD' && args.length >= 2) {
        state.x = state.lineX + Number(args[0])
        state.y = state.lineY + Number(args[1])
        state.lineX = state.x
        state.lineY = state.y
      }
      else if (op === 'T*') {
        // Move to start of next line (uses TL leading)
        state.y = state.lineY // approximate — TL not tracked yet
        state.x = state.lineX
      }
      else if (op === 'Tj' && args.length >= 1 && inText) {
        const str = args[0] as PdfString
        if (str && typeof str === 'object' && 'decoded' in str) {
          textRuns.push({
            text: str.decoded,
            rawString: str,
            fontName: state.fontName,
            fontSize: state.fontSize,
            x: state.x,
            y: state.y,
            opIndex: opIdx,
            isTJ: false,
          })
        }
      }
      else if (op === 'TJ' && args.length >= 1 && inText) {
        const arr = args[0] as TJArrayElement[]
        if (Array.isArray(arr)) {
          arr.forEach((el, elIdx) => {
            if (el.kind === 'string') {
              textRuns.push({
                text: el.value.decoded,
                rawString: el.value,
                fontName: state.fontName,
                fontSize: state.fontSize,
                x: state.x,
                y: state.y,
                opIndex: opIdx,
                isTJ: true,
                tjElementIndex: elIdx,
              })
            }
          })
        }
      }
      else if ((op === "'" || op === '"') && inText) {
        // ' and " operators: move to next line then show text
        if (args.length >= 1) {
          const lastArg = args[args.length - 1]
          if (lastArg && typeof lastArg === 'object' && 'decoded' in (lastArg as object)) {
            const str = lastArg as PdfString
            textRuns.push({
              text: str.decoded,
              rawString: str,
              fontName: state.fontName,
              fontSize: state.fontSize,
              x: state.lineX,
              y: state.y,
              opIndex: opIdx,
              isTJ: false,
            })
          }
        }
      }

      argStack.length = 0
      argStart = -1
    }
  }

  return { operators, textRuns, rawBytes: bytes }
}

// ── Serializer ─────────────────────────────────────────────────────

/** Encode a string as PDF literal string bytes: (escaped content) */
function encodeLiteralString(value: Uint8Array): Uint8Array {
  const parts: number[] = [CharCode.LeftParen]
  for (const b of value) {
    if (b === CharCode.LeftParen || b === CharCode.RightParen || b === CharCode.Backslash) {
      parts.push(CharCode.Backslash, b)
    } else {
      parts.push(b)
    }
  }
  parts.push(CharCode.RightParen)
  return new Uint8Array(parts)
}

/** Encode a string as PDF hex string bytes: <hex digits> */
function encodeHexString(value: Uint8Array): Uint8Array {
  const hex = Array.from(value, b => b.toString(16).padStart(2, '0')).join('')
  return new TextEncoder().encode('<' + hex + '>')
}

/** Encode a PdfString back to its original format */
export function encodePdfString(str: PdfString): Uint8Array {
  return str.type === 'hex' ? encodeHexString(str.value) : encodeLiteralString(str.value)
}

/** Serialize a full parsed content stream back to bytes */
export function serializeContentStream(ops: ContentStreamOp[], rawBytes: Uint8Array): Uint8Array {
  // Strategy: rebuild from original raw bytes, replacing only modified regions
  // This preserves non-text operators byte-for-byte
  const chunks: Uint8Array[] = []
  let cursor = 0

  for (const op of ops) {
    // Copy any bytes between the previous op and this one (whitespace, etc.)
    if (op.byteOffset > cursor) {
      chunks.push(rawBytes.slice(cursor, op.byteOffset))
    }

    if (op.operator === '__modified') {
      // This operator was replaced — use the serialized bytes stored in args[0]
      chunks.push(op.args[0] as Uint8Array)
    } else {
      // Copy original bytes verbatim
      chunks.push(rawBytes.slice(op.byteOffset, op.byteOffset + op.byteLength))
    }

    cursor = op.byteOffset + op.byteLength
  }

  // Copy trailing bytes
  if (cursor < rawBytes.length) {
    chunks.push(rawBytes.slice(cursor))
  }

  // Concatenate
  const totalLen = chunks.reduce((s, c) => s + c.length, 0)
  const result = new Uint8Array(totalLen)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

// ── Text Replacement ───────────────────────────────────────────────

/** Replace text in a Tj operator */
function buildReplacedTj(newTextBytes: Uint8Array, originalFormat: 'literal' | 'hex'): Uint8Array {
  const strBytes = originalFormat === 'hex'
    ? encodeHexString(newTextBytes)
    : encodeLiteralString(newTextBytes)
  const tjBytes = new TextEncoder().encode(' Tj')
  const result = new Uint8Array(strBytes.length + tjBytes.length)
  result.set(strBytes, 0)
  result.set(tjBytes, strBytes.length)
  return result
}

/** Replace text in a TJ operator, preserving kerning structure */
function buildReplacedTJ(
  originalArray: TJArrayElement[],
  newTexts: Map<number, Uint8Array> // elementIndex → new bytes
): Uint8Array {
  const parts: string[] = ['[']
  for (let i = 0; i < originalArray.length; i++) {
    const el = originalArray[i]
    if (el.kind === 'number') {
      parts.push(String(el.value))
    } else {
      const newBytes = newTexts.get(i) ?? el.value.value
      if (el.value.type === 'hex') {
        parts.push('<' + Array.from(newBytes, b => b.toString(16).padStart(2, '0')).join('') + '>')
      } else {
        // Literal string with escapes
        let s = '('
        for (const b of newBytes) {
          if (b === CharCode.LeftParen || b === CharCode.RightParen || b === CharCode.Backslash) s += '\\' + String.fromCharCode(b)
          else s += String.fromCharCode(b)
        }
        s += ')'
        parts.push(s)
      }
    }
    if (i < originalArray.length - 1) parts.push(' ')
  }
  parts.push('] TJ')
  return new TextEncoder().encode(parts.join(''))
}

/** Apply a text replacement to a parsed content stream.
 *  Marks the operator as '__modified' with serialized bytes. */
export function applyTextReplacement(
  parsed: ParsedContentStream,
  opIndex: number,
  newTextBytes: Uint8Array,
  tjElementIndex?: number
): void {
  const op = parsed.operators[opIndex]
  if (!op) return

  if (op.operator === 'Tj') {
    const original = op.args[0] as PdfString
    const replaced = buildReplacedTj(newTextBytes, original.type)
    op.operator = '__modified'
    op.args = [replaced]
  } else if (op.operator === 'TJ' && tjElementIndex !== undefined) {
    const arr = op.args[0] as TJArrayElement[]
    const replacements = new Map<number, Uint8Array>()
    replacements.set(tjElementIndex, newTextBytes)
    const replaced = buildReplacedTJ(arr, replacements)
    op.operator = '__modified'
    op.args = [replaced]
  }
}

// ── Text Reflow ────────────────────────────────────────────────────

/** Estimate text width in PDF points using average character width from pdfjs extraction data.
 *  Falls back to fontSize * 0.5 * charCount if no extraction data available. */
export function estimateTextWidth(
  text: string,
  fontSize: number,
  avgCharWidth?: number
): number {
  const acw = avgCharWidth ?? fontSize * 0.5
  return text.length * acw
}

/** Simple word-wrap: split text into lines that fit within maxWidth.
 *  Returns array of line strings. */
export function wordWrap(
  text: string,
  maxWidth: number,
  fontSize: number,
  avgCharWidth?: number
): string[] {
  const acw = avgCharWidth ?? fontSize * 0.5
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const test = current ? current + ' ' + word : word
    if (test.length * acw > maxWidth && current) {
      lines.push(current)
      current = word
    } else {
      current = test
    }
  }
  if (current) lines.push(current)
  return lines.length > 0 ? lines : ['']
}

/**
 * Apply text replacement with reflow: if the new text is longer than the original,
 * word-wrap it and insert additional Td + Tj operators for extra lines.
 * If shorter, the extra space is left (future: could compact).
 */
export function applyTextReplacementWithReflow(
  parsed: ParsedContentStream,
  opIndex: number,
  newText: string,
  originalWidth: number,
  fontSize: number,
  lineHeight: number,
  avgCharWidth?: number,
  encodeFunc?: (text: string) => Uint8Array
): void {
  const encode = encodeFunc ?? encodeTextToBytes
  const lines = wordWrap(newText, originalWidth, fontSize, avgCharWidth)

  if (lines.length <= 1) {
    // Fits on one line — simple replacement
    const bytes = encode(lines[0] || '')
    applyTextReplacement(parsed, opIndex, bytes)
    return
  }

  // Multi-line: build replacement bytes with Td + Tj for each line
  const op = parsed.operators[opIndex]
  if (!op) return

  const original = op.args[0] as PdfString
  const strType = original?.type ?? 'hex'

  const parts: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const lineBytes = encode(lines[i])
    const strRepr = strType === 'hex'
      ? '<' + Array.from(lineBytes, b => b.toString(16).padStart(2, '0')).join('') + '>'
      : '(' + Array.from(lineBytes, b => {
          if (b === 0x28 || b === 0x29 || b === 0x5C) return '\\' + String.fromCharCode(b)
          return String.fromCharCode(b)
        }).join('') + ')'

    if (i > 0) {
      // Move down by lineHeight * fontSize
      const yOffset = -(fontSize * lineHeight)
      parts.push(`0 ${yOffset.toFixed(2)} Td`)
    }
    parts.push(`${strRepr} Tj`)
  }

  op.operator = '__modified'
  op.args = [new TextEncoder().encode(parts.join('\n'))]
}

// ── Stream Access ──────────────────────────────────────────────────

/** Get decompressed content stream bytes for a page */
export function getPageContentBytes(
  pdfDoc: PDFDocument,
  pageIndex: number
): { stream: PDFRawStream; bytes: Uint8Array; isCompressed: boolean } | null {
  try {
    const page = pdfDoc.getPage(pageIndex)
    const contentsRef = page.node.get(PDFName.of('Contents'))
    if (!contentsRef) return null

    const resolved = pdfDoc.context.lookup(contentsRef)
    if (!resolved) return null

    // Handle PDFArray of content streams (concatenate)
    if ('size' in resolved && typeof (resolved as any).size === 'function') {
      // It's a PDFArray — concatenate all streams
      const arr = resolved as any
      const allBytes: number[] = []
      for (let i = 0; i < arr.size(); i++) {
        const ref = arr.get(i)
        const stream = pdfDoc.context.lookup(ref) as PDFRawStream
        if (stream && 'getContents' in stream) {
          const filter = stream.dict?.get(PDFName.of('Filter'))
          const raw = stream.getContents()
          const decompressed = filter?.toString() === '/FlateDecode'
            ? Array.from(pako.inflate(raw))
            : Array.from(raw)
          allBytes.push(...decompressed)
          allBytes.push(CharCode.LF) // newline between streams
        }
      }
      // Return the first stream ref for writing back
      const firstRef = arr.get(0)
      const firstStream = pdfDoc.context.lookup(firstRef) as PDFRawStream
      return { stream: firstStream, bytes: new Uint8Array(allBytes), isCompressed: true }
    }

    // Single stream
    const stream = resolved as PDFRawStream
    if (!stream || !('getContents' in stream)) return null
    const filter = stream.dict?.get(PDFName.of('Filter'))
    const isCompressed = filter?.toString() === '/FlateDecode'
    const raw = stream.getContents()
    const bytes = isCompressed ? new Uint8Array(pako.inflate(raw)) : raw
    return { stream, bytes, isCompressed }
  } catch {
    return null
  }
}

/** Write modified content stream bytes back to the page */
export function writePageContentBytes(
  stream: PDFRawStream,
  newBytes: Uint8Array,
  compress: boolean = true
): void {
  if (compress) {
    const compressed = pako.deflate(newBytes)
    stream.contents = compressed
    stream.dict.set(PDFName.of('Length'), PDFNumber.of(compressed.length))
    stream.dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'))
  } else {
    stream.contents = newBytes
    stream.dict.set(PDFName.of('Length'), PDFNumber.of(newBytes.length))
    stream.dict.delete(PDFName.of('Filter'))
  }
}

// ── Utilities ──────────────────────────────────────────────────────

/** Best-effort decode of PDF string bytes to Unicode */
function decodePdfBytes(bytes: Uint8Array): string {
  // Try UTF-16BE if starts with BOM
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    let result = ''
    for (let i = 2; i < bytes.length - 1; i += 2) {
      result += String.fromCharCode((bytes[i] << 8) | bytes[i + 1])
    }
    return result
  }
  // Try UTF-8 first
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return decoded
  } catch {
    // Fall back to Latin-1 (covers PDFDocEncoding for most chars)
    return Array.from(bytes, b => String.fromCharCode(b)).join('')
  }
}

/** Encode a Unicode string to PDF string bytes (Latin-1 or UTF-16BE) */
export function encodeTextToBytes(text: string): Uint8Array {
  // Check if Latin-1 is sufficient
  let isLatin1 = true
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0xFF) { isLatin1 = false; break }
  }
  if (isLatin1) {
    const bytes = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
    return bytes
  }
  // UTF-16BE with BOM
  const bytes = new Uint8Array(2 + text.length * 2)
  bytes[0] = 0xFE; bytes[1] = 0xFF
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    bytes[2 + i * 2] = (code >> 8) & 0xFF
    bytes[2 + i * 2 + 1] = code & 0xFF
  }
  return bytes
}
