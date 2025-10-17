import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: true,
    watch: {
      ignored: ['!**/node_modules/@alien_org/**'],
    },
  },
  resolve: {
    alias: {
      '@alien_org/sso-sdk-react': path.resolve(__dirname, '../../packages/react/src')
    },
  },
  optimizeDeps: {
    exclude: ['@alien_org/sso-sdk-react', '@alien_org/sso-sdk-core'],
  },
});
