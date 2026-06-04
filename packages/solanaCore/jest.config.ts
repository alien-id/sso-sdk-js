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
      // @noble/curves (transformed here, see transformIgnorePatterns below) uses
      // BigInt `**`. The package's own build targets ES2015, which would
      // down-level that to `Math.pow` and crash at load ("Cannot convert a
      // BigInt value to a number"). Compile the test graph at a target that
      // keeps BigInt operators native.
      tsconfig: { target: 'ES2020' },
    },
  },
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  transformIgnorePatterns: ['/node_modules/(?!@noble)'],
};

export default config;
