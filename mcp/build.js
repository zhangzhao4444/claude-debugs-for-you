// build.js
import * as esbuild from 'esbuild';
import { chmod } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get __dirname equivalent in ES modules
const __dirname = dirname(fileURLToPath(import.meta.url));

async function build() {
  // First build the bundle
  await esbuild.build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: 'build/index.js',
    minify: false,
    sourcemap: true,
    external: [],
    format: 'esm',
    banner: {
      js: '#!/usr/bin/env node',
    },
    loader: { '.ts': 'ts' },
    tsconfig: 'tsconfig.json',
  });

  // Make the output file executable
  await chmod('build/index.js', 0o755);
  
  console.log('Build completed successfully!');
  console.log('Output file: build/index.js');
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
