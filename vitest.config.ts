import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['evals/**/*.test.ts'],
    // Native addon + Agent SDK must not be bundled/transformed by Vite.
    server: {
      deps: {
        external: [/@duckdb/, /@anthropic-ai\/claude-agent-sdk/],
      },
    },
  },
});
