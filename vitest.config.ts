import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// The examples import the package by its name, as a user would. In the tests that name points at the source, so they run without a build.
export default defineConfig({
  resolve: { alias: { '@extrafemi-ai/assay/gate': fileURLToPath(new URL('./src/gate.ts', import.meta.url)) } },
});
