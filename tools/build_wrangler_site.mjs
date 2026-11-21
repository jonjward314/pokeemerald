#!/usr/bin/env node
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

const output = 'dist/cloudflare';
const files = [
  ['web/index.html', `${output}/index.html`],
  ['web/style.css', `${output}/web/style.css`],
  ['web/app.js', `${output}/web/app.js`],
  ['web/audio.js', `${output}/web/audio.js`],
  ['web/link.js', `${output}/web/link.js`],
  ['web/profiles.js', `${output}/web/profiles.js`],
  ['web/audio-worklet.js', `${output}/web/audio-worklet.js`],
  ['build/wasm/sound.bin', `${output}/build/wasm/sound.bin`],
  ['web/manifest.webmanifest', `${output}/web/manifest.webmanifest`],
  ['web/icon-192.png', `${output}/web/icon-192.png`],
  ['web/icon-512.png', `${output}/web/icon-512.png`],
  ['web/admin/index.html', `${output}/admin/index.html`],
  ['web/admin/admin.css', `${output}/admin/admin.css`],
  ['web/admin/admin.js', `${output}/admin/admin.js`],
  ['build/wasm/pokeemerald.wasm', `${output}/build/wasm/pokeemerald.wasm`],
];

await rm(output, { recursive: true, force: true });

for (const [source, destination] of files) {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

console.log(`prepared Cloudflare static assets in ${output}`);
