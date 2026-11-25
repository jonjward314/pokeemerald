"""Synthesises Zeroid's cry: 8-bit mono 10512 Hz WAV like the other cries,
plus a 44.1 kHz 16-bit preview. A saber ignition 'vwumm' under a two-note
digital shout. Usage: cry.py <game.wav> <preview.wav>"""
import numpy as np, wave, sys
SR = 10512
dur = 0.72
t = np.arange(int(SR * dur)) / SR
rng = np.random.default_rng(3)

def interp(pts):
    xs, ys = zip(*pts); return np.interp(t, xs, ys)

# saber ignition: buzzing low hum that sweeps up, with a swish of filtered noise
fs = interp([(0, 90), (0.10, 240), (0.40, 180), (0.72, 140)])
phs = 2 * np.pi * np.cumsum(fs) / SR
hum = (2 * ((phs / (2 * np.pi)) % 1) - 1) * 0.6 + 0.4 * np.sin(2 * phs)
hum *= interp([(0, 0), (0.03, 1), (0.25, 0.7), (0.6, 0.45), (0.72, 0)])
noise = rng.uniform(-1, 1, len(t))
swish = np.convolve(noise, np.ones(4) / 4, 'same') * interp([(0, 0), (0.02, 1), (0.12, 0.1), (0.72, 0)])
# voice: square-ish "zeh-ROH", second note higher and longer, with vibrato
f = interp([(0, 420), (0.08, 470), (0.15, 440), (0.19, 600), (0.24, 700), (0.50, 660), (0.72, 520)])
f *= 1 + 0.03 * np.sin(2 * np.pi * 18 * t)
ph = 2 * np.pi * np.cumsum(f) / SR
voice = 0.6 * np.sign(np.sin(ph)) + 0.5 * np.sin(2 * ph) + 0.25 * np.sin(3 * ph + 1)
voice *= interp([(0, 0), (0.06, 0), (0.08, 0.9), (0.16, 0.7), (0.18, 0.1), (0.20, 1.0), (0.48, 0.8), (0.70, 0)])
sig = 0.9 * hum + 0.35 * swish + 0.75 * voice
# a little bit-crush for a robotic edge
sig = np.round(sig * 10) / 10
sig /= np.max(np.abs(sig)) / 0.92
sig *= np.minimum(1, (len(t) - np.arange(len(t))) / (0.02 * SR))

def write(path, s, sr):
    w = wave.open(path, 'wb'); w.setnchannels(1); w.setsampwidth(1); w.setframerate(sr)
    w.writeframes(np.clip(np.round(s * 127 + 128), 0, 255).astype(np.uint8).tobytes()); w.close()
write(sys.argv[1], sig, SR)
idx = (np.arange(int(len(sig) * 44100 / SR)) * SR / 44100).astype(int)
w = wave.open(sys.argv[2], 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(44100)
w.writeframes((np.clip(sig[idx], -1, 1) * 30000).astype('<i2').tobytes()); w.close()
print(len(sig), 'samples')
