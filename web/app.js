import { createGameAudio } from './audio.js';
import { createLinkCable } from './link.js';
import { choosePlayer, pickerRequested, switchPlayer } from './profiles.js';

const WIDTH = 240;
const HEIGHT = 160;
const REG = 0x04000000;
const KEYINPUT = 0x04000130;
const KEY_MASK = 0x03ff;
const FLASH_BASE = 0x0e000000;
const FLASH_SIZE = 128 * 1024;
const FLASH_SECTOR_SIZE = 4096;
const REG_OFFSET_WIN0H = 0x40;
const REG_OFFSET_WIN0V = 0x44;
const REG_OFFSET_WININ = 0x48;
const REG_OFFSET_WINOUT = 0x4a;
const REG_OFFSET_DMA0 = 0xb0;
const DMA_DEST_FIXED = 0x0040;
const DMA_DEST_RELOAD = 0x0060;
const DMA_REPEAT = 0x0200;
const DMA_START_HBLANK = 0x2000;
const DMA_ENABLE = 0x8000;
const SAVE_SECTORS_PER_SLOT = 14;
const SAVE_SECTOR_SIGNATURE = 0x08012025;
const SAVE_SECTOR_DATA_SIZES = [
  0x0f2c,
  0x0f80, 0x0f80, 0x0f80, 0x0f0c,
  0x0f80, 0x0f80, 0x0f80, 0x0f80, 0x0f80, 0x0f80, 0x0f80, 0x0f80, 0x07d0,
];
const VANILLA_SAVE_SECTOR_DATA_SIZES = [
  0x0f2c,
  0x0f80, 0x0f80, 0x0f80, 0x0f08,
  0x0f80, 0x0f80, 0x0f80, 0x0f80, 0x0f80, 0x0f80, 0x0f80, 0x0f80, 0x07d0,
];
const LEGACY_WASM_SAVE_SECTOR_DATA_SIZES = [
  0x0f08,
  0x0f80, 0x0f80, 0x0f80, 0x0dc4,
  0x0f80, 0x0f80, 0x0f80, 0x0f80, 0x0f80, 0x0f80, 0x0f80, 0x0f80, 0x07d0,
];
const LEGACY_WASM_FRONTEND_SAVE_SECTOR_DATA_SIZES = [
  0x0f08,
  0x0f80, 0x0f80, 0x0f80, 0x0dc0,
  0x0f80, 0x0f80, 0x0f80, 0x0f80, 0x0f80, 0x0f80, 0x0f80, 0x0f80, 0x07d0,
];
const SAVE_BLOCK2_SIZE = 0x0f2c;
const SAVE_BLOCK1_SIZE = 0x3d8c;
const LEGACY_SAVE_BLOCK2_SIZE = 0x0f08;
const LEGACY_SAVE_BLOCK1_SIZE = 0x3c44;
const SAVE_BLOCK2_ENCRYPTION_KEY_OFFSET = 0x0ac;
const SAVE_BLOCK2_TRAINER_ID_OFFSET = 0x00a;
const SAVE_BLOCK1_COINS_OFFSET = 0x494;
const SAVE_BAG_POCKETS = [
  [0x560, 30, 99],
  [0x5d8, 30, 99],
  [0x650, 16, 99],
  [0x690, 64, 99],
  [0x790, 46, 999],
];
const BASE_SAVE_STORAGE_KEY = 'pokeemerald.wasm.flash.v1';
// Each player on the sign-in ("Who's playing?", web/profiles.js) keeps their
// own copy in this browser; the account's own player keeps the original key.
let SAVE_STORAGE_KEY = BASE_SAVE_STORAGE_KEY;
let profileId = 'main';
const SAVE_FLUSH_INTERVAL_MS = 1000;
const searchParams = new URLSearchParams(location.search);
const speedParam = searchParams.get('speed');
const automate = searchParams.get('automate') === '1';
const MIN_SPEED = 0.1;
const MAX_SPEED = 1000;
const FAST_FRAME_BUDGET_MS = 16;

const linkBadge = document.getElementById('link-badge');
const linkStatusEl = document.getElementById('link-status');
const linkCableSelect = document.getElementById('link-cable');
const linkCable = createLinkCable({
  profile: () => profileId,
  onStatus: ({ text, active }) => {
    if (linkBadge) {
      linkBadge.textContent = text;
      linkBadge.hidden = !active || !text;
    }
    if (linkStatusEl) linkStatusEl.textContent = text || 'Not plugged in. Talk to the Cable Club lady upstairs in a Pokémon Center.';
  },
});
if (linkCableSelect) {
  linkCableSelect.value = String(linkCable.cable());
  linkCableSelect.addEventListener('change', () => linkCable.setCable(Number(linkCableSelect.value)));
}

const buttons = {
  a: 1 << 0,
  b: 1 << 1,
  select: 1 << 2,
  start: 1 << 3,
  right: 1 << 4,
  left: 1 << 5,
  up: 1 << 6,
  down: 1 << 7,
  r: 1 << 8,
  l: 1 << 9,
};

const DEFAULT_KEYS = [
  ['KeyZ', 'a'], ['KeyX', 'b'], ['ShiftLeft', 'select'], ['ShiftRight', 'select'], ['Enter', 'start'],
  ['ArrowRight', 'right'], ['ArrowLeft', 'left'], ['ArrowUp', 'up'], ['ArrowDown', 'down'],
  ['KeyS', 'r'], ['KeyA', 'l'],
];
const KEYS_STORAGE_KEY = 'emerald-keys';
const LAYOUT_STORAGE_KEY = 'emerald-layout';
const keyMap = new Map(loadKeyMap());

function loadKeyMap() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEYS_STORAGE_KEY));
    if (Array.isArray(stored) && stored.every((e) => Array.isArray(e) && e[1] in buttons)) return stored;
  } catch { /* storage disabled or bad data */ }
  return DEFAULT_KEYS;
}

const canvas = document.querySelector('#screen');
const statusEl = document.querySelector('#status');
const speedButtons = document.querySelectorAll('[data-speed]');
const speedValue = document.querySelector('#speed-value');
const fullscreenButton = document.querySelector('#fullscreen');
const shell = document.querySelector('.shell');
const downloadSaveButton = document.querySelector('#download-save');
const uploadSaveInput = document.querySelector('#upload-save');
const ctx = canvas.getContext('2d');
const soundButton = document.querySelector('#sound-toggle');
const gameAudio = createGameAudio({ onStateChange: updateSoundButton });
if (!automate) gameAudio.unlockOnFirstGesture();

function updateSoundButton() {
  if (!soundButton) return;
  soundButton.textContent = gameAudio.enabled ? 'Sound: on' : 'Sound: off';
  soundButton.classList.toggle('active', gameAudio.enabled);
}
soundButton?.addEventListener('click', () => gameAudio.setEnabled(!gameAudio.enabled));
updateSoundButton();
let image;
const pressed = new Set();
const pendingPresses = new Map();

let instance;
let memory;
let u8;
let u16;
let u32;
let statusText = 'loading wasm…';
let lastFpsUpdate = performance.now();
let lastTick = performance.now();
let renderedFrames = 0;
let emulatedFrames = 0;
let gameFrameAccumulator = 0;
let speed = 1;
let lastFiniteSpeed = 1;
let currentFrame = 0;
let lastSavedFlashHash = 0;
let lastSaveFlushTime = performance.now();
let wasmModulePromise;
let bootId = 0;
let automationReady;
let resolveAutomationReady;
if (automate) {
  automationReady = new Promise((resolve) => { resolveAutomationReady = resolve; });
}

function refreshViews() {
  u8 = new Uint8Array(memory.buffer);
  u16 = new Uint16Array(memory.buffer);
  u32 = new Uint32Array(memory.buffer);
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    const chunk = bytes.subarray(i, i + 0x8000);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function flashBytes() {
  return u8.subarray(FLASH_BASE, FLASH_BASE + FLASH_SIZE);
}

function hashBytes(bytes) {
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function loadFlashSave(sourceBytes) {
  const flash = flashBytes();
  flash.fill(0xFF);

  if (sourceBytes?.length === FLASH_SIZE) {
    flash.set(normalizeSaveForCurrentBuild(sourceBytes) ?? sourceBytes);
  } else {
    try {
      const stored = localStorage.getItem(SAVE_STORAGE_KEY);
      if (stored) {
        const saved = base64ToBytes(stored);
        if (saved.length === FLASH_SIZE) {
          const normalized = normalizeSaveForCurrentBuild(saved);
          flash.set(normalized ?? saved);
          if (normalized && normalized !== saved) localStorage.setItem(SAVE_STORAGE_KEY, bytesToBase64(normalized));
        }
      }
    } catch {
      // Storage may be disabled; the game can still run with volatile flash.
    }
  }

  lastSavedFlashHash = hashBytes(flash);
}

function saveFlashIfChanged(force = false) {
  if (!u8) return;
  const now = performance.now();
  if (!force && now - lastSaveFlushTime < SAVE_FLUSH_INTERVAL_MS) return;
  lastSaveFlushTime = now;

  const flash = flashBytes();
  const hash = hashBytes(flash);
  if (!force && hash === lastSavedFlashHash) return;

  const changed = hash !== lastSavedFlashHash;
  try {
    localStorage.setItem(SAVE_STORAGE_KEY, bytesToBase64(flash));
    lastSavedFlashHash = hash;
  } catch {
    // Keep running even if the browser refuses persistent storage.
  }
  if (changed) {
    setLocalSavedAt(Date.now());
    scheduleCloudUpload();
  }
}

// ---- Account saves -------------------------------------------------------
// When the site runs on the Cloudflare Worker (worker/index.js), each player's
// save is also kept on the server, keyed by their family login. The newest
// copy wins at start-up, so a cleared browser or a new phone keeps the game.
// On plain static hosting the /api/save endpoint is missing and this is off.
let SAVE_TIME_KEY = `${SAVE_STORAGE_KEY}.savedAt`;

function profileHeaders(headers = {}) {
  return profileId === 'main' ? headers : { ...headers, 'X-Profile': profileId };
}
const cloudStatusEl = document.querySelector('#cloud-status');
let cloudAvailable = false;
let cloudUploadTimer = 0;
let cloudUploadAfterBoot = false;

function localSavedAt() {
  try { return Number(localStorage.getItem(SAVE_TIME_KEY)) || 0; } catch { return 0; }
}

function setLocalSavedAt(time) {
  try { localStorage.setItem(SAVE_TIME_KEY, String(time)); } catch { /* storage disabled */ }
}

function hasLocalSave() {
  try { return Boolean(localStorage.getItem(SAVE_STORAGE_KEY)); } catch { return false; }
}

function setCloudStatus(text) {
  if (cloudStatusEl) cloudStatusEl.textContent = text;
}

function timeText(ms) {
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

async function fetchCloudSave() {
  try {
    const res = await fetch('api/save', { cache: 'no-store', credentials: 'same-origin', headers: profileHeaders() });
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    if (res.ok && !isJson) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length !== FLASH_SIZE) return { available: true };
      return { available: true, bytes, savedAt: Number(res.headers.get('X-Saved-At')) || 0 };
    }
    if (isJson && res.status === 404) return { available: true };
    if (isJson && res.status === 401) setCloudStatus('Account saves: not signed in. Reload the page to sign in again.');
    return { available: false };
  } catch {
    return { available: false };
  }
}

async function startupSave() {
  if (automate) return undefined;
  const cloud = await fetchCloudSave();
  cloudAvailable = cloud.available;
  if (!cloudAvailable) {
    if (!cloudStatusEl?.textContent) setCloudStatus('Saves are kept in this browser only.');
    return undefined;
  }

  const localAt = localSavedAt();
  if (cloud.bytes && (!hasLocalSave() || cloud.savedAt > localAt)) {
    try {
      localStorage.setItem(SAVE_STORAGE_KEY, bytesToBase64(cloud.bytes));
      setLocalSavedAt(cloud.savedAt);
    } catch { /* still boot from the account copy */ }
    setCloudStatus(`Account save loaded (saved ${timeText(cloud.savedAt)}).`);
    return cloud.bytes;
  }

  if (hasLocalSave() && (!cloud.bytes || localAt > cloud.savedAt)) {
    cloudUploadAfterBoot = true; // this browser has the newer game
  } else {
    setCloudStatus(cloud.bytes ? `Account save is up to date (saved ${timeText(cloud.savedAt)}).` : 'Account saves are on. Save in the game to store it.');
  }
  return undefined;
}

function scheduleCloudUpload(delayMs = 1500) {
  if (!cloudAvailable) return;
  clearTimeout(cloudUploadTimer);
  cloudUploadTimer = setTimeout(uploadCloudSave, delayMs);
}

async function uploadCloudSave() {
  if (!u8 || !cloudAvailable) return;
  const savedAt = localSavedAt() || Date.now();
  const body = flashBytes().slice();
  setCloudStatus('Saving to your account…');
  try {
    const res = await fetch('api/save', {
      method: 'PUT',
      body,
      credentials: 'same-origin',
      headers: profileHeaders({ 'Content-Type': 'application/octet-stream', 'X-Saved-At': String(savedAt) }),
    });
    if (res.ok) setCloudStatus(`Saved to your account at ${timeText(savedAt)}.`);
    else if (res.status === 409) setCloudStatus('Another device saved a newer game. Reload to continue from it.');
    else if (res.status === 401) setCloudStatus('Account save failed: not signed in. Reload the page to sign in again.');
    else setCloudStatus(`Account save failed (${res.status}). It is still saved in this browser.`);
  } catch {
    setCloudStatus('Offline: saved in this browser. It will go to your account after the next save.');
  }
}

// ---- House rules -----------------------------------------------------------
// The admin page (/admin, worker/index.js) sets EXP, prize money and
// encounter multipliers and the game clock. They are written into the C
// struct gWasmRules (include/wasm_rules.h) by byte offset. The clock is the
// device's local time, which also turns on the game's real-time clock.
const RULES_REFRESH_MS = 5 * 60 * 1000;
const SECONDS_1970_TO_2000 = 946684800;
const screenEl = document.querySelector('#screen');
let gameRules = {
  expPercent: 100, moneyPercent: 100, encounterPercent: 100, catchPercent: 100,
  clockMode: 'real', clockShiftHours: 0, clockLockHour: 12, dayNight: true,
};
let rulesVersion = 0;
let lastPhaseCheck = 0;
let dayNightPhase = 0;
// Replays (?automate=1) stay deterministic: no rules or clock unless ?rules=1.
const rulesEnabled = !automate || searchParams.get('rules') === '1';

async function fetchGameRules(timeoutMs = 3000) {
  if (!rulesEnabled) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('api/rules', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal, headers: profileHeaders() });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('application/json')) return;
    gameRules = { ...gameRules, ...(await res.json()) };
    writeGameRules();
  } catch { /* offline or static hosting: keep the last rules */ } finally {
    clearTimeout(timer);
  }
}

function rulesView() {
  const address = instance?.exports.gWasmRules?.value;
  if (address === undefined || !memory) return null;
  return { view: new DataView(memory.buffer), address };
}

function writeGameRules() {
  if (!rulesEnabled) return;
  const target = rulesView();
  if (!target) return;
  const { view, address } = target;
  view.setUint32(address + 0x00, ++rulesVersion, true);
  view.setUint16(address + 0x04, gameRules.expPercent, true);
  view.setUint16(address + 0x06, gameRules.moneyPercent, true);
  view.setUint16(address + 0x08, gameRules.encounterPercent, true);
  view.setUint8(address + 0x0a, gameRules.dayNight ? 1 : 0);
  view.setUint16(address + 0x10, gameRules.catchPercent ?? 100, true);
  writeEncounterOverrides(view);
  writeGameClock();
}

// Route overrides from the admin page: { "group:num": [species ids] } into
// gWasmEncounterOverrides (include/wasm_rules.h: 64 entries of 0x44 bytes).
function writeEncounterOverrides(view) {
  const base = instance.exports.gWasmEncounterOverrides?.value;
  if (base === undefined) return;
  new Uint8Array(memory.buffer, base, 64 * 0x44).fill(0);
  let slot = 0;
  for (const [key, list] of Object.entries(gameRules.encounters || {})) {
    const [group, num] = key.split(':').map(Number);
    const ids = (list || []).slice(0, 32);
    if (!ids.length || slot >= 64 || !Number.isInteger(group) || !Number.isInteger(num)) continue;
    const entry = base + slot * 0x44;
    view.setUint8(entry, group);
    view.setUint8(entry + 1, num);
    view.setUint8(entry + 2, ids.length);
    ids.forEach((id, i) => view.setUint16(entry + 4 + i * 2, id, true));
    slot++;
  }
}

function gameClockSeconds() {
  const now = new Date();
  const local = Math.floor(now.getTime() / 1000) - now.getTimezoneOffset() * 60;
  let seconds = local;
  if (gameRules.clockMode === 'shift') seconds += gameRules.clockShiftHours * 3600;
  else if (gameRules.clockMode === 'lock') seconds = Math.floor(local / 86400) * 86400 + gameRules.clockLockHour * 3600;
  return Math.max(1, seconds - SECONDS_1970_TO_2000);
}

function writeGameClock() {
  if (!rulesEnabled) return;
  const target = rulesView();
  if (target) target.view.setUint32(target.address + 0x0c, gameClockSeconds(), true);
}

// Darkens outdoor maps in the evening and at night (the original game has no
// day/night look). The game reports the phase; the page just tints the canvas.
function updateDayNight(now) {
  if (!rulesEnabled || now - lastPhaseCheck < 500) return;
  lastPhaseCheck = now;
  const phase = instance?.exports.WasmDayNightPhase ? instance.exports.WasmDayNightPhase() : 0;
  if (phase === dayNightPhase) return;
  dayNightPhase = phase;
  screenEl.classList.toggle('tint-dawn', phase === 1);
  screenEl.classList.toggle('tint-evening', phase === 2);
  screenEl.classList.toggle('tint-night', phase === 3);
}

setInterval(fetchGameRules, RULES_REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') fetchGameRules();
});

// Which build is running (written by tools/build_wrangler_site.mjs).
fetch('version.json', { cache: 'no-store' })
  .then((res) => (res.ok ? res.json() : null))
  .then((info) => {
    const el = document.querySelector('#version');
    if (!info || !el) return;
    const built = new Date(info.builtAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    el.textContent = `Version ${info.sha || 'local'}, built ${built}`;
  })
  .catch(() => { /* no version file when served from the source tree */ });

function downloadSave() {
  if (!u8) return;
  saveFlashIfChanged(true);
  const blob = new Blob([new Uint8Array(flashBytes())], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'pokeemerald.sav';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function readSaveU16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readSaveU32(bytes, offset) {
  return (bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)) >>> 0;
}

function writeSaveU16(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
}

function saveSectorChecksum(bytes, offset, size) {
  let sum = 0;
  let i = 0;
  for (; i + 3 < size; i += 4) sum = (sum + readSaveU32(bytes, offset + i)) >>> 0;
  for (; i < size; i++) sum = (sum + (bytes[offset + i] << ((i & 3) * 8))) >>> 0;
  return ((sum >>> 16) + (sum & 0xffff)) & 0xffff;
}

function hasValidEmeraldSaveSlot(bytes, slot, sectorDataSizes) {
  let validSectorFlags = 0;
  const firstSector = slot * SAVE_SECTORS_PER_SLOT;

  for (let i = 0; i < SAVE_SECTORS_PER_SLOT; i++) {
    const sectorOffset = (firstSector + i) * FLASH_SECTOR_SIZE;
    const id = readSaveU16(bytes, sectorOffset + 0x0ff4);
    const checksum = readSaveU16(bytes, sectorOffset + 0x0ff6);
    const signature = readSaveU32(bytes, sectorOffset + 0x0ff8);
    const dataSize = sectorDataSizes[id];

    if (signature === SAVE_SECTOR_SIGNATURE
      && dataSize !== undefined
      && checksum === saveSectorChecksum(bytes, sectorOffset, dataSize)) {
      validSectorFlags |= 1 << id;
    }
  }

  return validSectorFlags === (1 << SAVE_SECTORS_PER_SLOT) - 1;
}

function isValidEmeraldSave(bytes, sectorDataSizes) {
  return hasValidEmeraldSaveSlot(bytes, 0, sectorDataSizes)
    || hasValidEmeraldSaveSlot(bytes, 1, sectorDataSizes);
}

function isValidCurrentBuildSave(bytes) {
  return isValidEmeraldSave(bytes, SAVE_SECTOR_DATA_SIZES)
    || isValidEmeraldSave(bytes, VANILLA_SAVE_SECTOR_DATA_SIZES);
}

function copyRange(dst, dstOffset, src, srcOffset, size) {
  dst.set(src.subarray(srcOffset, srcOffset + size), dstOffset);
}

function copyLegacyArray(dst, dstOffset, dstElementSize, src, srcOffset, srcElementSize, count) {
  for (let i = 0; i < count; i++) {
    copyRange(dst, dstOffset + i * dstElementSize, src, srcOffset + i * srcElementSize, srcElementSize);
  }
}

function readSlotSaveBlocks(bytes, slot, sectorDataSizes, saveBlock2Size, saveBlock1Size) {
  const saveBlock2 = new Uint8Array(saveBlock2Size);
  const saveBlock1 = new Uint8Array(saveBlock1Size);
  const firstSector = slot * SAVE_SECTORS_PER_SLOT;

  for (let i = 0; i < SAVE_SECTORS_PER_SLOT; i++) {
    const sectorOffset = (firstSector + i) * FLASH_SECTOR_SIZE;
    const id = readSaveU16(bytes, sectorOffset + 0x0ff4);
    const size = sectorDataSizes[id];
    if (size === undefined) continue;

    if (id === 0) {
      copyRange(saveBlock2, 0, bytes, sectorOffset, Math.min(size, saveBlock2.length));
    } else if (id >= 1 && id <= 4) {
      copyRange(saveBlock1, (id - 1) * 0x0f80, bytes, sectorOffset, Math.min(size, saveBlock1.length - (id - 1) * 0x0f80));
    }
  }

  return { saveBlock1, saveBlock2 };
}

function saveKeyScore(saveBlock1, key) {
  let score = (readSaveU32(saveBlock1, 0x490) ^ key) <= 999999 ? 20 : -20;

  for (const [offset, count, maxQuantity] of SAVE_BAG_POCKETS) {
    for (let i = 0; i < count; i++) {
      const itemOffset = offset + i * 4;
      const itemId = readSaveU16(saveBlock1, itemOffset);
      const quantity = (readSaveU16(saveBlock1, itemOffset + 2) ^ key) & 0xffff;
      if (itemId === 0) score += quantity === 0 ? 1 : -1;
      else if (itemId < 377 && quantity > 0 && quantity <= maxQuantity) score += 3;
      else score -= 3;
    }
  }

  return score;
}

function isLikelyLegacyWasmSaveBlock(blocks) {
  const legacyKey = readSaveU32(blocks.saveBlock2, 0x0a8);
  const currentKey = readSaveU32(blocks.saveBlock2, SAVE_BLOCK2_ENCRYPTION_KEY_OFFSET);
  if (legacyKey === currentKey) return false;
  return saveKeyScore(blocks.saveBlock1, legacyKey) > saveKeyScore(blocks.saveBlock1, currentKey) + 20;
}

function isPlausibleBagQuantity(itemId, quantity, maxQuantity) {
  if (itemId === 0) return quantity === 0;
  return itemId < 377 && quantity > 0 && quantity <= maxQuantity;
}

function bagQuantityKeyScore(saveBlock1, key) {
  let score = 0;
  const keyLow = key & 0xffff;

  for (const [offset, count, maxQuantity] of SAVE_BAG_POCKETS) {
    for (let i = 0; i < count; i++) {
      const itemOffset = offset + i * 4;
      const itemId = readSaveU16(saveBlock1, itemOffset);
      const quantity = (readSaveU16(saveBlock1, itemOffset + 2) ^ keyLow) & 0xffff;
      if (isPlausibleBagQuantity(itemId, quantity, maxQuantity)) score += itemId === 0 ? 2 : 5;
      else score += itemId === 0 ? -2 : -5;
    }
  }

  return score;
}

function staleBagQuantityKey(saveBlock1, currentKey) {
  const currentKeyLow = currentKey & 0xffff;
  const candidates = new Set();

  for (const [offset, count] of SAVE_BAG_POCKETS) {
    for (let i = 0; i < count; i++) {
      const itemOffset = offset + i * 4;
      if (readSaveU16(saveBlock1, itemOffset) === 0) {
        const rawQuantity = readSaveU16(saveBlock1, itemOffset + 2);
        if (rawQuantity !== currentKeyLow) candidates.add(rawQuantity);
      }
    }
  }

  const currentScore = bagQuantityKeyScore(saveBlock1, currentKeyLow);
  let bestKey = currentKeyLow;
  let bestScore = currentScore;
  for (const candidate of candidates) {
    const score = bagQuantityKeyScore(saveBlock1, candidate);
    if (score > bestScore) {
      bestKey = candidate;
      bestScore = score;
    }
  }

  return bestKey !== currentKeyLow && bestScore > currentScore + 100 && bestScore > 100 ? bestKey : null;
}

function reencryptSaveBlock1Hword(saveBlock1, offset, oldKey, newKey) {
  const value = (readSaveU16(saveBlock1, offset) ^ oldKey) & 0xffff;
  writeSaveU16(saveBlock1, offset, value ^ newKey);
}

function repairStaleBagEncryption(blocks) {
  const currentKey = readSaveU32(blocks.saveBlock2, SAVE_BLOCK2_ENCRYPTION_KEY_OFFSET);
  const currentKeyLow = currentKey & 0xffff;
  const oldKey = staleBagQuantityKey(blocks.saveBlock1, currentKey);
  if (oldKey === null) return null;

  const saveBlock1 = new Uint8Array(blocks.saveBlock1);
  let didRepair = false;
  for (const [offset, count, maxQuantity] of SAVE_BAG_POCKETS) {
    for (let i = 0; i < count; i++) {
      const quantityOffset = offset + i * 4 + 2;
      const itemId = readSaveU16(saveBlock1, quantityOffset - 2);
      const rawQuantity = readSaveU16(saveBlock1, quantityOffset);
      const currentQuantity = (rawQuantity ^ currentKeyLow) & 0xffff;
      const oldQuantity = (rawQuantity ^ oldKey) & 0xffff;
      if (isPlausibleBagQuantity(itemId, currentQuantity, maxQuantity)
          || !isPlausibleBagQuantity(itemId, oldQuantity, maxQuantity)) {
        continue;
      }

      reencryptSaveBlock1Hword(saveBlock1, quantityOffset, oldKey, currentKeyLow);
      didRepair = true;
    }
  }

  const rawCoins = readSaveU16(saveBlock1, SAVE_BLOCK1_COINS_OFFSET);
  const currentCoins = (rawCoins ^ currentKeyLow) & 0xffff;
  const oldCoins = (rawCoins ^ oldKey) & 0xffff;
  if (oldCoins <= 9999 && (currentCoins > 9999 || rawCoins === oldKey)) {
    writeSaveU16(saveBlock1, SAVE_BLOCK1_COINS_OFFSET, oldCoins ^ currentKeyLow);
    didRepair = true;
  }

  return didRepair ? { saveBlock1, saveBlock2: blocks.saveBlock2 } : null;
}

function migrateLegacySaveBlock2(src) {
  const dst = new Uint8Array(0x0f2c);
  copyRange(dst, 0, src, 0, 0x98);
  copyRange(dst, 0x98, src, 0x98, 5);
  copyRange(dst, 0xa0, src, 0x9e, 5);
  copyRange(dst, 0xa8, src, 0xa4, 0xe64);
  return dst;
}

function migrateLegacySaveBlock1(src) {
  const dst = new Uint8Array(0x3d8c);
  copyRange(dst, 0, src, 0, 0x848);
  copyLegacyArray(dst, 0x848, 8, src, 0x848, 7, 40);
  copyRange(dst, 0x988, src, 0x960, 0x166c - 0x960);
  copyLegacyArray(dst, 0x169c, 8, src, 0x1674, 6, 128);
  copyRange(dst, 0x1a9c, src, 0x1974, 0x2be0 - 0x1974);
  copyLegacyArray(dst, 0x2be0, 36, src, 0x2ab8, 34, 16);
  copyRange(dst, 0x2e20, src, 0x2cd8, 0x3150 - 0x2cd8);
  copyRange(dst, 0x3150, src, 0x3008, 85);
  copyRange(dst, 0x31a8, src, 0x305e, 11);
  copyRange(dst, 0x31b4, src, 0x306c, 20);
  copyRange(dst, 0x31c8, src, 0x3080, 21);
  copyRange(dst, 0x31e0, src, 0x3098, 0x3c44 - 0x3098);
  return dst;
}

function writeCurrentSaveSlot(out, source, slot, currentBlocks) {
  const firstSector = slot * SAVE_SECTORS_PER_SLOT;

  for (let i = 0; i < SAVE_SECTORS_PER_SLOT; i++) {
    const sectorOffset = (firstSector + i) * FLASH_SECTOR_SIZE;
    const id = readSaveU16(source, sectorOffset + 0x0ff4);
    const size = SAVE_SECTOR_DATA_SIZES[id];
    if (size === undefined) continue;

    out.fill(0, sectorOffset, sectorOffset + 0x0ff4);
    if (id === 0) {
      copyRange(out, sectorOffset, currentBlocks.saveBlock2, 0, size);
    } else if (id >= 1 && id <= 4) {
      copyRange(out, sectorOffset, currentBlocks.saveBlock1, (id - 1) * 0x0f80, size);
    } else {
      copyRange(out, sectorOffset, source, sectorOffset, size);
    }
    writeSaveU16(out, sectorOffset + 0x0ff6, saveSectorChecksum(out, sectorOffset, size));
  }
}

function writeMigratedSaveSlot(out, source, slot, blocks) {
  writeCurrentSaveSlot(out, source, slot, {
    saveBlock2: migrateLegacySaveBlock2(blocks.saveBlock2),
    saveBlock1: migrateLegacySaveBlock1(blocks.saveBlock1),
  });
}

function migrateLegacyWasmSave(bytes) {
  const out = new Uint8Array(bytes);
  let didMigrate = false;

  for (let slot = 0; slot < 2; slot++) {
    for (const legacySizes of [LEGACY_WASM_SAVE_SECTOR_DATA_SIZES, LEGACY_WASM_FRONTEND_SAVE_SECTOR_DATA_SIZES]) {
      if (!hasValidEmeraldSaveSlot(bytes, slot, legacySizes)) continue;
      const blocks = readSlotSaveBlocks(bytes, slot, legacySizes, LEGACY_SAVE_BLOCK2_SIZE, LEGACY_SAVE_BLOCK1_SIZE);
      if (!isLikelyLegacyWasmSaveBlock(blocks)) continue;
      writeMigratedSaveSlot(out, bytes, slot, blocks);
      didMigrate = true;
      break;
    }
  }

  return didMigrate ? out : null;
}

function repairStaleBagEncryptionSave(bytes) {
  const out = new Uint8Array(bytes);
  let didRepair = false;

  for (let slot = 0; slot < 2; slot++) {
    let sectorDataSizes = null;
    if (hasValidEmeraldSaveSlot(bytes, slot, SAVE_SECTOR_DATA_SIZES)) sectorDataSizes = SAVE_SECTOR_DATA_SIZES;
    else if (hasValidEmeraldSaveSlot(bytes, slot, VANILLA_SAVE_SECTOR_DATA_SIZES)) sectorDataSizes = VANILLA_SAVE_SECTOR_DATA_SIZES;
    if (!sectorDataSizes) continue;

    const blocks = readSlotSaveBlocks(bytes, slot, sectorDataSizes, SAVE_BLOCK2_SIZE, SAVE_BLOCK1_SIZE);
    const repaired = repairStaleBagEncryption(blocks);
    if (!repaired) continue;

    writeCurrentSaveSlot(out, bytes, slot, repaired);
    didRepair = true;
  }

  return didRepair ? out : null;
}

function normalizeSaveForCurrentBuild(bytes) {
  const migrated = migrateLegacyWasmSave(bytes);
  if (migrated) return repairStaleBagEncryptionSave(migrated) ?? migrated;

  const repaired = repairStaleBagEncryptionSave(bytes);
  if (repaired) return repaired;

  return isValidCurrentBuildSave(bytes) ? bytes : null;
}

async function wasmModule() {
  wasmModulePromise ??= Promise.all([
    fetch('build/wasm/pokeemerald.wasm', { cache: 'no-cache' }).then((res) => res.arrayBuffer()),
    // Songs, instruments and cries; the game finds them at a fixed address.
    fetch('build/wasm/sound.bin', { cache: 'no-cache' })
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .catch(() => null),
  ]).then(async ([bytes, sound]) => ({ bytes, sound, module: await WebAssembly.compile(bytes) }));
  return wasmModulePromise;
}

async function restartWithSave(bytes) {
  statusText = 'restarting with uploaded save...';
  statusEl.textContent = statusText;
  pressed.clear();
  pendingPresses.clear();
  await boot(bytes);
}

async function uploadSave(file) {
  if (!file || !u8) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== FLASH_SIZE) {
    statusEl.textContent = `expected a ${FLASH_SIZE} byte Emerald .sav file, got ${bytes.length} bytes`;
    return;
  }
  const normalized = normalizeSaveForCurrentBuild(bytes);
  if (!normalized) {
    statusEl.textContent = 'save file does not contain a valid Emerald save slot';
    return;
  }

  lastSavedFlashHash = hashBytes(normalized);
  localStorage.setItem(SAVE_STORAGE_KEY, bytesToBase64(normalized));
  setLocalSavedAt(Date.now());
  await restartWithSave(normalized);
  scheduleCloudUpload();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatSpeed(value) {
  if (value === Infinity) return 'unlimited';
  if (value < 1) return `${value.toFixed(1)}x`;
  if (value < 100) return `${value.toFixed(value < 10 ? 1 : 0)}x`;
  return `${Math.round(value)}x`;
}

function setSpeed(value) {
  speed = value === Infinity ? Infinity : clamp(value, MIN_SPEED, MAX_SPEED);
  if (speed !== Infinity) lastFiniteSpeed = speed;
  speedValue.textContent = formatSpeed(speed);
  speedButtons.forEach((button) => {
    button.classList.toggle('active',
      (button.dataset.speed === '1' && speed === 1) || (button.dataset.speed === 'unlimited' && speed === Infinity));
  });
}

function adjustSpeed(multiplier) {
  setSpeed((speed === Infinity ? lastFiniteSpeed : speed) * multiplier);
}

function toggleUnlimitedSpeed() {
  setSpeed(speed === Infinity ? lastFiniteSpeed : Infinity);
}

function resetFpsCounters() {
  lastFpsUpdate = performance.now();
  renderedFrames = 0;
  emulatedFrames = 0;
  gameFrameAccumulator = 0;
}

function initialSpeed() {
  if (speedParam === '0') return Infinity;
  const parsed = Number(speedParam);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function updateFullscreenButton() {
  const isFullscreen = document.fullscreenElement === shell;
  fullscreenButton.textContent = isFullscreen ? 'Exit Big Picture' : 'Big Picture';
  fullscreenButton.classList.toggle('active', isFullscreen);
}

async function toggleFullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    await shell.requestFullscreen();
  }
}

function refreshFrameImage() {
  const ptr = instance.exports.WasmDisplayBuffer();
  const size = instance.exports.WasmDisplayBufferSize();
  image = new ImageData(new Uint8ClampedArray(memory.buffer, ptr, size), WIDTH, HEIGHT);
}

function render() {
  instance.exports.WasmRenderFrame();
  ctx.putImageData(image, 0, 0);
}

function copy(src, dst, count, size, fill) {
  for (let i = 0; i < count; i++) {
    const from = fill ? src : src + i * size;
    u8.set(u8.subarray(from, from + size), dst + i * size);
  }
}

function lz77(src, dst) {
  const size = u8[src + 1] | (u8[src + 2] << 8) | (u8[src + 3] << 16);
  let s = src + 4;
  let d = dst;
  const end = dst + size;
  while (d < end) {
    const flags = u8[s++];
    for (let bit = 7; bit >= 0 && d < end; bit--) {
      if (flags & (1 << bit)) {
        const pair = (u8[s] << 8) | u8[s + 1];
        s += 2;
        let length = (pair >> 12) + 3;
        const disp = (pair & 0xfff) + 1;
        while (length-- && d < end) {
          u8[d] = u8[d - disp];
          d++;
        }
      } else {
        u8[d++] = u8[s++];
      }
    }
  }
}

function rl(src, dst) {
  const size = u8[src + 1] | (u8[src + 2] << 8) | (u8[src + 3] << 16);
  let s = src + 4;
  let d = dst;
  const end = dst + size;
  while (d < end) {
    const flag = u8[s++];
    if (flag & 0x80) {
      let count = (flag & 0x7f) + 3;
      const value = u8[s++];
      while (count-- && d < end) u8[d++] = value;
    } else {
      let count = (flag & 0x7f) + 1;
      while (count-- && d < end) u8[d++] = u8[s++];
    }
  }
}

function readCString(ptr) {
  let out = '';
  while (u8[ptr]) out += String.fromCharCode(u8[ptr++]);
  return out;
}

function readS16(ptr) {
  return u16[ptr >> 1] << 16 >> 16;
}

function readS32(ptr) {
  return (u16[ptr >> 1] | (u16[(ptr + 2) >> 1] << 16)) | 0;
}

function writeS16(ptr, value) {
  u16[ptr >> 1] = value & 0xffff;
}

function writeS32(ptr, value) {
  u16[ptr >> 1] = value & 0xffff;
  u16[(ptr + 2) >> 1] = (value >> 16) & 0xffff;
}

function affineTerms(xScale, yScale, rotation) {
  const angle = rotation * Math.PI * 2 / 0x10000;
  const sin = Math.sin(angle) * 256;
  const cos = Math.cos(angle) * 256;
  return {
    pa: cos * xScale / 256,
    pb: -sin * xScale / 256,
    pc: sin * yScale / 256,
    pd: cos * yScale / 256,
  };
}

function bgAffineSet(src, dest, count) {
  for (let i = 0; i < count; i++) {
    const s = src + i * 20;
    const d = dest + i * 16;
    const texX = readS32(s);
    const texY = readS32(s + 4);
    const scrX = readS16(s + 8);
    const scrY = readS16(s + 10);
    const { pa, pb, pc, pd } = affineTerms(readS16(s + 12), readS16(s + 14), u16[(s + 16) >> 1]);
    const a = pa | 0;
    const b = pb | 0;
    const c = pc | 0;
    const e = pd | 0;
    writeS16(d, a);
    writeS16(d + 2, b);
    writeS16(d + 4, c);
    writeS16(d + 6, e);
    writeS32(d + 8, (texX - scrX * a - scrY * b) | 0);
    writeS32(d + 12, (texY - scrX * c - scrY * e) | 0);
  }
}

function objAffineSet(src, dest, count, offset) {
  for (let i = 0; i < count; i++) {
    const s = src + i * 6;
    const d = dest + i * offset * 4;
    const { pa, pb, pc, pd } = affineTerms(readS16(s), readS16(s + 2), u16[(s + 4) >> 1]);
    writeS16(d, pa | 0);
    writeS16(d + offset, pb | 0);
    writeS16(d + offset * 2, pc | 0);
    writeS16(d + offset * 3, pd | 0);
  }
}

function copyOamMatrices(src, dest, dummy, oamCount, oamLimit, oamEnd) {
  const dummyWord0 = u32[dummy >> 2];
  const dummyWord1 = u32[(dummy + 4) >> 2];
  for (let entry = oamCount; entry < oamLimit; entry++) {
    const output = (dest + entry * 8) >> 2;
    u32[output] = dummyWord0;
    u32[output + 1] = dummyWord1;
  }
  const wholeMatrices = oamEnd >> 2;
  for (let matrix = 0; matrix < wholeMatrices; matrix++) {
    const source = (src + matrix * 8) >> 1;
    const output = (dest + matrix * 32 + 6) >> 1;
    u16[output] = u16[source];
    u16[output + 4] = u16[source + 1];
    u16[output + 8] = u16[source + 2];
    u16[output + 12] = u16[source + 3];
  }
  for (let entry = wholeMatrices * 4; entry < oamEnd; entry++) {
    u16[(dest + entry * 8 + 6) >> 1] = u16[(src + entry * 2) >> 1];
  }
}

function importsFor(module) {
  const env = {};
  for (const item of WebAssembly.Module.imports(module)) {
    if (item.kind !== 'function') continue;
    env[item.name] = (...args) => {
      switch (item.name) {
        case 'CpuSet': return copy(args[0], args[1], args[2] & 0x1fffff, (args[2] >>> 26) & 1 ? 4 : 2, (args[2] >>> 24) & 1);
        case 'CpuFastSet': return copy(args[0], args[1], args[2] & 0x1fffff, 4, (args[2] >>> 24) & 1);
        case 'LZ77UnCompWram':
        case 'LZ77UnCompVram': return lz77(args[0], args[1]);
        case 'RLUnCompWram':
        case 'RLUnCompVram': return rl(args[0], args[1]);
        case 'BgAffineSet': return bgAffineSet(args[0], args[1], args[2]);
        case 'ObjAffineSet': return objAffineSet(args[0], args[1], args[2], args[3]);
        case 'WasmCopyOamMatrices': return copyOamMatrices(args[0], args[1], args[2], args[3], args[4], args[5]);
        case 'Div': return args[1] ? (args[0] / args[1]) | 0 : 0;
        case 'Sqrt': return Math.sqrt(args[0]) | 0;
        case 'strcmp': return readCString(args[0]).localeCompare(readCString(args[1]));
        default: return 0;
      }
    };
  }
  return { env };
}

function writeKeys() {
  let held = 0;
  for (const key of pressed) held |= buttons[key] || 0;
  for (const key of pendingPresses.keys()) held |= buttons[key] || 0;
  u16[KEYINPUT >> 1] = KEY_MASK ^ held;
}

function stepPendingPresses() {
  for (const [key, frames] of pendingPresses) {
    if (frames <= 1) pendingPresses.delete(key);
    else pendingPresses.set(key, frames - 1);
  }
}

function setPressed(name, isPressed) {
  if (isPressed) {
    pressed.add(name);
    pendingPresses.set(name, 1);
  } else {
    pressed.delete(name);
  }
  document.querySelectorAll(`[data-key='${name}']`).forEach((el) => el.classList.toggle('pressed', isPressed));
  if (u16) writeKeys();
}

window.addEventListener('keydown', (event) => {
  if (rebinding) {
    event.preventDefault();
    finishRebind(event.code);
    return;
  }
  if (event.code === 'Escape' && document.documentElement.classList.contains('pc')) {
    event.preventDefault();
    moreMenu.open = !moreMenu.open;
    return;
  }
  const name = keyMap.get(event.code);
  if (!name) return;
  event.preventDefault();
  setPressed(name, true);
});

window.addEventListener('keyup', (event) => {
  const name = keyMap.get(event.code);
  if (!name) return;
  event.preventDefault();
  setPressed(name, false);
});

// Game controllers (Switch Pro Controller, Joy-Cons, Xbox, PlayStation) via the
// Gamepad API's standard layout. Face buttons follow their position, like a
// GBA: right = A, bottom = B. Left stick works as the d-pad.
const padButtons = [
  [1, 'a'], [0, 'b'], [4, 'l'], [5, 'r'], [6, 'l'], [7, 'r'], [8, 'select'], [9, 'start'],
  [12, 'up'], [13, 'down'], [14, 'left'], [15, 'right'],
];
const padHeld = new Set();
// Edge on Xbox turns the controller into a mouse unless the page asks for it.
try { if ('gamepadInputEmulation' in navigator) navigator.gamepadInputEmulation = 'gamepad'; } catch { /* ignore */ }
function pollGamepads() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const now = new Set();
  for (const pad of pads) {
    if (!pad || !pad.connected) continue;
    for (const [index, name] of padButtons) if (pad.buttons[index]?.pressed) now.add(name);
    const [x = 0, y = 0] = pad.axes;
    if (x < -0.5) now.add('left');
    if (x > 0.5) now.add('right');
    if (y < -0.5) now.add('up');
    if (y > 0.5) now.add('down');
  }
  for (const name of now) if (!padHeld.has(name)) setPressed(name, true);
  for (const name of padHeld) if (!now.has(name)) setPressed(name, false);
  padHeld.clear();
  for (const name of now) padHeld.add(name);
}

window.addEventListener('beforeunload', () => saveFlashIfChanged(true));
window.addEventListener('pagehide', () => saveFlashIfChanged(true));
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveFlashIfChanged(true);
});

// Touch controls. Each finger is tracked on its own, so a child can hold a
// direction with one thumb and tap A with the other. A finger that slides
// across the d-pad or between face buttons changes the button it presses.
const touchOwners = new Map(); // pointerId -> Set of button names it holds

function holdForPointer(pointerId, names) {
  const before = touchOwners.get(pointerId) || new Set();
  const after = new Set(names);
  touchOwners.set(pointerId, after);
  for (const name of before) {
    if (!after.has(name) && ![...touchOwners.values()].some((held) => held.has(name))) setPressed(name, false);
  }
  for (const name of after) {
    if (!before.has(name)) {
      setPressed(name, true);
      if (navigator.vibrate) navigator.vibrate(8);
    }
  }
}

function releasePointer(pointerId) {
  holdForPointer(pointerId, []);
  touchOwners.delete(pointerId);
}

function dpadDirections(dpad, event) {
  const rect = dpad.getBoundingClientRect();
  const dx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
  const dy = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
  if (Math.hypot(dx, dy) < 0.22) return [];
  // Eight-way with wide cardinal zones: diagonals only within 22.5 degrees.
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  const names = [];
  if (angle > -67.5 && angle < 67.5) names.push('right');
  if (angle > 112.5 || angle < -112.5) names.push('left');
  if (angle > 22.5 && angle < 157.5) names.push('down');
  if (angle < -22.5 && angle > -157.5) names.push('up');
  return names;
}

document.querySelectorAll('.dpad').forEach((dpad) => {
  const update = (event) => {
    if (event.type !== 'pointerdown' && !touchOwners.has(event.pointerId)) return;
    event.preventDefault();
    holdForPointer(event.pointerId, dpadDirections(dpad, event));
  };
  dpad.addEventListener('pointerdown', (event) => { dpad.setPointerCapture(event.pointerId); update(event); });
  dpad.addEventListener('pointermove', update);
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((type) => dpad.addEventListener(type, (event) => releasePointer(event.pointerId)));
});

document.querySelectorAll('[data-key]').forEach((button) => {
  if (button.closest('.dpad')) return;
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    button.releasePointerCapture?.(event.pointerId);
    holdForPointer(event.pointerId, [button.dataset.key]);
  });
  button.addEventListener('pointerenter', (event) => {
    if (touchOwners.has(event.pointerId)) holdForPointer(event.pointerId, [button.dataset.key]);
  });
  button.addEventListener('pointerleave', (event) => {
    const held = touchOwners.get(event.pointerId);
    if (held && held.has(button.dataset.key)) holdForPointer(event.pointerId, []);
  });
});
['pointerup', 'pointercancel'].forEach((type) => window.addEventListener(type, (event) => {
  if (touchOwners.has(event.pointerId) && !event.target.closest?.('.dpad')) releasePointer(event.pointerId);
}));
// Stop long-press menus and double-tap zoom from interrupting play.
document.addEventListener('contextmenu', (event) => { if (event.target.closest('.pad')) event.preventDefault(); });
document.addEventListener('dblclick', (event) => event.preventDefault(), { passive: false });

speedButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (button.dataset.speed === 'unlimited') toggleUnlimitedSpeed();
    else if (button.dataset.speed === '1') setSpeed(1);
    else adjustSpeed(Number(button.dataset.speed));
    resetFpsCounters();
  });
});

fullscreenButton.addEventListener('click', async () => {
  try {
    await toggleFullscreen();
  } catch (error) {
    console.error(error);
    statusEl.textContent = error.stack || String(error);
  }
});

document.addEventListener('fullscreenchange', updateFullscreenButton);

// ---- PC mode: screen only, flyout menu, keyboard configurator ----
const moreMenu = document.querySelector('.more');
const layoutButtons = document.querySelectorAll('[data-layout]');
const keyGrid = document.querySelector('#key-grid');
const keyHelp = document.querySelector('#key-help');
const pcQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
let rebinding = null;

function storedLayout() {
  try { return localStorage.getItem(LAYOUT_STORAGE_KEY) || 'auto'; } catch { return 'auto'; }
}

function applyLayout() {
  const choice = storedLayout();
  const pc = choice === 'pc' || (choice === 'auto' && pcQuery.matches);
  document.documentElement.classList.toggle('pc', pc);
  layoutButtons.forEach((b) => b.classList.toggle('active', b.dataset.layout === choice));
}

layoutButtons.forEach((button) => button.addEventListener('click', () => {
  try { localStorage.setItem(LAYOUT_STORAGE_KEY, button.dataset.layout); } catch { /* storage disabled */ }
  applyLayout();
}));
pcQuery.addEventListener?.('change', applyLayout);
applyLayout();

// Clicking outside the open flyout closes it.
document.addEventListener('pointerdown', (event) => {
  if (moreMenu.open && document.documentElement.classList.contains('pc') && !moreMenu.contains(event.target)) {
    moreMenu.open = false;
  }
});
moreMenu.addEventListener('toggle', () => { if (!moreMenu.open) cancelRebind(); });

// ---- Trade evolution without a partner (src/wasm_trade_evo.c) ------------
const tradeEvoList = document.getElementById('trade-evo-list');
const tradeEvoNote = document.getElementById('trade-evo-note');
const TRADE_EVO_HELP = tradeEvoNote?.textContent || '';

function readAscii(ptr) {
  let text = '';
  for (let i = ptr >>> 0; u8[i]; i++) text += String.fromCharCode(u8[i]);
  return text;
}

function refreshTradeEvolutions() {
  if (!tradeEvoList || !instance?.exports.WasmTradeEvoTarget) return;
  const buttons = [];
  for (let slot = 0; slot < 6; slot++) {
    if (!instance.exports.WasmTradeEvoTarget(slot)) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = readAscii(instance.exports.WasmTradeEvoLabel(slot));
    button.addEventListener('click', () => {
      const result = instance.exports.WasmTradeEvolve(slot);
      if (result === 0) {
        tradeEvoNote.textContent = TRADE_EVO_HELP;
        moreMenu.open = false;
      } else if (result === 1) {
        tradeEvoNote.textContent = 'Close this menu and finish what you are doing in the game (talking, a battle, a menu), then try again while you can walk around.';
      } else {
        refreshTradeEvolutions();
      }
    });
    buttons.push(button);
  }
  tradeEvoList.replaceChildren(...buttons);
  if (!buttons.length) tradeEvoNote.textContent = TRADE_EVO_HELP;
}

moreMenu.addEventListener('toggle', () => { if (moreMenu.open) refreshTradeEvolutions(); });

const KEY_LABELS = [
  ['a', 'A'], ['b', 'B'], ['l', 'L'], ['r', 'R'], ['start', 'Start'], ['select', 'Select'],
  ['up', 'Up'], ['down', 'Down'], ['left', 'Left'], ['right', 'Right'],
];

function keyName(code) {
  const names = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', Enter: 'Enter',
    ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
    AltLeft: 'Alt', AltRight: 'Alt', Backspace: 'Backspace', Tab: 'Tab',
  };
  if (names[code]) return names[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

function renderKeyGrid() {
  keyGrid.replaceChildren(...KEY_LABELS.map(([name, label]) => {
    const row = document.createElement('label');
    row.className = 'key-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.bind = name;
    const codes = [...new Set([...keyMap].filter(([, n]) => n === name).map(([code]) => keyName(code)))];
    button.textContent = rebinding === name ? 'Press a key…' : (codes.join(' / ') || 'none');
    button.classList.toggle('listening', rebinding === name);
    button.addEventListener('click', () => startRebind(name));
    row.append(label, button);
    return row;
  }));
}

function startRebind(name) {
  rebinding = name;
  keyHelp.textContent = 'Press the key you want. Esc cancels.';
  renderKeyGrid();
}

function cancelRebind() {
  if (!rebinding) return;
  rebinding = null;
  keyHelp.textContent = 'Click a button, then press the key you want for it. Esc opens and closes this menu.';
  renderKeyGrid();
}

function finishRebind(code) {
  const name = rebinding;
  if (code === 'Escape') { cancelRebind(); return; }
  for (const [c, n] of [...keyMap]) if (n === name || c === code) keyMap.delete(c);
  keyMap.set(code, name);
  try { localStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify([...keyMap])); } catch { /* storage disabled */ }
  cancelRebind();
}

document.querySelector('#keys-reset').addEventListener('click', () => {
  keyMap.clear();
  for (const [code, name] of DEFAULT_KEYS) keyMap.set(code, name);
  try { localStorage.removeItem(KEYS_STORAGE_KEY); } catch { /* storage disabled */ }
  cancelRebind();
  renderKeyGrid();
});
renderKeyGrid();
updateFullscreenButton();

downloadSaveButton.addEventListener('click', downloadSave);

uploadSaveInput.addEventListener('change', async () => {
  try {
    await uploadSave(uploadSaveInput.files[0]);
  } catch (error) {
    console.error(error);
    statusEl.textContent = error.stack || String(error);
  } finally {
    uploadSaveInput.value = '';
  }
});

function fpsStatus(displayFps, gameFps) {
  return `${statusText} — Display FPS: ${displayFps}, Game FPS: ${gameFps} (${(gameFps / 60).toFixed(1)}x)`;
}

async function boot(saveBytes) {
  const thisBootId = ++bootId;
  const { bytes, sound, module } = await wasmModule();
  instance = await WebAssembly.instantiate(module, importsFor(module));
  memory = instance.exports.memory;
  if (sound && instance.exports.WasmSoundBlobBase) {
    new Uint8Array(memory.buffer, instance.exports.WasmSoundBlobBase() >>> 0, sound.byteLength).set(new Uint8Array(sound));
  }
  gameAudio.reset();
  linkCable.attach(instance, memory);
  window.pokeemerald = { instance, memory, runFrames };
  if (automate) window.pokeemerald.automation = automationApi();
  refreshViews();
  refreshFrameImage();
  loadFlashSave(saveBytes);
  writeGameRules();
  writeKeys();
  instance.exports.AgbMain();
  currentFrame = 0;
  gameFrameAccumulator = 0;
  resetFpsCounters();
  statusText = `running — ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MiB wasm`;
  setSpeed(initialSpeed());
  statusEl.textContent = fpsStatus(0, 0);
  if (automate) {
    render();
    resolveAutomationReady();
  } else {
    requestAnimationFrame((now) => tick(thisBootId, now));
  }
}

function updateFps(frameCount) {
  renderedFrames++;
  emulatedFrames += frameCount;

  const now = performance.now();
  const elapsed = now - lastFpsUpdate;
  if (elapsed < 1000) return;

  const fps = Math.round(renderedFrames * 1000 / elapsed);
  const gameFps = Math.round(emulatedFrames * 1000 / elapsed);
  statusEl.textContent = fpsStatus(fps, gameFps);
  lastFpsUpdate = now;
  renderedFrames = 0;
  emulatedFrames = 0;
}

function runFrames(frameCount, keyMask = 0) {
  for (let i = 0; i < frameCount; i++) {
    if (keyMask) u16[KEYINPUT >> 1] = KEY_MASK ^ keyMask;
    else writeKeys();
    instance.exports.WasmRunFrame();
    linkCable.afterFrame();
    currentFrame++;
    stepPendingPresses();
  }
  u16[KEYINPUT >> 1] = KEY_MASK;
  saveFlashIfChanged();
}

function setAutomationButton(name, isPressed) {
  if (!Object.hasOwn(buttons, name)) throw new Error(`unknown button: ${name}`);
  pendingPresses.delete(name);
  if (isPressed) pressed.add(name);
  else pressed.delete(name);
  document.querySelectorAll(`[data-key='${name}']`).forEach((el) => el.classList.toggle('pressed', isPressed));
  writeKeys();
}

function runToFrame(targetFrame) {
  if (!Number.isInteger(targetFrame) || targetFrame < currentFrame) {
    throw new Error(`cannot run from frame ${currentFrame} to ${targetFrame}`);
  }
  runFrames(targetFrame - currentFrame);
  render();
  return currentFrame;
}

function readU32(ptr) {
  return (u16[ptr >> 1] | (u16[(ptr + 2) >> 1] << 16)) >>> 0;
}

function hblankDmaWin0HProbe() {
  const src = 0x0203ff00;
  const dma = REG + REG_OFFSET_DMA0;
  const callDmaStop0 = () => {
    if (typeof instance.exports.WasmDmaStop0 !== 'function') throw new Error('WasmDmaStop0 export unavailable');
    instance.exports.WasmDmaStop0();
  };
  const probeMode = (destMode) => {
    writeS32(dma, src);
    writeS32(dma + 4, REG + REG_OFFSET_WIN0H);
    writeS32(dma + 8, 1 | ((DMA_ENABLE | DMA_START_HBLANK | DMA_REPEAT | destMode) << 16));

    instance.exports.WasmRefreshHblankDmaGpuRegs();
    const activeLine0 = instance.exports.WasmWindowMask(5, 0);
    const activeLine1 = instance.exports.WasmWindowMask(5, 1);
    const activeLine2 = instance.exports.WasmWindowMask(5, 2);
    const activeCached = Boolean(instance.exports.WasmHblankDmaGpuRegActive(REG_OFFSET_WIN0H));

    callDmaStop0();
    const stoppedControl = u16[(dma + 10) >> 1];
    instance.exports.WasmRefreshHblankDmaGpuRegs();
    const stoppedLine0 = instance.exports.WasmWindowMask(5, 0);
    const stoppedLine1 = instance.exports.WasmWindowMask(5, 1);
    const stoppedLine2 = instance.exports.WasmWindowMask(5, 2);

    return {
      activeLine0,
      activeLine1,
      activeLine2,
      activeCached,
      stoppedControl,
      stoppedLine0,
      stoppedLine1,
      stoppedLine2,
      stoppedCached: Boolean(instance.exports.WasmHblankDmaGpuRegActive(REG_OFFSET_WIN0H)),
    };
  };
  const saved = {
    dispcnt: u16[REG >> 1],
    win0h: u16[(REG + REG_OFFSET_WIN0H) >> 1],
    win0v: u16[(REG + REG_OFFSET_WIN0V) >> 1],
    winin: u16[(REG + REG_OFFSET_WININ) >> 1],
    winout: u16[(REG + REG_OFFSET_WINOUT) >> 1],
    src0: u16[src >> 1],
    src1: u16[(src + 2) >> 1],
    dmaSrc: readU32(dma),
    dmaDest: readU32(dma + 4),
    dmaControl: readU32(dma + 8),
  };
  let result;

  try {
    u16[REG >> 1] = 0x2000;
    u16[(REG + REG_OFFSET_WIN0H) >> 1] = (20 << 8) | 30;
    u16[(REG + REG_OFFSET_WIN0V) >> 1] = HEIGHT;
    u16[(REG + REG_OFFSET_WININ) >> 1] = 0x3f;
    u16[(REG + REG_OFFSET_WINOUT) >> 1] = 0;
    u16[src >> 1] = 10;
    u16[(src + 2) >> 1] = (20 << 8) | 30;

    result = {
      fixed: probeMode(DMA_DEST_FIXED),
      reload: probeMode(DMA_DEST_RELOAD),
    };
  } finally {
    u16[REG >> 1] = saved.dispcnt;
    u16[(REG + REG_OFFSET_WIN0H) >> 1] = saved.win0h;
    u16[(REG + REG_OFFSET_WIN0V) >> 1] = saved.win0v;
    u16[(REG + REG_OFFSET_WININ) >> 1] = saved.winin;
    u16[(REG + REG_OFFSET_WINOUT) >> 1] = saved.winout;
    u16[src >> 1] = saved.src0;
    u16[(src + 2) >> 1] = saved.src1;
    writeS32(dma, saved.dmaSrc);
    writeS32(dma + 4, saved.dmaDest);
    writeS32(dma + 8, saved.dmaControl);
    instance.exports.WasmRefreshHblankDmaGpuRegs();
  }

  return result;
}

function automationState() {
  const saveBlock1 = readU32(instance.exports.gSaveBlock1Ptr.value);
  const saveBlock2 = readU32(instance.exports.gSaveBlock2Ptr.value);
  const playerAvatar = instance.exports.gPlayerAvatar.value;
  const objectEventId = u8[playerAvatar + 5];
  const objectEvent = instance.exports.gObjectEvents.value + objectEventId * 0x24;
  return {
    frame: currentFrame,
    trainerId: u16[(saveBlock2 + SAVE_BLOCK2_TRAINER_ID_OFFSET) >> 1],
    x: readS16(saveBlock1),
    y: readS16(saveBlock1 + 2),
    mapGroup: u8[saveBlock1 + 4],
    mapNum: u8[saveBlock1 + 5],
    elevation: u8[objectEvent + 0x0b] & 0x0f,
    objectX: readS16(objectEvent + 0x10),
    objectY: readS16(objectEvent + 0x12),
    objectEventId,
    littlerootTownState: instance.exports.VarGet(0x4050),
    birchLabState: instance.exports.VarGet(0x4084),
    littlerootRivalState: instance.exports.VarGet(0x408d),
    littlerootIntroState: instance.exports.VarGet(0x4092),
    oldaleRivalState: instance.exports.VarGet(0x40c7),
    starterMon: instance.exports.VarGet(0x4023),
  };
}

function automationApi() {
  return {
    ready: automationReady,
    setButton: setAutomationButton,
    runToFrame,
    screenshot: () => canvas.toDataURL('image/png'),
    hblankDmaWin0HProbe,
    state: automationState,
    frame: () => currentFrame,
  };
}

function runFramesForTick(elapsedMs) {
  const start = performance.now();
  const frameBudgetMs = speed === Infinity ? elapsedMs : FAST_FRAME_BUDGET_MS;
  let frameCount;

  if (speed === Infinity) {
    gameFrameAccumulator = 0;
    frameCount = Infinity;
  } else {
    gameFrameAccumulator += speed * elapsedMs / (1000 / 60);
    frameCount = Math.floor(gameFrameAccumulator);
    gameFrameAccumulator -= frameCount;
    if (frameCount === 0) return 0;
  }

  let frames = 0;
  while (frames < frameCount && performance.now() - start < frameBudgetMs) {
    const batchSize = Math.min(frameCount - frames, 256);
    runFrames(batchSize);
    frames += batchSize;
  }
  return frames;
}

function tick(thisBootId, now) {
  if (thisBootId !== bootId) return;
  try {
    const elapsedMs = Math.min(now - lastTick, 100);
    lastTick = now;
    pollGamepads();
    writeGameClock();
    const frames = runFramesForTick(elapsedMs);
    updateDayNight(now);
    gameAudio.pump(instance, memory, speed);
    render();
    updateFps(frames);
    requestAnimationFrame((nextNow) => tick(thisBootId, nextNow));
  } catch (error) {
    console.error(error);
    statusEl.textContent = error.stack || String(error);
  }
}

async function startPlayer() {
  if (automate) return;
  const player = await choosePlayer({ forcePicker: pickerRequested() });
  profileId = player.id;
  if (profileId !== 'main') SAVE_STORAGE_KEY = `${BASE_SAVE_STORAGE_KEY}.${profileId}`;
  SAVE_TIME_KEY = `${SAVE_STORAGE_KEY}.savedAt`;
  const playerEl = document.getElementById('player-name');
  const switchButton = document.getElementById('switch-player');
  if (playerEl && player.name) playerEl.textContent = player.name;
  if (switchButton && player.profiles.length) {
    switchButton.closest('.player-control').hidden = false;
    switchButton.addEventListener('click', switchPlayer);
  }
}

startPlayer().then(() => Promise.all([startupSave(), fetchGameRules()])).then(async ([saveBytes]) => {
  await boot(saveBytes);
  if (cloudUploadAfterBoot) scheduleCloudUpload(0);
}).catch((error) => {
  console.error(error);
  statusEl.textContent = error.stack || String(error);
});
