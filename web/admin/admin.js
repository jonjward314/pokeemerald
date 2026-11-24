// Admin page: house rules for the game. Talks to /api/admin/* in
// worker/index.js, which only answers for the admin sign-in.

const RULE_KEYS = {
  expPercent: ['expPercent'],
  moneyPercent: ['moneyPercent'],
  catchPercent: ['catchPercent'],
  encounterPercent: ['encounterPercent'],
  clock: ['clockMode', 'clockShiftHours', 'clockLockHour'],
  dayNight: ['dayNight'],
};

const form = document.querySelector('#rules-form');
const scopeSelect = document.querySelector('#scope');
const scopeHint = document.querySelector('#scope-hint');
const statusEl = document.querySelector('#status');
const clearButton = document.querySelector('#clear-player');

let defaults = {};
let rows = new Map(); // email ('*' = everyone) -> rules object
let players = [];

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

async function api(path, options = {}) {
  const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `request failed (${res.status})`);
  return body;
}

function hourLabel(hour) {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  const part = hour >= 5 && hour < 7 ? 'dawn' : hour >= 7 && hour < 18 ? 'day' : hour >= 18 && hour < 20 ? 'evening' : 'night';
  return `${h} ${suffix} (${part})`;
}

function buildStaticControls() {
  const lock = form.elements.clockLockHour;
  for (let hour = 0; hour < 24; hour++) lock.add(new Option(hourLabel(hour), String(hour)));

  for (const holder of form.querySelectorAll('[data-presets]')) {
    const input = holder.parentElement.querySelector('input[type="number"]');
    for (const value of holder.dataset.presets.split(',')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = value === '0' ? 'Off' : value === '10000' ? 'Always' : `${Number(value) / 100}x`;
      button.dataset.value = value;
      button.addEventListener('click', () => {
        input.value = value;
        markPresets();
      });
      holder.append(button);
    }
    input.addEventListener('input', markPresets);
  }

  for (const button of form.querySelectorAll('#clock-presets button')) {
    button.addEventListener('click', () => {
      if (button.dataset.real !== undefined) {
        form.elements.clockMode.value = 'real';
      } else {
        form.elements.clockMode.value = 'lock';
        form.elements.clockLockHour.value = button.dataset.lock;
      }
    });
  }

  for (const fieldset of form.querySelectorAll('fieldset[data-rule]')) {
    fieldset.querySelector('[data-override]').addEventListener('change', (event) => {
      fieldset.classList.toggle('inherited', !event.target.checked);
    });
  }
}

function markPresets() {
  for (const holder of form.querySelectorAll('[data-presets]')) {
    const input = holder.parentElement.querySelector('input[type="number"]');
    for (const button of holder.querySelectorAll('button')) {
      button.classList.toggle('on', button.dataset.value === String(input.value));
    }
  }
}

let names = {};

// "Ava (family@example.com)" for players on a shared sign-in.
function playerLabel(key) {
  const email = key.split('#')[0];
  return names[key] ? `${names[key]} (${email})` : key;
}

function playerEmails() {
  const emails = new Set(players.map((p) => p.email));
  for (const email of rows.keys()) if (email !== '*') emails.add(email);
  return [...emails].sort();
}

function renderScopes(selected = scopeSelect.value || '*') {
  scopeSelect.replaceChildren(new Option('Everyone', '*'));
  for (const email of playerEmails()) {
    const tag = rows.has(email) ? ' (own rules)' : '';
    scopeSelect.add(new Option(`${playerLabel(email)}${tag}`, email));
  }
  scopeSelect.value = [...scopeSelect.options].some((o) => o.value === selected) ? selected : '*';
}

function renderForm() {
  const scope = scopeSelect.value;
  const isPlayer = scope !== '*';
  const everyone = { ...defaults, ...(rows.get('*') || {}) };
  const own = isPlayer ? rows.get(scope) || {} : {};
  const values = { ...everyone, ...own };

  form.classList.toggle('player-scope', isPlayer);
  clearButton.hidden = !isPlayer || !rows.has(scope);
  scopeHint.textContent = isPlayer
    ? 'Tick "Set for this player" on anything that should differ from everyone else. Unticked rules follow Everyone.'
    : 'These apply to every player, unless a player has their own setting.';

  form.elements.expPercent.value = values.expPercent;
  form.elements.moneyPercent.value = values.moneyPercent;
  form.elements.encounterPercent.value = values.encounterPercent;
  form.elements.catchPercent.value = values.catchPercent ?? 100;
  form.elements.clockMode.value = values.clockMode;
  form.elements.clockShiftHours.value = values.clockShiftHours;
  form.elements.clockLockHour.value = String(values.clockLockHour);
  form.elements.dayNight.checked = Boolean(values.dayNight);

  for (const fieldset of form.querySelectorAll('fieldset[data-rule]')) {
    const keys = RULE_KEYS[fieldset.dataset.rule];
    const overridden = isPlayer && keys.some((key) => key in own);
    fieldset.querySelector('[data-override]').checked = overridden;
    fieldset.classList.toggle('inherited', isPlayer && !overridden);
  }
  markPresets();
}

function collectRules() {
  const isPlayer = scopeSelect.value !== '*';
  const all = {
    expPercent: Number(form.elements.expPercent.value),
    moneyPercent: Number(form.elements.moneyPercent.value),
    encounterPercent: Number(form.elements.encounterPercent.value),
    catchPercent: Number(form.elements.catchPercent.value),
    clockMode: form.elements.clockMode.value || 'real',
    clockShiftHours: Number(form.elements.clockShiftHours.value) || 0,
    clockLockHour: Number(form.elements.clockLockHour.value) || 0,
    dayNight: form.elements.dayNight.checked,
  };
  if (!isPlayer) return all;
  const picked = {};
  for (const fieldset of form.querySelectorAll('fieldset[data-rule]')) {
    if (!fieldset.querySelector('[data-override]').checked) continue;
    for (const key of RULE_KEYS[fieldset.dataset.rule]) picked[key] = all[key];
  }
  return picked;
}

async function load() {
  const data = await api('../api/admin/rules');
  defaults = data.defaults;
  rows = new Map(data.rows.map((row) => [row.email, row.rules]));
  players = data.players;
  names = data.names || {};
  renderScopes();
  renderForm();
  renderEncounterScopes();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = scopeSelect.value;
  const rules = collectRules();
  const encounters = rows.get(email)?.encounters;
  if (encounters && Object.keys(encounters).length) rules.encounters = encounters;
  setStatus('Saving…');
  try {
    if (email !== '*' && Object.keys(rules).length === 0) {
      await api('../api/admin/rules', { method: 'PUT', body: JSON.stringify({ email, rules: null }), headers: { 'Content-Type': 'application/json' } });
      rows.delete(email);
    } else {
      const saved = await api('../api/admin/rules', { method: 'PUT', body: JSON.stringify({ email, rules }), headers: { 'Content-Type': 'application/json' } });
      rows.set(email, saved.rules);
    }
    renderScopes(email);
    renderForm();
    setStatus(`Saved at ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`);
  } catch (error) {
    setStatus(`Could not save: ${error.message}`, true);
  }
});

clearButton.addEventListener('click', async () => {
  const email = scopeSelect.value;
  if (email === '*') return;
  setStatus('Removing…');
  try {
    await api('../api/admin/rules', { method: 'PUT', body: JSON.stringify({ email, rules: null }), headers: { 'Content-Type': 'application/json' } });
    rows.delete(email);
    renderScopes(email);
    renderForm();
    setStatus(`${email} now follows the Everyone rules.`);
  } catch (error) {
    setStatus(`Could not remove: ${error.message}`, true);
  }
});

document.querySelector('#add-player').addEventListener('click', () => {
  const email = (window.prompt('Their sign-in email (the one on the Family list):') || '').trim().toLowerCase();
  if (!email) return;
  if (!email.includes('@')) {
    setStatus('That does not look like an email address.', true);
    return;
  }
  if (!players.some((p) => p.email === email)) players.push({ email });
  renderScopes(email);
  renderForm();
  setStatus(`Pick the rules for ${email}, then Save.`);
});

scopeSelect.addEventListener('change', () => {
  setStatus('');
  renderForm();
});

// ---- Tabs and shared (picker) logins ----

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    for (const other of document.querySelectorAll('.tab')) other.classList.toggle('active', other === tab);
    for (const panel of document.querySelectorAll('.panel')) panel.hidden = panel.id !== tab.dataset.tab;
  });
}

const pickerList = document.querySelector('#picker-list');
const pickerStatus = document.querySelector('#picker-status');

function setPickerStatus(text, isError = false) {
  pickerStatus.textContent = text;
  pickerStatus.classList.toggle('error', isError);
}

async function loadPickers() {
  const { pickers } = await api('../api/admin/pickers');
  pickerList.replaceChildren();
  if (!pickers.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No shared logins yet.';
    pickerList.append(li);
  }
  for (const { email } of pickers) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = email;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost danger';
    remove.textContent = 'Remove';
    remove.addEventListener('click', async () => {
      try {
        await api('../api/admin/pickers', { method: 'DELETE', body: JSON.stringify({ email }), headers: { 'Content-Type': 'application/json' } });
        setPickerStatus(`${email} now plays as one player.`);
        await loadPickers();
      } catch (error) {
        setPickerStatus(`Could not remove: ${error.message}`, true);
      }
    });
    li.append(name, remove);
    pickerList.append(li);
  }
}

document.querySelector('#picker-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.querySelector('#picker-email');
  const email = input.value.trim().toLowerCase();
  try {
    await api('../api/admin/pickers', { method: 'PUT', body: JSON.stringify({ email }), headers: { 'Content-Type': 'application/json' } });
    input.value = '';
    setPickerStatus(`${email} will ask "Who's playing?"`);
    await loadPickers();
  } catch (error) {
    setPickerStatus(`Could not add: ${error.message}`, true);
  }
});

// ---- Route encounters ----
// Per player (or everyone), per map: grass and surfing pick evenly from the
// checked Pokémon. Stored as rules.encounters { "group:num": [species ids] }.

const MAX_ENCOUNTER_SPECIES = 32;
const encScope = document.querySelector('#enc-scope');
const encMap = document.querySelector('#enc-map');
const encNormal = document.querySelector('#enc-normal');
const encState = document.querySelector('#enc-state');
const encSearch = document.querySelector('#enc-search');
const encGrid = document.querySelector('#enc-species');
const encPicked = document.querySelector('#enc-picked');
const encCount = document.querySelector('#enc-count');
const encStatus = document.querySelector('#enc-status');
const encFollow = document.querySelector('#enc-follow');
let gameData = { maps: [], species: [] };
let speciesName = new Map();
let checked = new Set();

function setEncStatus(text, isError = false) {
  encStatus.textContent = text;
  encStatus.classList.toggle('error', isError);
}

function renderEncounterScopes() {
  const selected = encScope.value || '*';
  encScope.replaceChildren(new Option('Everyone', '*'));
  for (const email of playerEmails()) encScope.add(new Option(playerLabel(email), email));
  encScope.value = [...encScope.options].some((o) => o.value === selected) ? selected : '*';
  renderEncounterMaps();
}

function overridesFor(scope) {
  return rows.get(scope)?.encounters || {};
}

function renderEncounterMaps() {
  const selected = encMap.value;
  const mine = overridesFor(encScope.value);
  const everyone = overridesFor('*');
  encMap.replaceChildren();
  for (const map of gameData.maps) {
    const mark = map.key in mine ? ' ★' : (encScope.value !== '*' && everyone[map.key]?.length ? ' ☆' : '');
    encMap.add(new Option(`${map.name}${mark}`, map.key));
  }
  if (selected && [...encMap.options].some((o) => o.value === selected)) encMap.value = selected;
  else encMap.value = gameData.maps.find((m) => m.map === 'MAP_ROUTE101')?.key || encMap.options[0]?.value;
  loadEncounterChoice();
}

function loadEncounterChoice() {
  const scope = encScope.value;
  const key = encMap.value;
  const map = gameData.maps.find((m) => m.key === key);
  if (!map) return;
  const normal = [...new Set([...map.land, ...map.water])].map((id) => speciesName.get(id)).filter(Boolean);
  encNormal.textContent = `Normally here: ${normal.join(', ')}.`;
  const own = overridesFor(scope)[key];
  const everyone = overridesFor('*')[key];
  let list;
  if (own !== undefined) {
    list = own;
    const who = scope === '*' ? 'Everyone has' : 'This player has';
    encState.textContent = own.length ? `${who} a custom list for this area.` : 'This player gets the normal Pokémon here.';
  } else if (scope !== '*' && everyone?.length) {
    list = everyone;
    encState.textContent = 'Following the Everyone list for this area.';
  } else {
    list = [];
    encState.textContent = 'Normal Pokémon. Check some below to replace them.';
  }
  checked = new Set(list);
  encFollow.hidden = scope === '*' || own === undefined;
  setEncStatus('');
  renderSpeciesGrid();
}

function renderSpeciesGrid() {
  const query = encSearch.value.trim().toLowerCase();
  encGrid.replaceChildren();
  for (const sp of gameData.species) {
    if (query && !sp.name.toLowerCase().includes(query) && !checked.has(sp.id)) continue;
    const label = document.createElement('label');
    label.className = 'species';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = checked.has(sp.id);
    box.addEventListener('change', () => {
      if (box.checked && checked.size >= MAX_ENCOUNTER_SPECIES) {
        box.checked = false;
        setEncStatus(`Up to ${MAX_ENCOUNTER_SPECIES} Pokémon per area.`, true);
        return;
      }
      if (box.checked) checked.add(sp.id); else checked.delete(sp.id);
      renderPicked();
    });
    label.append(box, document.createTextNode(sp.name));
    encGrid.append(label);
  }
  renderPicked();
}

function renderPicked() {
  encCount.textContent = checked.size
    ? `${checked.size} picked, each ${Math.round(1000 / checked.size) / 10}% of encounters`
    : 'None picked';
  encPicked.replaceChildren(...[...checked].map((id) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = `${speciesName.get(id)} ✕`;
    chip.addEventListener('click', () => { checked.delete(id); renderSpeciesGrid(); });
    return chip;
  }));
}

async function saveEncounters(list) {
  const scope = encScope.value;
  const key = encMap.value;
  const rules = { ...(rows.get(scope) || {}) };
  const encounters = { ...(rules.encounters || {}) };
  if (list === null) delete encounters[key]; else encounters[key] = list;
  rules.encounters = encounters;
  setEncStatus('Saving…');
  try {
    const saved = await api('../api/admin/rules', { method: 'PUT', body: JSON.stringify({ email: scope, rules }), headers: { 'Content-Type': 'application/json' } });
    rows.set(scope, saved.rules);
    renderScopes();
    renderEncounterMaps();
    setEncStatus(`Saved at ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Games pick it up within 5 minutes or on reload.`);
  } catch (error) {
    setEncStatus(`Could not save: ${error.message}`, true);
  }
}

document.querySelector('#enc-save').addEventListener('click', () => {
  if (!checked.size) {
    setEncStatus('Check at least one Pokémon, or use "Normal Pokémon".', true);
    return;
  }
  saveEncounters([...checked]);
});
document.querySelector('#enc-normal-button').addEventListener('click', () => {
  // Everyone: drop the override. A player: pin the normal Pokémon even if Everyone has a list.
  const everyoneHasList = overridesFor('*')[encMap.value]?.length;
  saveEncounters(encScope.value === '*' || !everyoneHasList ? null : []);
});
encFollow.addEventListener('click', () => saveEncounters(null));
encScope.addEventListener('change', renderEncounterMaps);
encMap.addEventListener('change', loadEncounterChoice);
encSearch.addEventListener('input', renderSpeciesGrid);

fetch('game-data.json', { cache: 'no-cache' })
  .then((res) => res.json())
  .then((data) => {
    gameData = data;
    speciesName = new Map(data.species.map((sp) => [sp.id, sp.name]));
    renderEncounterScopes();
  })
  .catch((error) => setEncStatus(`Could not load the game data: ${error.message}`, true));

loadPickers().catch((error) => setPickerStatus(`Could not load logins: ${error.message}`, true));
buildStaticControls();
api('../api/whoami')
  .then((me) => { document.querySelector('#who').textContent = `Signed in as ${me.email}`; })
  .catch(() => { document.querySelector('#who').textContent = 'Not signed in'; });
load().catch((error) => setStatus(`Could not load rules: ${error.message}`, true));
