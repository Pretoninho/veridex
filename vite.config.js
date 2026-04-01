import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'fs'

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  base: '/veridex/',
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate", version,
      includeAssets: ['favicon.ico'],
      manifest: {
        id: '/veridex/',
        name: 'Veridex',
        short_name: 'Veridex',
        description: 'Analyse cross-exchange · Signaux composites · Données vérifiées',
        theme_color: '#060a0f',
        background_color: '#060a0f',
        display: 'standalone',
        scope: '/veridex/',
        start_url: '/veridex/',
        orientation: 'portrait-primary',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ],
        shortcuts: [
          { name: 'IV Live', short_name: 'IV Live', url: '/veridex/?view=tracker' },
          { name: 'Chaîne Options', short_name: 'Chaîne', url: '/veridex/?view=chain' }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        importScripts: ['push-handlers.js'],
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) => request.destination === 'style' || request.destination === 'script' || request.destination === 'font' || (request.destination === 'image' && url.origin === self.location.origin),
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-assets',
              expiration: { maxEntries: 120, maxAgeSeconds: 30 * 24 * 60 * 60 },
            }
          },
          {
            urlPattern: /^https:\/\/www\.deribit\.com\/api/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'deribit-api',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 80, maxAgeSeconds: 30 },
            }
          }
        ]
      }
    })
  ]
})
