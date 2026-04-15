// Form field creation. Adds interactive AcroForm fields to an existing
// PDF at given page + rect coordinates. Supports text, checkbox, radio
// group, dropdown, signature. All positions in PDF points (origin
// bottom-left), matching the rest of pdfOps.

import { PDFDocument } from 'pdf-lib'

export interface FormFieldSpec {
  kind: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'signature'
  name: string
  page: number // 0-based
  rect: { x: number; y: number; width: number; height: number }
  defaultValue?: string | boolean
  options?: string[] // for dropdown & radio (option labels)
  required?: boolean
  readOnly?: boolean
}

export async function addFormFields(bytes: Uint8Array, specs: FormFieldSpec[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes)
  const form = doc.getForm()
  const pages = doc.getPages()

  for (const spec of specs) {
    const page = pages[spec.page]
    if (!page) continue
    const box = { x: spec.rect.x, y: spec.rect.y, width: spec.rect.width, height: spec.rect.height }

    switch (spec.kind) {
      case 'text': {
        const f = form.createTextField(spec.name)
        if (typeof spec.defaultValue === 'string') f.setText(spec.defaultValue)
        if (spec.required) f.enableRequired()
        if (spec.readOnly) f.enableReadOnly()
        f.addToPage(page, box)
        break
      }
      case 'checkbox': {
        const f = form.createCheckBox(spec.name)
        if (spec.defaultValue === true) f.check()
        if (spec.required) f.enableRequired()
        if (spec.readOnly) f.enableReadOnly()
        f.addToPage(page, box)
        break
      }
      case 'radio': {
        // Radio groups have one name + multiple options, each positioned.
        // We treat `rect` as the first option's rect; subsequent options
        // stack vertically below with the same height.
        const f = form.createRadioGroup(spec.name)
        const opts = spec.options ?? ['Option 1']
        opts.forEach((label, i) => {
          f.addOptionToPage(label, page, {
            x: box.x,
            y: box.y - i * (box.height + 4),
            width: box.width,
            height: box.height,
          })
        })
        if (typeof spec.defaultValue === 'string' && opts.includes(spec.defaultValue)) {
          f.select(spec.defaultValue)
        }
        if (spec.required) f.enableRequired()
        if (spec.readOnly) f.enableReadOnly()
        break
      }
      case 'dropdown': {
        const f = form.createDropdown(spec.name)
        f.addOptions(spec.options ?? [])
        if (typeof spec.defaultValue === 'string') f.select(spec.defaultValue)
        if (spec.required) f.enableRequired()
        if (spec.readOnly) f.enableReadOnly()
        f.addToPage(page, box)
        break
      }
      case 'signature': {
        // pdf-lib doesn't expose a signature-field helper; we fall back
        // to a readonly text field labeled "Sign here". Full digital
        // signature is a separate feature (pdfSign.ts).
        const f = form.createTextField(spec.name)
        f.setText('Sign here')
        f.enableReadOnly()
        f.addToPage(page, box)
        break
      }
    }
  }
  return await doc.save()
}

/** Read back current form field values & types for UI display. */
export async function listFormFields(bytes: Uint8Array): Promise<Array<{ name: string; type: string; value?: string | boolean }>> {
  const doc = await PDFDocument.load(bytes)
  const form = doc.getForm()
  return form.getFields().map((f) => {
    const name = f.getName()
    const type = f.constructor.name.replace(/^PDF/, '').toLowerCase()
    let value: string | boolean | undefined
    if ('getText' in f && typeof (f as { getText?: () => string }).getText === 'function') {
      value = (f as unknown as { getText: () => string }).getText()
    } else if ('isChecked' in f && typeof (f as { isChecked?: () => boolean }).isChecked === 'function') {
      value = (f as unknown as { isChecked: () => boolean }).isChecked()
    } else if ('getSelected' in f && typeof (f as { getSelected?: () => unknown }).getSelected === 'function') {
      // Dropdown.getSelected → string[]; RadioGroup.getSelected → string|undefined
      const sel = (f as unknown as { getSelected: () => unknown }).getSelected()
      if (Array.isArray(sel)) value = sel.join(', ')
      else if (typeof sel === 'string') value = sel
    }
    return { name, type, value }
  })
}
