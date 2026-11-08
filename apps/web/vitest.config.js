import { defineConfig } from 'vitest/config';

// Separate from vite.config.js on purpose: that one sets root to src/ and loads the PWA plugin,
// neither of which a unit test wants.
export default defineConfig({
  // The component tests render .jsx sources, which use the automatic JSX runtime (no `import React`).
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
});
