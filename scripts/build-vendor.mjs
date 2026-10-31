import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

await mkdir(new URL('../vendor/', import.meta.url), { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL('./vendor-entry.js', import.meta.url))],
  outfile: fileURLToPath(new URL('../vendor/jsonify-libs.js', import.meta.url)),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'JSONifyVendor',
  target: ['es2022'],
  minify: true,
  legalComments: 'inline',
});
console.log('Built local standards libraries: vendor/jsonify-libs.js');
