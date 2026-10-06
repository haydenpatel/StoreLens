import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(),tailwindcss()],
  resolve: {
    alias: {"@": path.resolve(__dirname, "./src")},
  },
  build: {
    // Pinned, not left to Vite's default ('baseline-widely-available'), so a Vite
    // upgrade can't change how the JavaScript is transpiled without this changing
    // too. This is the JavaScript floor only: the CSS (Tailwind v4) needs Chrome/Edge
    // 111, Firefox 128 and Safari 16.4, which is what the README's "Browser support"
    // states. Keep the README in step with both.
    target: ['chrome107', 'edge107', 'firefox104', 'safari16'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}', 'scripts/**/*.test.mjs'],
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
})
