#!/usr/bin/env python3
import argparse
from collections import deque
from pathlib import Path
import sys

try:
    from PIL import Image
except ImportError:
    print("Pillow is required. Install it with: pip install pillow")
    raise SystemExit(1)


COINCHE_RANKS = ["SEPT", "HUIT", "NEUF", "DIX", "VALET", "DAME", "ROI", "AS"]
COINCHE_SUITS_BY_ROW = ["COEUR", "TREFLE", "CARREAU", "PIC"]


def parse_hex_color(value: str):
    clean = value.strip().lstrip("#")
    if len(clean) != 6:
        raise ValueError("separator color must be a 6-digit hex value, e.g. 696969")
    return tuple(int(clean[i:i + 2], 16) for i in (0, 2, 4))


def find_default_input(script_dir: Path):
    candidates = [
        script_dir / "template.png",
        script_dir / "Template.png",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def component_boxes(mask, width, height, min_pixels):
    visited = bytearray(width * height)
    boxes = []

    def idx(x, y):
        return y * width + x

    for y in range(height):
        for x in range(width):
            i = idx(x, y)
            if visited[i] or not mask[i]:
                continue

            queue = deque([(x, y)])
            visited[i] = 1

            min_x = max_x = x
            min_y = max_y = y
            count = 0

            while queue:
                cx, cy = queue.popleft()
                count += 1

                if cx < min_x:
                    min_x = cx
                if cx > max_x:
                    max_x = cx
                if cy < min_y:
                    min_y = cy
                if cy > max_y:
                    max_y = cy

                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if nx < 0 or ny < 0 or nx >= width or ny >= height:
                        continue
                    ni = idx(nx, ny)
                    if visited[ni] or not mask[ni]:
                        continue
                    visited[ni] = 1
                    queue.append((nx, ny))

            if count >= min_pixels:
                boxes.append((min_x, min_y, max_x, max_y, count))

    return boxes


def sort_boxes_row_major(boxes, row_tolerance):
    if not boxes:
        return []

    boxes = sorted(boxes, key=lambda b: (b[1], b[0]))
    rows = []

    for box in boxes:
        y = box[1]
        if not rows:
            rows.append([box])
            continue

        # Group cards that are roughly on the same row.
        row_anchor = rows[-1][0][1]
        if abs(y - row_anchor) <= row_tolerance:
            rows[-1].append(box)
        else:
            rows.append([box])

    ordered = []
    for row in rows:
        ordered.extend(sorted(row, key=lambda b: b[0]))
    return ordered


def build_filenames(count, naming_mode):
    if naming_mode == "sequential":
        return [f"card_{i + 1:02d}.png" for i in range(count)]

    if naming_mode in {"coinche", "auto"} and count == 32:
        names = []
        for suit in COINCHE_SUITS_BY_ROW:
            for rank in COINCHE_RANKS:
                names.append(f"{rank}_{suit}.png")
        return names

    if naming_mode == "coinche":
        raise ValueError("coinche naming requires exactly 32 detected cards")

    return [f"card_{i + 1:02d}.png" for i in range(count)]


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Split a card template image into separate files. Cards are detected "
            "as connected components separated by a delimiter color."
        )
    )
    parser.add_argument(
        "--input",
        "-i",
        default=None,
        help="Input template image path (default: template.png/Template.png next to this script).",
    )
    parser.add_argument(
        "--output",
        "-o",
        default=None,
        help="Output folder (default: <script-folder>/exported).",
    )
    parser.add_argument(
        "--separator",
        default="696969",
        help="Hex color used to separate cards (default: 696969).",
    )
    parser.add_argument(
        "--min-pixels",
        type=int,
        default=500,
        help="Minimum connected component size to keep (default: 500).",
    )
    parser.add_argument(
        "--row-tolerance",
        type=int,
        default=10,
        help="Tolerance in pixels to group cards by row for left-to-right naming (default: 10).",
    )
    parser.add_argument(
        "--naming",
        choices=["auto", "coinche", "sequential"],
        default="auto",
        help="Output naming mode (default: auto).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Detect cards and print planned outputs without writing files.",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    script_dir = Path(__file__).resolve().parent

    input_path = Path(args.input).resolve() if args.input else find_default_input(script_dir)
    output_dir = Path(args.output).resolve() if args.output else (script_dir / "exported")

    if not input_path.exists():
        print(f"Input image not found: {input_path}")
        return 1

    try:
        separator_rgb = parse_hex_color(args.separator)
    except ValueError as exc:
        print(f"Invalid separator color: {exc}")
        return 1

    try:
        with Image.open(input_path) as img:
            rgba = img.convert("RGBA")
            width, height = rgba.size
            pixels = rgba.load()

            mask = bytearray(width * height)
            for y in range(height):
                row_start = y * width
                for x in range(width):
                    r, g, b, a = pixels[x, y]
                    is_separator = (r, g, b) == separator_rgb and a > 0
                    # Keep everything except separator lines.
                    mask[row_start + x] = 0 if is_separator else 1

            raw_boxes = component_boxes(mask, width, height, max(1, args.min_pixels))
            boxes = sort_boxes_row_major(raw_boxes, max(0, args.row_tolerance))

            if not boxes:
                print("No card component detected. Check separator color and min-pixels.")
                return 1

            try:
                filenames = build_filenames(len(boxes), args.naming)
            except ValueError as exc:
                print(f"Naming error: {exc}")
                return 1

            print(f"Detected {len(boxes)} cards in {input_path.name}")

            if args.dry_run:
                for i, box in enumerate(boxes):
                    min_x, min_y, max_x, max_y, count = box
                    w = max_x - min_x + 1
                    h = max_y - min_y + 1
                    print(f"[DRY-RUN] {filenames[i]}: box=({min_x},{min_y})-({max_x},{max_y}), size={w}x{h}, pixels={count}")
                return 0

            output_dir.mkdir(parents=True, exist_ok=True)
            for i, box in enumerate(boxes):
                min_x, min_y, max_x, max_y, _ = box
                crop = rgba.crop((min_x, min_y, max_x + 1, max_y + 1))
                target = output_dir / filenames[i]
                crop.save(target, format="PNG")
                print(f"[SAVED] {target}")

            print("Done.")
            return 0

    except OSError as exc:
        print(f"Failed to process image: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
