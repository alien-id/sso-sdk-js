import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  testEnvironment: 'node',
  preset: 'ts-jest/presets/default-esm',
  testMatch: ['**/tests/**/*.test.ts'],
  verbose: true,
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      useESM: true,
      // ES2020 keeps native BigInt ** (ES2015 downlevels it to Math.pow,
      // which breaks @noble/curves when transformed here).
      tsconfig: { target: 'ES2020' },
    },
  },
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  transformIgnorePatterns: ['/node_modules/(?!@noble)'],
};

export default config;
