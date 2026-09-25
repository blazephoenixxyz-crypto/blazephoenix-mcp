import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/server.ts', 'src/config.ts'],
  format: ['esm'],
  target: 'node18',
  dts: { entry: ['src/server.ts', 'src/config.ts'] },
  sourcemap: true,
  clean: true,
  // Runtime dependencies stay external: npm installs them next to the bin.
  external: ['@blazephoenix/sdk', '@modelcontextprotocol/sdk', 'viem', 'zod'],
});
