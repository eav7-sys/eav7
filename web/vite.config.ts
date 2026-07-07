import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// SPA da EAV7 — build gera estáticos servidos pelo nó (mesmo domínio, eavscan.com).
// O proxy no dev encaminha as chamadas de API para um nó local em 6070.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', assetsDir: 'assets', sourcemap: false },
  server: {
    port: 5173,
    proxy: {
      '/status': 'http://127.0.0.1:6070',
      '/blocks': 'http://127.0.0.1:6070',
      '/address': 'http://127.0.0.1:6070',
      '/tx': 'http://127.0.0.1:6070',
      '/validators': 'http://127.0.0.1:6070',
      '/tokens': 'http://127.0.0.1:6070',
      '/mempool': 'http://127.0.0.1:6070',
      '/eavm': 'http://127.0.0.1:6070',
      '/ai': 'http://127.0.0.1:6070',
      '/bridge': 'http://127.0.0.1:6070',
      '/security': 'http://127.0.0.1:6070',
    },
  },
});
