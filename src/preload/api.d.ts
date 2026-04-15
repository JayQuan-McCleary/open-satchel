import type { AFPEAPI } from './index'

declare global {
  interface Window {
    api: AFPEAPI
  }
}
