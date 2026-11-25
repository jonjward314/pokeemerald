"""Zeroid menu icon (from the front sprite) and footprint.

Usage: python3 tools/zeroid/icon.py graphics/pokemon/zeroid graphics/pokemon/icon_palettes/icon_palette_1.pal
"""
import os, sys, numpy as np
from collections import Counter
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import draw
out = sys.argv[1]; pal_path = sys.argv[2]
pal = [tuple(map(int, l.split())) for l in open(pal_path).read().split('\n')[3:19]]
# sprite palette index -> icon palette 1 index
M = {0: 0, 1: 15, 2: 13, 3: 13, 4: 7, 5: 9, 6: 10, 7: 11, 8: 3, 9: 14, 10: 2, 11: 11, 12: 2, 13: 4, 14: 6, 15: 6}

def small(px):
    a = np.vectorize(M.get)(px)
    ys, xs = np.nonzero(px); x0, y0 = xs.min(), ys.min()
    a = a[y0:ys.max() + 1, x0:xs.max() + 1]
    h, w = a.shape
    r = np.zeros(((h + 1) // 2, (w + 1) // 2), int)
    for y in range(r.shape[0]):
        for x in range(r.shape[1]):
            blk = a[y * 2:y * 2 + 2, x * 2:x * 2 + 2].flatten()
            nz = [v for v in blk if v not in (0, 15)]
            # keep the thin saber visible
            if 6 in blk: r[y, x] = 6
            elif sum(1 for v in blk if v == 0) >= 3 or (not nz and sum(1 for v in blk if v == 0) >= 2): r[y, x] = 0
            elif nz: r[y, x] = Counter(nz).most_common(1)[0][0]
            else: r[y, x] = 15
    return r

def place(r, dy):
    c = np.zeros((32, 32), int)
    h, w = r.shape
    ox = (32 - w) // 2; oy = 32 - h - dy
    if oy < 0: r = r[-oy:]; h += oy; oy = 0
    c[oy:oy + h, ox:ox + w] = r
    o = c.copy()
    for y in range(32):
        for x in range(32):
            if c[y, x] and c[y, x] != 6 and any(not (0 <= x + a < 32 and 0 <= y + b < 32) or c[y + b, x + a] == 0 for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                o[y, x] = 15
    for y in range(32):  # drop stray single pixels
        for x in range(32):
            if o[y, x] and not any(0 <= x + a < 32 and 0 <= y + b < 32 and o[y + b, x + a] for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                o[y, x] = 0
    return o

f0 = small(draw.draw_front(0)); f1 = small(draw.draw_front(1))
icon = np.vstack([place(f0, 0), place(f1, 1)])
im = Image.fromarray(icon.astype(np.uint8), 'P'); flat = [c for rgb in pal for c in rgb]
im.putpalette(flat + [0] * (768 - len(flat))); im.save(f'{out}/icon.png')

# footprint: 16x16, 1bpp, index 1 = ink. An armoured boot sole.
fp = np.zeros((16, 16), int)
for y in range(1, 15):
    for x in range(16):
        top = (x - 7.5) ** 2 / 4.2 ** 2 + (y - 5) ** 2 / 4.5 ** 2 <= 1
        heel = 4 <= x <= 11 and 10 <= y <= 14
        if (top or heel) and not (y == 9): fp[y, x] = 1
fim = Image.fromarray(fp.astype(np.uint8), 'P'); fim.putpalette([255, 255, 255, 0, 0, 0] + [0] * 762); fim.save(f'{out}/footprint.png')
print('\n'.join(''.join('#' if v else '.' for v in row) for row in fp))
