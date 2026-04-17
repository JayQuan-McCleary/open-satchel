import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { registerAllFormats } from './formats/registerAll'
import './styles/global.css'

// Register every format handler at app start. Handlers are small and pure
// (just metadata + lazy-loaded Viewer components), so this is cheap.
registerAllFormats()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
