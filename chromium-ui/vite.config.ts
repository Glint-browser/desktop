import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Two entries: the side-panel page (React app) and the MV3 service worker.
// The worker is declared "type": "module" in the manifest, so shared chunks
// imported from both entries are fine.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: {
        sidepanel: 'sidepanel.html',
        settings: 'settings.html',
        background: 'src/background.ts'
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  }
})
