#!/usr/bin/env node
// Writes the game data the admin page needs (routes with wild Pokémon and
// the species list) as JSON, straight from the decompiled sources.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const output = process.argv[2] || 'dist/cloudflare/admin/game-data.json';

const speciesConsts = new Map();
for (const [, name, value] of (await readFile('include/constants/species.h', 'utf8')).matchAll(/#define (SPECIES_\w+) (\d+)/g)) {
  speciesConsts.set(name, Number(value));
}

const species = [];
for (const [, name, text] of (await readFile('src/data/text/species_names.h', 'utf8')).matchAll(/\[(SPECIES_\w+)\] = _\("([^"]*)"\)/g)) {
  const id = speciesConsts.get(name);
  // Skip the empty slot, the unused Unown placeholders (named "?") and Egg.
  if (!id || text === '?' || name === 'SPECIES_EGG') continue;
  species.push({ id, name: titleCase(text) });
}
species.sort((a, b) => a.name.localeCompare(b.name));

const mapValues = new Map();
for (const [, name, num, group] of (await readFile('include/constants/map_groups.h', 'utf8')).matchAll(/(MAP_\w+)\s*=\s*\((\d+) \| \((\d+) << 8\)\)/g)) {
  mapValues.set(name, { group: Number(group), num: Number(num) });
}

const encounters = JSON.parse(await readFile('src/data/wild_encounters.json', 'utf8'));
const maps = [];
const seen = new Set();
for (const group of encounters.wild_encounter_groups) {
  if (!group.for_maps) continue;
  for (const entry of group.encounters) {
    const where = mapValues.get(entry.map);
    if (!where || seen.has(entry.map) || entry.map.includes('UNUSED')) continue;
    const land = unique(entry.land_mons?.mons);
    const water = unique(entry.water_mons?.mons);
    if (!land.length && !water.length) continue;
    seen.add(entry.map);
    maps.push({ key: `${where.group}:${where.num}`, map: entry.map, name: mapName(entry.map), land, water });
  }
}
maps.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ maps, species }));
console.log(`wrote ${output}: ${maps.length} maps, ${species.length} species`);

function unique(mons = []) {
  return [...new Set(mons.map((mon) => speciesConsts.get(mon.species)).filter(Boolean))];
}

function titleCase(text) {
  return text.toLowerCase().replace(/(^|[\s.-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

function mapName(constant) {
  return constant.replace(/^MAP_/, '').split('_')
    .map((word) => (/^(B?\d+F|B\d+|\d+R|SS)$/.test(word) ? word : word.charAt(0) + word.slice(1).toLowerCase()))
    .join(' ')
    .replace(/([a-z])(\d)/g, '$1 $2');
}
