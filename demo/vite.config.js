import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  server: { proxy: { '/api': 'http://localhost:3009' } },
  preview: { proxy: { '/api': 'http://localhost:3009' } },
});
