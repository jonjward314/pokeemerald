// Moves the game's mixed audio from wasm memory to the speakers.
//
// The sound engine (src/m4a.c and friends) writes 800 stereo samples per game
// frame into a ring buffer in wasm memory (src/wasm_audio.c). After each batch
// of frames, pump() copies whatever is new to an AudioWorklet.
//
// Browsers only allow sound to start from a tap or key press, so the audio
// context is created on the first one.

const SOUND_PREF_KEY = 'pokeemerald.wasm.sound';
// The engine mixes quietly (to leave room for many voices), so lift it to a
// comfortable phone volume.
const VOLUME = 3;

export function createGameAudio({ onStateChange } = {}) {
  let ctx = null;
  let node = null;
  let gain = null;
  let starting = null;
  let readPos = 0; // floats read from the wasm ring (uint32 arithmetic)
  let enabled = readPref();

  function readPref() {
    try { return localStorage.getItem(SOUND_PREF_KEY) !== 'off'; } catch { return true; }
  }

  function writePref() {
    try { localStorage.setItem(SOUND_PREF_KEY, enabled ? 'on' : 'off'); } catch { /* ignore */ }
  }

  async function start() {
    if (ctx || starting) return starting;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !window.AudioWorkletNode) return null;
    starting = (async () => {
      try {
        ctx = new AudioContextClass({ sampleRate: 48000, latencyHint: 'interactive' });
      } catch {
        ctx = new AudioContextClass({ latencyHint: 'interactive' });
      }
      // Resume right away, inside the tap, which iOS requires.
      const resumed = ctx.resume();
      await ctx.audioWorklet.addModule(new URL('./audio-worklet.js', import.meta.url));
      node = new AudioWorkletNode(ctx, 'game-audio', { numberOfInputs: 0, outputChannelCount: [2] });
      gain = ctx.createGain();
      gain.gain.value = enabled ? VOLUME : 0;
      node.connect(gain).connect(ctx.destination);
      await resumed;
      onStateChange?.();
    })().catch((error) => {
      console.error('audio failed to start', error);
      ctx = null;
    });
    return starting;
  }

  function unlockOnFirstGesture() {
    const unlock = () => {
      start();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    };
    ['pointerdown', 'keydown', 'touchend'].forEach((type) => window.addEventListener(type, unlock, { capture: true, passive: true }));
  }

  // Copy new samples out of the wasm ring buffer and send them to the worklet.
  function pump(instance, memory, speed) {
    const exports = instance?.exports;
    if (!exports?.WasmAudioWritten) return;
    const written = exports.WasmAudioWritten() >>> 0;
    const ringFloats = exports.WasmAudioRingFloats() >>> 0;
    let pending = (written - readPos) >>> 0;
    if (pending > ringFloats) {
      readPos = (written - ringFloats) >>> 0;
      pending = ringFloats;
    }
    if (pending === 0) return;
    const start = readPos;
    readPos = written;
    // Only play at normal speed; fast-forward audio would just be noise.
    if (!node || !enabled || speed !== 1 || ctx?.state !== 'running') return;

    const ring = new Float32Array(memory.buffer, exports.WasmAudioRing(), ringFloats);
    const chunk = new Float32Array(pending);
    const first = Math.min(pending, ringFloats - (start % ringFloats));
    chunk.set(ring.subarray(start % ringFloats, (start % ringFloats) + first), 0);
    if (first < pending) chunk.set(ring.subarray(0, pending - first), first);
    node.port.postMessage(chunk, [chunk.buffer]);
  }

  function reset() {
    readPos = 0;
    node?.port.postMessage('clear');
  }

  function setEnabled(value) {
    enabled = value;
    writePref();
    if (gain) gain.gain.value = enabled ? VOLUME : 0;
    if (enabled) start();
    else node?.port.postMessage('clear');
    onStateChange?.();
  }

  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.visibilityState === 'hidden') ctx.suspend();
    else ctx.resume();
  });

  return {
    unlockOnFirstGesture,
    pump,
    reset,
    setEnabled,
    get enabled() { return enabled; },
    get running() { return ctx?.state === 'running'; },
  };
}
