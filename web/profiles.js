// "Who's playing?": several players on one family sign-in, each with their
// own save, for kids who share a phone. The list lives on the server
// (worker/index.js, /api/profiles). Only sign-ins the admin marked as shared
// "picker" accounts ask; every page visit on one asks who is playing, and a
// reload in the same tab remembers the answer.

const SESSION_KEY = 'pokeemerald.profile';
const LAST_KEY = 'pokeemerald.profile.last';

function read(storage, key) {
  try { return storage.getItem(key); } catch { return null; }
}

function write(storage, key, value) {
  try {
    if (value == null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // Storage disabled: the picker just asks again next time.
  }
}

async function fetchProfiles() {
  try {
    const res = await fetch('api/profiles', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('application/json')) return null;
    const { picker, profiles } = await res.json();
    if (!Array.isArray(profiles) || !profiles.length) return null;
    return picker ? profiles : null;
  } catch {
    return null;
  }
}

async function addProfile(name) {
  const res = await fetch('api/profiles', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `could not add (${res.status})`);
  return body.profile;
}

// Resolves to { id, name, profiles } once a player is chosen. Without the
// family server (plain static hosting) it resolves to the only player.
export async function choosePlayer({ forcePicker = false } = {}) {
  const profiles = await fetchProfiles();
  // Not a shared "picker" sign-in (or no family server): just this player.
  if (!profiles) return { id: 'main', name: '', profiles: [] };

  const remembered = read(sessionStorage, SESSION_KEY);
  const chosen = profiles.find((p) => p.id === remembered);
  if (chosen && !forcePicker) return { ...chosen, profiles };

  return new Promise((resolve) => showPicker(profiles, (profile, list) => {
    write(sessionStorage, SESSION_KEY, profile.id);
    write(localStorage, LAST_KEY, profile.id);
    resolve({ ...profile, profiles: list });
  }));
}

// Pick someone else: forget this tab's choice and start the page again.
export function switchPlayer() {
  write(sessionStorage, SESSION_KEY, null);
  write(sessionStorage, 'pokeemerald.profile.ask', '1');
  location.reload();
}

export function pickerRequested() {
  const ask = read(sessionStorage, 'pokeemerald.profile.ask') === '1';
  write(sessionStorage, 'pokeemerald.profile.ask', null);
  return ask;
}

function showPicker(profiles, onPick) {
  const root = document.getElementById('player-picker');
  const list = root.querySelector('.player-list');
  const form = root.querySelector('form');
  const input = form.querySelector('input');
  const error = root.querySelector('.player-error');
  const last = read(localStorage, LAST_KEY);
  let current = profiles;

  function render() {
    list.replaceChildren(...current.map((profile) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'player-button';
      button.textContent = profile.name;
      if (profile.id === last) button.classList.add('last');
      button.addEventListener('click', () => {
        root.hidden = true;
        onPick(profile, current);
      });
      return button;
    }));
    form.hidden = current.length >= 8;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    error.textContent = '';
    try {
      const profile = await addProfile(name);
      current = [...current, profile];
      input.value = '';
      render();
    } catch (err) {
      error.textContent = err.message;
    }
  });

  render();
  root.hidden = false;
  (list.querySelector('.last') || list.querySelector('button'))?.focus();
}
