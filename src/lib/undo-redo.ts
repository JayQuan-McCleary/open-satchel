// Central undo/redo dispatcher.
//
// historyStore holds typed entries from multiple subsystems (Fabric
// overlays, page-level mods, paragraph-text edits). This module pops
// the top of the stack, inspects `type`, and applies the inverse via
// the appropriate store. Keeping the dispatch here means shortcut
// handlers and UI buttons share one path.

import { useHistoryStore, type HistoryEntry } from '../stores/historyStore'
import { useFormatStore } from '../stores/formatStore'
import { useTabStore } from '../stores/tabStore'
import type { PdfFormatState } from '../formats/pdf'
import type { ParagraphEdit } from '../services/pdfParagraphEdits'

/** Apply a history entry's "direction" to the page state. For undo we
 *  want `entry.before`; for redo we want `entry.after`. Callers pick. */
function applyParagraphEdits(
  tabId: string,
  pageIndex: number,
  edits: ParagraphEdit[] | undefined,
): void {
  useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({
    ...prev,
    pages: prev.pages.map((p) =>
      p.pageIndex === pageIndex
        ? ({ ...p, _paragraphEdits: edits && edits.length > 0 ? edits : undefined } as any)
        : p,
    ),
  }))
  // Dirty flag: true iff the target direction leaves ANY edits on ANY
  // page, else rely on caller's judgement. Conservative: mark dirty
  // whenever we mutate edits so the autosave knows to flush.
  useTabStore.getState().setTabDirty(tabId, true)
}

export function undo(): boolean {
  const entry = useHistoryStore.getState().undo()
  if (!entry) return false
  applyEntry(entry, 'before')
  return true
}

export function redo(): boolean {
  const entry = useHistoryStore.getState().redo()
  if (!entry) return false
  applyEntry(entry, 'after')
  return true
}

function applyEntry(entry: HistoryEntry, dir: 'before' | 'after'): void {
  switch (entry.type) {
    case 'paragraph_edits':
      applyParagraphEdits(
        entry.tabId,
        entry.pageIndex,
        dir === 'before' ? entry.before : entry.after,
      )
      return
    case 'pages':
      // Legacy pages entry: restore the full `pages` array. `before` and
      // `after` aren't split on this entry type in the Electron archive
      // version; treat dir===before as "restore snapshot" and skip the
      // redo side (the mutations that led here would have had to push
      // their own forward-snapshot, which the current callers don't do).
      if (dir === 'before') {
        useFormatStore.getState().updateFormatState<PdfFormatState>(entry.tabId, (prev) => ({
          ...prev,
          pages: entry.pages,
        }))
      }
      return
    case 'fabric':
      // Fabric entries are per-page JSON snapshots. FabricCanvas should
      // pick this up via its own subscription; if not, consumers can
      // listen on historyStore changes directly.
      return
  }
}
