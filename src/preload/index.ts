import { contextBridge, ipcRenderer } from 'electron'

const api = {
  file: {
    open: (): Promise<{ bytes: Uint8Array; path: string } | null> =>
      ipcRenderer.invoke('file:open'),
    save: (bytes: Uint8Array, path: string): Promise<void> =>
      ipcRenderer.invoke('file:save', bytes, path),
    saveAs: (bytes: Uint8Array): Promise<string | null> =>
      ipcRenderer.invoke('file:saveAs', bytes),
    pickImages: (): Promise<{ bytes: Uint8Array; name: string }[] | null> =>
      ipcRenderer.invoke('file:pickImages'),
    openMultiple: (): Promise<{ bytes: Uint8Array; path: string }[] | null> =>
      ipcRenderer.invoke('file:openMultiple'),
    openPath: (path: string): Promise<{ bytes: Uint8Array; path: string }> =>
      ipcRenderer.invoke('file:openPath', path)
  },
  pdf: {
    merge: (bytesArray: Uint8Array[]): Promise<Uint8Array> =>
      ipcRenderer.invoke('pdf:merge', bytesArray),
    split: (bytes: Uint8Array, ranges: [number, number][]): Promise<Uint8Array[]> =>
      ipcRenderer.invoke('pdf:split', bytes, ranges)
  },
  recent: {
    get: (): Promise<{ path: string; name: string; format: string; lastOpened: number }[]> =>
      ipcRenderer.invoke('recent:get'),
    add: (path: string, name: string, format: string): Promise<void> =>
      ipcRenderer.invoke('recent:add', path, name, format),
    remove: (path: string): Promise<void> =>
      ipcRenderer.invoke('recent:remove', path),
    clear: (): Promise<void> =>
      ipcRenderer.invoke('recent:clear')
  },
  font: {
    list: (): Promise<{ id: string; name: string; fileName: string; style: string }[]> =>
      ipcRenderer.invoke('font:list'),
    import: (): Promise<{ id: string; name: string; fileName: string; style: string } | null> =>
      ipcRenderer.invoke('font:import'),
    getBytes: (fontId: string): Promise<Uint8Array> =>
      ipcRenderer.invoke('font:getBytes', fontId),
    remove: (fontId: string): Promise<void> =>
      ipcRenderer.invoke('font:remove', fontId)
  },
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args))
    return () => ipcRenderer.removeAllListeners(channel)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type SatchelAPI = typeof api
