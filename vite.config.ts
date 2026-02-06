import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron({
      // 1. Apuntamos al archivo principal de Electron que creamos
      entry: 'electron/main.ts',
      vite: {
        build: {
          rollupOptions: {
            // 2. IMPORTANTE: better-sqlite3 es un módulo "nativo". 
            // No queremos que Vite intente meterlo dentro del archivo .js, 
            // sino que lo deje afuera para que Node.js lo maneje.
            external: ['better-sqlite3'],
          },
        },
      },
    }),
    // 3. Este plugin permite que React use "ipcRenderer" para hablar con la base de datos
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    emptyOutDir: true,
  },
})