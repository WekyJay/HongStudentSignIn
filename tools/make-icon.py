# Generate app icons (build/icon.png, build/icon.ico, build/icon.icns,
# resources/icon.png) from a school-provided logo file.
# White background is removed by flood-filling from the borders only, so the
# white shapes inside the logo are preserved.
import sys
from collections import deque
from PIL import Image

if len(sys.argv) != 2:
    raise SystemExit("Usage: python tools/make-icon.py <school-logo-image>")

SRC = sys.argv[1]
OUT_PNG_512 = [r"build\icon.png", r"resources\icon.png"]
OUT_ICO = r"build\icon.ico"
OUT_ICNS = r"build\icon.icns"

img = Image.open(SRC).convert("RGBA")
w, h = img.size
px = img.load()

def is_white(p):
    r, g, b, a = p
    return a == 0 or (r > 240 and g > 240 and b > 240)

# Flood fill from every border pixel, turning background white transparent.
seen = bytearray(w * h)
q = deque()
for x in range(w):
    for y in (0, h - 1):
        if is_white(px[x, y]):
            q.append((x, y))
for y in range(h):
    for x in (0, w - 1):
        if is_white(px[x, y]):
            q.append((x, y))
while q:
    x, y = q.popleft()
    i = y * w + x
    if seen[i]:
        continue
    seen[i] = 1
    r, g, b, a = px[x, y]
    px[x, y] = (r, g, b, 0)
    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
        if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and is_white(px[nx, ny]):
            q.append((nx, ny))

# Crop to the opaque bounding box, then fit into a square 512x512 canvas.
bbox = img.getbbox()
img = img.crop(bbox)
side = max(img.size)
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2), img)
icon = canvas.resize((512, 512), Image.LANCZOS)

for p in OUT_PNG_512:
    icon.save(p)
    print("wrote", p)

icon.save(OUT_ICO, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("wrote", OUT_ICO)

icon.save(OUT_ICNS, sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512)])
print("wrote", OUT_ICNS)
