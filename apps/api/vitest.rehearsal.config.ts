import { defineConfig } from 'vitest/config';

// P11-S5: the migration rehearsal. Not part of `pnpm test`: run with `pnpm --filter @ledgora/api rehearse`.
export default defineConfig({
  test: {
    include: ['rehearsal/**/*.rehearse.ts'],
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
    fileParallelism: false,
  },
});
