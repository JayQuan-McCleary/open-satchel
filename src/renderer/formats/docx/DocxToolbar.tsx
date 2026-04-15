import { useState, useRef, useEffect } from 'react'
import type { FormatViewerProps } from '../types'
import type { Editor } from '@tiptap/react'

// We need to get the editor from the EditorContent context.
// TipTap doesn't expose a global editor ref by tabId, so we use a module-level registry.
// The DocxEditor registers it, and this toolbar reads it.
// Since both mount for the same tab, we share via a simple map.
import { editorRegistry } from './editorRegistry'

export default function DocxToolbar({ tabId }: FormatViewerProps) {
  const [, forceUpdate] = useState(0)
  const editor = editorRegistry.get(tabId) ?? null

  // Re-render when editor selection changes
  useEffect(() => {
    if (!editor) return
    const handler = () => forceUpdate((n) => n + 1)
    editor.on('selectionUpdate', handler)
    editor.on('transaction', handler)
    return () => {
      editor.off('selectionUpdate', handler)
      editor.off('transaction', handler)
    }
  }, [editor])

  // Poll for editor availability
  useEffect(() => {
    if (editor) return
    const id = setInterval(() => {
      if (editorRegistry.has(tabId)) forceUpdate((n) => n + 1)
    }, 200)
    return () => clearInterval(id)
  }, [editor, tabId])

  if (!editor) return null

  return (
    <div style={toolbarStyle}>
      <FontFamilySelect editor={editor} />
      <FontSizeSelect editor={editor} />
      <Sep />
      <ToggleBtn
        label="B"
        title="Bold"
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
        style={{ fontWeight: 700 }}
      />
      <ToggleBtn
        label="I"
        title="Italic"
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        style={{ fontStyle: 'italic' }}
      />
      <ToggleBtn
        label="U"
        title="Underline"
        active={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        style={{ textDecoration: 'underline' }}
      />
      <ToggleBtn
        label="S"
        title="Strikethrough"
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        style={{ textDecoration: 'line-through' }}
      />
      <ToggleBtn
        label="X\u00B2"
        title="Superscript"
        active={editor.isActive('superscript')}
        onClick={() => editor.chain().focus().toggleSuperscript().run()}
      />
      <ToggleBtn
        label="X\u2082"
        title="Subscript"
        active={editor.isActive('subscript')}
        onClick={() => editor.chain().focus().toggleSubscript().run()}
      />
      <Sep />
      <ColorButton editor={editor} />
      <HighlightButton editor={editor} />
      <Sep />
      <ToggleBtn
        label="\u2261"
        title="Align Left"
        active={editor.isActive({ textAlign: 'left' })}
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
      />
      <ToggleBtn
        label="\u2261"
        title="Align Center"
        active={editor.isActive({ textAlign: 'center' })}
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
        style={{ textAlign: 'center' }}
      />
      <ToggleBtn
        label="\u2261"
        title="Align Right"
        active={editor.isActive({ textAlign: 'right' })}
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
        style={{ textAlign: 'right' }}
      />
      <ToggleBtn
        label="\u2261"
        title="Justify"
        active={editor.isActive({ textAlign: 'justify' })}
        onClick={() => editor.chain().focus().setTextAlign('justify').run()}
      />
      <Sep />
      <ToggleBtn
        label="\u2022"
        title="Bullet List"
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToggleBtn
        label="1."
        title="Ordered List"
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <ToggleBtn
        label="\u2611"
        title="Task List"
        active={editor.isActive('taskList')}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      />
      <Sep />
      <HeadingSelect editor={editor} />
      <Sep />
      <ToolBtn
        label="\u275D"
        title="Blockquote"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
      <ToolBtn
        label="<>"
        title="Code Block"
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      />
      <Sep />
      <ToolBtn
        label="\u2637"
        title="Insert Table"
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      />
      <ToolBtn
        label="\uD83D\uDDBC"
        title="Insert Image"
        onClick={() => {
          const url = prompt('Image URL:')
          if (url) editor.chain().focus().setImage({ src: url }).run()
        }}
      />
      <ToolBtn
        label="\uD83D\uDD17"
        title="Insert Link"
        onClick={() => {
          const url = prompt('Link URL:')
          if (url) editor.chain().focus().setLink({ href: url }).run()
        }}
      />
      <ToolBtn
        label="\u2015"
        title="Horizontal Rule"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      />
      <Sep />
      <ToolBtn
        label="T\u0336"
        title="Clear Formatting"
        onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
      />
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────

function ToggleBtn({
  label,
  title,
  active,
  onClick,
  style
}: {
  label: string
  title: string
  active: boolean
  onClick: () => void
  style?: React.CSSProperties
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        ...btnBase,
        ...(active ? btnActive : {}),
        ...style
      }}
    >
      {label}
    </button>
  )
}

function ToolBtn({
  label,
  title,
  onClick
}: {
  label: string
  title: string
  onClick: () => void
}) {
  return (
    <button title={title} onClick={onClick} style={btnBase}>
      {label}
    </button>
  )
}

function Sep() {
  return <div style={sepStyle} />
}

function FontFamilySelect({ editor }: { editor: Editor }) {
  const fonts = [
    'Arial', 'Times New Roman', 'Courier New', 'Georgia',
    'Verdana', 'Trebuchet MS', 'Tahoma', 'Segoe UI',
    'Calibri', 'Cambria', 'Garamond', 'Comic Sans MS'
  ]

  return (
    <select
      title="Font Family"
      style={selectStyle}
      value={editor.getAttributes('textStyle').fontFamily || 'Segoe UI'}
      onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
    >
      {fonts.map((f) => (
        <option key={f} value={f} style={{ fontFamily: f }}>
          {f}
        </option>
      ))}
    </select>
  )
}

function FontSizeSelect({ editor }: { editor: Editor }) {
  const sizes = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '36', '48', '72']

  return (
    <select
      title="Font Size"
      style={{ ...selectStyle, width: 52 }}
      value=""
      onChange={(e) => {
        editor.chain().focus().setMark('textStyle', { fontSize: e.target.value + 'pt' }).run()
      }}
    >
      <option value="" disabled>
        Size
      </option>
      {sizes.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  )
}

function HeadingSelect({ editor }: { editor: Editor }) {
  const currentLevel = [1, 2, 3, 4, 5, 6].find((l) =>
    editor.isActive('heading', { level: l })
  )

  return (
    <select
      title="Heading Level"
      style={selectStyle}
      value={currentLevel?.toString() || '0'}
      onChange={(e) => {
        const val = parseInt(e.target.value)
        if (val === 0) {
          editor.chain().focus().setParagraph().run()
        } else {
          editor.chain().focus().toggleHeading({ level: val as 1 | 2 | 3 | 4 | 5 | 6 }).run()
        }
      }}
    >
      <option value="0">Normal</option>
      <option value="1">Heading 1</option>
      <option value="2">Heading 2</option>
      <option value="3">Heading 3</option>
      <option value="4">Heading 4</option>
      <option value="5">Heading 5</option>
      <option value="6">Heading 6</option>
    </select>
  )
}

function ColorButton({ editor }: { editor: Editor }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        title="Text Color"
        style={{ ...btnBase, color: editor.getAttributes('textStyle').color || 'var(--text-secondary)' }}
        onClick={() => inputRef.current?.click()}
      >
        A
      </button>
      <input
        ref={inputRef}
        type="color"
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
        onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
      />
    </div>
  )
}

function HighlightButton({ editor }: { editor: Editor }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        title="Highlight Color"
        style={{
          ...btnBase,
          background: editor.isActive('highlight')
            ? 'var(--accent, #89b4fa)'
            : 'var(--bg-surface, #313244)'
        }}
        onClick={() => inputRef.current?.click()}
      >
        H
      </button>
      <input
        ref={inputRef}
        type="color"
        defaultValue="#fce94f"
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
        onChange={(e) => editor.chain().focus().toggleHighlight({ color: e.target.value }).run()}
      />
    </div>
  )
}

// ── Styles ──────────────────────────────────────────────────────

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  flexWrap: 'wrap',
  padding: '3px 6px'
}

const btnBase: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: 11,
  borderRadius: 3,
  background: 'var(--bg-surface, #313244)',
  color: 'var(--text-secondary, #a6adc8)',
  border: 'none',
  cursor: 'pointer',
  minWidth: 24,
  height: 24,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1,
  fontFamily: 'inherit'
}

const btnActive: React.CSSProperties = {
  background: 'var(--accent, #89b4fa)',
  color: '#1e1e2e'
}

const selectStyle: React.CSSProperties = {
  padding: '2px 4px',
  fontSize: 11,
  borderRadius: 3,
  background: 'var(--bg-surface, #313244)',
  color: 'var(--text-secondary, #a6adc8)',
  border: '1px solid var(--border, #45475a)',
  cursor: 'pointer',
  height: 24,
  width: 110,
  outline: 'none'
}

const sepStyle: React.CSSProperties = {
  width: 1,
  height: 18,
  background: 'var(--border, #45475a)',
  margin: '0 3px',
  flexShrink: 0
}
