// Shim must load BEFORE anything imports window.api (format handlers,
// services, dialogs). Side-effect import is intentional.
import './lib/electron-api-shim'

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { registerAllFormats } from './formats/registerAll'
import './styles/global.css'

registerAllFormats()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
