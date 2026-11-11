import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5180, strictPort: true, host: true },
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
