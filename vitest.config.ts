import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/scratch/**',
      '**/gui/e2e/**',
      '**/desktop/*.js',
      '**/desktop/e2e/**'
    ],
    testTimeout: 30000,
    setupFiles: ['./src/test-setup.ts'],
  }
});
