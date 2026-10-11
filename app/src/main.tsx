import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { startSync } from './store/sync'
import { App } from './ui/App'
import './styles/app.css'

registerSW({ immediate: true })
startSync()

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
