// Action Wizard — multi-step batch workflow executor.
// Defines a pipeline of operations that run sequentially on PDF bytes.

import { compressPdf } from './pdfOps'
import { applyBatesNumbering, sanitizePdf, type BatesOptions, type SanitizeOptions } from './pdfOps'
import { pdfToWord } from './pdfToWord'
import { pdfToText, pdfToExcel, pdfToPpt, toImageOnlyPdf } from './pdfConvert'
import { flattenTransparency } from './pdfFlatten'

export type ActionStepType =
  | 'compress'
  | 'bates'
  | 'sanitize'
  | 'flatten_transparency'
  | 'to_word'
  | 'to_excel'
  | 'to_ppt'
  | 'to_text'
  | 'to_image_only'

export interface ActionStep {
  type: ActionStepType
  label: string
  options?: Record<string, unknown>
}

export interface ActionWorkflow {
  name: string
  steps: ActionStep[]
}

export interface WorkflowResult {
  success: boolean
  outputBytes: Uint8Array
  outputFormat: string    // 'pdf', 'docx', 'xlsx', 'pptx', 'txt'
  log: string[]
}

/** Execute a workflow on PDF bytes, returning the final result */
export async function executeWorkflow(
  bytes: Uint8Array,
  workflow: ActionWorkflow,
  onProgress?: (step: number, total: number, label: string) => void
): Promise<WorkflowResult> {
  let current = bytes
  let format = 'pdf'
  const log: string[] = []

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i]
    onProgress?.(i, workflow.steps.length, step.label)
    log.push(`Step ${i + 1}: ${step.label}...`)

    try {
      switch (step.type) {
        case 'compress':
          current = await compressPdf(current, step.options as any)
          log.push(`  Compressed: ${current.byteLength} bytes`)
          break
        case 'bates':
          current = await applyBatesNumbering(current, (step.options || {}) as BatesOptions)
          log.push(`  Bates numbering applied`)
          break
        case 'sanitize':
          current = await sanitizePdf(current, (step.options || {}) as SanitizeOptions)
          log.push(`  Sanitized`)
          break
        case 'flatten_transparency':
          current = await flattenTransparency(current, step.options as any)
          log.push(`  Transparency flattened`)
          break
        case 'to_word':
          current = await pdfToWord(current)
          format = 'docx'
          log.push(`  Converted to Word`)
          break
        case 'to_excel':
          current = await pdfToExcel(current)
          format = 'xlsx'
          log.push(`  Converted to Excel`)
          break
        case 'to_ppt':
          current = await pdfToPpt(current)
          format = 'pptx'
          log.push(`  Converted to PowerPoint`)
          break
        case 'to_text': {
          const text = await pdfToText(current)
          current = new Uint8Array(new TextEncoder().encode(text))
          format = 'txt'
          log.push(`  Converted to text`)
          break
        }
        case 'to_image_only':
          current = await toImageOnlyPdf(current)
          log.push(`  Converted to image-only PDF`)
          break
        default:
          log.push(`  Unknown step type: ${step.type} — skipped`)
      }
    } catch (err) {
      log.push(`  ERROR: ${(err as Error).message}`)
      return { success: false, outputBytes: current, outputFormat: format, log }
    }
  }

  onProgress?.(workflow.steps.length, workflow.steps.length, 'Done')
  log.push('Workflow complete.')
  return { success: true, outputBytes: current, outputFormat: format, log }
}

/** Preset workflows for common operations */
export const PRESET_WORKFLOWS: ActionWorkflow[] = [
  {
    name: 'Prepare for Distribution',
    steps: [
      { type: 'sanitize', label: 'Strip hidden data' },
      { type: 'compress', label: 'Optimize file size' },
    ]
  },
  {
    name: 'Prepare for Print',
    steps: [
      { type: 'flatten_transparency', label: 'Flatten transparency' },
      { type: 'compress', label: 'Optimize' },
    ]
  },
  {
    name: 'Archive (sanitize + compress + Bates)',
    steps: [
      { type: 'sanitize', label: 'Strip metadata & hidden data' },
      { type: 'bates', label: 'Apply Bates numbering', options: { prefix: 'ARCH-', digits: 6 } },
      { type: 'compress', label: 'Optimize' },
    ]
  },
]
