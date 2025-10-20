import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_GITHUB_PAGES ? '/sso-sdk-js/example-solana-sso-app/' : '/',
  server: {
    port: 3000,
    open: true,
  },
  optimizeDeps: {
    include: ['react/jsx-runtime']
  }
});
