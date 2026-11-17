# Store art for the Growth captures, all made here from our own material:
#   - each fictional rival's five App Store screenshots, cut from our template
#     preview strips (3000 x 1000, five boards each), with the strip background
#     in the rounded corners painted over with the board's own edge colour, so a
#     screenshot is a full rectangle the way the store hands it out
#   - square app icons for Juniper, the three rivals and the filler apps that
#     show up in keyword search results
# Run: python -I make_assets.py   ->  ./assets/*.png
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'assets')
STRIPS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..') + '/public/data/projects/previews/'
os.makedirs(OUT, exist_ok=True)

# Board geometry in the 3000 x 1000 strips, measured from trackio, nookly and zenfit.
BOARD_X = [454, 883, 1311, 1739, 2167]
BOARD_W = 377
BOARD_Y0, BOARD_Y1 = 93, 906
INSET = 2
RADIUS = 46


def cut_board(strip: Image.Image, index: int) -> Image.Image:
    x0 = BOARD_X[index] + INSET
    x1 = BOARD_X[index] + BOARD_W - INSET
    board = strip.crop((x0, BOARD_Y0 + INSET, x1, BOARD_Y1 - INSET)).convert('RGB')
    a = np.asarray(board).copy()
    h, w, _ = a.shape
    r = RADIUS - INSET
    yy, xx = np.mgrid[0:h, 0:w]
    for cx, cy, sx, sy in ((r, r, 0, 0), (w - 1 - r, r, w - 1, 0), (r, h - 1 - r, 0, h - 1), (w - 1 - r, h - 1 - r, w - 1, h - 1)):
        # Pixels in the corner square that fall outside the arc are strip background.
        in_square = (np.abs(xx - sx) <= r) & (np.abs(yy - sy) <= r)
        outside = in_square & (((xx - cx) ** 2 + (yy - cy) ** 2) > (r - 1.5) ** 2) & (np.sign(xx - cx) == np.sign(sx - cx + 0.1)) & (np.sign(yy - cy) == np.sign(sy - cy + 0.1))
        # The board's own colour just inside the arc, near that corner.
        px = int(cx + (sx - cx) * 0.55)
        py = int(cy + (sy - cy) * 0.55)
        patch = a[max(0, py - 3):py + 4, max(0, px - 3):px + 4].reshape(-1, 3)
        colour = np.median(patch, axis=0)
        a[outside] = colour
    return Image.fromarray(a)


SETS = {
    'dayline': 'trackio-fitness',
    'dayline-new': 'sereno-mind',
    'tally': 'nookly-focus',
    'brightly': 'plannio-student',
}

for key, strip_name in SETS.items():
    strip = Image.open(STRIPS + strip_name + '.png')
    for i in range(5):
        shot = cut_board(strip, i)
        shot.save(os.path.join(OUT, f'{key}-{i + 1}.png'), optimize=True)
    print('cut', key, shot.size)

# --- icons -------------------------------------------------------------------------------

S = 2048  # drawn at 4x, saved at 512


def gradient(c0, c1):
    t = np.linspace(0, 1, S)
    tx, ty = np.meshgrid(t, t)
    mix = (tx * 0.45 + ty * 0.55)[..., None]
    a = np.array(c0, float) * (1 - mix) + np.array(c1, float) * mix
    return Image.fromarray(a.astype(np.uint8), 'RGB')


def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def save_icon(img, name):
    img.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, f'icon-{name}.png'), optimize=True)
    print('icon', name)


# Juniper: forest green, a cream progress ring with a berry at its end and a check inside.
img = gradient(hexrgb('#3C8460'), hexrgb('#1F4E3A'))
d = ImageDraw.Draw(img)
cx = cy = S // 2
R = int(S * 0.30)
W = int(S * 0.085)
d.arc((cx - R, cy - R, cx + R, cy + R), start=-90, end=215, fill=hexrgb('#F6F2E9'), width=W)
d.arc((cx - R, cy - R, cx + R, cy + R), start=215, end=270, fill=(255, 255, 255, 60), width=W)
import math
for ang in (-90, 215):
    ex = cx + R * math.cos(math.radians(ang)) - 0
    ey = cy + R * math.sin(math.radians(ang))
    d.ellipse((ex - W / 2 + W * 0.02, ey - W / 2, ex + W / 2, ey + W / 2), fill=hexrgb('#F6F2E9'))
bx = cx + R * math.cos(math.radians(215))
by = cy + R * math.sin(math.radians(215))
d.ellipse((bx - W * 0.95, by - W * 0.95, bx + W * 0.95, by + W * 0.95), fill=hexrgb('#7A80E6'))
d.ellipse((bx - W * 0.95 + W * 0.35, by - W * 0.95 + W * 0.3, bx - W * 0.95 + W * 0.75, by - W * 0.95 + W * 0.7), fill=hexrgb('#B9BDF5'))
d.line([(cx - S * 0.12, cy + S * 0.005), (cx - S * 0.035, cy + S * 0.09), (cx + S * 0.13, cy - S * 0.09)], fill=hexrgb('#F6F2E9'), width=int(S * 0.07), joint='curve')
for px, py in ((cx - S * 0.12, cy + S * 0.005), (cx + S * 0.13, cy - S * 0.09)):
    rr = S * 0.035
    d.ellipse((px - rr, py - rr, px + rr, py + rr), fill=hexrgb('#F6F2E9'))
save_icon(img, 'juniper')

# Dayline: deep blue, a sun rising over a horizon.
img = gradient(hexrgb('#2F6BFF'), hexrgb('#0B1F5C'))
d = ImageDraw.Draw(img)
hy = int(S * 0.60)
R = int(S * 0.22)
d.pieslice((cx - R, hy - R, cx + R, hy + R), start=180, end=360, fill=hexrgb('#FFD166'))
d.rounded_rectangle((int(S * 0.18), hy - int(S * 0.012), int(S * 0.82), hy + int(S * 0.045)), radius=int(S * 0.03), fill=(255, 255, 255))
for ang in (200, 235, 270, 305, 340):
    a0 = math.radians(ang)
    r0, r1 = R + S * 0.06, R + S * 0.14
    d.line([(cx + r0 * math.cos(a0), hy + r0 * math.sin(a0)), (cx + r1 * math.cos(a0), hy + r1 * math.sin(a0))], fill=(255, 255, 255), width=int(S * 0.04))
d.rounded_rectangle((int(S * 0.30), hy + int(S * 0.11), int(S * 0.70), hy + int(S * 0.15)), radius=int(S * 0.02), fill=(255, 255, 255, 180))
save_icon(img, 'dayline')

# Tally: warm brown, four cream tally marks and a strike.
img = gradient(hexrgb('#D39B6A'), hexrgb('#8A5333'))
d = ImageDraw.Draw(img)
for i in range(4):
    x = int(S * (0.30 + i * 0.12))
    d.rounded_rectangle((x - int(S * 0.028), int(S * 0.27), x + int(S * 0.028), int(S * 0.73)), radius=int(S * 0.028), fill=hexrgb('#FBF3E6'))
d.line([(S * 0.22, S * 0.66), (S * 0.80, S * 0.36)], fill=hexrgb('#FBF3E6'), width=int(S * 0.055))
for px, py in ((S * 0.22, S * 0.66), (S * 0.80, S * 0.36)):
    rr = S * 0.0275
    d.ellipse((px - rr, py - rr, px + rr, py + rr), fill=hexrgb('#FBF3E6'))
save_icon(img, 'tally')

# Brightly: orange, a white four point sparkle.
img = gradient(hexrgb('#FFB347'), hexrgb('#EE5A12'))
d = ImageDraw.Draw(img)


def sparkle(draw, x, y, big, small, fill):
    pts = []
    for k in range(8):
        ang = math.radians(-90 + k * 45)
        rad = big if k % 2 == 0 else small
        pts.append((x + rad * math.cos(ang), y + rad * math.sin(ang)))
    draw.polygon(pts, fill=fill)


sparkle(d, cx - S * 0.03, cy + S * 0.03, S * 0.30, S * 0.075, (255, 255, 255))
sparkle(d, cx + S * 0.22, cy - S * 0.21, S * 0.11, S * 0.03, (255, 244, 220))
save_icon(img, 'brightly')

# Filler apps in search results: a gradient and a letter. Segoe UI Bold on
# Windows, Arial Bold on a Mac.
FONT = next(
    (f for f in ('C:/Windows/Fonts/segoeuib.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf') if os.path.exists(f)),
    'C:/Windows/Fonts/segoeuib.ttf',
)
FILLERS = {
    'nimbo': ('#8B5CF6', '#4C1D95', 'N'),
    'driplet': ('#38BDF8', '#0369A1', 'D'),
    'petalpath': ('#F472B6', '#9D174D', 'P'),
    'wrenly': ('#2DD4BF', '#0F766E', 'W'),
    'orbly': ('#FBBF24', '#B45309', 'O'),
    'kindleaf': ('#86EFAC', '#15803D', 'K'),
    'mossy': ('#A3B18A', '#3A5A40', 'M'),
    'quillby': ('#93C5FD', '#1E3A8A', 'Q'),
    'sundew': ('#FDBA74', '#C2410C', 'S'),
    'lumo': ('#C4B5FD', '#5B21B6', 'L'),
}
font = ImageFont.truetype(FONT, int(S * 0.52))
for name, (c0, c1, letter) in FILLERS.items():
    img = gradient(hexrgb(c0), hexrgb(c1))
    d = ImageDraw.Draw(img)
    box = d.textbbox((0, 0), letter, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    d.text((cx - tw / 2 - box[0], cy - th / 2 - box[1]), letter, font=font, fill=(255, 255, 255))
    save_icon(img, name)

# --- Dayline's first screenshot carries the template's own logo: put Dayline's name there ---
shot = Image.open(os.path.join(OUT, 'dayline-1.png')).convert('RGB')
a = np.asarray(shot).copy()
# Background only to the right of the logo: copy it across the logo's rows.
for y in range(22, 56):
    a[y, 54:150] = a[y, 152]
shot = Image.fromarray(a)
d = ImageDraw.Draw(shot)
try:
    f = ImageFont.truetype('C:/Windows/Fonts/bahnschrift.ttf', 25)
    try:
        f.set_variation_by_name('Bold Condensed')
    except Exception:
        pass
except Exception:
    impact = next((p for p in ('C:/Windows/Fonts/impact.ttf', '/System/Library/Fonts/Supplemental/Impact.ttf') if os.path.exists(p)), 'C:/Windows/Fonts/impact.ttf')
    f = ImageFont.truetype(impact, 24)
d.text((60, 27), 'Dayline', font=f, fill=(255, 255, 255))
shot.save(os.path.join(OUT, 'dayline-1.png'), optimize=True)
shot.crop((0, 0, 200, 80)).resize((600, 240)).save(os.path.join(HERE, 'dayline-logo.png'))
print('dayline logo replaced')
