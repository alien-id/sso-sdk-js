import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      include: ['src'],
      outDir: 'dist',
      rollupTypes: true,
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'AlienSsoCore',
      formats: ['es', 'cjs', 'umd'],
      fileName: (format) => {
        if (format === 'es') return 'index.esm.js';
        if (format === 'cjs') return 'index.cjs';
        return 'index.umd.js';
      },
    },
    target: 'es2015',
    rollupOptions: {
      external: ['zod', 'zod/v4-mini', '@solana/web3.js', 'js-sha256'],
      output: {
        globals: {
          'zod': 'Zod',
          'zod/v4-mini': 'Zod',
          '@solana/web3.js': 'solanaWeb3',
          'js-sha256': 'jsSha256',
        },
      },
    },
  },
});
