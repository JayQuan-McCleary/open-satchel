import { useState, useCallback, useEffect } from 'react'

interface Props {
  visible: boolean
  onClose: () => void
  onSearch: (query: string, matchIndex: number) => void
  totalMatches: number
}

export default function PdfSearchBar({ visible, onClose, onSearch, totalMatches }: Props) {
  const [query, setQuery] = useState('')
  const [currentMatch, setCurrentMatch] = useState(0)

  const handleSearch = useCallback((q: string, idx: number) => {
    onSearch(q, idx)
  }, [onSearch])

  useEffect(() => {
    if (query.length >= 2) {
      handleSearch(query, currentMatch)
    }
  }, [query, currentMatch, handleSearch])

  const nextMatch = () => {
    if (totalMatches > 0) {
      const next = (currentMatch + 1) % totalMatches
      setCurrentMatch(next)
    }
  }

  const prevMatch = () => {
    if (totalMatches > 0) {
      const prev = (currentMatch - 1 + totalMatches) % totalMatches
      setCurrentMatch(prev)
    }
  }

  if (!visible) return null

  return (
    <div style={{
      position: 'absolute', top: 8, right: 8, zIndex: 100,
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '6px 10px', background: 'var(--bg-primary)',
      border: '1px solid var(--border)', borderRadius: 6,
      boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
    }}>
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setCurrentMatch(0) }}
        placeholder="Search in PDF..."
        autoFocus
        style={{ width: 180, padding: '4px 8px', fontSize: 12 }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') nextMatch()
          if (e.key === 'Escape') onClose()
        }}
      />
      {query.length >= 2 && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {totalMatches > 0 ? `${currentMatch + 1}/${totalMatches}` : 'No matches'}
        </span>
      )}
      <button onClick={prevMatch} style={{ fontSize: 14, padding: '0 4px' }} title="Previous">▲</button>
      <button onClick={nextMatch} style={{ fontSize: 14, padding: '0 4px' }} title="Next">▼</button>
      <button onClick={onClose} style={{ fontSize: 14, padding: '0 4px', color: 'var(--text-muted)' }}>✕</button>
    </div>
  )
}
