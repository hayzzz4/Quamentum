import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: './src/test/global-setup.ts',
    setupFiles: ['./src/test/setup-env.ts'],
    testTimeout: 15000,
    // Every integration test shares one local Postgres instance via
    // truncateAllTables(); running test files in parallel lets one file's
    // truncate race another file's insert. Serialize files, not individual
    // tests within a file (those still run in TDD-authored order).
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
