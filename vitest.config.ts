import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/components/**/*.test.{ts,tsx,js,jsx}'],
    setupFiles: 'vitest.setup.ts',
    coverage: {
      provider: 'c8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage/unit',
      statements: 80,
      branches: 70,
      functions: 80,
      lines: 80
    }
  }
});
