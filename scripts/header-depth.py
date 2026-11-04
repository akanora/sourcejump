"""Makes the home header's depth map (web/src/features/home/header-depth.webp) from its picture. Rerun it when the
picture changes. White is near; the depth is MoGe-2's disparity (1 / distance), on a curve that spreads the room.

The figure gets its own pass on a crop around it: on the whole picture the model sees him at a few hundred pixels
and returns a flat cut-out (6 of 256 grey levels). The crop's depth is scaled to match the whole pass on him, his
relief boosted, and kept in front of the wall behind him: a limb pushed through it tears open when he moves.

Needs a CUDA GPU and, once, a venv outside the repo (about 5 GB):
  python3 -m venv ~/.venv-depth && ~/.venv-depth/bin/pip install torch torchvision \
    --index-url https://download.pytorch.org/whl/cu124 && ~/.venv-depth/bin/pip install \
    "git+https://github.com/microsoft/MoGe.git" pillow scipy
usage: ~/.venv-depth/bin/python scripts/header-depth.py web/src/features/home/header.png \
  web/src/features/home/header-depth.webp [x0 y0 x1 y1]  (the box around the figure)
"""

import sys

import numpy as np
import torch
from moge.model.v2 import MoGeModel
from PIL import Image, ImageFilter
from scipy import ndimage

# The figure's relief, times its true depth, and the curve on the whole map (below 1 spreads the far room).
RELIEF = 2.5
CURVE = 0.6
# Patches the model reads the picture in; more is sharper, up to about this many.
TOKENS = 6000

src, out = sys.argv[1], sys.argv[2]
x0, y0, x1, y1 = map(int, sys.argv[3:7]) if len(sys.argv) > 6 else (560, 240, 860, 500)
image = np.array(Image.open(src).convert("RGB"))
model = MoGeModel.from_pretrained("Ruicheng/moge-2-vitl-normal").cuda().eval()


def disparity(img: np.ndarray) -> np.ndarray:
    t = torch.tensor(img / 255, dtype=torch.float32, device="cuda").permute(2, 0, 1)
    with torch.no_grad():
        o = model.infer(t, num_tokens=TOKENS)
    z, m = o["depth"].cpu().numpy(), o["mask"].cpu().numpy()
    d = np.zeros_like(z)
    ok = m & np.isfinite(z) & (z > 0)
    d[ok] = 1 / z[ok]
    return d


whole = disparity(image)
crop = disparity(image[y0:y1, x0:x1])

# The figure: the crop's largest near blob, split from the wall by Otsu's threshold on disparity.
hist, edges = np.histogram(crop[crop > 0], 256)
w, mu = np.cumsum(hist), np.cumsum(hist * edges[:-1])
between = (mu[-1] * w - mu * w[-1]) ** 2 / np.maximum(w * (w[-1] - w), 1)
blobs, n = ndimage.label(crop > edges[np.argmax(between)])
figure = ndimage.binary_fill_holes(blobs == np.argmax(ndimage.sum(blobs > 0, blobs, range(1, n + 1))) + 1)

under = whole[y0:y1, x0:x1]
scaled = crop * np.median(under[figure] / crop[figure])
mid = np.median(scaled[figure])
ring = ndimage.binary_dilation(figure, iterations=12) & ~ndimage.binary_dilation(figure, iterations=4)
wall = np.median(under[ring])
boosted = np.maximum(mid + RELIEF * (scaled - mid), mid - 0.5 * (mid - wall))

# A soft edge also softens the tear where he slides over the wall.
soft = np.array(Image.fromarray((figure * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5))) / 255
merged = whole.copy()
merged[y0:y1, x0:x1] = under * (1 - soft) + boosted * soft

lo, hi = np.percentile(merged[merged > 0], 1), np.percentile(merged, 99.5)
grey = np.clip((merged - lo) / (hi - lo), 0, 1) ** CURVE
Image.fromarray((grey * 255).round().astype(np.uint8)).save(out, quality=85)
print(out)
