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
    // upgrade can't change how the JavaScript or CSS is transpiled without this
    // changing too. `target` is the JavaScript floor; `cssTarget` is the CSS floor
    // (Tailwind v4 needs Chrome/Edge 111, Firefox 128 and Safari 16.4), which is
    // what the README's "Browser support" states. Without `cssTarget`, Vite 8's
    // Lightning CSS minifier lowers every oklch() colour against `target` to lab()
    // plus fallbacks. Keep the README in step with both.
    target: ['chrome107', 'edge107', 'firefox104', 'safari16'],
    cssTarget: ['chrome111', 'edge111', 'firefox128', 'safari16.4'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}', 'scripts/**/*.test.mjs'],
    // Fails any test that calls fetch without stubbing it (no real network).
    setupFiles: ['./src/lib/__fixtures__/no-network.js', './src/lib/__fixtures__/locale-setup.js'],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
