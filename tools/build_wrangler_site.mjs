#!/usr/bin/env node
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

const output = 'dist/cloudflare';
const files = [
  ['web/index.html', `${output}/index.html`],
  ['web/style.css', `${output}/web/style.css`],
  ['web/app.js', `${output}/web/app.js`],
  ['web/manifest.webmanifest', `${output}/web/manifest.webmanifest`],
  ['web/icon-192.png', `${output}/web/icon-192.png`],
  ['web/icon-512.png', `${output}/web/icon-512.png`],
  ['build/wasm/pokeemerald.wasm', `${output}/build/wasm/pokeemerald.wasm`],
];

await rm(output, { recursive: true, force: true });

for (const [source, destination] of files) {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

console.log(`prepared Cloudflare static assets in ${output}`);
