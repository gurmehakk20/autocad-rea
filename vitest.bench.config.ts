import { defineConfig } from 'vitest/config';

// Benchmarks print timings and run in a separate config so `npm test` stays fast.
export default defineConfig({
  test: {
    include: ['tests/bench/**/*.bench.ts'],
    environment: 'node',
    testTimeout: 600_000,
  },
});
