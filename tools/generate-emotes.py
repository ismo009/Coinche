#!/usr/bin/env python3
"""Génère les emotes de départ de Cari'Coinche (public/emotes/*.png).

Style pixel-art arcade : chaque emote est dessinée sur une grille 64x64
(aplats francs, sans anticrénelage), entourée automatiquement d'un contour
sombre épais et d'une ombre dure, puis agrandie en NEAREST jusqu'à 256x256.
Fond transparent, PNG RGBA optimisé.

Usage : python3 tools/generate-emotes.py [dossier_sortie]
Dépendance : Pillow.
"""
import math
import os
import sys

from PIL import Image, ImageChops, ImageDraw

GRID = 64
OUT_SIZE = 256

# Palette du thème (public/style.css)
OUTLINE = (15, 27, 30, 255)       # --panel-edge
SHADOW = (0, 0, 0, 90)
WHITE = (255, 248, 236, 255)      # --text
RED = (254, 95, 85, 255)
RED_DARK = (178, 58, 50, 255)
BLUE = (47, 155, 255, 255)
BLUE_DARK = (23, 98, 180, 255)
GOLD = (255, 201, 74, 255)
GOLD_DARK = (192, 138, 18, 255)
GOLD_LIGHT = (255, 228, 150, 255)
GREEN = (63, 194, 134, 255)
GREEN_DARK = (34, 128, 90, 255)
PURPLE = (143, 107, 255, 255)
PURPLE_DARK = (90, 60, 196, 255)
PINK = (255, 150, 140, 255)

# Police pixel 5x7 (seulement les glyphes utiles).
FONT = {
    'G': ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
    'C': ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    'O': ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    'I': ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    'N': ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    'H': ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    'E': ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    'Z': ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    '!': ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
}


def new_layer():
    return Image.new('RGBA', (GRID, GRID), (0, 0, 0, 0))


def text_width(text, scale=1, spacing=1):
    return sum((5 if ch != ' ' else 3) * scale + spacing * scale for ch in text) - spacing * scale


def draw_text(img, text, x, y, color, scale=1, spacing=1):
    d = ImageDraw.Draw(img)
    cx = x
    for ch in text:
        if ch == ' ':
            cx += 3 * scale + spacing * scale
            continue
        rows = FONT[ch]
        for ry, row in enumerate(rows):
            for rx, bit in enumerate(row):
                if bit == '1':
                    d.rectangle([cx + rx * scale, y + ry * scale,
                                 cx + rx * scale + scale - 1, y + ry * scale + scale - 1], fill=color)
        cx += 5 * scale + spacing * scale


def shift(mask, dx, dy):
    """Décale un masque sans le faire boucler sur les bords (contrairement à ImageChops.offset)."""
    out = Image.new(mask.mode, mask.size, 0)
    out.paste(mask, (dx, dy))
    return out


def dilate(mask, radius=2):
    """Dilatation en disque (pixel-art) d'un masque 'L'."""
    out = mask.copy()
    for dx in range(-radius, radius + 1):
        for dy in range(-radius, radius + 1):
            if dx * dx + dy * dy <= radius * radius + 1:
                out = ImageChops.lighter(out, shift(mask, dx, dy))
    return out


def finish(art, outline=2, shadow=2):
    """Ajoute contour sombre + ombre dure sous le dessin, puis agrandit en 256x256."""
    alpha = art.getchannel('A').point(lambda a: 255 if a > 0 else 0)
    outer = dilate(alpha, outline)
    result = new_layer()
    if shadow:
        shadow_mask = shift(outer, 0, shadow)
        result.paste(Image.new('RGBA', (GRID, GRID), SHADOW), (0, 0), shadow_mask)
    result.paste(Image.new('RGBA', (GRID, GRID), OUTLINE), (0, 0), outer)
    result.alpha_composite(art)
    return result.resize((OUT_SIZE, OUT_SIZE), Image.NEAREST)


def sparkle(d, x, y, color, size=2):
    d.rectangle([x - size, y, x + size, y], fill=color)
    d.rectangle([x, y - size, x, y + size], fill=color)


# ---------------------------------------------------------------- emotes

def emote_gg():
    art = new_layer()
    d = ImageDraw.Draw(art)
    # Bulle de dialogue bleue avec queue
    d.rounded_rectangle([5, 10, 58, 46], radius=7, fill=BLUE)
    d.polygon([(14, 44), (24, 44), (12, 56)], fill=BLUE)
    d.rectangle([9, 40, 54, 44], fill=BLUE_DARK)
    d.rounded_rectangle([5, 10, 58, 41], radius=7, fill=BLUE)
    d.rectangle([10, 14, 20, 15], fill=(120, 190, 255, 255))
    # "GG" doré, ombre sombre décalée
    w = text_width('GG', scale=3, spacing=1)
    x = (GRID - w) // 2 + 1
    for ox in (-1, 0, 1):
        for oy in (-1, 0, 1, 2):
            draw_text(art, 'GG', x + ox, 15 + oy, OUTLINE, scale=3)
    draw_text(art, 'GG', x, 16, GOLD_DARK, scale=3)
    draw_text(art, 'GG', x, 15, GOLD, scale=3)
    # Étincelles
    sparkle(d, 57, 6, GOLD, 3)
    sparkle(d, 50, 55, WHITE, 2)
    return finish(art)


def face_base(d, color=GOLD, dark=GOLD_DARK, light=GOLD_LIGHT, cx=32, cy=34, r=24):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=dark)
    d.ellipse([cx - r, cy - r, cx + r - 2, cy + r - 4], fill=color)
    # reflet
    d.rectangle([cx - r + 8, cy - r + 6, cx - r + 12, cy - r + 7], fill=light)
    d.rectangle([cx - r + 6, cy - r + 8, cx - r + 7, cy - r + 12], fill=light)


def emote_rire():
    art = new_layer()
    d = ImageDraw.Draw(art)
    face_base(d)
    # Yeux plissés "^ ^"
    for ex in (21, 43):
        d.line([(ex - 5, 29), (ex, 24), (ex + 5, 29)], fill=OUTLINE, width=3)
    # Grande bouche ouverte
    d.chord([16, 30, 48, 54], 0, 180, fill=OUTLINE)
    d.rectangle([18, 42, 46, 44], fill=WHITE)
    d.chord([24, 46, 40, 56], 180, 360, fill=RED)
    d.rectangle([24, 50, 40, 51], fill=RED)
    d.chord([16, 30, 48, 54], 0, 180, outline=OUTLINE, width=2)
    # Larmes de joie
    for x, flip in ((7, 1), (57, -1)):
        d.polygon([(x, 26), (x - 3 * flip, 34), (x + 3 * flip, 34)], fill=BLUE)
        d.ellipse([x - 4, 31, x + 4, 39], fill=BLUE)
        d.rectangle([x - 2, 33, x - 1, 35], fill=WHITE)
    return finish(art)


def emote_colere():
    art = new_layer()
    d = ImageDraw.Draw(art)
    face_base(d, RED, RED_DARK, PINK)
    # Sourcils froncés
    d.polygon([(11, 22), (27, 28), (27, 32), (11, 26)], fill=OUTLINE)
    d.polygon([(53, 22), (37, 28), (37, 32), (53, 26)], fill=OUTLINE)
    # Yeux
    d.rectangle([18, 30, 24, 36], fill=WHITE)
    d.rectangle([21, 32, 24, 36], fill=OUTLINE)
    d.rectangle([40, 30, 46, 36], fill=WHITE)
    d.rectangle([40, 32, 43, 36], fill=OUTLINE)
    # Bouche en grimace (dents serrées)
    d.rectangle([20, 43, 44, 50], fill=OUTLINE)
    d.rectangle([22, 45, 42, 48], fill=WHITE)
    for x in (27, 32, 37):
        d.rectangle([x, 45, x, 48], fill=OUTLINE)
    # Veine de colère
    vx, vy = 49, 12
    for dx, dy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        d.line([(vx + dx * 2, vy + dy * 2), (vx + dx * 5, vy + dy * 5)], fill=RED_DARK, width=2)
    return finish(art)


def emote_coeur():
    art = new_layer()
    d = ImageDraw.Draw(art)
    # Coeur pixel : deux cercles + triangle
    d.ellipse([7, 10, 33, 36], fill=RED_DARK)
    d.ellipse([31, 10, 57, 36], fill=RED_DARK)
    d.polygon([(8, 27), (56, 27), (32, 56)], fill=RED_DARK)
    d.ellipse([7, 10, 32, 34], fill=RED)
    d.ellipse([31, 10, 55, 34], fill=RED)
    d.polygon([(8, 25), (54, 25), (32, 51)], fill=RED)
    # Reflets
    d.rectangle([13, 16, 18, 18], fill=WHITE)
    d.rectangle([12, 19, 14, 22], fill=WHITE)
    d.rectangle([40, 15, 42, 16], fill=PINK)
    # Étincelles dorées
    sparkle(d, 58, 6, GOLD, 3)
    sparkle(d, 6, 50, GOLD, 2)
    return finish(art)


def emote_oups():
    art = new_layer()
    d = ImageDraw.Draw(art)
    face_base(d)
    # Yeux ronds
    for ex in (22, 42):
        d.ellipse([ex - 5, 25, ex + 5, 35], fill=WHITE)
        d.rectangle([ex - 2, 28, ex + 1, 32], fill=OUTLINE)
    # Bouche en vague
    pts = [(18, 47), (22, 44), (26, 47), (30, 44), (34, 47), (38, 44), (42, 47), (46, 44)]
    d.line(pts, fill=OUTLINE, width=3)
    # Goutte de sueur
    d.polygon([(51, 6), (44, 20), (58, 20)], fill=BLUE)
    d.ellipse([44, 14, 58, 28], fill=BLUE)
    d.ellipse([47, 22, 58, 28], fill=BLUE_DARK)
    d.ellipse([44, 14, 56, 26], fill=BLUE)
    d.rectangle([47, 17, 48, 21], fill=WHITE)
    return finish(art)


def emote_dodo():
    art = new_layer()
    d = ImageDraw.Draw(art)
    face_base(d, cx=27, cy=39, r=20)
    # Yeux fermés
    for ex in (19, 35):
        d.arc([ex - 5, 32, ex + 5, 40], 20, 160, fill=OUTLINE, width=2)
    # Petite bouche + bulle de nez
    d.ellipse([22, 46, 28, 52], fill=OUTLINE)
    d.ellipse([33, 42, 43, 52], fill=(170, 215, 255, 255))
    d.rectangle([35, 44, 36, 45], fill=WHITE)
    # Bonnet de nuit violet
    d.polygon([(8, 27), (46, 27), (50, 8)], fill=PURPLE)
    d.polygon([(8, 27), (46, 27), (28, 18)], fill=PURPLE_DARK)
    d.rounded_rectangle([6, 24, 48, 30], radius=3, fill=WHITE)
    d.ellipse([45, 3, 55, 13], fill=WHITE)
    # Zzz
    draw_text(art, 'Z', 49, 23, BLUE, scale=2)
    draw_text(art, 'Z', 53, 42, BLUE, scale=1)
    return finish(art)


def emote_bravo():
    art = new_layer()
    d = ImageDraw.Draw(art)
    # Manche bleue
    d.rectangle([5, 30, 17, 57], fill=BLUE)
    d.rectangle([5, 30, 8, 57], fill=BLUE_DARK)
    d.rectangle([14, 30, 17, 57], fill=(120, 190, 255, 255))
    # Poing
    d.rounded_rectangle([18, 28, 50, 58], radius=6, fill=GOLD_DARK)
    d.rounded_rectangle([18, 28, 48, 56], radius=6, fill=GOLD)
    # Pouce levé
    d.rounded_rectangle([19, 4, 31, 34], radius=6, fill=GOLD_DARK)
    d.rounded_rectangle([19, 4, 29, 33], radius=5, fill=GOLD)
    d.rectangle([22, 8, 23, 16], fill=GOLD_LIGHT)
    # Doigts repliés
    for y in (35, 42, 49):
        d.line([(33, y), (49, y)], fill=OUTLINE, width=2)
    d.line([(31, 28), (31, 56)], fill=GOLD_DARK, width=1)
    # Étincelles
    sparkle(d, 46, 10, GOLD, 3)
    sparkle(d, 57, 22, GREEN, 3)
    sparkle(d, 40, 3, WHITE, 1)
    return finish(art)


def emote_coinche():
    art = new_layer()
    d = ImageDraw.Draw(art)
    # Tampon rouge : cadre double, texte "COINCHE !"
    d.rounded_rectangle([4, 12, 59, 52], radius=4, fill=RED_DARK)
    d.rounded_rectangle([4, 12, 59, 50], radius=4, fill=RED)
    d.rounded_rectangle([7, 15, 56, 47], radius=2, fill=WHITE)
    d.rounded_rectangle([9, 17, 54, 45], radius=2, fill=RED)
    w1 = text_width('COIN', scale=2)
    draw_text(art, 'COIN', (GRID - w1) // 2 + 1, 20, RED_DARK, scale=2)
    draw_text(art, 'COIN', (GRID - w1) // 2, 19, WHITE, scale=2)
    w2 = text_width('CHE!', scale=2)
    draw_text(art, 'CHE!', (GRID - w2) // 2 + 1, 34, RED_DARK, scale=2)
    draw_text(art, 'CHE!', (GRID - w2) // 2, 33, GOLD, scale=2)
    # Étincelles d'impact
    sparkle(d, 58, 6, GOLD, 3)
    sparkle(d, 6, 58, GOLD, 2)
    return finish(art)


EMOTES = {
    'gg': emote_gg,
    'bravo': emote_bravo,
    'rire': emote_rire,
    'colere': emote_colere,
    'coeur': emote_coeur,
    'oups': emote_oups,
    'coinche': emote_coinche,
    'dodo': emote_dodo,
}


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, 'public', 'emotes')
    os.makedirs(out_dir, exist_ok=True)
    for name, fn in EMOTES.items():
        img = fn()
        path = os.path.join(out_dir, f'{name}.png')
        img.save(path, format='PNG', optimize=True)
        print(f'{path} ({os.path.getsize(path)} octets)')


if __name__ == '__main__':
    main()
