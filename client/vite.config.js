import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { msw } from 'msw/vite'

const root = path.dirname(fileURLToPath(import.meta.url))

// Mermaid registers its ELK layout (elkjs, ~1.5 MB) as a lazy chunk. We force the dagre layout
// (src/lib/loadMermaid.js), so swap that chunk for a stub and keep it out of dist/ entirely.
function noMermaidElk() {
  const STUB = '\0mermaid-elk-stub'
  return {
    name: 'no-mermaid-elk',
    enforce: 'pre',
    resolveId(source, importer) {
      if (importer?.includes('/node_modules/mermaid/') && /(^|\/)elk-[A-Z0-9]+\.mjs$/.test(source)) return STUB
      return null
    },
    load(id) {
      if (id !== STUB) return null
      return "export const render = () => { throw new Error('ELK layout is not bundled; use dagre') }\nexport default { render }\n"
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    noMermaidElk(),
    // Only `npm run dev:mock` serves the MSW worker script. Normal dev and builds never mock.
    ...(mode === 'mock' ? [msw({ mode: 'worker-only' })] : []),
  ],
  resolve: {
    alias: { '@': path.resolve(root, 'src') },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: false,
    restoreMocks: true,
  },
}))
