/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    // Must run before react() so generated route tree is picked up.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      // autoUpdate = skipWaiting + clientsClaim: a new deploy takes over at once, a new tab gets the
      // new bundle; open tabs get the «Доступна новая версия» toast (src/lib/sw-update.ts, #56).
      registerType: 'autoUpdate',
      // Registered from src/main.tsx via virtual:pwa-register.
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon-180.png'],
      manifest: {
        name: 'IQ UP Tracker',
        short_name: 'IQ UP',
        description: 'Учёт занятий, посещаемости, оплат и зарплат IQ UP',
        lang: 'ru',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#FFFDF6',
        theme_color: '#F2C230',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // Supabase is another origin today; keep its paths out of the SPA fallback regardless.
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//],
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Precache only latin + cyrillic font subsets; others load on demand.
        globPatterns: ['**/*.{js,css,html,svg,png}', '**/*-{latin,cyrillic}-wght-*.woff2'],
      },
    }),
  ],
  define: {
    // Which bundle a user runs — shown in the profile (#56).
    'import.meta.env.VITE_BUILD_SHA': JSON.stringify(process.env.CF_PAGES_COMMIT_SHA ?? ''),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'supabase/functions/**/*.test.ts'],
    css: false,
    // full parallel runs (CI, several agents) make Radix-animated tests slow; asyncUtilTimeout is 5 s
    testTimeout: 15_000,
  },
})
