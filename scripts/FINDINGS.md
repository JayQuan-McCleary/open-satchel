# Phase 2 — Edit-test findings

Running `scripts/edit-test.mts` against the stress fixture (`scripts/gen-stress-pdf.mjs`) revealed the following save-pipeline bugs. Each has a reproduction command; the harness regenerates a deterministic `test-pdfs/stress-edited-<name>.pdf` that can be opened via `window.__loadTestPdf('/test-pdfs/stress-edited-<name>.pdf')` in the dev server.

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
