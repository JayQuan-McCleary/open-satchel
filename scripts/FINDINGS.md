# Phase 2 — Edit-test findings

Running `scripts/edit-test.mts` against the stress fixture (`scripts/gen-stress-pdf.mjs`) revealed the following save-pipeline bugs. Each has a reproduction command; the harness regenerates a deterministic `test-pdfs/stress-edited-<name>.pdf` that can be opened via `window.__loadTestPdf('/test-pdfs/stress-edited-<name>.pdf')` in the dev server.

Live-UI adversarial tests (via zenlink + direct store manipulation) surfaced additional bugs listed at the bottom.

**Bugs 1 and 2 both fixed in commit `2568233` (surgical byte-patch + text-overflow).**

## Critical

### 1. Longer replacement text is silently truncated at bbox bottom
- **Repro:** `npx tsx scripts/edit-test.mts --builtin rename-title`
- **Symptom:** master "Q4 2026 EARNINGS REPORT" → edited "Q1 2027 EARNINGS" (the word "REPORT" is dropped).
- **Root cause:** `pdfParagraphEdits.applyParagraphEditsToBytes` wraps the new text with `wrapLines()` when it exceeds the bbox width, then draws line-by-line until `baselineY < drawPdfY` (bbox bottom). Since the original bbox was sized to one line of the original text, any replacement that wraps to a 2nd line loses that line.
- **Fix direction:** either (a) let the draw loop extend past the bbox bottom, (b) auto-shrink font size to fit, or (c) surface a "text doesn't fit" warning to the UI.

### 2. Editing text inside a filled rectangle appears to destroy the rectangle's render
- **Repro:** `npx tsx scripts/edit-test.mts --builtin rename-segment`
- **Symptom:** navy table-header bar (drawn via `drawRectangle` at x=40, y=532, w=532, h=18) renders as only a small rect around the edited word "Division" in the output; the full-width navy bar is visually gone.
- **Diagnostic state:** the content stream's navy-bar `q ... f Q` block is BYTE-IDENTICAL in master and edited (confirmed via `_diff-contents.mts`). q/Q balance is 0 in both. `Contents` goes from 1 stream (master) to a 4-stream PDFArray (edited) after pd-lib's append-on-draw pass.
- **Hypothesis:** either (a) the `/GS-XXX gs` ExtGState reference used by the navy block is dropped or rewritten during pd-lib's `replacePageContents` + subsequent save, so rendering reverts to default graphics state without the fill we expect, or (b) the 4-stream concatenation adds something between streams that breaks state inheritance.
- **Fix direction:** instrument the ExtGState resource dict across the edit round-trip; either preserve the original GS object or inline the state ops so the rect survives without needing an external reference.

## Harness limitations (not editor bugs)

### 3. Mask rect color is slightly off
- **Repro:** any edit on a paragraph whose bg color isn't pure black or white (e.g. the navy header).
- **Symptom:** tiny rectangle around the edited text in a visibly different shade than the surrounding bg.
- **Root cause:** the node harness can't call `sampleParagraphBackgrounds` (no canvas). It derives bg from text-color luminance (`#101518` if text is light, `#ffffff` if dark). Browser path doesn't have this problem.
- **Fix direction:** either add a node-side rasterizer (`@napi-rs/canvas`) and call `sampleParagraphBackgrounds` directly, or drive the test via zenlink against the real dev-server pipeline.

## Stress-fixture layout issues (not editor bugs)

### 4. "Guidance" heading gets clustered with its body
- **Repro:** `npx tsx scripts/edit-test.mts --builtin rename-guidance` → "[fail] No paragraph with text 'Guidance' on page 1"
- **Root cause:** in `scripts/gen-stress-pdf.mjs` the Guidance callout draws the heading at calloutY-20 and the body at calloutY-36 — a 16pt gap that falls within our paragraphGapFactor. The editor clusters them into one paragraph `"Guidance\nFor FY2027..."`.
- **Fix direction:** widen the generator's gap (e.g. calloutY-44 for the body) OR tune the editor's clustering to treat a large font-size step as a paragraph break even when the gap is otherwise tight. (Latter is more generally useful.)

## Working tests (no issues found)

- `move-invoice` — drag the dark header title to a new position. Ghost mask appears at origin, new text appears at destination.
- `align-thanks` — center-align the pull-quote paragraph on page 2. Align state preserved through save.
- `rename-chinese` — text change on a CJK paragraph. Verified the CJK subsetter warning in ROADMAP.md — re-embedding works but only when subset:false (part of the reason the stress PDF embeds the full Noto Sans SC font).

## Iterating

When a fix lands, re-run the relevant test:

```bash
npx tsx scripts/edit-test.mts --builtin <name>
```

Then open the result in the browser via zenlink:

```js
await window.__loadTestPdf('/test-pdfs/stress-edited-<name>.pdf')
```

Compare against master (`/test-pdfs/stress.pdf`) side-by-side. A future revision of this harness should add:

1. Headless rendering of both PDFs to PNG (via `@napi-rs/canvas` + pdfjs) and automated pixel diff with region masks for the expected-change area.
2. A "drive-via-zenlink" mode that performs the edit through the actual UI (not via direct service calls) — catches any UI-path bugs the direct-call harness misses.

---

## Adversarial live-UI test pass (2026-04-18)

Phase A of the modeless refactor (`docs/MODELESS.md`) landed in commit `03fc251`. These findings came from driving the dev server via zenlink — real rendering, real store updates, real tool transitions.

### Fixed this session

**#3 — Stale per-paragraph activeId across tool flips** (fix: commit `a57ecee`)
- Repro: edit a paragraph in Edit Text → switch to Select/Highlight/Draw → switch back to Edit Text → the paragraph's `contenteditable` stays true but the div's textContent is empty.
- Root cause: layer-local `activeId` useState survived the tool flip; ParagraphEditor remounted with `active=true` and the seeding effect's `if (active) return` guard skipped filling textContent from the pending edit.
- Fix: effect in EditableParagraphLayer clears `activeId` whenever the `active` prop goes false. Seeding effect also relaxed to seed when `textContent` is empty regardless of `active`.

**#4 — Cross-page activeId leaking between layer instances** (fix: commit `2ec16bd`)
- Repro: edit page 1 title → scroll to page 2 → click a page 2 paragraph. The edit silently lands on page 1 instead of page 2. Both paragraphs end up with `contentEditable=true`; `querySelector('[contenteditable="true"]')` returns the first (page 1) and the edit misroutes.
- Root cause: each page has its own layer instance with its own `activeId`. When user focuses a paragraph on page 2, page 1's layer doesn't know.
- Fix: each layer with `active=true` attaches a capture-phase document listener on pointerdown + click. If the event target isn't inside the layer's own DOM, drop the local `activeId`. Handles both real user clicks and programmatic `.click()` (important for tests).

### Passed

- **Architectural contract across 9 tool transitions:** FabricCanvas and EditableParagraphLayer stay mounted with stable DOM node identity; `data-active` attr flips correctly; Fabric wrapper pointer-events: `none`↔`auto` correctly.
- **Click priority by tool:**
  - Edit Text → `elementFromPoint` on a paragraph hits `div[data-paragraph-id]` (paragraph wins).
  - Select → hits Fabric `upper-canvas` (annotation wins).
  - Highlight → hits Fabric `upper-canvas` (capture for drag-to-create).
- **Drag + tool flip + save:** drag commits `positionDelta` into `_paragraphEdits`, survives 15-tool spam, save applies the delta to bytes.
- **50-tool marathon spam:** 516 ms total (~10 ms/transition). No remounts. Title edit + drag both survive into saved PDF. Navy bar byte-sampled post-save at rgb(30,58,138) = authored navy (bug #2 regression gate still holds).
- **Cross-page edits after fix:** page 1 title → "XSESS TITLE 1", page 2 title → "XSESS P2 EDITED". Routing clean, no contamination. Saved bytes reload with the expected per-page content.
- **Undo/redo across tool switches:** two sequential text edits followed by Select→Highlight→Edit-Text flips → Ctrl+Z reverts second edit (visible text matches), Ctrl+Z again reverts first, Ctrl+Y×2 restores both. Store snapshots and visible DOM match at every step.

### Not yet exercised (future session)

- **Real drop-on-click tools (Add Text, Stamp, Sticky Note, Link, Audio, Video)** — these need Fabric's pointer pipeline to fire. Synthetic MouseEvent dispatch doesn't reach Fabric's state machine reliably. Would need either (a) zen_click with pointerType=mouse against the Fabric upper-canvas, (b) a small debug global exposing `fabricRef.current` so tests can call `fc.add(textbox)` directly, or (c) Phase B's unified click dispatcher which would route via the application layer rather than Fabric's own events.
- **Drag-to-create tools (Highlight, Draw, Shape, Measure)** — same Fabric-event-model issue.
- **Fill & Sign quick-stamps** — same.
- **Form Designer mode** — untouched; has its own mode-like semantics that may need special handling in Phase B.
- **Page rotate / reorder / delete while edits pending** — unknown whether pending edits survive a page-level mutation.
- **Auto-save while mid-drag or mid-type** — timing corner case we haven't probed.

These aren't regressions from Phase A — they're pre-existing gaps in test coverage that the new always-mounted architecture actually makes testable.
