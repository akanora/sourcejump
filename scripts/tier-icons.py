"""Draws the tier icons the Discord record feed shows next to a map's name (web/public/tiers/t0.png to t10.png).
Rerun it to change them. Discord crops these icons to a circle, so each is a disc with its label inside it. The
colours are the old site's, green (easy) to red (hard); T0, which it never had, comes before them in teal.

Needs Pillow and DejaVu Sans Bold (fonts-dejavu-core on Debian and Ubuntu).
usage: python3 scripts/tier-icons.py web/public/tiers
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

COLOURS = [
    "#00e6a0", "#35ff00", "#6aff00", "#9fff00", "#d4ff00", "#fff600",
    "#ffc100", "#ff8c00", "#ff5700", "#ff2300", "#ff1100",
]
SIZE = 128
# Drawn at four times the size and scaled down, for smooth edges.
SCALE = 4
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def icon(tier: int, colour: str) -> Image.Image:
    big = SIZE * SCALE
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse((0, 0, big - 1, big - 1), fill=colour)
    label = f"T{tier}"
    # Two-digit labels get a smaller font so they stay inside the circle.
    font = ImageFont.truetype(FONT, int(big * (0.40 if len(label) == 2 else 0.33)))
    draw.text((big / 2, big / 2), label, font=font, fill="#111111", anchor="mm")
    return image.resize((SIZE, SIZE), Image.LANCZOS)


def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    for tier, colour in enumerate(COLOURS):
        icon(tier, colour).save(out / f"t{tier}.png", optimize=True)


if __name__ == "__main__":
    main()
