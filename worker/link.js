// The family link cable: a Durable Object that joins up to four games so
// they can battle, trade and mix records in the Cable Club, as if their Game
// Boys were plugged into one link cable.
//
// Each "cable" (cable=1, 2, 3 ...) is one Durable Object. A page plugs in by
// opening a WebSocket when the player talks to the Cable Club receptionist.
//
// Messages from a page:
//   JSON {t:'open'}    the game opened its link (waiting to connect)
//   JSON {t:'close'}   the game closed its link
//   JSON {t:'start'}   the leader confirmed "start the link"
//   binary, 16 bytes   one command block (8 little-endian u16) from the game
//
// Messages to a page:
//   JSON {t:'lobby', count, id, you, players:[names]}
//         count = games on this cable with their link open, id = this game's
//         place among them (0 is the leader), -1 when its link is closed;
//         players = everyone plugged in, you = this page's index in players
//   JSON {t:'start', count, id, players}   the link is up
//   JSON {t:'lost'}    a linked partner closed or dropped
//   JSON {t:'busy'}    cable already has four players
//   binary, count*16 bytes   one round: every linked player's block, in id order
//
// A round holds at most one block per player. Like the real cable, a block
// that arrives while that player's slot is already full starts the next
// round, so a player sending a long transfer is never held up by the others.

const MAX_PLAYERS = 4;
const BLOCK_BYTES = 16;
// How long a round waits for the other players' blocks before going out
// partly empty. Games are fine with empty slots; this just keeps the
// players' blocks together when they send at the same time.
const ROUND_WAIT_MS = 12;

export class LinkCable {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.members = []; // in plug-in order: { ws, name, open }
    this.session = null; // members joined in the current link, in id order
    this.round = null;
    this.roundTimer = null;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected a WebSocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    if (this.members.length >= MAX_PLAYERS) {
      server.send(JSON.stringify({ t: 'busy' }));
      server.close(1000, 'cable full');
      return new Response(null, { status: 101, webSocket: client });
    }

    const member = { ws: server, name: request.headers.get('X-Player-Name') || 'Player', open: false };
    this.members.push(member);
    server.addEventListener('message', (event) => this.onMessage(member, event.data));
    server.addEventListener('close', () => this.onLeave(member));
    server.addEventListener('error', () => this.onLeave(member));
    this.broadcastLobby();
    return new Response(null, { status: 101, webSocket: client });
  }

  onMessage(member, data) {
    if (typeof data !== 'string') {
      this.onBlock(member, new Uint8Array(data));
      return;
    }
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    switch (message.t) {
      case 'open':
        member.open = true;
        this.broadcastLobby();
        break;
      case 'close':
        member.open = false;
        this.leaveSession(member);
        this.broadcastLobby();
        break;
      case 'start':
        this.tryStart(member);
        break;
      case 'ping':
        member.ws.send(JSON.stringify({ t: 'pong' }));
        break;
    }
  }

  onLeave(member) {
    const index = this.members.indexOf(member);
    if (index === -1) return;
    this.members.splice(index, 1);
    this.leaveSession(member);
    this.broadcastLobby();
  }

  waiting() {
    // Games with their link open that aren't already in the running link.
    return this.members.filter((m) => m.open && !(this.session && this.session.includes(m)));
  }

  broadcastLobby() {
    const waiting = this.waiting();
    const players = this.members.map((m) => m.name);
    this.members.forEach((member, you) => {
      if (this.session && this.session.includes(member)) return;
      const id = waiting.indexOf(member);
      send(member.ws, { t: 'lobby', count: Math.max(1, waiting.length), id, you, players });
    });
  }

  tryStart(member) {
    if (this.session) return;
    const waiting = this.waiting();
    if (waiting.length < 2 || waiting[0] !== member) return;
    this.session = waiting;
    this.round = new Array(waiting.length).fill(null);
    const players = waiting.map((m) => m.name);
    waiting.forEach((m, id) => send(m.ws, { t: 'start', count: waiting.length, id, players }));
  }

  leaveSession(member) {
    if (!this.session) return;
    const index = this.session.indexOf(member);
    if (index === -1) return;
    this.flushRound();
    const rest = this.session.filter((m) => m !== member && m.open && this.members.includes(m));
    for (const m of rest) send(m.ws, { t: 'lost' });
    // The link is over once a player leaves it; the others' games close
    // their link too, and can then link up again from the lobby.
    this.session = null;
    this.round = null;
  }

  onBlock(member, bytes) {
    if (!this.session || bytes.length !== BLOCK_BYTES) return;
    const id = this.session.indexOf(member);
    if (id === -1) return;
    if (this.round[id]) this.flushRound();
    this.round[id] = bytes;
    if (this.round.every(Boolean)) {
      this.flushRound();
    } else if (!this.roundTimer) {
      this.roundTimer = setTimeout(() => this.flushRound(), ROUND_WAIT_MS);
    }
  }

  flushRound() {
    if (this.roundTimer) {
      clearTimeout(this.roundTimer);
      this.roundTimer = null;
    }
    if (!this.session || !this.round || !this.round.some(Boolean)) return;
    const out = new Uint8Array(this.session.length * BLOCK_BYTES);
    this.round.forEach((block, id) => {
      if (block) out.set(block, id * BLOCK_BYTES);
    });
    this.round.fill(null);
    for (const m of this.session) {
      try {
        m.ws.send(out);
      } catch {
        // Its close handler will clean up.
      }
    }
  }
}

function send(ws, message) {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // The socket is closing; its close handler will clean up.
  }
}
