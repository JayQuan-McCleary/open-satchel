import type { FormatHandler } from '../types'
import ImageViewer from './ImageViewer'
import { useFormatStore } from '../../stores/formatStore'

export interface ImageFormatState {
  imageBytes: Uint8Array
  mimeType: string
  dataUrl: string
  fabricJSON: Record<string, unknown> | null
}

function getMimeType(bytes: Uint8Array, ext: string): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'image/jpeg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif'
  if (ext === 'svg') return 'image/svg+xml'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'bmp') return 'image/bmp'
  return 'image/png'
}

export const imageHandler: FormatHandler = {
  format: 'image',
  extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'tiff', 'tif', 'ico'],
  displayName: 'Image',
  icon: '🖼',
  Viewer: ImageViewer,

  load: async (tabId, bytes, filePath) => {
    const ext = filePath.split('.').pop()?.toLowerCase() || ''
    const mimeType = getMimeType(bytes, ext)
    const blob = new Blob([bytes], { type: mimeType })
    const dataUrl = URL.createObjectURL(blob)

    const state: ImageFormatState = { imageBytes: bytes, mimeType, dataUrl, fabricJSON: null }
    useFormatStore.getState().setFormatState(tabId, state)
  },

  save: async (tabId) => {
    const state = useFormatStore.getState().getFormatState<ImageFormatState>(tabId)
    if (!state) throw new Error('No image state')
    // For now, return original bytes. Full save with annotations would rasterize the fabric canvas.
    return state.imageBytes
  },

  cleanup: (tabId) => {
    const state = useFormatStore.getState().getFormatState<ImageFormatState>(tabId)
    if (state?.dataUrl) URL.revokeObjectURL(state.dataUrl)
    useFormatStore.getState().clearFormatState(tabId)
  },

  canConvertTo: ['pdf'],
  capabilities: { edit: false, annotate: true, search: false, zoom: true }
}
