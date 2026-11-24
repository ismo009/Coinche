#!/usr/bin/env python3
"""Génère les icônes d'annonce (public/logo/COEUR|CARREAU|TREFLE|PIC|TA|SA.png).

Même style pixel-art arcade que les emotes (tools/generate-emotes.py) :
dessin sur une grille 24x24 (aplats francs, ombrage en bas à droite, reflet),
contour sombre épais + ombre dure, puis agrandissement NEAREST en 120x120.
Fond transparent, PNG optimisé (quelques centaines d'octets par icône).

Usage : python3 tools/generate-annonces.py [dossier_sortie]
Dépendance : Pillow.
"""
import os
import sys

from PIL import Image, ImageChops, ImageDraw

GRID = 24
OUT_SIZE = 120

# Palette du thème (public/style.css) — identique aux emotes.
OUTLINE = (15, 27, 30, 255)        # --panel-edge
SHADOW = (0, 0, 0, 90)
WHITE = (255, 248, 236, 255)       # --text
RED = (254, 95, 85, 255)           # --red
RED_DARK = (178, 58, 50, 255)
RED_LIGHT = (255, 170, 160, 255)
SLATE = (52, 75, 82, 255)          # cartes noires : ardoise du thème
SLATE_DARK = (30, 44, 49, 255)
SLATE_LIGHT = (120, 150, 158, 255)
GOLD = (255, 201, 74, 255)         # --gold
GOLD_DARK = (192, 138, 18, 255)
GOLD_LIGHT = (255, 228, 150, 255)
BLUE = (47, 155, 255, 255)         # --blue
BLUE_DARK = (23, 98, 180, 255)
BLUE_LIGHT = (140, 200, 255, 255)

# Silhouettes 18x18 ('#' = rempli), placées dans la grille 24x24.
SHAPES = {
    'COEUR': [
        "..................",
        "..####......####..",
        ".######....######.",
        "########..########",
        "##################",
        "##################",
        "##################",
        "##################",
        ".################.",
        "..##############..",
        "...############...",
        "....##########....",
        ".....########.....",
        "......######......",
        ".......####.......",
        "........##........",
        "..................",
        "..................",
    ],
    'CARREAU': [
        "........##........",
        ".......####.......",
        "......######......",
        ".....########.....",
        "....##########....",
        "...############...",
        "..##############..",
        ".################.",
        "##################",
        "##################",
        ".################.",
        "..##############..",
        "...############...",
        "....##########....",
        ".....########.....",
        "......######......",
        ".......####.......",
        "........##........",
    ],
    'TREFLE': [
        ".......####.......",
        "......######......",
        ".....########.....",
        ".....########.....",
        ".....########.....",
        "..####.####.####..",
        ".################.",
        "##################",
        "##################",
        "##################",
        ".######.##.######.",
        "..####..##..####..",
        "........##........",
        ".......####.......",
        "......######......",
        ".....########.....",
        "..................",
        "..................",
    ],
    'PIC': [
        "........##........",
        ".......####.......",
        "......######......",
        ".....########.....",
        "....##########....",
        "...############...",
        "..##############..",
        ".################.",
        "##################",
        "##################",
        "##################",
        ".######.##.######.",
        "..####..##..####..",
        "........##........",
        ".......####.......",
        "......######......",
        ".....########.....",
        "..................",
    ],
}

# Police pixel 3x5 (glyphes utiles).
FONT = {
    'T': ["111", "010", "010", "010", "010"],
    'A': ["010", "101", "111", "101", "101"],
    'S': ["011", "100", "010", "001", "110"],
}
GLYPH_W = 3


def new_layer():
    return Image.new('RGBA', (GRID, GRID), (0, 0, 0, 0))


def shift(mask, dx, dy):
    out = Image.new(mask.mode, mask.size, 0)
    out.paste(mask, (dx, dy))
    return out


def dilate(mask, radius=1):
    out = mask.copy()
    for dx in range(-radius, radius + 1):
        for dy in range(-radius, radius + 1):
            if dx * dx + dy * dy <= radius * radius + 1:
                out = ImageChops.lighter(out, shift(mask, dx, dy))
    return out


def finish(art, outline=2, shadow=1):
    """Contour sombre + ombre dure, puis agrandissement en OUT_SIZE."""
    alpha = art.getchannel('A').point(lambda a: 255 if a > 0 else 0)
    outer = dilate(alpha, outline)
    result = new_layer()
    if shadow:
        result.paste(Image.new('RGBA', (GRID, GRID), SHADOW), (0, 0), shift(outer, 0, shadow))
    result.paste(Image.new('RGBA', (GRID, GRID), OUTLINE), (0, 0), outer)
    result.alpha_composite(art)
    return result.resize((OUT_SIZE, OUT_SIZE), Image.NEAREST)


def draw_suit(name, base, dark, light):
    """Silhouette avec ombrage automatique (bas/droite) et petit reflet en haut à gauche."""
    art = new_layer()
    px = art.load()
    rows = SHAPES[name]
    h, w = len(rows), len(rows[0])
    ox, oy = (GRID - w) // 2, 2
    filled = {(x, y) for y, row in enumerate(rows) for x, ch in enumerate(row) if ch == '#'}
    for (x, y) in filled:
        edge = (x + 1, y) not in filled or (x, y + 1) not in filled or (x + 1, y + 1) not in filled
        px[ox + x, oy + y] = dark if edge else base
    # Reflet : 2 pixels en diagonale près du haut gauche de la masse principale.
    top = min(y for (_, y) in filled)
    candidates = sorted((y, x) for (x, y) in filled if y >= top + 2)
    for (y, x) in candidates:
        if (x + 1, y) in filled and (x + 1, y + 1) in filled and (x - 1, y) in filled:
            px[ox + x, oy + y] = light
            px[ox + x + 1, oy + y] = light
            px[ox + x, oy + y + 1] = light
            break
    return finish(art)


def draw_text(img, text, x, y, color, scale=2, spacing=1):
    d = ImageDraw.Draw(img)
    cx = x
    for ch in text:
        for ry, row in enumerate(FONT[ch]):
            for rx, bit in enumerate(row):
                if bit == '1':
                    d.rectangle([cx + rx * scale, y + ry * scale,
                                 cx + rx * scale + scale - 1, y + ry * scale + scale - 1], fill=color)
        cx += GLYPH_W * scale + spacing * scale


def draw_badge(text, base, dark, light, ink, ink_shadow):
    """Pastille arrondie (style bouton arcade) avec 2 lettres pixel."""
    art = new_layer()
    d = ImageDraw.Draw(art)
    x0, y0, x1, y1 = 1, 4, 22, 19
    d.rounded_rectangle([x0, y0, x1, y1], radius=4, fill=dark)          # épaisseur "3D"
    d.rounded_rectangle([x0, y0, x1, y1 - 2], radius=4, fill=base)
    d.rectangle([x0 + 3, y0 + 1, x0 + 7, y0 + 1], fill=light)          # reflet
    scale = 2
    width = len(text) * GLYPH_W * scale + (len(text) - 1) * scale
    tx = x0 + (x1 - x0 + 1 - width) // 2
    ty = y0 + 2
    draw_text(art, text, tx, ty + 1, ink_shadow, scale)
    draw_text(art, text, tx, ty, ink, scale)
    return finish(art)


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'public', 'logo')
    os.makedirs(out_dir, exist_ok=True)
    icons = {
        'COEUR': draw_suit('COEUR', RED, RED_DARK, RED_LIGHT),
        'CARREAU': draw_suit('CARREAU', RED, RED_DARK, RED_LIGHT),
        'TREFLE': draw_suit('TREFLE', SLATE, SLATE_DARK, SLATE_LIGHT),
        'PIC': draw_suit('PIC', SLATE, SLATE_DARK, SLATE_LIGHT),
        'TA': draw_badge('TA', GOLD, GOLD_DARK, GOLD_LIGHT, OUTLINE, GOLD_DARK),
        'SA': draw_badge('SA', BLUE, BLUE_DARK, BLUE_LIGHT, WHITE, BLUE_DARK),
    }
    for name, img in icons.items():
        path = os.path.join(out_dir, f'{name}.png')
        img.save(path, optimize=True)
        print(f'{path} ({os.path.getsize(path)} octets)')


if __name__ == '__main__':
    main()
