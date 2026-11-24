"""Synthesises Obsidillo's cry: 8-bit mono 10512 Hz WAV like the other cries,
plus a 44.1 kHz 16-bit preview copy. Usage: cry.py <game.wav> <preview.wav>"""
import numpy as np, wave, sys
SR = 10512
dur = 0.62
t = np.arange(int(SR * dur)) / SR
rng = np.random.default_rng(7)

def interp(pts):
    xs, ys = zip(*pts); return np.interp(t, xs, ys)

# voice: two syllables "kree-tink", pitch contour + vibrato
f = interp([(0, 560), (0.06, 980), (0.16, 820), (0.22, 700), (0.27, 900), (0.33, 1250), (0.45, 1050), (0.62, 640)])
f *= 1 + 0.025 * np.sin(2 * np.pi * 22 * t)
ph = 2 * np.pi * np.cumsum(f) / SR
voice = 0.55 * np.sign(np.sin(ph)) * 0.35 + 0.65 * np.sin(ph) + 0.30 * np.sin(2 * ph + 0.5) + 0.15 * np.sin(3 * ph)
env = interp([(0, 0), (0.012, 1), (0.17, 0.85), (0.215, 0.15), (0.24, 0.2), (0.26, 1.0), (0.45, 0.75), (0.62, 0)])
voice *= env
# glass chime on the second syllable: inharmonic partials, exponential ring
chime = np.zeros_like(t)
for start, base, amp in ((0.25, 1760, 0.55), (0.31, 2349, 0.35)):
    tt = np.clip(t - start, 0, None); on = (t >= start)
    for mult, a, dec in ((1.0, 1.0, 9), (2.76, 0.45, 14)):
        fr = base * mult
        if fr < SR / 2 - 200:
            chime += on * amp * a * np.sin(2 * np.pi * fr * tt) * np.exp(-dec * tt)
# ember crackle: sparse soft clicks
crackle = np.zeros_like(t)
for i in rng.choice(len(t), 18, replace=False):
    n = 6; crackle[i:i + n] += rng.uniform(-1, 1) * np.hanning(n)[:len(crackle[i:i + n])] * 0.5
crackle *= interp([(0, 0.3), (0.3, 1), (0.62, 0.6)])
sig = voice + chime + crackle
sig /= np.max(np.abs(sig)) / 0.92
fade = np.minimum(1, (len(t) - np.arange(len(t))) / (0.02 * SR)); sig *= fade
def write(path, s, sr):
    w = wave.open(path, 'wb'); w.setnchannels(1); w.setsampwidth(1); w.setframerate(sr)
    w.writeframes(np.clip(np.round(s * 127 + 128), 0, 255).astype(np.uint8).tobytes()); w.close()
write(sys.argv[1], sig, SR)
# 16-bit 44.1k preview of exactly the in-game sample (sample-and-hold like the GBA would play it)
idx = (np.arange(int(len(sig) * 44100 / SR)) * SR / 44100).astype(int)
p = sig[idx]
w = wave.open(sys.argv[2], 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(44100)
w.writeframes((np.clip(p, -1, 1) * 30000).astype('<i2').tobytes()); w.close()
print(len(sig), 'samples')
