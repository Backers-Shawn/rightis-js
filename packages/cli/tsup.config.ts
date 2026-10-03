import { defineConfig } from 'tsup';

// ESM only: this package is a command, not a library. @rightis/sdk stays an
// external dependency (tsconfig.build.json has no path mapping to its source).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  tsconfig: 'tsconfig.build.json',
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  external: ['@rightis/sdk'],
  banner: { js: '#!/usr/bin/env node' },
});
