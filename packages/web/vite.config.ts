import { defineConfig } from 'vite';
export default defineConfig({
  // GitHub Pages serves the repo at /<repo>/ — overridden in CI via --base.
  base: process.env.VITE_BASE ?? '/',
  build: { outDir: 'dist', target: 'es2022' },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
