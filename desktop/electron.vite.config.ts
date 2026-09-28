import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: { externalizeDeps: { exclude: ['unpdf'] } }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        // ONNX runtime files ship inside the app instead of coming from a CDN.
        'ort-dist': resolve('node_modules/@huggingface/transformers/dist')
      }
    },
    plugins: [react()],
    worker: { format: 'es' },
    optimizeDeps: { exclude: ['@huggingface/transformers'] }
  }
})
