// Plays the game's audio. The page posts interleaved stereo Float32 chunks at
// 48 kHz; this keeps a short queue and resamples to the device's rate.
const SOURCE_RATE = 48000;
const MAX_QUEUED_SECONDS = 0.25; // beyond this, drop the oldest audio (e.g. at 2x speed)
const START_QUEUED_SECONDS = 0.05; // wait for this much before (re)starting, to avoid crackle

class GameAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = Math.ceil(SOURCE_RATE * 1) * 2; // one second of stereo floats
    this.ring = new Float32Array(this.capacity);
    this.readPos = 0; // in frames (stereo pairs), fractional
    this.queued = 0; // whole frames available
    this.writeFrame = 0;
    this.started = false;
    this.step = SOURCE_RATE / sampleRate;
    this.port.onmessage = (event) => {
      if (event.data === 'clear') {
        this.queued = 0;
        this.readPos = this.writeFrame;
        this.started = false;
        return;
      }
      this.push(event.data);
    };
  }

  push(chunk) {
    const frames = chunk.length >> 1;
    const capFrames = this.capacity >> 1;
    for (let i = 0; i < frames; i++) {
      const at = ((this.writeFrame + i) % capFrames) * 2;
      this.ring[at] = chunk[i * 2];
      this.ring[at + 1] = chunk[i * 2 + 1];
    }
    this.writeFrame += frames;
    this.queued += frames;
    const maxFrames = Math.floor(SOURCE_RATE * MAX_QUEUED_SECONDS);
    if (this.queued > maxFrames) {
      const drop = this.queued - maxFrames;
      this.readPos += drop;
      this.queued = maxFrames;
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const left = out[0];
    const right = out[1] || out[0];
    const capFrames = this.capacity >> 1;

    if (!this.started && this.queued >= SOURCE_RATE * START_QUEUED_SECONDS) this.started = true;
    if (!this.started) {
      left.fill(0);
      if (right !== left) right.fill(0);
      return true;
    }

    for (let i = 0; i < left.length; i++) {
      if (this.queued < 2) {
        // Ran dry: fade to silence and wait for the queue to refill.
        left[i] = 0;
        right[i] = 0;
        this.started = false;
        continue;
      }
      const base = Math.floor(this.readPos);
      const frac = this.readPos - base;
      const a = (base % capFrames) * 2;
      const b = ((base + 1) % capFrames) * 2;
      left[i] = this.ring[a] + (this.ring[b] - this.ring[a]) * frac;
      right[i] = this.ring[a + 1] + (this.ring[b + 1] - this.ring[a + 1]) * frac;
      const before = Math.floor(this.readPos);
      this.readPos += this.step;
      this.queued -= Math.floor(this.readPos) - before;
    }
    return true;
  }
}

registerProcessor('game-audio', GameAudio);
