import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  sourcemap: true,
  noExternal: ['@bn/schema', '@bn/renderer', '@bn/editor'],
})
