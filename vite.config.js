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
    // upgrade can't change the browsers StoreLens supports without this changing
    // too. Keep the README's "Browser support" in step.
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
