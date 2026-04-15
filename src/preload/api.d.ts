import type { SatchelAPI } from './index'

declare global {
  interface Window {
    api: SatchelAPI
  }
}
