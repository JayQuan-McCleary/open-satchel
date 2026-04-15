import { Canvas, Textbox, Rect, Group, type TPointerEventInfo } from 'fabric'

export interface StampDef {
  text: string
  color: string
  bgColor: string
}

export const STAMPS: StampDef[] = [
  { text: 'APPROVED', color: '#a6e3a1', bgColor: 'rgba(166,227,161,0.15)' },
  { text: 'REJECTED', color: '#f38ba8', bgColor: 'rgba(243,139,168,0.15)' },
  { text: 'DRAFT', color: '#f9e2af', bgColor: 'rgba(249,226,175,0.15)' },
  { text: 'CONFIDENTIAL', color: '#f38ba8', bgColor: 'rgba(243,139,168,0.15)' },
  { text: 'FINAL', color: '#89b4fa', bgColor: 'rgba(137,180,250,0.15)' },
  { text: 'COPY', color: '#6c7086', bgColor: 'rgba(108,112,134,0.15)' },
  { text: 'VOID', color: '#f38ba8', bgColor: 'rgba(243,139,168,0.15)' },
  { text: 'URGENT', color: '#fab387', bgColor: 'rgba(250,179,135,0.15)' },
  { text: 'REVIEWED', color: '#a6e3a1', bgColor: 'rgba(166,227,161,0.15)' },
  { text: 'SIGN HERE', color: '#cba6f7', bgColor: 'rgba(203,166,247,0.15)' }
]

export function applyStampTool(
  canvas: Canvas,
  stamp: StampDef,
  onSave: () => void
): void {
  canvas.isDrawingMode = false
  canvas.selection = false
  canvas.defaultCursor = 'crosshair'

  canvas.on('mouse:down', (e: TPointerEventInfo) => {
    if (e.target) return
    const pointer = canvas.getScenePoint(e.e)

    const textWidth = stamp.text.length * 14 + 30

    const bg = new Rect({
      width: textWidth,
      height: 40,
      fill: stamp.bgColor,
      stroke: stamp.color,
      strokeWidth: 3,
      rx: 4,
      ry: 4
    })

    const label = new Textbox(stamp.text, {
      width: textWidth,
      top: 8,
      left: 0,
      fontSize: 18,
      fill: stamp.color,
      fontFamily: 'Impact, "Arial Black", sans-serif',
      fontWeight: 'bold',
      textAlign: 'center',
      editable: false
    })

    const group = new Group([bg, label], {
      left: pointer.x,
      top: pointer.y,
      selectable: true,
      angle: -15
    })

    ;(group as any).__isStamp = true

    canvas.add(group)
    canvas.setActiveObject(group)
    onSave()
  })
}
