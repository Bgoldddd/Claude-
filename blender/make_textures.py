"""Generate original, tileable textures for COURTSIDE.
All art here is made from code (noise + shapes). No outside images.
Run: /opt/bpyenv/bin/python make_textures.py <outdir>
"""
import sys, os, math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else "textures"
os.makedirs(OUT, exist_ok=True)
FONT = "/usr/share/fonts/truetype/google-fonts/Poppins-BoldItalic.ttf"
FONT_B = "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf"
rng = np.random.default_rng(7)
random.seed(7)


def tile_noise(size, scale, octaves=5, seed=0):
    """Tileable value noise built from wrapped random grids."""
    r = np.random.default_rng(seed)
    out = np.zeros((size, size), np.float32)
    amp, total = 1.0, 0.0
    for o in range(octaves):
        cells = max(2, int(scale * (2 ** o)))
        grid = r.random((cells, cells)).astype(np.float32)
        img = Image.fromarray((grid * 255).astype(np.uint8))
        # wrap: pad by tiling then crop so edges match
        big = np.tile(grid, (3, 3))
        bimg = Image.fromarray((big * 255).astype(np.uint8)).resize((size * 3, size * 3), Image.BICUBIC)
        layer = np.asarray(bimg, np.float32)[size:2 * size, size:2 * size] / 255.0
        out += layer * amp
        total += amp
        amp *= 0.5
    return out / total


def save(arr, name, mode="RGB"):
    arr = np.clip(arr, 0, 255).astype(np.uint8)
    Image.fromarray(arr, mode).save(os.path.join(OUT, name), optimize=True)
    print("wrote", name)


def normal_from_height(h, strength=2.0):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    n = np.dstack([-dx, -dy, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return (n * 0.5 + 0.5) * 255


# ---------- Asphalt (surrounding street) ----------
S = 1024
n1 = tile_noise(S, 8, 6, 1)
n2 = tile_noise(S, 64, 3, 2)
grain = rng.random((S, S)).astype(np.float32)
stones = (grain > 0.985).astype(np.float32) * 0.35 + (grain > 0.995) * 0.25
base = 0.20 + n1 * 0.10 + n2 * 0.05 + stones
# cracks: random walk lines
crack = Image.new("L", (S, S), 0)
d = ImageDraw.Draw(crack)
for _ in range(9):
    x, y = random.random() * S, random.random() * S
    ang = random.random() * math.tau
    pts = [(x, y)]
    for _ in range(40):
        ang += random.uniform(-0.6, 0.6)
        x = (x + math.cos(ang) * 12) % S
        y = (y + math.sin(ang) * 12) % S
        pts.append((x, y))
    for a, b in zip(pts, pts[1:]):
        if abs(a[0] - b[0]) < 50 and abs(a[1] - b[1]) < 50:
            d.line([a, b], fill=255, width=2)
crack = np.asarray(crack.filter(ImageFilter.GaussianBlur(0.8)), np.float32) / 255
base = base * (1 - crack * 0.6)
col = np.dstack([base * 0.98, base * 0.98, base * 1.02]) * 255
save(col, "asphalt_col.png")
save(normal_from_height(base * 6), "asphalt_nrm.png")
rough = (0.85 + n2 * 0.1 - stones * 0.2) * 255
save(np.dstack([rough] * 3), "asphalt_rgh.png")

# ---------- Court concrete (sealed, smoother, warm gray) ----------
n3 = tile_noise(S, 4, 6, 3)
n4 = tile_noise(S, 40, 3, 4)
speck = (rng.random((S, S)) > 0.992).astype(np.float32) * 0.08
c = 0.52 + n3 * 0.10 + n4 * 0.05 - speck
# scuff marks (sneaker rubber) — dark curved strokes
scuff = Image.new("L", (S, S), 0)
d = ImageDraw.Draw(scuff)
for _ in range(60):
    x, y = random.random() * S, random.random() * S
    r = random.uniform(10, 60)
    a0 = random.uniform(0, 360)
    d.arc([x - r, y - r, x + r, y + r], a0, a0 + random.uniform(20, 90), fill=random.randint(40, 120), width=random.randint(2, 5))
scuff = np.asarray(scuff.filter(ImageFilter.GaussianBlur(1.2)), np.float32) / 255
c = c * (1 - scuff * 0.35)
col = np.dstack([c * 1.0, c * 0.97, c * 0.93]) * 255
save(col, "concrete_col.png")
save(normal_from_height(c * 3), "concrete_nrm.png")
save(np.dstack([(0.7 + n4 * 0.2 - scuff * 0.2) * 255] * 3), "concrete_rgh.png")

# ---------- Painted court paint (muted orange + charcoal) — tint mask ----------
pn = tile_noise(512, 6, 5, 5)
wear = tile_noise(512, 16, 4, 6)
p = 0.85 + pn * 0.15
worn = np.clip((wear - 0.62) * 4, 0, 1)
save(np.dstack([p * 255, p * 255, p * 255, (1 - worn * 0.7) * 255]), "paint_mask.png", "RGBA")

# ---------- Brick ----------
B = 1024
img = Image.new("RGB", (B, B), (70, 66, 62))
d = ImageDraw.Draw(img)
bw, bh, mortar = 128, 42, 6
rows = B // bh + 1
for r in range(rows):
    off = (bw // 2) if r % 2 else 0
    for cidx in range(-1, B // bw + 2):
        x0 = cidx * bw + off + mortar // 2
        y0 = r * bh + mortar // 2
        t = random.uniform(-1, 1)
        base_c = (int(118 + t * 18), int(62 + t * 10), int(48 + t * 8))
        if random.random() < 0.08:
            base_c = (int(84 + t * 10), int(80 + t * 8), int(78 + t * 8))
        d.rectangle([x0, y0, x0 + bw - mortar, y0 + bh - mortar], fill=base_c)
arr = np.asarray(img, np.float32)
grime = tile_noise(B, 6, 5, 9)[..., None]
arr = arr * (0.75 + grime * 0.45)
# vertical rain streaks
streak = np.tile(tile_noise(B, 30, 2, 10)[0:1, :], (B, 1))[..., None]
arr *= (0.85 + streak * 0.2)
save(arr, "brick_col.png")
h = arr.mean(axis=2) / 255
save(normal_from_height(h * 4), "brick_nrm.png")

# ---------- Windows (facade overlay with emission mask) ----------
W = 512
win = Image.new("RGB", (W, W), (0, 0, 0))
emi = Image.new("RGB", (W, W), (0, 0, 0))
d = ImageDraw.Draw(win); de = ImageDraw.Draw(emi)
for gy in range(4):
    for gx in range(4):
        x0, y0 = gx * 128 + 28, gy * 128 + 22
        d.rectangle([x0 - 6, y0 - 6, x0 + 78, y0 + 94], fill=(40, 38, 36))  # frame
        lit = random.random() < 0.35
        glass = (255, 196, 120) if lit else (26, 32, 40)
        d.rectangle([x0, y0, x0 + 72, y0 + 88], fill=glass)
        d.line([x0 + 36, y0, x0 + 36, y0 + 88], fill=(30, 30, 30), width=4)
        d.line([x0, y0 + 44, x0 + 72, y0 + 44], fill=(30, 30, 30), width=4)
        if lit:
            de.rectangle([x0, y0, x0 + 72, y0 + 88], fill=(255, 180, 100))
        d.rectangle([x0 - 10, y0 + 94, x0 + 82, y0 + 102], fill=(150, 145, 138))  # sill
save(np.asarray(win), "window_col.png")
save(np.asarray(emi), "window_emi.png")
# window alpha mask (where windows are)
mask = Image.new("L", (W, W), 0)
dm = ImageDraw.Draw(mask)
for gy in range(4):
    for gx in range(4):
        x0, y0 = gx * 128 + 28, gy * 128 + 22
        dm.rectangle([x0 - 10, y0 - 6, x0 + 82, y0 + 102], fill=255)
win_rgba = np.dstack([np.asarray(win), np.asarray(mask)])
save(win_rgba, "window_rgba.png", "RGBA")

# ---------- Skyline windows (night towers) ----------
K = 512
sky = np.zeros((K, K, 3), np.float32)
for gy in range(0, K, 16):
    for gx in range(0, K, 12):
        if random.random() < 0.28:
            warm = random.random() < 0.7
            colr = (255, 200, 130) if warm else (170, 210, 255)
            sky[gy + 4:gy + 12, gx + 3:gx + 9] = colr
save(sky, "skyline_emi.png")

# ---------- Chain-link fence (RGBA, tileable diamond) ----------
C = 256
cl = Image.new("RGBA", (C, C), (0, 0, 0, 0))
d = ImageDraw.Draw(cl)
step = 32
wire = (165, 170, 172, 255)
for k in range(-C, 2 * C, step):
    d.line([(k, 0), (k + C, C)], fill=wire, width=3)
    d.line([(k, C), (k + C, 0)], fill=wire, width=3)
cl.save(os.path.join(OUT, "chainlink_rgba.png"))
print("wrote chainlink_rgba.png")

# ---------- Graffiti murals (original designs) ----------
def mural(name, w, h, words, palette, seed):
    rnd = random.Random(seed)
    im = Image.new("RGB", (w, h), palette[0])
    d = ImageDraw.Draw(im)
    # background bubbles / bursts
    for _ in range(40):
        x, y = rnd.random() * w, rnd.random() * h
        r = rnd.uniform(20, 140)
        d.ellipse([x - r, y - r, x + r, y + r], fill=rnd.choice(palette[1:3]))
    # stripes
    for i in range(6):
        y = rnd.uniform(0, h)
        d.polygon([(0, y), (w, y - 120), (w, y - 80), (0, y + 40)], fill=rnd.choice(palette[1:]))
    # big outlined lettering
    size = int(h * 0.42)
    f = ImageFont.truetype(FONT, size)
    tw = d.textlength(words, font=f)
    while tw > w * 0.92:
        size = int(size * 0.92); f = ImageFont.truetype(FONT, size); tw = d.textlength(words, font=f)
    tx, ty = (w - tw) / 2, h * 0.24
    for o in range(14, 0, -2):  # thick outline / 3D shadow
        d.text((tx + o, ty + o), words, font=f, fill=(20, 20, 22))
    d.text((tx, ty), words, font=f, fill=palette[3], stroke_width=8, stroke_fill=(250, 248, 240))
    # drips under letters
    for _ in range(26):
        x = tx + rnd.random() * tw
        y0 = ty + size * 0.95
        L = rnd.uniform(20, 120)
        d.line([(x, y0), (x, y0 + L)], fill=palette[3], width=rnd.randint(4, 9))
        d.ellipse([x - 6, y0 + L - 6, x + 6, y0 + L + 6], fill=palette[3])
    # sparkle stars
    for _ in range(12):
        x, y, r = rnd.random() * w, rnd.random() * h, rnd.uniform(8, 22)
        d.polygon([(x, y - r), (x + r * .25, y - r * .25), (x + r, y), (x + r * .25, y + r * .25), (x, y + r), (x - r * .25, y + r * .25), (x - r, y), (x - r * .25, y - r * .25)], fill=(255, 255, 240))
    # weathering
    arr = np.asarray(im, np.float32)
    n = tile_noise(max(w, h), 10, 4, seed)[:h, :w, None]
    arr = arr * (0.8 + n * 0.3)
    save(arr, name)

mural("graffiti_a.png", 2048, 768, "THE BLOCK", [(46, 44, 48), (214, 104, 46), (60, 70, 160), (255, 120, 40)], 11)
mural("graffiti_b.png", 1536, 768, "HOOP DREAMS", [(30, 30, 34), (0, 190, 200), (200, 60, 120), (255, 230, 60)], 12)
mural("graffiti_c.png", 1536, 768, "NEXT UP", [(60, 58, 54), (120, 200, 80), (230, 80, 60), (250, 250, 245)], 13)

# ---------- Sign: THE BLOCK entrance + court-center logo ----------
logo = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
d = ImageDraw.Draw(logo)
d.ellipse([40, 40, 984, 984], outline=(245, 242, 235, 255), width=26)
d.ellipse([110, 110, 914, 914], fill=(214, 110, 52, 230))
f = ImageFont.truetype(FONT, 190)
for txt, y in (("THE", 250), ("BLOCK", 430)):
    tw = d.textlength(txt, font=f)
    d.text(((1024 - tw) / 2, y), txt, font=f, fill=(28, 28, 30, 255))
f2 = ImageFont.truetype(FONT_B, 70)
txt = "COURTSIDE"
tw = d.textlength(txt, font=f2)
d.text(((1024 - tw) / 2, 690), txt, font=f2, fill=(245, 242, 235, 255))
logo.save(os.path.join(OUT, "center_logo.png")); print("wrote center_logo.png")

# ---------- Basketball (equirectangular) ----------
BW, BH = 1024, 512
u = np.linspace(0, 1, BW, endpoint=False)[None, :]
v = np.linspace(0, 1, BH)[:, None]
lon = u * 2 * np.pi
lat = (0.5 - v) * np.pi
x = np.cos(lat) * np.cos(lon); y = np.sin(lat) * np.ones_like(lon); z = np.cos(lat) * np.sin(lon)
pebble = rng.random((BH, BW)).astype(np.float32)
pebble = np.asarray(Image.fromarray((pebble * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)), np.float32) / 255
base = np.dstack([np.full((BH, BW), 0.80), np.full((BH, BW), 0.36), np.full((BH, BW), 0.14)]) * (0.85 + pebble[..., None] * 0.2)
w = 0.022
seam = (np.abs(x) < w) | (np.abs(y) < w)
# the two curved seams: |z| close to a curve
curve = np.abs(np.abs(z) - (0.62 + 0.25 * x * x)) < w * 1.1
seam |= curve
base[seam] = [0.06, 0.05, 0.05]
save(base * 255, "ball_col.png")

print("done")

# =============================================================== extra courts
# ---------- hardwood (THE LAB)
W2 = 1024
wood = np.zeros((W2, W2, 3), np.float32)
pw = 64  # plank width in px
grain = tile_noise(W2, 3, 5, 21)
fine = tile_noise(W2, 60, 2, 22)
for i in range(W2 // pw):
    t = random.uniform(-1, 1)
    base_c = np.array([0.78 + t * 0.05, 0.56 + t * 0.05, 0.34 + t * 0.04])
    x0 = i * pw
    # stretch noise along planks (vertical grain)
    g = np.repeat(grain[::16, x0:x0 + pw], 16, axis=0)[:W2]
    wood[:, x0:x0 + pw] = base_c * (0.86 + g[..., None] * 0.22 + fine[:, x0:x0 + pw, None] * 0.06)
    wood[:, x0:x0 + 2] *= 0.6  # seams
    # plank end joints
    for _ in range(3):
        y = random.randint(0, W2 - 1)
        wood[y:y + 2, x0:x0 + pw] *= 0.65
save(wood * 255, "wood_col.png")
save(normal_from_height(wood.mean(axis=2) * 2), "wood_nrm.png")

# ---------- sand (COASTLINE)
sn = tile_noise(1024, 10, 6, 31); sg = rng.random((1024, 1024)).astype(np.float32)
s = 0.8 + sn * 0.15 + (sg - 0.5) * 0.08
ripples = np.sin(np.linspace(0, 60 * np.pi, 1024))[None, :] * 0.025 + np.sin(np.linspace(0, 23 * np.pi, 1024))[:, None] * 0.015
s += ripples
save(np.dstack([s * 0.93, s * 0.82, s * 0.6]) * 255, "sand_col.png")

# ---------- rooftop pavers (SKYLINE)
P = 1024
pav = Image.new("RGB", (P, P), (34, 34, 38))
d = ImageDraw.Draw(pav)
tile = 128
for yy in range(0, P, tile):
    for xx in range(0, P, tile):
        v = random.randint(46, 62)
        d.rectangle([xx + 3, yy + 3, xx + tile - 3, yy + tile - 3], fill=(v, v, v + 4))
arr = np.asarray(pav, np.float32) * (0.85 + tile_noise(P, 8, 4, 41)[..., None] * 0.3)
save(arr, "pavers_col.png")

# ---------- signs and banners (original text art)
def sign(name, w, h, text, fg, bg, sub=None, glow=False, font=FONT):
    im = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(im)
    size = int(h * (0.5 if sub else 0.62))
    f = ImageFont.truetype(font, size)
    while d.textlength(text, font=f) > w * 0.9:
        size = int(size * 0.92); f = ImageFont.truetype(font, size)
    tw = d.textlength(text, font=f)
    y = h * (0.12 if sub else 0.16)
    d.text(((w - tw) / 2, y), text, font=f, fill=fg)
    if sub:
        f2 = ImageFont.truetype(FONT_B, int(h * 0.14))
        sw = d.textlength(sub, font=f2)
        d.text(((w - sw) / 2, h * 0.72), sub, font=f2, fill=fg)
    if glow:
        im = Image.blend(im, im.filter(ImageFilter.GaussianBlur(10)), 0.35)
    im.save(os.path.join(OUT, name)); print("wrote", name)

sign("sign_skyline.png", 1024, 256, "SKYLINE", (0, 229, 255), (0, 0, 0), glow=True)
sign("banner_lab.png", 1024, 512, "THE LAB", (242, 239, 232), (20, 20, 22), sub="COURTSIDE TRAINING FACILITY")
sign("banner_nodays.png", 1024, 256, "NO DAYS OFF", (217, 102, 43), (24, 24, 27))
sign("banner_work.png", 1024, 256, "OUTWORK EVERYBODY", (242, 239, 232), (194, 84, 28))
sign("sign_coast.png", 1024, 256, "COASTLINE", (255, 255, 255), (16, 120, 140), font=FONT)
sign("scoreboard.png", 512, 256, "11 : 09", (255, 140, 40), (5, 5, 6), sub="HOME          AWAY")
