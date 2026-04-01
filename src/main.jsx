import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './interface/App.jsx'
import { ErrorBoundary } from './interface/App.jsx'
import './index.css'
import { registerSW } from 'virtual:pwa-register'

registerSW({
  immediate: true,
  onOfflineReady() {
    console.info('PWA offline ready')
  },
  onRegisterError(error) {
    console.warn('PWA registration error', error)
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
