import { defineConfig } from 'vitest/config';

// Separate from vite.config.js on purpose: that one sets root to src/ and loads the PWA plugin,
// neither of which a unit test wants.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
});
