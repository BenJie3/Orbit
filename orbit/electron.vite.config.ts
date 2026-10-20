import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    // 1. Le decimos al guardia que deje empaquetar el lector de PDFs
    plugins: [externalizeDepsPlugin({ exclude: ['pdf-img-convert'] })],
    
    // 2. Protegemos estrictamente los motores nativos
    build: {
      rollupOptions: {
        external: ['canvas', 'sharp', 'uiohook-napi']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [vue()]
  }
})