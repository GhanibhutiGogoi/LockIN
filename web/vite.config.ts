import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const localProxy = {
  '/v1/web-memory': { target: 'http://127.0.0.1:8000', changeOrigin: true },
  '/v1/web-screen': { target: 'http://127.0.0.1:8000', changeOrigin: true },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5180, strictPort: true, host: true, proxy: localProxy },
  preview: { proxy: localProxy },
  build: {
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'index.html'),
        // pilot sign-up page (static, built with hallmark)
        pilot: resolve(__dirname, 'pilot/index.html'),
      },
    },
  },
});
