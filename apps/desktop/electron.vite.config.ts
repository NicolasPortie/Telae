import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // Servidor padrão dos instaladores oficiais, definido só na compilação (veja docs/OPERATIONS.md).
    // Sem a variável, o app não aponta para servidor nenhum: quem compila o código aberto usa o próprio.
    define: {
      __TELAE_DEFAULT_SERVER_URL__: JSON.stringify(process.env.TELAE_DEFAULT_SERVER_URL?.trim() ?? ''),
      __TELAE_PREVIOUS_SERVER_URL__: JSON.stringify(process.env.TELAE_PREVIOUS_SERVER_URL?.trim() ?? ''),
      __TELAE_UPDATE_PUBLIC_KEY__: JSON.stringify(process.env.TELAE_UPDATE_PUBLIC_KEY?.trim() ?? ''),
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
        output: {
          format: 'cjs',
          entryFileNames: 'index.cjs',
        },
      },
    },
  },
  renderer: {
    root: '.',
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'index.html'),
      },
    },
  },
})
