import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.NEXO_API ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  // Relative paths so the desktop app can load the build from disk.
  base: './',
  server: {
    port: 5173,
    proxy: {
      '/api': api,
      '/uploads': api,
      '/socket.io': { target: api, ws: true },
    },
  },
});
