import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173, // Changed from 3000
    strictPort: false, // Will try next available port if 5173 is taken
    open: true, // Auto-open browser
  },
  // Environment variable prefix
  envPrefix: 'VITE_',
});
