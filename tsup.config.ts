import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  treeshake: true,
  outDir: 'dist',
  target: 'es2022',
  // Ensure external dependencies are not bundled
  external: [
    'bottleneck',
    'simple-proxy-agent',
    'node-fetch',
    'rate-limiter-flexible',
  ],
});
