import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { startSync } from './store/sync'
import { App } from './ui/App'
import './styles/app.css'

// Pick up new versions promptly: check when the app comes back to the front, and reload once
// the new version takes over (otherwise an installed app can keep showing the old one).
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}) })
  }
})
let reloading = false
navigator.serviceWorker?.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload() } })
startSync()

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
