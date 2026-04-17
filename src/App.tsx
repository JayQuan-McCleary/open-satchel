import { useEffect } from 'react'
import AppShell from './components/layout/AppShell'
import { registerGlobalShortcuts } from './lib/shortcuts'

export default function App() {
  useEffect(() => {
    const cleanup = registerGlobalShortcuts()
    return cleanup
  }, [])

  return <AppShell />
}
