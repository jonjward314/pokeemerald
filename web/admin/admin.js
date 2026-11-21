// Admin page: house rules for the game. Talks to /api/admin/* in
// worker/index.js, which only answers for the admin sign-in.

const RULE_KEYS = {
  expPercent: ['expPercent'],
  moneyPercent: ['moneyPercent'],
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
      button.textContent = value === '0' ? 'Off' : `${Number(value) / 100}x`;
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

function playerEmails() {
  const emails = new Set(players.map((p) => p.email));
  for (const email of rows.keys()) if (email !== '*') emails.add(email);
  return [...emails].sort();
}

function renderScopes(selected = scopeSelect.value || '*') {
  scopeSelect.replaceChildren(new Option('Everyone', '*'));
  for (const email of playerEmails()) {
    const tag = rows.has(email) ? ' (own rules)' : '';
    scopeSelect.add(new Option(`${email}${tag}`, email));
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
  renderScopes();
  renderForm();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = scopeSelect.value;
  const rules = collectRules();
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

loadPickers().catch((error) => setPickerStatus(`Could not load logins: ${error.message}`, true));
buildStaticControls();
api('../api/whoami')
  .then((me) => { document.querySelector('#who').textContent = `Signed in as ${me.email}`; })
  .catch(() => { document.querySelector('#who').textContent = 'Not signed in'; });
load().catch((error) => setStatus(`Could not load rules: ${error.message}`, true));
