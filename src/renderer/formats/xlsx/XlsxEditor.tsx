import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import { useTabStore } from '../../stores/tabStore'
import type { XlsxFormatState } from './index'

const ROW_HEIGHT = 28
const ROW_NUMBER_WIDTH = 50
const HEADER_HEIGHT = 28
const FORMULA_BAR_HEIGHT = 32
const SHEET_TAB_HEIGHT = 32
const OVERSCAN = 10

function colLabel(index: number): string {
  let label = ''
  let n = index
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  }
  return label
}

function cellRef(row: number, col: number): string {
  return `${colLabel(col)}${row + 1}`
}

export default function XlsxEditor({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as XlsxFormatState | undefined)
  const containerRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [containerHeight, setContainerHeight] = useState(600)
  const [containerWidth, setContainerWidth] = useState(800)
  const [editValue, setEditValue] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)
  const formulaInputRef = useRef<HTMLInputElement>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; row: number; col: number } | null>(null)
  const [resizingCol, setResizingCol] = useState<number | null>(null)
  const resizeStartX = useRef(0)
  const resizeStartWidth = useRef(0)

  // Measure container
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setContainerHeight(entry.contentRect.height)
        setContainerWidth(entry.contentRect.width)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const sheet = state?.sheets[state.activeSheet]
  const selectedCell = state?.selectedCell ?? null
  const editingCell = state?.editingCell ?? null

  const updateState = useCallback(
    (updater: (prev: XlsxFormatState) => XlsxFormatState) => {
      useFormatStore.getState().updateFormatState<XlsxFormatState>(tabId, updater)
    },
    [tabId]
  )

  const markDirty = useCallback(() => {
    useTabStore.getState().setTabDirty(tabId, true)
  }, [tabId])

  const setSelectedCell = useCallback(
    (row: number, col: number) => {
      updateState((prev) => ({ ...prev, selectedCell: { row, col }, editingCell: null }))
    },
    [updateState]
  )

  const startEditing = useCallback(
    (row: number, col: number) => {
      if (!sheet) return
      const value = sheet.data[row]?.[col] ?? ''
      setEditValue(value)
      updateState((prev) => ({
        ...prev,
        selectedCell: { row, col },
        editingCell: { row, col }
      }))
    },
    [sheet, updateState]
  )

  const commitEdit = useCallback(() => {
    if (!editingCell || !sheet) return
    const { row, col } = editingCell
    updateState((prev) => {
      const sheets = [...prev.sheets]
      const s = { ...sheets[prev.activeSheet] }
      const data = s.data.map((r) => [...r])
      // Ensure row exists
      while (data.length <= row) {
        data.push(new Array(s.colWidths.length).fill(''))
      }
      // Ensure col exists
      if (data[row].length <= col) {
        data[row] = [...data[row], ...new Array(col - data[row].length + 1).fill('')]
      }
      data[row][col] = editValue
      s.data = data
      sheets[prev.activeSheet] = s
      return { ...prev, sheets, editingCell: null }
    })
    markDirty()
  }, [editingCell, editValue, sheet, updateState, markDirty])

  const cancelEdit = useCallback(() => {
    updateState((prev) => ({ ...prev, editingCell: null }))
  }, [updateState])

  // Column width accumulation for positioning
  const colPositions = useMemo(() => {
    if (!sheet) return []
    const positions: number[] = [0]
    for (let i = 0; i < sheet.colWidths.length; i++) {
      positions.push(positions[i] + sheet.colWidths[i])
    }
    return positions
  }, [sheet])

  const totalWidth = colPositions[colPositions.length - 1] ?? 0

  // Virtualized row range
  const visibleAreaHeight = containerHeight - FORMULA_BAR_HEIGHT - HEADER_HEIGHT - SHEET_TAB_HEIGHT
  const totalRows = sheet?.data.length ?? 0
  const totalContentHeight = totalRows * ROW_HEIGHT

  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const endRow = Math.min(totalRows, Math.ceil((scrollTop + visibleAreaHeight) / ROW_HEIGHT) + OVERSCAN)

  // Visible column range
  const startCol = useMemo(() => {
    if (!colPositions.length) return 0
    for (let i = 0; i < colPositions.length - 1; i++) {
      if (colPositions[i + 1] > scrollLeft) return Math.max(0, i - 2)
    }
    return 0
  }, [colPositions, scrollLeft])

  const endCol = useMemo(() => {
    if (!colPositions.length) return 0
    const rightEdge = scrollLeft + containerWidth
    for (let i = startCol; i < colPositions.length - 1; i++) {
      if (colPositions[i] > rightEdge) return Math.min(colPositions.length - 1, i + 2)
    }
    return colPositions.length - 1
  }, [colPositions, scrollLeft, containerWidth, startCol])

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget
    setScrollTop(target.scrollTop)
    setScrollLeft(target.scrollLeft)
  }, [])

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!sheet || !selectedCell) return

      if (editingCell) {
        if (e.key === 'Enter') {
          e.preventDefault()
          commitEdit()
          // Move down
          const nextRow = Math.min(selectedCell.row + 1, sheet.data.length - 1)
          setSelectedCell(nextRow, selectedCell.col)
        } else if (e.key === 'Tab') {
          e.preventDefault()
          commitEdit()
          const nextCol = e.shiftKey
            ? Math.max(selectedCell.col - 1, 0)
            : Math.min(selectedCell.col + 1, (sheet.colWidths?.length ?? 1) - 1)
          setSelectedCell(selectedCell.row, nextCol)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancelEdit()
        }
        return
      }

      const { row, col } = selectedCell
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          setSelectedCell(Math.max(row - 1, 0), col)
          break
        case 'ArrowDown':
          e.preventDefault()
          setSelectedCell(Math.min(row + 1, sheet.data.length - 1), col)
          break
        case 'ArrowLeft':
          e.preventDefault()
          setSelectedCell(row, Math.max(col - 1, 0))
          break
        case 'ArrowRight':
          e.preventDefault()
          setSelectedCell(row, Math.min(col + 1, (sheet.colWidths?.length ?? 1) - 1))
          break
        case 'Tab':
          e.preventDefault()
          if (e.shiftKey) {
            setSelectedCell(row, Math.max(col - 1, 0))
          } else {
            setSelectedCell(row, Math.min(col + 1, (sheet.colWidths?.length ?? 1) - 1))
          }
          break
        case 'Enter':
          e.preventDefault()
          startEditing(row, col)
          break
        case 'F2':
          e.preventDefault()
          startEditing(row, col)
          break
        case 'Delete':
        case 'Backspace':
          e.preventDefault()
          updateState((prev) => {
            const sheets = [...prev.sheets]
            const s = { ...sheets[prev.activeSheet] }
            const data = s.data.map((r) => [...r])
            if (data[row]) data[row][col] = ''
            s.data = data
            sheets[prev.activeSheet] = s
            return { ...prev, sheets }
          })
          markDirty()
          break
        default:
          // Start typing into cell directly
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault()
            setEditValue(e.key)
            updateState((prev) => ({
              ...prev,
              editingCell: { row, col }
            }))
          }
          break
      }
    },
    [sheet, selectedCell, editingCell, commitEdit, cancelEdit, setSelectedCell, startEditing, updateState, markDirty]
  )

  // Copy/paste
  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      if (!selectedCell || !sheet) return
      const val = sheet.data[selectedCell.row]?.[selectedCell.col] ?? ''
      e.clipboardData?.setData('text/plain', val)
      e.preventDefault()
    }
    const handlePaste = (e: ClipboardEvent) => {
      if (!selectedCell || !sheet) return
      // Don't paste if we're editing via input
      if (editingCell) return
      const text = e.clipboardData?.getData('text/plain') ?? ''
      e.preventDefault()

      // Support pasting a grid of cells
      const rows = text.split(/\r?\n/).map((line) => line.split('\t'))
      updateState((prev) => {
        const sheets = [...prev.sheets]
        const s = { ...sheets[prev.activeSheet] }
        const data = s.data.map((r) => [...r])
        for (let ri = 0; ri < rows.length; ri++) {
          const targetRow = selectedCell.row + ri
          if (targetRow >= data.length) {
            data.push(new Array(s.colWidths.length).fill(''))
          }
          for (let ci = 0; ci < rows[ri].length; ci++) {
            const targetCol = selectedCell.col + ci
            if (targetCol < data[targetRow].length) {
              data[targetRow][targetCol] = rows[ri][ci]
            }
          }
        }
        s.data = data
        sheets[prev.activeSheet] = s
        return { ...prev, sheets }
      })
      markDirty()
    }
    document.addEventListener('copy', handleCopy)
    document.addEventListener('paste', handlePaste)
    return () => {
      document.removeEventListener('copy', handleCopy)
      document.removeEventListener('paste', handlePaste)
    }
  }, [selectedCell, editingCell, sheet, updateState, markDirty])

  // Column resize handlers
  const handleColResizeStart = useCallback(
    (e: React.MouseEvent, colIdx: number) => {
      e.preventDefault()
      e.stopPropagation()
      if (!sheet) return
      setResizingCol(colIdx)
      resizeStartX.current = e.clientX
      resizeStartWidth.current = sheet.colWidths[colIdx]
    },
    [sheet]
  )

  useEffect(() => {
    if (resizingCol === null) return
    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX.current
      const newWidth = Math.max(30, resizeStartWidth.current + delta)
      updateState((prev) => {
        const sheets = [...prev.sheets]
        const s = { ...sheets[prev.activeSheet] }
        const colWidths = [...s.colWidths]
        colWidths[resizingCol] = newWidth
        s.colWidths = colWidths
        sheets[prev.activeSheet] = s
        return { ...prev, sheets }
      })
    }
    const handleMouseUp = () => {
      setResizingCol(null)
      markDirty()
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [resizingCol, updateState, markDirty])

  // Context menu actions
  const insertRowAbove = useCallback(() => {
    if (!contextMenu) return
    updateState((prev) => {
      const sheets = [...prev.sheets]
      const s = { ...sheets[prev.activeSheet] }
      const data = [...s.data]
      data.splice(contextMenu.row, 0, new Array(s.colWidths.length).fill(''))
      s.data = data
      sheets[prev.activeSheet] = s
      return { ...prev, sheets }
    })
    markDirty()
    setContextMenu(null)
  }, [contextMenu, updateState, markDirty])

  const insertRowBelow = useCallback(() => {
    if (!contextMenu) return
    updateState((prev) => {
      const sheets = [...prev.sheets]
      const s = { ...sheets[prev.activeSheet] }
      const data = [...s.data]
      data.splice(contextMenu.row + 1, 0, new Array(s.colWidths.length).fill(''))
      s.data = data
      sheets[prev.activeSheet] = s
      return { ...prev, sheets }
    })
    markDirty()
    setContextMenu(null)
  }, [contextMenu, updateState, markDirty])

  const deleteRow = useCallback(() => {
    if (!contextMenu) return
    updateState((prev) => {
      const sheets = [...prev.sheets]
      const s = { ...sheets[prev.activeSheet] }
      const data = [...s.data]
      if (data.length > 1) data.splice(contextMenu.row, 1)
      s.data = data
      sheets[prev.activeSheet] = s
      return { ...prev, sheets }
    })
    markDirty()
    setContextMenu(null)
  }, [contextMenu, updateState, markDirty])

  const insertColLeft = useCallback(() => {
    if (!contextMenu) return
    updateState((prev) => {
      const sheets = [...prev.sheets]
      const s = { ...sheets[prev.activeSheet] }
      const data = s.data.map((row) => {
        const r = [...row]
        r.splice(contextMenu.col, 0, '')
        return r
      })
      const colWidths = [...s.colWidths]
      colWidths.splice(contextMenu.col, 0, 80)
      s.data = data
      s.colWidths = colWidths
      sheets[prev.activeSheet] = s
      return { ...prev, sheets }
    })
    markDirty()
    setContextMenu(null)
  }, [contextMenu, updateState, markDirty])

  const insertColRight = useCallback(() => {
    if (!contextMenu) return
    updateState((prev) => {
      const sheets = [...prev.sheets]
      const s = { ...sheets[prev.activeSheet] }
      const data = s.data.map((row) => {
        const r = [...row]
        r.splice(contextMenu.col + 1, 0, '')
        return r
      })
      const colWidths = [...s.colWidths]
      colWidths.splice(contextMenu.col + 1, 0, 80)
      s.data = data
      s.colWidths = colWidths
      sheets[prev.activeSheet] = s
      return { ...prev, sheets }
    })
    markDirty()
    setContextMenu(null)
  }, [contextMenu, updateState, markDirty])

  const deleteCol = useCallback(() => {
    if (!contextMenu) return
    updateState((prev) => {
      const sheets = [...prev.sheets]
      const s = { ...sheets[prev.activeSheet] }
      if (s.colWidths.length <= 1) return prev
      const data = s.data.map((row) => {
        const r = [...row]
        r.splice(contextMenu.col, 1)
        return r
      })
      const colWidths = [...s.colWidths]
      colWidths.splice(contextMenu.col, 1)
      s.data = data
      s.colWidths = colWidths
      sheets[prev.activeSheet] = s
      return { ...prev, sheets }
    })
    markDirty()
    setContextMenu(null)
  }, [contextMenu, updateState, markDirty])

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [contextMenu])

  // Switch sheet
  const switchSheet = useCallback(
    (index: number) => {
      updateState((prev) => ({
        ...prev,
        activeSheet: index,
        selectedCell: { row: 0, col: 0 },
        editingCell: null
      }))
    },
    [updateState]
  )

  const addSheet = useCallback(() => {
    updateState((prev) => {
      const minCols = 26
      const minRows = 50
      const newName = `Sheet${prev.sheets.length + 1}`
      const sheets = [
        ...prev.sheets,
        {
          name: newName,
          data: Array.from({ length: minRows }, () => new Array(minCols).fill('')),
          colWidths: new Array(minCols).fill(80)
        }
      ]
      return { ...prev, sheets, activeSheet: sheets.length - 1, selectedCell: { row: 0, col: 0 }, editingCell: null }
    })
    markDirty()
  }, [updateState, markDirty])

  // Focus the edit input when editing starts
  useEffect(() => {
    if (editingCell) {
      editInputRef.current?.focus()
    }
  }, [editingCell])

  // Auto-scroll selected cell into view
  useEffect(() => {
    if (!selectedCell || !gridRef.current || !colPositions.length) return
    const el = gridRef.current
    const cellTop = selectedCell.row * ROW_HEIGHT
    const cellBottom = cellTop + ROW_HEIGHT
    const cellLeft = colPositions[selectedCell.col] ?? 0
    const cellRight = cellLeft + (sheet?.colWidths[selectedCell.col] ?? 80)

    const viewTop = el.scrollTop
    const viewBottom = viewTop + visibleAreaHeight
    const viewLeft = el.scrollLeft
    const viewRight = viewLeft + (containerWidth - ROW_NUMBER_WIDTH)

    if (cellTop < viewTop) el.scrollTop = cellTop
    else if (cellBottom > viewBottom) el.scrollTop = cellBottom - visibleAreaHeight
    if (cellLeft < viewLeft) el.scrollLeft = cellLeft
    else if (cellRight > viewRight) el.scrollLeft = cellRight - (containerWidth - ROW_NUMBER_WIDTH)
  }, [selectedCell, colPositions, sheet, visibleAreaHeight, containerWidth])

  if (!state || !sheet) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
        Loading spreadsheet...
      </div>
    )
  }

  const currentCellValue =
    selectedCell && sheet.data[selectedCell.row] ? (sheet.data[selectedCell.row][selectedCell.col] ?? '') : ''

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        fontFamily: '"Segoe UI", "Cascadia Code", "Consolas", sans-serif',
        fontSize: 13,
        outline: 'none',
        overflow: 'hidden'
      }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Formula Bar */}
      <div
        style={{
          height: FORMULA_BAR_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          flexShrink: 0
        }}
      >
        <div
          style={{
            width: 70,
            textAlign: 'center',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            borderRight: '1px solid var(--border)',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            background: 'var(--bg-surface)'
          }}
        >
          {selectedCell ? cellRef(selectedCell.row, selectedCell.col) : ''}
        </div>
        <div style={{ padding: '0 4px', color: 'var(--text-muted)', fontSize: 14 }}>fx</div>
        <input
          ref={formulaInputRef}
          value={editingCell ? editValue : currentCellValue}
          onChange={(e) => {
            if (editingCell) {
              setEditValue(e.target.value)
            } else if (selectedCell) {
              // Start editing via formula bar
              setEditValue(e.target.value)
              updateState((prev) => ({
                ...prev,
                editingCell: { row: selectedCell.row, col: selectedCell.col }
              }))
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (editingCell) commitEdit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancelEdit()
            }
          }}
          onFocus={() => {
            if (selectedCell && !editingCell) {
              setEditValue(currentCellValue)
              updateState((prev) => ({
                ...prev,
                editingCell: { row: selectedCell.row, col: selectedCell.col }
              }))
            }
          }}
          style={{
            flex: 1,
            height: '100%',
            border: 'none',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            padding: '0 8px',
            fontSize: 13,
            fontFamily: 'inherit',
            outline: 'none'
          }}
        />
      </div>

      {/* Spreadsheet Grid */}
      <div
        ref={gridRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflow: 'auto',
          position: 'relative'
        }}
      >
        <div
          style={{
            width: totalWidth + ROW_NUMBER_WIDTH,
            height: totalContentHeight + HEADER_HEIGHT,
            position: 'relative'
          }}
        >
          {/* Corner cell */}
          <div
            style={{
              position: 'sticky',
              top: 0,
              left: 0,
              width: ROW_NUMBER_WIDTH,
              height: HEADER_HEIGHT,
              background: 'var(--bg-surface)',
              borderBottom: '2px solid var(--border)',
              borderRight: '1px solid var(--border)',
              zIndex: 4
            }}
          />

          {/* Column headers */}
          <div
            style={{
              position: 'sticky',
              top: 0,
              left: ROW_NUMBER_WIDTH,
              height: HEADER_HEIGHT,
              zIndex: 3,
              pointerEvents: 'auto'
            }}
          >
            {Array.from({ length: endCol - startCol }, (_, i) => {
              const ci = startCol + i
              const left = colPositions[ci]
              const width = sheet.colWidths[ci]
              const isSelectedCol = selectedCell?.col === ci
              return (
                <div
                  key={ci}
                  style={{
                    position: 'absolute',
                    left,
                    top: 0,
                    width,
                    height: HEADER_HEIGHT,
                    background: isSelectedCol ? 'var(--bg-hover)' : 'var(--bg-surface)',
                    borderBottom: '2px solid var(--border)',
                    borderRight: '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: isSelectedCol ? 'var(--accent)' : 'var(--text-secondary)',
                    fontSize: 12,
                    fontWeight: 600,
                    userSelect: 'none',
                    cursor: 'default'
                  }}
                >
                  {colLabel(ci)}
                  {/* Resize handle */}
                  <div
                    onMouseDown={(e) => handleColResizeStart(e, ci)}
                    style={{
                      position: 'absolute',
                      right: -2,
                      top: 0,
                      width: 5,
                      height: '100%',
                      cursor: 'col-resize',
                      zIndex: 5
                    }}
                  />
                </div>
              )
            })}
          </div>

          {/* Row numbers */}
          <div
            style={{
              position: 'sticky',
              left: 0,
              top: HEADER_HEIGHT,
              width: ROW_NUMBER_WIDTH,
              zIndex: 2
            }}
          >
            {Array.from({ length: endRow - startRow }, (_, i) => {
              const ri = startRow + i
              const isSelectedRow = selectedCell?.row === ri
              return (
                <div
                  key={ri}
                  style={{
                    position: 'absolute',
                    top: ri * ROW_HEIGHT,
                    left: 0,
                    width: ROW_NUMBER_WIDTH,
                    height: ROW_HEIGHT,
                    background: isSelectedRow ? 'var(--bg-hover)' : 'var(--bg-surface)',
                    borderBottom: '1px solid var(--border)',
                    borderRight: '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: isSelectedRow ? 'var(--accent)' : 'var(--text-muted)',
                    fontSize: 11,
                    userSelect: 'none'
                  }}
                >
                  {ri + 1}
                </div>
              )
            })}
          </div>

          {/* Cells */}
          <div
            style={{
              position: 'absolute',
              top: HEADER_HEIGHT,
              left: ROW_NUMBER_WIDTH
            }}
          >
            {Array.from({ length: endRow - startRow }, (_, rowOffset) => {
              const ri = startRow + rowOffset
              const isEvenRow = ri % 2 === 0
              return Array.from({ length: endCol - startCol }, (_, colOffset) => {
                const ci = startCol + colOffset
                const left = colPositions[ci]
                const width = sheet.colWidths[ci]
                const top = ri * ROW_HEIGHT
                const isSelected = selectedCell?.row === ri && selectedCell?.col === ci
                const isEditing = editingCell?.row === ri && editingCell?.col === ci
                const cellValue = sheet.data[ri]?.[ci] ?? ''

                return (
                  <div
                    key={`${ri}-${ci}`}
                    onClick={() => {
                      if (editingCell) commitEdit()
                      setSelectedCell(ri, ci)
                    }}
                    onDoubleClick={() => startEditing(ri, ci)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setSelectedCell(ri, ci)
                      setContextMenu({ x: e.clientX, y: e.clientY, row: ri, col: ci })
                    }}
                    style={{
                      position: 'absolute',
                      left,
                      top,
                      width,
                      height: ROW_HEIGHT,
                      borderBottom: '1px solid var(--border)',
                      borderRight: '1px solid var(--border)',
                      background: isSelected
                        ? 'rgba(137, 180, 250, 0.08)'
                        : isEvenRow
                          ? 'var(--bg-primary)'
                          : 'rgba(49, 50, 68, 0.3)',
                      boxShadow: isSelected ? 'inset 0 0 0 2px var(--accent)' : 'none',
                      zIndex: isSelected ? 1 : 0,
                      overflow: 'hidden',
                      cursor: 'cell'
                    }}
                  >
                    {isEditing ? (
                      <input
                        ref={editInputRef}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            commitEdit()
                            setSelectedCell(Math.min(ri + 1, sheet.data.length - 1), ci)
                          } else if (e.key === 'Tab') {
                            e.preventDefault()
                            commitEdit()
                            const nextCol = e.shiftKey ? Math.max(ci - 1, 0) : Math.min(ci + 1, sheet.colWidths.length - 1)
                            setSelectedCell(ri, nextCol)
                          } else if (e.key === 'Escape') {
                            e.preventDefault()
                            cancelEdit()
                          }
                          e.stopPropagation()
                        }}
                        style={{
                          width: '100%',
                          height: '100%',
                          border: 'none',
                          background: 'rgba(137, 180, 250, 0.12)',
                          color: 'var(--text-primary)',
                          padding: '0 6px',
                          fontSize: 13,
                          fontFamily: 'inherit',
                          outline: 'none',
                          boxSizing: 'border-box'
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          padding: '0 6px',
                          lineHeight: `${ROW_HEIGHT}px`,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          color: 'var(--text-primary)'
                        }}
                      >
                        {cellValue}
                      </div>
                    )}
                  </div>
                )
              })
            })}
          </div>
        </div>
      </div>

      {/* Sheet tabs */}
      <div
        style={{
          height: SHEET_TAB_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          flexShrink: 0,
          gap: 0,
          overflowX: 'auto',
          overflowY: 'hidden'
        }}
      >
        {state.sheets.map((s, i) => (
          <button
            key={i}
            onClick={() => switchSheet(i)}
            style={{
              padding: '4px 16px',
              height: '100%',
              border: 'none',
              borderRight: '1px solid var(--border)',
              background: i === state.activeSheet ? 'var(--bg-primary)' : 'transparent',
              color: i === state.activeSheet ? 'var(--accent)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: i === state.activeSheet ? 600 : 400,
              whiteSpace: 'nowrap',
              borderTop: i === state.activeSheet ? '2px solid var(--accent)' : '2px solid transparent'
            }}
          >
            {s.name}
          </button>
        ))}
        <button
          onClick={addSheet}
          style={{
            padding: '4px 12px',
            height: '100%',
            border: 'none',
            background: 'transparent',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          title="Add sheet"
        >
          +
        </button>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '4px 0',
            zIndex: 1000,
            minWidth: 180,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)'
          }}
        >
          {[
            { label: 'Insert row above', action: insertRowAbove },
            { label: 'Insert row below', action: insertRowBelow },
            { label: 'Delete row', action: deleteRow },
            { label: 'divider', action: () => {} },
            { label: 'Insert column left', action: insertColLeft },
            { label: 'Insert column right', action: insertColRight },
            { label: 'Delete column', action: deleteCol }
          ].map((item, i) =>
            item.label === 'divider' ? (
              <div key={i} style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
            ) : (
              <div
                key={i}
                onClick={(e) => {
                  e.stopPropagation()
                  item.action()
                }}
                style={{
                  padding: '6px 16px',
                  cursor: 'pointer',
                  color: 'var(--text-primary)',
                  fontSize: 12
                }}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLDivElement).style.background = 'transparent'
                }}
              >
                {item.label}
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}
