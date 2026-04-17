import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import { useTabStore } from '../../stores/tabStore'
import type { RichTextFormatState } from './index'

export default function RichTextViewer({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as RichTextFormatState | undefined)

  const editor = useEditor({
    extensions: [StarterKit, Underline],
    content: state?.html || '',
    onUpdate: ({ editor }) => {
      useFormatStore.getState().updateFormatState<RichTextFormatState>(tabId, (prev) => ({
        ...prev, html: editor.getHTML()
      }))
      useTabStore.getState().setTabDirty(tabId, true)
    }
  }, [state?.originalHtml])

  if (!state) return <div style={{ padding: 20 }}>Loading...</div>

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)' }}>
      <div style={{ padding: 6, borderBottom: '1px solid var(--border)', display: 'flex', gap: 4 }}>
        <button style={tbtn(editor?.isActive('bold'))} onClick={() => editor?.chain().focus().toggleBold().run()}>B</button>
        <button style={tbtn(editor?.isActive('italic'))} onClick={() => editor?.chain().focus().toggleItalic().run()}>I</button>
        <button style={tbtn(editor?.isActive('underline'))} onClick={() => editor?.chain().focus().toggleUnderline().run()}>U</button>
        <button style={tbtn(editor?.isActive('heading', { level: 1 }))} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}>H1</button>
        <button style={tbtn(editor?.isActive('heading', { level: 2 }))} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
        <button style={tbtn(editor?.isActive('bulletList'))} onClick={() => editor?.chain().focus().toggleBulletList().run()}>• List</button>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>{state.sourceType.toUpperCase()}</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 20, background: '#fff', color: '#000' }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

function tbtn(active?: boolean): React.CSSProperties {
  return {
    padding: '4px 10px', fontSize: 12, cursor: 'pointer',
    background: active ? 'var(--accent)' : 'var(--bg-surface)',
    color: active ? 'var(--bg-primary)' : 'var(--text-primary)',
    border: '1px solid var(--border)', borderRadius: 3,
    fontWeight: 500,
  }
}
