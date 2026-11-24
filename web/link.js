// Link cable over the internet: carries the game's link-cable blocks between
// this page and the family link server (worker/link.js), so two to four
// players can battle, trade and mix records in any Pokémon Center's Cable
// Club. The game side lives in src/wasm_link.c.

const LINK_CLOSED = 0;
const LINK_HANDSHAKE = 1;
const LINK_CONNECTED = 2;
const MAX_PLAYERS = 4;
const CMD_LENGTH = 8;
const BLOCK_BYTES = CMD_LENGTH * 2;
const CABLE_KEY = 'pokeemerald.link.cable';
const UNPLUG_AFTER_MS = 30000;
const RETRY_MS = 2000;

export function createLinkCable({ onStatus = () => {}, profile = () => 'main' } = {}) {
  let exports = null;
  let memory = null;
  let ws = null;
  let wsWanted = false;
  let state = LINK_CLOSED;
  let unplugTimer = null;
  let retryTimer = null;
  let players = [];
  let linkedWith = [];
  let plugIndex = -1;
  let note = '';

  function cable() {
    try {
      return Math.min(3, Math.max(1, Number(localStorage.getItem(CABLE_KEY)) || 1));
    } catch {
      return 1;
    }
  }

  function setCable(value) {
    try {
      localStorage.setItem(CABLE_KEY, String(value));
    } catch {
      // Private mode: stays on this cable for this visit only.
    }
    if (ws) {
      // Move to the new cable.
      const socket = ws;
      ws = null;
      socket.close();
      if (wsWanted) connect();
    }
    report();
  }

  function report() {
    let text;
    if (state === LINK_CLOSED && !ws) text = '';
    else if (note) text = note;
    else if (state === LINK_CONNECTED) text = linkedWith.length ? `Linked with ${linkedWith.join(', ')}` : 'Linked';
    else if (state === LINK_HANDSHAKE) {
      const others = players.filter((_, i) => i !== myIndex());
      text = others.length ? `Cable ${cable()}: ${others.join(', ')} plugged in` : `Cable ${cable()}: waiting for family…`;
    } else text = `Cable ${cable()}: plugged in`;
    onStatus({ text, active: state !== LINK_CLOSED, cable: cable() });
  }

  function myIndex() {
    return plugIndex;
  }

  function connect() {
    if (ws || !wsWanted) return;
    clearTimeout(retryTimer);
    const url = new URL(`api/link?cable=${cable()}`, location.href);
    if (profile() !== 'main') url.searchParams.set('profile', profile());
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const devName = new URLSearchParams(location.search).get('player');
    if (devName) url.searchParams.set('name', devName);
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    ws = socket;
    note = '';
    socket.addEventListener('open', () => {
      if (ws !== socket) return;
      if (state !== LINK_CLOSED) sendJson({ t: 'open' });
      report();
    });
    socket.addEventListener('message', (event) => {
      if (ws === socket) onMessage(event.data);
    });
    socket.addEventListener('close', () => {
      if (ws !== socket) return;
      ws = null;
      players = [];
      if (state === LINK_CONNECTED) exports.WasmLinkPeerLost();
      if (state === LINK_HANDSHAKE) exports.WasmLinkSetLobby(1, 0);
      if (wsWanted) retryTimer = setTimeout(connect, RETRY_MS);
      report();
    });
  }

  function sendJson(message) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  function onMessage(data) {
    if (data instanceof ArrayBuffer) {
      if (state !== LINK_CONNECTED) return;
      const round = new Uint8Array(data);
      const inbox = new Uint8Array(memory.buffer, exports.WasmLinkInbox() >>> 0, MAX_PLAYERS * BLOCK_BYTES);
      inbox.fill(0);
      inbox.set(round.subarray(0, Math.min(round.length, inbox.length)));
      exports.WasmLinkPushRound();
      return;
    }
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    switch (message.t) {
      case 'lobby':
        players = message.players || [];
        plugIndex = message.you;
        if (state === LINK_HANDSHAKE) {
          if (message.id >= 0) exports.WasmLinkSetLobby(message.count, message.id);
          else exports.WasmLinkSetLobby(1, 0);
        }
        break;
      case 'start':
        if (state === LINK_HANDSHAKE) {
          exports.WasmLinkStart(message.count, message.id);
          state = LINK_CONNECTED;
          linkedWith = (message.players || []).filter((_, i) => i !== message.id);
        }
        break;
      case 'lost':
        if (state === LINK_CONNECTED) exports.WasmLinkPeerLost();
        break;
      case 'busy':
        note = `Cable ${cable()} is full (4 players). Try another cable under More.`;
        break;
    }
    report();
  }

  function plugIn() {
    clearTimeout(unplugTimer);
    unplugTimer = null;
    wsWanted = true;
    if (!ws) connect();
    else sendJson({ t: 'open' });
  }

  function unplugSoon() {
    clearTimeout(unplugTimer);
    unplugTimer = setTimeout(() => {
      wsWanted = false;
      clearTimeout(retryTimer);
      if (ws) {
        const socket = ws;
        ws = null;
        socket.close();
      }
      players = [];
      note = '';
      report();
    }, UNPLUG_AFTER_MS);
  }

  // Called after every game frame.
  function afterFrame() {
    if (!exports) return;
    const now = exports.WasmLinkState();
    if (now !== state) {
      const was = state;
      state = now;
      if (was === LINK_CLOSED) {
        exports.WasmLinkReset();
        plugIn();
      } else if (now === LINK_CLOSED) {
        sendJson({ t: 'close' });
        exports.WasmLinkReset();
        linkedWith = [];
        unplugSoon();
      }
      report();
    }
    if (state === LINK_HANDSHAKE) {
      if (exports.WasmLinkTakeStartRequest()) sendJson({ t: 'start' });
    } else if (state === LINK_CONNECTED) {
      const count = exports.WasmLinkOutboxCount();
      if (count) {
        const base = exports.WasmLinkOutbox() >>> 0;
        if (ws && ws.readyState === WebSocket.OPEN) {
          for (let i = 0; i < count; i++) {
            ws.send(memory.buffer.slice(base + i * BLOCK_BYTES, base + (i + 1) * BLOCK_BYTES));
          }
        }
        exports.WasmLinkOutboxClear();
      }
    }
  }

  function attach(instance, mem) {
    exports = instance.exports.WasmLinkState ? instance.exports : null;
    memory = mem;
    state = LINK_CLOSED;
    if (exports) exports.WasmLinkReset();
  }


  return { attach, afterFrame, cable, setCable };
}
