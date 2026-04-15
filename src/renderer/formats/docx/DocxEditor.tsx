import { useEffect, useRef, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { TextAlign } from '@tiptap/extension-text-align'
import { Underline } from '@tiptap/extension-underline'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { FontFamily } from '@tiptap/extension-font-family'
import { Highlight } from '@tiptap/extension-highlight'
import { Image } from '@tiptap/extension-image'
import { Link } from '@tiptap/extension-link'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Superscript } from '@tiptap/extension-superscript'
import { Subscript } from '@tiptap/extension-subscript'
import { Typography } from '@tiptap/extension-typography'

import type { FormatViewerProps } from '../types'
import type { DocxFormatState } from './index'
import { useFormatStore } from '../../stores/formatStore'
import { useTabStore } from '../../stores/tabStore'
import { editorRegistry } from './editorRegistry'

export default function DocxEditor({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as DocxFormatState | undefined)
  const initializedRef = useRef(false)

  const onUpdate = useCallback(
    ({ editor }: { editor: { getHTML: () => string } }) => {
      const html = editor.getHTML()
      useFormatStore.getState().updateFormatState<DocxFormatState>(tabId, (prev) => ({
        ...prev,
        html
      }))
      useTabStore.getState().setTabDirty(tabId, true)
    },
    [tabId]
  )

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] }
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph']
      }),
      Underline,
      TextStyle,
      Color,
      FontFamily,
      Highlight.configure({ multicolor: true }),
      Image.configure({ inline: false, allowBase64: true }),
      Link.configure({ openOnClick: false, autolink: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Start typing...' }),
      Superscript,
      Subscript,
      Typography
    ],
    editorProps: {
      attributes: {
        class: 'docx-editor-content',
        spellcheck: 'true'
      }
    },
    onUpdate
  })

  // Register editor instance for toolbar access
  useEffect(() => {
    if (!editor) return
    editorRegistry.set(tabId, editor)
    return () => {
      editorRegistry.delete(tabId)
    }
  }, [editor, tabId])

  // Set initial content once
  useEffect(() => {
    if (editor && state?.html && !initializedRef.current) {
      editor.commands.setContent(state.html)
      initializedRef.current = true
    }
  }, [editor, state?.html])

  // Sync editor reference for save: keep format state up to date
  useEffect(() => {
    if (!editor) return
    // Store reference so save can grab latest HTML
    const handler = () => {
      const html = editor.getHTML()
      useFormatStore.getState().updateFormatState<DocxFormatState>(tabId, (prev) => ({
        ...prev,
        html
      }))
    }
    // Update state on blur as a safety net
    editor.on('blur', handler)
    return () => {
      editor.off('blur', handler)
    }
  }, [editor, tabId])

  if (!state) {
    return (
      <div style={styles.loading}>
        Loading document...
      </div>
    )
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.pageContainer}>
        <div style={styles.page}>
          <EditorContent editor={editor} />
        </div>
      </div>
      <style>{editorCSS}</style>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: 'var(--bg-primary, #1e1e2e)'
  },
  pageContainer: {
    flex: 1,
    overflow: 'auto',
    display: 'flex',
    justifyContent: 'center',
    padding: '24px 16px',
    background: '#585b70'
  },
  page: {
    width: '100%',
    maxWidth: 816,
    minHeight: '100%',
    background: '#ffffff',
    borderRadius: 4,
    boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
    padding: '60px 72px'
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: 'var(--text-secondary, #a6adc8)',
    fontSize: 14
  }
}

const editorCSS = `
.docx-editor-content {
  outline: none;
  color: #1e1e2e;
  font-family: 'Segoe UI', 'Arial', sans-serif;
  font-size: 11pt;
  line-height: 1.6;
  min-height: 600px;
}

.docx-editor-content:focus {
  outline: none;
}

.docx-editor-content .ProseMirror {
  outline: none;
  min-height: 600px;
}

.docx-editor-content .ProseMirror > * + * {
  margin-top: 0.4em;
}

.docx-editor-content h1 { font-size: 24pt; font-weight: 700; margin: 0.6em 0 0.3em; color: #1e1e2e; }
.docx-editor-content h2 { font-size: 18pt; font-weight: 600; margin: 0.5em 0 0.25em; color: #1e1e2e; }
.docx-editor-content h3 { font-size: 14pt; font-weight: 600; margin: 0.4em 0 0.2em; color: #1e1e2e; }
.docx-editor-content h4 { font-size: 12pt; font-weight: 600; margin: 0.35em 0 0.15em; color: #1e1e2e; }
.docx-editor-content h5 { font-size: 11pt; font-weight: 600; margin: 0.3em 0 0.1em; color: #1e1e2e; }
.docx-editor-content h6 { font-size: 10pt; font-weight: 600; margin: 0.3em 0 0.1em; color: #585b70; }

.docx-editor-content p {
  margin: 0.25em 0;
}

.docx-editor-content p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  float: left;
  color: #9399b2;
  pointer-events: none;
  height: 0;
}

.docx-editor-content ul,
.docx-editor-content ol {
  padding-left: 1.5em;
  margin: 0.25em 0;
}

.docx-editor-content li {
  margin: 0.1em 0;
}

.docx-editor-content ul[data-type="taskList"] {
  list-style: none;
  padding-left: 0;
}

.docx-editor-content ul[data-type="taskList"] li {
  display: flex;
  align-items: flex-start;
  gap: 0.5em;
}

.docx-editor-content ul[data-type="taskList"] li label {
  margin-top: 0.15em;
}

.docx-editor-content blockquote {
  border-left: 3px solid #89b4fa;
  padding-left: 1em;
  margin: 0.5em 0;
  color: #585b70;
  font-style: italic;
}

.docx-editor-content code {
  background: #f0f0f4;
  border-radius: 3px;
  padding: 0.15em 0.35em;
  font-family: 'Cascadia Code', 'Consolas', 'Courier New', monospace;
  font-size: 0.9em;
  color: #d20f39;
}

.docx-editor-content pre {
  background: #f5f5f9;
  border-radius: 6px;
  padding: 12px 16px;
  overflow-x: auto;
  margin: 0.5em 0;
}

.docx-editor-content pre code {
  background: none;
  padding: 0;
  color: #1e1e2e;
  font-size: 0.85em;
}

.docx-editor-content a {
  color: #1e66f5;
  text-decoration: underline;
  cursor: pointer;
}

.docx-editor-content img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  margin: 0.5em 0;
}

.docx-editor-content hr {
  border: none;
  border-top: 1px solid #ccd0da;
  margin: 1em 0;
}

.docx-editor-content table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.5em 0;
}

.docx-editor-content th,
.docx-editor-content td {
  border: 1px solid #ccd0da;
  padding: 6px 10px;
  text-align: left;
  min-width: 60px;
}

.docx-editor-content th {
  background: #f5f5f9;
  font-weight: 600;
}

.docx-editor-content .selectedCell {
  background: rgba(137, 180, 250, 0.15);
}

.docx-editor-content mark {
  background: #fce94f;
  border-radius: 2px;
  padding: 0 2px;
}

.docx-editor-content sup { vertical-align: super; font-size: 0.75em; }
.docx-editor-content sub { vertical-align: sub; font-size: 0.75em; }
`
