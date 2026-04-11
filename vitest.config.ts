import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'node:test': path.resolve(__dirname, 'vitest-node-test-shim.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx,js,jsx}'],
    exclude: [
      'src/lib/task-governance.test.ts',
      'src/lib/workspace-isolation.test.ts',
      'src/lib/task-lifecycle.smoke.test.ts',
    ],
    setupFiles: 'vitest.setup.ts',
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage/unit'
    }
  }
});
