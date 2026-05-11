import { defineConfig } from 'vitest/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as { version: string };

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.spec.ts', 'src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**', 'src/index.ts'],
    },
  },
  define: {
    __DOOW_DEBUG__: 'true',
    // __SDK_VERSION__ is replaced at build/test time with the version from package.json
    __SDK_VERSION__: JSON.stringify(pkg.version),
  },
  esbuild: {
    target: 'node18',
  },
});
