#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');

const API_URL = 'https://valorant-api.com/v1/maps';
const OUTPUT_PATH = path.resolve(__dirname, '..', 'assets', 'valorant', 'maps.json');

function normalizeMap(map) {
  const uuid = typeof map?.uuid === 'string' ? map.uuid.trim() : '';
  const displayName = typeof map?.displayName === 'string' ? map.displayName.trim() : '';
  const listViewIcon = typeof map?.listViewIcon === 'string' ? map.listViewIcon.trim() : '';
  const splash = typeof map?.splash === 'string' ? map.splash.trim() : '';
  const displayIcon = typeof map?.displayIcon === 'string' ? map.displayIcon.trim() : '';

  if (!uuid || !displayName) return null;

  return {
    uuid,
    displayName,
    listViewIcon: listViewIcon || null,
    splash: splash || null,
    displayIcon: displayIcon || null
  };
}

async function main() {
  const response = await fetch(API_URL, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'OW-HeroBans-OBS-Tool/1.0'
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Valorant maps: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const maps = Array.isArray(payload?.data)
    ? payload.data.map(normalizeMap).filter(Boolean).sort((a, b) => a.displayName.localeCompare(b.displayName))
    : [];

  if (!maps.length) {
    throw new Error('No maps returned from Valorant API.');
  }

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify({ updatedAt: new Date().toISOString(), maps }, null, 2)}\n`, 'utf8');

  console.log(`Saved ${maps.length} maps to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
