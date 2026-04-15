// Compare two PDFs by page text. Returns per-page diff summary. Visual
// comparison (pixel-diff) is a separate feature we can add later — most
// users actually want text-level diff which this provides.

import { extractText } from './pdfOps'

export type DiffOp = 'equal' | 'insert' | 'delete'

export interface DiffSegment {
  op: DiffOp
  text: string
}

export interface PageDiff {
  page: number
  left: string
  right: string
  segments: DiffSegment[]
  similarity: number // 0..1
}

/** Classic LCS-based line diff, good enough for page text comparison. */
function diffLines(a: string[], b: string[]): DiffSegment[] {
  const n = a.length, m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  const out: DiffSegment[] = []
  let i = n, j = m
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { out.unshift({ op: 'equal', text: a[i - 1] }); i--; j-- }
    else if (dp[i - 1][j] >= dp[i][j - 1]) { out.unshift({ op: 'delete', text: a[i - 1] }); i-- }
    else { out.unshift({ op: 'insert', text: b[j - 1] }); j-- }
  }
  while (i > 0) { out.unshift({ op: 'delete', text: a[--i] }) }
  while (j > 0) { out.unshift({ op: 'insert', text: b[--j] }) }
  return out
}

export interface ComparePdfsResult {
  pages: PageDiff[]
  summary: { totalLines: number; inserted: number; deleted: number; unchanged: number; similarity: number }
}

export async function comparePdfs(leftBytes: Uint8Array, rightBytes: Uint8Array): Promise<ComparePdfsResult> {
  const [left, right] = await Promise.all([extractText(leftBytes), extractText(rightBytes)])
  const maxPages = Math.max(left.length, right.length)
  const pages: PageDiff[] = []
  let ins = 0, del = 0, eq = 0
  for (let i = 0; i < maxPages; i++) {
    const leftLines = (left[i]?.items ?? []).map((it) => it.str).filter((s) => s.trim())
    const rightLines = (right[i]?.items ?? []).map((it) => it.str).filter((s) => s.trim())
    const segs = diffLines(leftLines, rightLines)
    let pageIns = 0, pageDel = 0, pageEq = 0
    for (const s of segs) {
      if (s.op === 'insert') pageIns++
      else if (s.op === 'delete') pageDel++
      else pageEq++
    }
    ins += pageIns; del += pageDel; eq += pageEq
    const totalOnPage = pageIns + pageDel + pageEq
    pages.push({
      page: i,
      left: leftLines.join('\n'),
      right: rightLines.join('\n'),
      segments: segs,
      similarity: totalOnPage === 0 ? 1 : pageEq / totalOnPage,
    })
  }
  const total = ins + del + eq
  return {
    pages,
    summary: { totalLines: total, inserted: ins, deleted: del, unchanged: eq, similarity: total === 0 ? 1 : eq / total },
  }
}
