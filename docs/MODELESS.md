# Modeless editing architecture

**Status:** adopted 2026-04-18 (this session implements Phase A). Supersedes the earlier "one layer mounts per active tool" pattern.

**Why:** Acrobat-style modes were forcing whole classes of bugs where the user's content on one layer (e.g. a Fabric textbox added via Add Text) silently disappeared when they switched to another tool (e.g. Edit Text unmounted the Fabric canvas). User feedback: *"why do we even have these stages again instead of live constant stream edits."* The honest answer was that we didn't have a good reason — Acrobat designed modes in 1993 under engineering constraints that no longer apply. The stress-test loop (Phase 2) was surfacing a new layer-race bug roughly every second edit target. This document specifies a replacement architecture.

## Goals

1. **Kill layer races.** A Fabric object you just placed must never vanish because you clicked a different tool.
2. **Match modern editor conventions.** Word, Docs, Notion, Figma all route clicks based on what was clicked; tools are priority hints, not on/off gates.
3. **Shrink the mental model to two modes.**
   - **Read mode** — no overlays, no chrome, just the PDF. For reading long documents.
   - **Edit mode** — everything live. The "tool" the user picked only changes which layer wins ambiguous clicks. Action tools (Highlight, Draw, Shape, Stamp, Fill-Sign quick-stamps, signature) trigger an action and auto-return to the previous mode.
4. **Maintain save-pipeline correctness.** No change to `applyParagraphEditsToBytes` or the surgical content-stream patcher; the refactor is purely a client-side rendering + dispatch change.

## Non-goals

- No new PDF spec features. This is a UX / architecture refactor.
- No save-format changes. The on-disk PDF looks identical after a modeless edit vs. a modal one.
- No tool additions / removals this pass. 38 tools stay; their activation semantics change.

---

## Architecture

```
PageRenderer
 ├── <canvas>        pdfjs render        (zIndex 0, always mounted)
 ├── FormFieldRenderer                   (zIndex 1, always mounted)
 ├── FabricCanvas                        (zIndex 1, always mounted)
 ├── EditableParagraphLayer              (zIndex 5, always mounted  ← NEW in Phase A)
 ├── AddTextPlaceholder / drag-preview   (transient, current action tool)
 └── RulersGuides / Minimap              (optional, not in click path)
```

**Click dispatcher** sits on top of the page div as a single `onPointerDown` handler. It performs a hit test in order (priority determined by `tool`), picks the first winner, and calls that layer's handler.

### Hit test inputs

1. `fabricCanvas.findTarget(event)` — returns the Fabric object under the pointer, or null.
2. `paragraphLayer.findParagraphAt(event)` — returns the paragraph whose bbox contains the pointer, or null. (New method, O(N) scan; N typically 20-100.)
3. Empty space — everything else.

### Priority table (tool → hit-test order)

| Tool group | Tool | Priority order | On winner |
|---|---|---|---|
| **Primary** | `select` | fabric → paragraph → empty | fabric: select for move/resize; paragraph: select (shows toolbar, no inline edit); empty: start marquee |
| **Primary** | `edit_text` | paragraph → fabric → empty | paragraph: activate inline editor; fabric: select (so you don't get "why can't I click my textbox"); empty: no-op |
| **Drop-on-click** | `text` `image` `signature` `sticky_note` `stamp` `link` `audio` `video` `textbox_note` `insert_text_marker` `replace_text_marker` | empty → paragraph → fabric | any winner: place the action's object at pointer, then auto-revert tool to `select` |
| **Drag-to-create** | `draw` `shape_rect` `shape_circle` `shape_line` `shape_arrow` `highlight` `highlight_area` `underline` `strikethrough` `redact` `wipe_off` `measure` | drag captures everything under the cursor | drag end: commit the new Fabric object; auto-revert to `select` |
| **Fill-Sign quick-stamps** | `fill_cross` `fill_check` `fill_circle` `fill_line` `fill_dot` `fill_date` `fill_initials` `fill_timestamp` | empty → paragraph → fabric | drop the quick-stamp glyph at pointer, auto-revert to `select` |
| **Specialized** | `form` `form_designer` | retains current behavior (designer mode) | the designer has its own UX |

**Key rule:** a tool never unmounts a layer. Clicking `edit_text` after `text` doesn't remove the "hello" textbox you just placed; it just means the next click with `edit_text` active goes to a paragraph if one is under the pointer.

### What the user sees

| Mode | PDF canvas | Fabric annotations | Paragraph outlines | Cursor |
|---|---|---|---|---|
| Read (future) | rendered | hidden | hidden | default |
| Edit + select | rendered | visible, interactive | hidden unless hovering a paragraph | default |
| Edit + edit_text | rendered | visible, interactive | **dashed outline on every paragraph** | text cursor over paragraphs |
| Edit + action tool | rendered | visible, interactive (dimmed) | hidden | action-specific crosshair |

(Phase A ships `edit_text` and `select` correct. Read mode is a later polish. Action-tool cursor states already mostly work via Fabric.)

---

## Migration plan per layer

### `EditableParagraphLayer` (Phase A)

**Before:** mounted only when `tool === 'edit_text'`. Unmount drops all cluster state.

**After:** always mounted. Takes a new `active: boolean` prop derived from `tool === 'edit_text'`.

- When `active`: current behavior — outlines visible, pointer-events on boxes, clicks activate the inline editor.
- When `!active`: outlines hidden (empty div), `pointer-events: none` on the whole layer, but cluster state + `_paragraphEdits` stay cached. Switching back to `edit_text` is instant (no re-cluster).

Clustering already runs in a `useEffect` that fires once per (pdfDoc, pageIndex). That doesn't change — it just runs on mount (when the page first renders) instead of on-demand when the user picks Edit Text. Cost: the ~100-150ms cluster time shifts from "first click on Edit Text" to "first page render." Negligible because the page render itself takes ~200ms anyway; parallel.

### `FabricCanvas` (already done 2026-04-18, commit `01e3fcd`)

Always mounted. `interactive` prop added; sets `pointer-events: none` on the wrapper when Edit Text is active, so paragraph clicks fall through. The Fabric canvas itself retains all its objects and renders them — only click capture is gated.

### `FormFieldRenderer`

Already always-mounted. No change.

### Click dispatcher (Phase B)

Phase A keeps the existing per-layer click handlers — they continue to fire as before, but because both layers are now mounted, overlapping clicks resolve by z-index + pointer-events. That's correct for the `select` ↔ `edit_text` case. For later phases (Add Text, Fill-Sign action tools, etc.) we introduce an explicit dispatcher at the PageRenderer level:

```ts
function dispatchClick(e: PointerEvent) {
  const priorities = priorityOrderFor(tool)
  for (const layer of priorities) {
    const hit = layer.hitTest(e)
    if (hit) return layer.handleClick(e, hit)
  }
  // empty-space handlers
}
```

### Auto-revert tool

Action tools (Add Text, Shape, Stamp, etc.) currently stay active after use — user has to click Select to go back. Modeless target: after the action is committed, `setTool('select')` automatically. Phase C.

---

## Phase plan

| Phase | Scope | Effort | Shipped |
|---|---|---|---|
| **A** | EditableParagraphLayer always-mounted with `active` prop. No click-dispatcher yet. Just proves mount-cost is fine and kills the "switching tools wipes my Fabric" bug category. | ~1 hour | this session |
| **B** | Unified click dispatcher at PageRenderer level. Priority table implemented for the 2 primary modes + Add Text. Paragraph + Fabric share one entry point. | ~1 day | next session |
| **C** | Auto-revert for action tools. Drop-on-click tools (Add Text, Stamp, Fill-Sign quick-stamps) revert to `select` after the drop. Drag-to-create tools (Shape, Draw, Highlight) revert after the drag ends. | ~half day | next session |
| **D** | Read-mode toggle. Hides all edit chrome for pure viewing. | ~2 hours | later |
| **E** | **Contextual floating toolbar alongside the ribbon** — NOT a ribbon replacement. Ribbon stays as the discoverable home for all 38 tools; we *add* a small popover that appears near the current selection (paragraph → font/size/color/align; Fabric object → fill/stroke/opacity; highlight → swatches). Matches Word's mini-toolbar, Google Docs' selection toolbar, Acrobat's contextual panel. | ~2 days | later |

Phases can ship independently. A alone already fixes the reported bug and is a net UX improvement.

---

## Regressions to guard against

The previous modal architecture existed partly to avoid these. Phase A needs to handle them:

1. **Cluster stale on pdfBytes update.** When save runs, `pdfBytes` changes and `pdfDoc` is a new pdfjs proxy. The cluster `useEffect` re-runs, but existing `_paragraphEdits` may reference old paragraph IDs. The IDs are position-based (`p_{pageIndex}_{x}_{y}`) so as long as positions don't shift, IDs match. Any edit that SHIFTED a paragraph's position (drag) gets a new ID → the pending edit appears to apply to a phantom paragraph. **Fix:** already handled by `_paragraphEdits` being keyed on id; the matching cluster run regenerates the same ids from the same geometry. Drag-move currently has this issue in modal mode too; not a regression.

2. **`pointer-events: none` on Fabric doesn't cover all cases.** Drag events that start inside Fabric boundaries but end outside still go to Fabric if the mousedown fired there. We check on the ENTIRE wrapper so a mousedown inside wrapper with pointer-events:none gets routed to the underlying element (the paragraph layer). Correct per CSS spec.

3. **Memory.** Keeping cluster state per-page in memory could balloon on 1000-page docs. Cluster state is ~1 KB / paragraph; 100 paragraphs × 1000 pages = 100 MB. Mitigation (later phase): clear cluster state for pages far outside viewport. Not an issue for v1 (stress fixture is 5 pages).

4. **`Ctrl+Z` scope ambiguity.** Currently undo dispatches based on history entry type (`paragraph_edits`, `fabric`, `pages`). Entries get pushed by whichever layer is active. In modeless world, the last action might be a Fabric add OR a paragraph edit — undo should handle both, which it already does via the type-tagged history entries. No change.

---

## Testing contract

After Phase A ships, we verify against the stress fixture (`test-pdfs/stress.pdf`):

- **Tool-persistence test:** add a Fabric textbox in `text` tool → switch to `edit_text` → the textbox is still visible ✓
- **Layer-priority test:** with `edit_text` active, click inside a paragraph bbox → inline editor activates (paragraph wins priority)
- **Layer-priority test:** with `edit_text` active, click inside a Fabric object that overlaps a paragraph bbox → Fabric wins (action tools' objects should always be clickable or they're dead content)

Actually point 3 is the contentious one and Phase B's dispatcher is what resolves it. For Phase A we accept: paragraph always wins when Edit Text is active; Fabric objects overlapping paragraphs are temporarily unreachable. Pushed to Phase B.

---

## Adversarial tests (session goal)

Each tool exercised solo, then in combination, on `stress.pdf`. The session log in `scripts/FINDINGS.md` gets updated with every bug surfaced.

- Every Home ribbon tool: `select`, `edit_text`, `text`, `draw`, `signature`
- Every Insert ribbon tool: `image`, `sticky_note`, shapes, stamps, `link` `audio` `video`
- Every Annotate ribbon tool: highlights, markers, `wipe_off`, `redact`, `measure`
- Every FillSign ribbon tool: all `fill_*` quick-stamps
- Cross-tool interactions: add text then edit text, add sticky on top of a paragraph, highlight over an annotation, draw shape then measure it
- Overlapping clicks: place a Fabric object right on a paragraph, then click — does the right thing win?
- Adversarial: spam tool changes, save mid-edit, undo after tool change, redo across modes.

Findings documented as they arise.
