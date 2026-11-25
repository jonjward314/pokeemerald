#!/usr/bin/env python3
"""Pixel-art renderer for Zeroid (front, anim frame, back, palettes).

Usage: python3 tools/zeroid/draw.py graphics/pokemon/zeroid
Writes front.png, anim_front.png, back.png, normal.pal, shiny.pal and preview.png
(the preview is not used by the game). Then run icon.py and cry.py.
"""
import math, sys
import numpy as np
from PIL import Image, ImageDraw

W = H = 64
BG, OUT = 0, 1
RED = [2, 3, 4]
HAIR = [5, 6, 7]
WHITE = [12, 8, 8]
SUIT = [9, 9, 10]
BLUE = [9, 10, 10]
SKIN = [12, 11, 11]
SABER = [13, 14, 15]
GREY = [9, 12, 8]

NORMAL = [
    (152, 208, 160),  # 0 bg
    (24, 16, 40),     # 1 outline
    (128, 24, 40), (208, 40, 48), (248, 120, 96),     # red armour
    (176, 112, 32), (240, 192, 64), (248, 240, 160),  # hair
    (248, 248, 248),  # 8 white
    (40, 40, 80),     # 9 suit
    (64, 120, 224),   # 10 blue
    (248, 208, 168),  # 11 skin
    (176, 168, 184),  # 12 grey / shade
    (24, 144, 64), (96, 232, 96), (216, 255, 200),    # saber
]
SHINY = list(NORMAL)
SHINY[2:5] = [(32, 24, 48), (72, 56, 104), (128, 112, 168)]  # dark armour
SHINY[13:16] = [(120, 40, 160), (200, 104, 240), (248, 216, 255)]  # violet saber


class Canvas:
    def __init__(s, w=W, h=H):
        s.w, s.h = w, h
        s.px = np.zeros((h, w), np.int16)
        s.sid = np.full((h, w), -1, np.int16)
        s.mat = np.zeros((h, w), np.int16)
        s.n = 0
        s.ramps = {}

    def _mask(s, fn):
        im = Image.new('L', (s.w, s.h), 0)
        fn(ImageDraw.Draw(im))
        return np.array(im) > 0

    def part(s, mask, ramp, light=True, core=None):
        s.n += 1
        mid = ramp[1]
        ys, xs = np.nonzero(mask)
        for y, x in zip(ys, xs):
            def out(a, b):
                return not (0 <= x + a < s.w and 0 <= y + b < s.h) or not mask[y + b, x + a]
            c = mid
            if light and (out(-1, 0) or out(0, -1) or out(-1, -1)) and not (out(1, 0) or out(0, 1)):
                c = ramp[2]
            if out(1, 0) or out(0, 1) or out(1, 1):
                c = ramp[0]
            s.px[y, x] = c; s.sid[y, x] = s.n; s.mat[y, x] = id(ramp) % 30000
        s.ramps[id(ramp) % 30000] = ramp

    def poly(s, pts, ramp, **k):
        s.part(s._mask(lambda d: d.polygon(pts, fill=1)), ramp, **k)

    def ell(s, cx, cy, rx, ry, ramp, **k):
        s.part(s._mask(lambda d: d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=1)), ramp, **k)

    def cap(s, pts, wd, ramp, **k):
        def f(d):
            d.line(pts, fill=1, width=wd, joint='curve')
            for x, y in (pts[0], pts[-1]):
                r = wd / 2 - 0.5
                d.ellipse([x - r, y - r, x + r, y + r], fill=1)
        s.part(s._mask(f), ramp, **k)

    def dot(s, x, y, c):
        if 0 <= x < s.w and 0 <= y < s.h: s.px[y, x] = c

    def line(s, pts, c, wd=1, own=False):
        m = s._mask(lambda d: d.line(pts, fill=1, width=wd))
        s.px[m & ((s.sid == s.n) if own else (s.sid >= 0))] = c

    def finish(s, glow_mats=()):
        o = s.px.copy()
        for y in range(s.h):
            for x in range(s.w):
                if s.sid[y, x] < 0: continue
                me = s.mat[y, x]
                for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    if not (0 <= x + a < s.w and 0 <= y + b < s.h) or s.sid[y + b, x + a] < 0:
                        o[y, x] = s.ramps[me][0] if me in glow_mats else OUT; break
                    if s.sid[y + b, x + a] < s.sid[y, x] and s.mat[y + b, x + a] != me:
                        o[y, x] = s.ramps[me][0] if me in glow_mats else OUT; break
        s.px = o
        return o

def mid(r): return id(r) % 30000


def saber(cv, hx, hy, ang, ln, hilt=4):
    """Hilt at (hx,hy), blade toward angle ang (deg, 0=right, 90=up)."""
    dx, dy = math.cos(math.radians(ang)), -math.sin(math.radians(ang))
    tip = (hx + dx * ln, hy + dy * ln)
    base = (hx + dx * 1, hy + dy * 1)
    cv.cap([base, tip], 4, SABER, light=False)
    # bright core down the middle
    cv.line([(hx + dx * 3, hy + dy * 3), (hx + dx * (ln - 2), hy + dy * (ln - 2))], 15)
    cv.cap([(hx - dx * hilt, hy - dy * hilt), (hx + dx * 0.5, hy + dy * 0.5)], 3, GREY, light=False)


def hair(cv, root, sway=0.0, dx=20, dy=36, w0=5.5):
    """Long flowing hair: a wavy tapered ribbon from root."""
    rx, ry = root
    N = 16
    def ctr(t):
        return (rx + dx * t + 2.5 * math.sin(t * 5.5 + sway) * (1 if dx >= 0 else -1),
                ry + dy * t + 1.5 * math.sin(t * 4 + sway))
    left, right = [], []
    for i in range(N + 1):
        t = i / N
        x, y = ctr(t)
        x2, y2 = ctr(min(1, t + 0.01)); x1, y1 = ctr(max(0, t - 0.01))
        tx, ty = x2 - x1, y2 - y1; L = math.hypot(tx, ty) or 1
        nx, ny = -ty / L, tx / L
        wdt = w0 * (1 - t) ** 0.8 + 0.6
        left.append((x + nx * wdt, y + ny * wdt)); right.append((x - nx * wdt, y - ny * wdt))
    cv.poly(left + right[::-1], HAIR)
    for off in (-0.45, 0.2):
        pts = []
        for i in range(1, N - 2):
            t = i / N
            x, y = ctr(t)
            x2, y2 = ctr(t + 0.01); tx, ty = x2 - x, y2 - y; L = math.hypot(tx, ty) or 1
            wdt = w0 * (1 - t) ** 0.8
            pts.append((x - ty / L * wdt * off, y + tx / L * wdt * off))
        cv.line(pts, 5, own=True)


def draw_front(frame=0):
    cv = Canvas()
    sw = 0.0 if frame == 0 else 1.2
    # long hair streaming behind to the right
    hair(cv, (38, 9), sw, dx=19, dy=40, w0=6.5)
    # back arm (viewer's right), fist at hip
    cv.cap([(42, 24), (46, 30)], 5, SUIT)
    cv.cap([(46, 30), (45, 36)], 6, RED)
    cv.poly([(42, 34), (48, 34), (48, 36), (42, 36)], WHITE)
    cv.ell(45, 39, 2.5, 2.5, SUIT)
    # back leg (viewer's right), angled out
    cv.cap([(37, 38), (41, 46)], 7, SUIT)
    cv.poly([(37, 46), (44, 45), (46, 55), (49, 59), (49, 62), (39, 62), (39, 55)], RED)
    cv.poly([(37, 45), (44, 44), (45, 47), (37, 48)], WHITE)
    # front leg (viewer's left), knee bent forward
    cv.cap([(31, 38), (25, 45)], 7, SUIT)
    cv.poly([(21, 45), (29, 44), (30, 54), (29, 62), (17, 62), (17, 59), (22, 55)], RED)
    cv.poly([(21, 44), (29, 43), (29, 46), (21, 47)], WHITE)
    # waist
    cv.poly([(28, 33), (40, 33), (41, 39), (27, 39)], SUIT)
    cv.poly([(31, 34), (36, 34), (36, 37), (31, 37)], WHITE)
    cv.ell(33.5, 35.5, 1.2, 1.2, BLUE)
    # torso armour
    cv.poly([(27, 21), (41, 21), (42, 27), (39, 34), (29, 34), (26, 27)], RED)
    cv.poly([(31, 21), (37, 21), (36, 24), (32, 24)], SUIT)  # collar
    cv.line([(29, 27), (33, 31), (34, 31), (38, 27)], 8)  # chest trim
    cv.ell(33.5, 27.5, 1.6, 1.6, BLUE)
    # shoulders
    cv.ell(43, 23, 3.8, 3.5, RED)
    cv.ell(25, 23, 4.5, 4, RED)
    # head: helmet
    cv.ell(33, 12, 7.5, 7, RED)
    # swept-back fins
    cv.poly([(26, 8), (29, 4), (36, -1), (39, 0), (33, 6), (30, 9)], WHITE)
    cv.poly([(33, 7), (38, 3), (47, 0), (47, 3), (41, 6), (37, 9)], WHITE)
    # face
    cv.poly([(27, 12), (35, 12), (35, 17), (32, 20), (28, 19), (26, 16)], SKIN)
    # fringe
    cv.poly([(26, 9), (36, 9), (35, 13), (33, 11), (31, 14), (29, 11), (27, 14), (26, 12)], HAIR)
    # helmet brow + gem
    cv.poly([(25, 7), (38, 7), (37, 10), (26, 10)], RED)
    cv.ell(31.5, 8.5, 1.5, 1.5, BLUE)
    # ear disc
    cv.ell(37.5, 13.5, 2.2, 2.7, WHITE)
    cv.dot(37, 13, 10)
    # front arm (viewer's left) reaching forward to the hilt
    cv.cap([(25, 25), (21, 30)], 5, SUIT)
    cv.cap([(21, 30), (17, 33)], 6, RED)
    saber(cv, 15, 34, 112 if frame == 0 else 124, 31)
    cv.ell(16, 34, 2.5, 2.5, SUIT)
    px = cv.finish(glow_mats=(mid(SABER),))
    # eyes (looking left)
    for x in (28, 32):
        px[14, x] = 1; px[15, x] = 10
    px[18, 30] = 12  # mouth shade
    return px


def draw_back():
    cv = Canvas()
    # seen from behind, larger and cut off at the waist
    # left arm (viewer's left)
    cv.cap([(17, 34), (12, 44)], 8, SUIT)
    cv.cap([(12, 44), (11, 54)], 9, RED)
    cv.poly([(6, 50), (16, 50), (16, 53), (6, 53)], WHITE)
    cv.ell(11, 57, 4, 3.5, SUIT)
    # right arm raised with the saber
    cv.cap([(47, 34), (53, 42)], 8, SUIT)
    cv.cap([(53, 42), (55, 49)], 9, RED)
    # back armour
    cv.poly([(19, 31), (45, 31), (47, 50), (43, 64), (21, 64), (17, 50)], RED)
    cv.poly([(20, 55), (44, 55), (43, 64), (21, 64)], SUIT)
    cv.ell(16, 33, 7, 6, RED)
    cv.ell(48, 33, 7, 6, RED)
    cv.poly([(27, 27), (37, 27), (38, 32), (26, 32)], SUIT)  # neck
    # helmet back
    cv.ell(32, 17, 11, 10.5, RED)
    cv.poly([(25, 11), (18, 3), (20, 1), (24, 3), (30, 8)], WHITE)
    cv.poly([(34, 8), (40, 3), (44, 1), (46, 3), (39, 11)], WHITE)
    cv.ell(21.5, 19, 2.6, 3.6, WHITE)
    cv.ell(42.5, 19, 2.6, 3.6, WHITE)
    # hair: thick ponytail down the back
    hair(cv, (32, 19), 0.6, dx=-6, dy=44, w0=8.5)
    saber(cv, 56, 50, 76, 44, hilt=5)
    cv.ell(56, 50, 3.5, 3.5, SUIT)
    return cv.finish(glow_mats=(mid(SABER),))


def save(px, path, pal):
    im = Image.fromarray(px.astype(np.uint8), 'P')
    flat = [c for rgb in pal for c in rgb]
    im.putpalette(flat + [0] * (768 - len(flat)))
    im.save(path)


def write_pal(path, pal):
    with open(path, 'w', newline='\r\n') as f:
        f.write('JASC-PAL\n0100\n16\n')
        for r, g, b in pal: f.write(f'{r} {g} {b}\n')


def prev(px, pal, s=5):
    im = Image.fromarray(px.astype(np.uint8), 'P'); flat = [c for rgb in pal for c in rgb]
    im.putpalette(flat + [0] * (768 - len(flat)))
    return im.convert('RGB').resize((px.shape[1] * s, px.shape[0] * s), Image.NEAREST)


if __name__ == '__main__':
    out = sys.argv[1]
    f0, f1, bk = draw_front(0), draw_front(1), draw_back()
    save(f0, f'{out}/front.png', NORMAL)
    save(np.vstack([f0, f1]), f'{out}/anim_front.png', NORMAL)
    save(bk, f'{out}/back.png', NORMAL)
    write_pal(f'{out}/normal.pal', NORMAL)
    write_pal(f'{out}/shiny.pal', SHINY)
    sheet = Image.new('RGB', (3 * 64 * 5 + 40, 2 * 64 * 5 + 20), (255, 255, 255))
    for i, (px, pal) in enumerate([(f0, NORMAL), (f1, NORMAL), (bk, NORMAL), (f0, SHINY), (f1, SHINY), (bk, SHINY)]):
        sheet.paste(prev(px, pal), ((i % 3) * (64 * 5 + 20), (i // 3) * (64 * 5 + 20)))
    sheet.save(f'{out}/preview.png')
