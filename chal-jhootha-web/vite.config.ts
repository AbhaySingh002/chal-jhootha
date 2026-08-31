import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      shared: fileURLToPath(new URL('./shared/src/index.ts', import.meta.url)),
    },
  },
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:10000',
      '/ws': { target: 'ws://localhost:10000', ws: true },
    },
  },
})
