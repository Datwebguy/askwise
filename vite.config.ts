import { defineConfig } from 'vite'

export default defineConfig({
  root: 'web',
  build: { target: 'esnext', outDir: '../dist', emptyOutDir: true },
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: { root: '.', include: ['tests/**/*.test.ts'], testTimeout: 20000 },
})
