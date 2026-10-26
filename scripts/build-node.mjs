import { build } from 'esbuild';

await build({
    entryPoints: ['src/node.ts'],
    outfile: 'dist/node.mjs',
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node26',
    packages: 'external',
});
