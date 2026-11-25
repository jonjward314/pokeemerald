#!/usr/bin/env python3
"""Converts the hand-made Zeroid sprite set into the game's files.

Usage: python3 tools/zeroid/convert.py <source-dir> graphics/pokemon/zeroid
Source dir holds front.png (64x128, 2 frames), back.png (64x64), icon.png (32x64),
footprint.png (16x16), normal.pal and shiny.pal, all sharing one 16-colour palette.
The icon is remapped to whichever shared icon palette fits it best.
"""
import sys, shutil
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
BG = (152, 208, 160)  # colour 0 is transparent; use the usual sprite background

def read_pal(path):
    return [tuple(map(int, l.split())) for l in open(path).read().split('\n')[3:19]]

def write_pal(path, pal):
    with open(path, 'w', newline='\r\n') as f:
        f.write('JASC-PAL\n0100\n16\n')
        for r, g, b in pal: f.write(f'{r} {g} {b}\n')

def indexed(path, size):
    im = Image.open(path)
    assert im.mode == 'P' and im.size == size, (path, im.mode, im.size)
    a = np.array(im)
    assert a.max() < 16, path
    return a

normal = read_pal(f'{src}/normal.pal'); shiny = read_pal(f'{src}/shiny.pal')
normal[0] = shiny[0] = BG

def save(a, path, pal):
    im = Image.fromarray(a.astype(np.uint8), 'P')
    im.putpalette([c for rgb in pal for c in rgb] + [0] * (768 - 48))
    im.save(path)

front = indexed(f'{src}/front.png', (64, 128))
save(front[:64], f'{out}/front.png', normal)
save(front, f'{out}/anim_front.png', normal)
save(indexed(f'{src}/back.png', (64, 64)), f'{out}/back.png', normal)
write_pal(f'{out}/normal.pal', normal)
write_pal(f'{out}/shiny.pal', shiny)

# icon: remap each colour to the nearest colour of the best-fitting icon palette
icon = indexed(f'{src}/icon.png', (32, 64))
used = sorted(set(icon.flatten()) - {0})
best = None
for n in range(3):
    ipal = read_pal(f'graphics/pokemon/icon_palettes/icon_palette_{n}.pal')
    m, err = {0: 0}, 0
    for i in used:
        c = np.array(read_pal(f'{src}/normal.pal')[i])
        d = [np.sum((c - np.array(ipal[j])) ** 2) for j in range(1, 16)]
        j = int(np.argmin(d)) + 1; m[i] = j; err += d[j - 1] * np.sum(icon == i)
    if best is None or err < best[0]: best = (err, n, m, ipal)
_, n, m, ipal = best
save(np.vectorize(m.get)(icon), f'{out}/icon.png', ipal)
print(f'icon palette {n}')

# footprint: black pixels are ink (index 1)
fp = np.array(Image.open(f'{src}/footprint.png').convert('L')) < 128
fim = Image.fromarray(fp.astype(np.uint8), 'P'); fim.putpalette([255, 255, 255, 0, 0, 0] + [0] * 762)
fim.save(f'{out}/footprint.png')
