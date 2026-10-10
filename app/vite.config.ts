/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'

const dataDir = fileURLToPath(new URL('../data', import.meta.url))

export default defineConfig({
  resolve: { alias: { '@data': dataDir } },
  server: { fs: { allow: ['..'] } },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: { navigateFallbackDenylist: [/^\/api\//] },
      includeAssets: ['icon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Smart Pantry',
        short_name: 'Pantry',
        description: 'What can I cook right now? Tiered dishes from what is in your kitchen.',
        theme_color: '#E5A50A',
        background_color: '#E8EBE7',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ],
  test: { environment: 'node', include: ['src/**/*.test.ts'] }
})
