import { useEffect, useState, useCallback, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { useFormatStore } from '../../stores/formatStore'
import type { PdfFormatState } from './index'

interface FormFieldRendererProps {
  tabId: string
  pageIndex: number
  pdfBytes: Uint8Array
  zoom: number
  pageWidth: number
  pageHeight: number
}

interface FormField {
  fieldName: string
  fieldType: 'Tx' | 'Btn' | 'Ch'
  fieldValue: string | boolean | null
  rect: number[]
  isCheckbox: boolean
  isRadioButton: boolean
  isMultiline: boolean
  options: Array<{ displayValue: string; exportValue: string }>
  radioGroupName: string | null
  pageHeightPts: number
}

export default function FormFieldRenderer({
  tabId,
  pageIndex,
  pdfBytes,
  zoom,
  pageWidth,
  pageHeight
}: FormFieldRendererProps) {
  const [fields, setFields] = useState<FormField[]>([])
  const loadIdRef = useRef(0)

  // Get current form values from the store
  const formValues = useFormatStore(
    (s) => (s.data[tabId] as PdfFormatState | undefined)?.pages[pageIndex]?.formValues
  )

  // Load annotations from the PDF page
  useEffect(() => {
    const currentLoadId = ++loadIdRef.current
    let cancelled = false

    const loadAnnotations = async () => {
      try {
        const doc = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise
        if (cancelled) { doc.destroy(); return }

        const page = await doc.getPage(pageIndex + 1)
        if (cancelled) { page.cleanup(); doc.destroy(); return }

        const viewport = page.getViewport({ scale: 1 })
        const pageHeightPts = viewport.height

        const annotations = await page.getAnnotations()
        if (cancelled) { page.cleanup(); doc.destroy(); return }

        const widgetFields: FormField[] = []
        for (const ann of annotations) {
          if (ann.subtype !== 'Widget') continue
          if (!ann.fieldName) continue

          const fieldType = ann.fieldType as 'Tx' | 'Btn' | 'Ch'
          if (!['Tx', 'Btn', 'Ch'].includes(fieldType)) continue

          widgetFields.push({
            fieldName: ann.fieldName,
            fieldType,
            fieldValue: ann.fieldValue ?? null,
            rect: ann.rect,
            isCheckbox: !!ann.checkBox,
            isRadioButton: !!ann.radioButton,
            isMultiline: !!(ann.multiLine),
            options: (ann.options || []).map((opt: any) => ({
              displayValue: typeof opt === 'string' ? opt : (opt.displayValue || opt.exportValue || ''),
              exportValue: typeof opt === 'string' ? opt : (opt.exportValue || opt.displayValue || '')
            })),
            radioGroupName: ann.radioButton ? ann.fieldName : null,
            pageHeightPts
          })
        }

        if (!cancelled && currentLoadId === loadIdRef.current) {
          setFields(widgetFields)
        }

        page.cleanup()
        doc.destroy()
      } catch (err) {
        console.error('Failed to load form annotations:', err)
      }
    }

    loadAnnotations()
    return () => { cancelled = true }
  }, [pdfBytes, pageIndex])

  const updateField = useCallback(
    (fieldName: string, value: string | boolean) => {
      useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({
        ...prev,
        pages: prev.pages.map((p, i) =>
          i === pageIndex
            ? { ...p, formValues: { ...(p.formValues || {}), [fieldName]: value } }
            : p
        )
      }))
    },
    [tabId, pageIndex]
  )

  if (fields.length === 0) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: pageWidth,
        height: pageHeight,
        pointerEvents: 'none',
        zIndex: 1
      }}
    >
      {fields.map((field) => {
        const cssX = field.rect[0] * zoom
        const cssY = (field.pageHeightPts - field.rect[3]) * zoom
        const cssWidth = (field.rect[2] - field.rect[0]) * zoom
        const cssHeight = (field.rect[3] - field.rect[1]) * zoom

        // Determine current value: store override > original PDF value
        const storeValue = formValues?.[field.fieldName]
        const currentValue = storeValue !== undefined ? storeValue : field.fieldValue

        const fieldStyle: React.CSSProperties = {
          position: 'absolute',
          left: cssX,
          top: cssY,
          width: cssWidth,
          height: cssHeight,
          pointerEvents: 'auto',
          boxSizing: 'border-box',
          border: 'none',
          outline: 'none',
          background: 'rgba(173, 216, 255, 0.2)',
          padding: '1px 2px',
          margin: 0,
          fontFamily: 'sans-serif',
          fontSize: `${Math.max(8, Math.min(cssHeight * 0.7, 16 * zoom))}px`,
          color: '#000',
          transition: 'background 0.15s, box-shadow 0.15s'
        }

        if (field.fieldType === 'Tx') {
          if (field.isMultiline) {
            return (
              <textarea
                key={field.fieldName}
                style={{
                  ...fieldStyle,
                  resize: 'none',
                  overflow: 'hidden'
                }}
                className="pdf-form-field"
                value={(currentValue as string) || ''}
                onChange={(e) => updateField(field.fieldName, e.target.value)}
              />
            )
          }
          return (
            <input
              key={field.fieldName}
              type="text"
              style={fieldStyle}
              className="pdf-form-field"
              value={(currentValue as string) || ''}
              onChange={(e) => updateField(field.fieldName, e.target.value)}
            />
          )
        }

        if (field.fieldType === 'Btn') {
          if (field.isCheckbox) {
            const checked = typeof currentValue === 'boolean' ? currentValue : currentValue === 'Yes' || currentValue === 'On'
            return (
              <div
                key={field.fieldName}
                style={{
                  ...fieldStyle,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer'
                }}
                className="pdf-form-field"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => updateField(field.fieldName, e.target.checked)}
                  style={{
                    width: Math.min(cssWidth, cssHeight) * 0.8,
                    height: Math.min(cssWidth, cssHeight) * 0.8,
                    margin: 0,
                    cursor: 'pointer',
                    accentColor: '#3b82f6'
                  }}
                />
              </div>
            )
          }

          if (field.isRadioButton) {
            const radioValue = typeof currentValue === 'string' ? currentValue : ''
            // For radio buttons, we use the fieldName as the group name
            // and toggle via a string value
            return (
              <div
                key={field.fieldName + '-' + field.rect.join(',')}
                style={{
                  ...fieldStyle,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer'
                }}
                className="pdf-form-field"
              >
                <input
                  type="radio"
                  name={`radio-${tabId}-${pageIndex}-${field.fieldName}`}
                  checked={!!radioValue && radioValue !== 'Off'}
                  onChange={() => {
                    // Toggle: if already selected set to Off, else set fieldValue or 'Yes'
                    const newVal = radioValue && radioValue !== 'Off'
                      ? 'Off'
                      : (typeof field.fieldValue === 'string' && field.fieldValue !== 'Off' ? field.fieldValue : 'Yes')
                    updateField(field.fieldName, newVal)
                  }}
                  style={{
                    width: Math.min(cssWidth, cssHeight) * 0.8,
                    height: Math.min(cssWidth, cssHeight) * 0.8,
                    margin: 0,
                    cursor: 'pointer',
                    accentColor: '#3b82f6'
                  }}
                />
              </div>
            )
          }

          // Push button - render as a non-interactive visual indicator
          return null
        }

        if (field.fieldType === 'Ch') {
          return (
            <select
              key={field.fieldName}
              style={{
                ...fieldStyle,
                cursor: 'pointer',
                // Native appearance cast: React CSSProperties narrows to
                // the specific appearance keywords; 'auto' is valid at
                // runtime and restores OS default styling for date inputs.
                WebkitAppearance: 'auto' as unknown as React.CSSProperties['WebkitAppearance']
              }}
              className="pdf-form-field"
              value={(currentValue as string) || ''}
              onChange={(e) => updateField(field.fieldName, e.target.value)}
            >
              <option value="">--</option>
              {field.options.map((opt, idx) => (
                <option key={idx} value={opt.exportValue}>
                  {opt.displayValue}
                </option>
              ))}
            </select>
          )
        }

        return null
      })}

      <style>{`
        .pdf-form-field:hover {
          background: rgba(173, 216, 255, 0.35) !important;
        }
        .pdf-form-field:focus,
        .pdf-form-field:focus-within {
          background: rgba(173, 216, 255, 0.3) !important;
          box-shadow: 0 0 0 1.5px #3b82f6 !important;
          outline: none !important;
        }
      `}</style>
    </div>
  )
}
