import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'process', 'util', 'stream']
    })
  ],
  base: process.env.VITE_GITHUB_PAGES ? '/sso-sdk-js/example-solana-sso-app/' : '/',
  server: {
    port: 3000,
    open: true,
  },
  define: {
    'global': 'globalThis',
  },
  optimizeDeps: {
    include: ['react/jsx-runtime']
  }
});
