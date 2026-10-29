import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // One database, tests make their own organizations; files run one after another to keep the pool small.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
