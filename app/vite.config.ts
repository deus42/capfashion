import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = 'http://127.0.0.1:4317';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5317,
    proxy: { '/api': api, '/media': api, '/thumb': api },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
