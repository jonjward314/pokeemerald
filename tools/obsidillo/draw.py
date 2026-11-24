#!/usr/bin/env python3
"""Procedural pixel-art renderer for Obsidillo (front, anim frame, back, palettes).

Usage: python3 tools/obsidillo/draw.py graphics/pokemon/obsidillo
Writes front.png, anim_front.png, back.png, normal.pal, shiny.pal and a
preview.png (delete the preview; it is not used by the game). Then run icon.py
for icon.png/footprint.png and cry.py for the cry:
  python3 tools/obsidillo/cry.py sound/direct_sound_samples/cries/obsidillo.wav /tmp/cry_preview.wav
"""
import math, sys
import numpy as np
from PIL import Image

W = H = 64
L = np.array([-0.55, -0.65, 0.52]); L = L / np.linalg.norm(L)

# palette indices
BG, OUT = 0, 1
OBS = [2, 3, 4]
GLS = [5, 6, 7]
SPK = 8
SKN = [9, 10, 11, 12]
FIR = [13, 14, 15]

NORMAL = [
    (152, 208, 160),  # 0 bg
    (32, 24, 40),     # 1 outline
    (56, 48, 80), (88, 80, 120), (136, 128, 168),          # obsidian
    (40, 112, 168), (72, 176, 216), (152, 228, 240),       # glass
    (248, 248, 248),                                        # sparkle / white
    (128, 72, 40), (200, 128, 72), (232, 176, 112), (248, 224, 176),  # skin
    (224, 64, 32), (248, 152, 40), (248, 232, 112),         # flame
]
SHINY = list(NORMAL)
SHINY[5:8] = [(168, 48, 104), (224, 104, 160), (248, 184, 216)]   # rose glass
SHINY[13:16] = [(48, 96, 216), (96, 176, 248), (200, 240, 255)]    # blue flame
SHINY[9:13] = [(120, 80, 56), (192, 144, 96), (224, 192, 136), (248, 232, 192)]  # paler skin


def ellipse_normal(x, y, cx, cy, rx, ry):
    nx = (x - cx) / rx; ny = (y - cy) / ry
    d = nx * nx + ny * ny
    if d > 1: return None
    nz = math.sqrt(max(0.0, 1 - d))
    return np.array([nx, ny, nz])


def shade(n, ramp, bias=0.0, gamma=1.0):
    i = float(np.dot(n, L)) + bias
    t = (i + 0.35) / 1.25
    t = min(max(t, 0), 0.999) ** gamma
    return ramp[int(t * len(ramp))]


HV = L + np.array([0, 0, 1.0]); HV = HV / np.linalg.norm(HV)


def glass(n, band, f, dist):
    """Glass pane colour: faceted per pane plus a glossy highlight."""
    bias = 0.12 if band % 2 else -0.02
    spec = float(np.dot(n, HV))
    if spec > 0.965 and dist > 1.3: return SPK
    if spec > 0.90: return GLS[2]
    c = shade(n, GLS, 0.1 + bias, 0.9)
    if f > 0.5 and dist < 2.0 and c != GLS[0]: return GLS[max(0, GLS.index(c) - 1)]
    return c


def rib(n):
    return shade(n, OBS, 0.15)


class Canvas:
    def __init__(self):
        self.px = np.zeros((H, W), dtype=np.int16)   # palette index
        self.sid = np.full((H, W), -1, dtype=np.int16)  # shape order id
        self.grp = np.zeros((H, W), dtype=np.int16)  # material group for outlines
        self.outc = {}

    def put(self, x, y, col, sid, grp):
        if 0 <= x < W and 0 <= y < H:
            self.px[y, x] = col; self.sid[y, x] = sid; self.grp[y, x] = grp

    def ellipse(self, sid, grp, cx, cy, rx, ry, colfn, clip=None):
        for y in range(H):
            for x in range(W):
                n = ellipse_normal(x + 0.5, y + 0.5, cx, cy, rx, ry)
                if n is None: continue
                if clip and not clip(x, y): continue
                c = colfn(x, y, n)
                if c is not None: self.put(x, y, c, sid, grp)

    def finish(self, darkest):
        out = self.px.copy()
        for y in range(H):
            for x in range(W):
                if self.sid[y, x] < 0: continue
                nb = [(x+1, y), (x-1, y), (x, y+1), (x, y-1)]
                ext = any(not (0 <= a < W and 0 <= b < H) or self.sid[b, a] < 0 for a, b in nb)
                if ext:
                    out[y, x] = OUT; continue
                for a, b in nb:
                    if self.sid[b, a] < self.sid[y, x] and self.grp[b, a] != self.grp[y, x]:
                        out[y, x] = darkest.get(self.grp[y, x], OUT); break
        self.px = out


def flame(cv, sid, cx, cy, size, flick=0):
    """Teardrop flame pointing up, base at (cx,cy)."""
    for y in range(H):
        for x in range(W):
            dx = (x + 0.5 - cx) / size
            dy = (y + 0.5 - cy) / size
            # teardrop: circle at bottom, narrowing to a tip above
            if dy > 0:
                r = math.hypot(dx, dy * 1.1)
            else:
                w = max(0.0, 1 + dy / 2.2)  # width shrinks going up
                if w <= 0: continue
                sway = 0.25 * flick * (-dy)
                r = abs(dx - sway * 0.6) / (w ** 1.2 + 1e-6)
                if -dy > 2.2: continue
            if r <= 1.0:
                core = math.hypot(dx * 1.3, (dy - 0.25) * 0.8)
                c = FIR[2] if core < 0.45 else FIR[1] if core < 0.85 else FIR[0]
                cv.put(x, y, c, sid, 9)


def draw_front(frame=0):
    cv = Canvas()
    bob = 1 if frame else 0
    # --- far back leg
    cv.ellipse(1, 3, 51, 53 + bob * 0, 3.6, 4.5, lambda x, y, n: shade(n, SKN[:3], -0.25))
    # --- tail (segmented, curving up), then flame tip
    pts = [(52, 47), (56, 46), (59, 43), (60.5, 39.5)]
    for k, (tx, ty) in enumerate(pts):
        r = 3.6 - k * 0.55
        ring = k % 2 == 1
        cv.ellipse(2 + k, 4 + (k % 2), tx, ty + bob, r, r,
                   (lambda ring: lambda x, y, n: shade(n, OBS if ring else SKN[1:], 0.05))(ring))
    flame(cv, 7, 60.5, 36.5 + bob, 3.4 + frame * 0.6, flick=1 if frame else -1)

    # --- shell dome
    scx, scy, srx, sry = 37.0, 36.0 + bob, 19.5, 15.5
    rim = lambda x: 45.5 + bob + 1.8 * ((x - scx) / srx) ** 2
    N = 5

    def tval(x, y):
        n = ellipse_normal(x + 0.5, y + 0.5, scx, scy, srx, sry)
        if n is None: return None
        th = math.atan2(n[0], n[2])
        return (th + math.pi / 2) / (math.pi / N)

    def shell_col(x, y, n):
        t = tval(x, y)
        t2 = tval(x + 1, y) or t
        dt = abs(t2 - t) + 1e-3
        f = t - math.floor(t)
        dist = min(f, 1 - f) / dt  # pixels to nearest rib
        band = int(math.floor(t))
        ry = rim(x) - (y + 0.5)
        cap = n[0] < -0.80 or n[0] > 0.80
        if ry < 2.5 or dist < 1.0 or cap:
            if cap and ry > 3.5 and abs(n[1] + 0.15) < 0.12 and dist > 0.8:
                return GLS[1]  # little glass studs on the shields
            return rib(n)
        return glass(n, band, f, dist)

    cv.ellipse(10, 1, scx, scy, srx, sry, shell_col, clip=lambda x, y: y + 0.5 < rim(x))

    # --- belly under the shell
    cv.ellipse(11, 3, scx - 1, rim(scx) + 1.0, 17, 6.0,
               lambda x, y, n: shade(n, SKN[:3], 0.05), clip=lambda x, y: y + 0.5 >= rim(x) - 0.2)
    # --- front legs + claws
    for i, (lx, ly) in enumerate([(41.5, 53.5), (27.5, 54.0)]):
        cv.ellipse(12 + i, 3, lx, ly + bob * 0, 3.8, 4.8, lambda x, y, n: shade(n, SKN[:3], 0.0))
        for k in range(3):
            cv.put(int(lx) - 2 + k * 2, int(ly + 4.6), SPK if k != 1 else SKN[3], 14 + i, 7)

    # --- ears (behind head)
    cv.ellipse(20, 3, 23.0, 29.0 + bob, 3.4, 4.6, lambda x, y, n: shade(n, SKN[1:], 0.1) if abs(x + 0.5 - 23.0) > 1.2 or y > 31 + bob else SKN[1])
    cv.ellipse(21, 3, 15.5, 29.5 + bob, 3.2, 4.4, lambda x, y, n: shade(n, SKN[1:], 0.2) if abs(x + 0.5 - 15.5) > 1.1 or y > 31 + bob else SKN[1])
    # --- head + snout
    hcx, hcy = 16.5, 40.5 + bob
    cv.ellipse(22, 3, hcx, hcy, 10.5, 9.0, lambda x, y, n: shade(n, SKN, 0.05))
    cv.ellipse(23, 3, 8.0, 46.0 + bob, 6.5, 4.6, lambda x, y, n: shade(n, SKN, 0.1))
    # helmet plate (obsidian) with a glass gem
    def helm(x, y, n):
        if (x + 0.5 - 16.5) ** 2 / 2.2 + (y + 0.5 - (34.5 + bob)) ** 2 / 1.6 < 1.0:
            return SPK if (x == 15 and y == int(33 + bob)) else GLS[1] if y < 35 + bob else GLS[0]
        return shade(n, OBS, 0.2)
    cv.ellipse(24, 1, 17.0, 37.5 + bob, 9.0, 6.0, helm, clip=lambda x, y: y + 0.5 < 36.5 + bob + 0.25 * (x - 10))

    cv.finish({1: OBS[0], 3: SKN[0], 4: OBS[0], 5: SKN[0], 7: SKN[0], 9: FIR[0]})

    # --- face details drawn on top (after outlines)
    px = cv.px
    ex, ey = 12, int(41 + bob)
    if frame == 0:
        for (x, y) in [(ex, ey - 2), (ex + 1, ey - 2), (ex - 1, ey - 1), (ex, ey - 1), (ex + 1, ey - 1), (ex + 2, ey - 1),
                       (ex - 1, ey), (ex, ey), (ex + 1, ey), (ex + 2, ey), (ex, ey + 1), (ex + 1, ey + 1)]:
            px[y, x] = OUT
        px[ey - 1, ex] = SPK; px[ey - 2, ex] = SPK; px[ey, ex + 1] = GLS[0]
        px[ey + 2, ex] = SKN[0]; px[ey + 2, ex + 1] = SKN[0]
    else:
        # happy closed eye  ^
        for (x, y) in [(ex - 1, ey + 1), (ex, ey), (ex + 1, ey), (ex + 2, ey + 1)]:
            px[y, x] = OUT
    # nose
    px[int(45 + bob), 2] = OUT; px[int(44 + bob), 2] = OUT; px[int(44 + bob), 3] = OUT
    # mouth / smile
    my = int(48 + bob)
    if frame == 0:
        for x in (6, 7, 8): px[my, x] = SKN[0]
        px[my - 1, 9] = SKN[0]
    else:
        for x in (5, 6, 7, 8): px[my, x] = OUT
        px[my + 1, 6] = FIR[0]; px[my + 1, 7] = FIR[0]
        px[my - 1, 9] = OUT
    # rosy cheek
    px[int(45 + bob), 15] = FIR[1]; px[int(45 + bob), 16] = FIR[1]
    return px


def draw_back():
    cv = Canvas()
    # seen from behind/right: big shell, tail toward viewer, head peeking at right
    # head peeking over the shell (behind it)
    cv.ellipse(1, 3, 51.0, 22.0, 3.4, 5.4, lambda x, y, n: shade(n, SKN, 0.05))   # ear
    cv.ellipse(2, 3, 42.5, 21.0, 3.2, 5.2, lambda x, y, n: shade(n, SKN, 0.1))    # ear
    cv.ellipse(3, 3, 47.0, 32.0, 10.0, 8.5, lambda x, y, n: shade(n, SKN, 0.1))   # back of head
    def bhelm(x, y, n):
        if (x + 0.5 - 47.5) ** 2 / 2.5 + (y + 0.5 - 27.5) ** 2 / 1.6 < 1.0:
            return SPK if (x == 46 and y == 26) else GLS[1] if y < 28 else GLS[0]
        return shade(n, OBS, 0.2)
    cv.ellipse(4, 4, 47.0, 30.0, 10.0, 6.5, bhelm, clip=lambda x, y: y < 33)   # helmet
    scx, scy, srx, sry = 31.0, 47.0, 24.0, 18.5
    N = 5

    def tval(x, y):
        n = ellipse_normal(x + 0.5, y + 0.5, scx, scy, srx, sry)
        if n is None: return None
        th = math.atan2(n[0], n[2])
        return (th + math.pi / 2) / (math.pi / N)

    def shell_col(x, y, n):
        t = tval(x, y); t2 = tval(x + 1, y) or t
        dt = abs(t2 - t) + 1e-3
        f = t - math.floor(t); dist = min(f, 1 - f) / dt
        band = int(math.floor(t))
        cap = n[0] < -0.82 or n[0] > 0.82 or n[1] < -0.86
        if dist < 1.1 or cap:
            return rib(n)
        return glass(n, band, f, dist)
    cv.ellipse(10, 1, scx, scy, srx, sry, shell_col)
    # tail toward viewer, bottom-left, with flame
    for k, (tx, ty, r) in enumerate([(13, 57, 4.6), (10, 52.5, 3.9), (8.5, 48, 3.3)]):
        cv.ellipse(11 + k, 4 + k % 2, tx, ty, r, r, (lambda k: lambda x, y, n: shade(n, OBS if k % 2 else SKN[1:], 0.05))(k))
    flame(cv, 15, 8.5, 44.5, 4.0, flick=1)
    cv.finish({1: OBS[0], 3: SKN[0], 4: OBS[0], 5: SKN[0], 9: FIR[0]})
    return cv.px


def save(px, path, pal):
    im = Image.fromarray(px.astype(np.uint8), 'P')
    flat = [c for rgb in pal for c in rgb]
    im.putpalette(flat + [0] * (768 - len(flat)))
    im.save(path, transparency=None)


def write_pal(path, pal):
    with open(path, 'w', newline='\r\n') as f:
        f.write('JASC-PAL\n0100\n16\n')
        for r, g, b in pal: f.write(f'{r} {g} {b}\n')


if __name__ == '__main__':
    out = sys.argv[1]
    f0 = draw_front(0); f1 = draw_front(1); bk = draw_back()
    save(f0, f'{out}/front.png', NORMAL)
    save(np.vstack([f0, f1]), f'{out}/anim_front.png', NORMAL)
    save(bk, f'{out}/back.png', NORMAL)
    write_pal(f'{out}/normal.pal', NORMAL)
    write_pal(f'{out}/shiny.pal', SHINY)
    # previews
    def prev(px, pal, s=6):
        im = Image.fromarray(px.astype(np.uint8), 'P'); flat = [c for rgb in pal for c in rgb]
        im.putpalette(flat + [0] * (768 - len(flat)))
        return im.convert('RGB').resize((px.shape[1] * s, px.shape[0] * s), Image.NEAREST)
    sheet = Image.new('RGB', (64 * 6 * 3 + 40, 64 * 6 * 2 + 30), (255, 255, 255))
    for i, (px, pal) in enumerate([(f0, NORMAL), (f1, NORMAL), (bk, NORMAL), (f0, SHINY), (f1, SHINY), (bk, SHINY)]):
        sheet.paste(prev(px, pal), ((i % 3) * (64 * 6 + 20), (i // 3) * (64 * 6 + 30)))
    sheet.save(f'{out}/preview.png')
