import { useEffect } from 'react'
import AppShell from './components/layout/AppShell'
import { registerGlobalShortcuts } from './lib/shortcuts'

// Re-export action helpers that were historically attached to App.tsx in
// the Electron codebase. Copied components import them from '../App'.
// All live in lib/actions now; these aliases keep import paths stable.
export {
  openFile,
  openFromPath as openFileFromPath,
  saveActiveTab as saveFile,
  saveActiveTabAs as saveFileAs,
  closeActiveTab,
  saveTabById,
} from './lib/actions'

export default function App() {
  useEffect(() => {
    const cleanup = registerGlobalShortcuts()
    return cleanup
  }, [])

  return <AppShell />
}
