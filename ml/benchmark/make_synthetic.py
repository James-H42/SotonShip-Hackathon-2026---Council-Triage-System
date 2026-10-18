"""Synthetic image data for the vision benchmark.

1. negatives/: images that are not street problems (solid colours, gradients, noise, text
   "screenshots", a map-like grid, a document). The service should report high uncertainty.
2. variants/: degraded copies of the hand-labelled in-scope FixMyStreet photos (blur, dark,
   over-exposed, rotated, tiny, heavy JPEG, tight crop), to measure robustness.
"""
import io
import json
import os
import random

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
# FixMyStreet scrape photos (not in the repo). Override with FMS_PHOTOS.
FMS = os.environ.get("FMS_PHOTOS", os.path.join(HERE, "..", "..", "..", "FixMyStreet Scraper", "fixmystreet_sample", "photos"))
random.seed(7)

neg = os.path.join(HERE, "negatives")
os.makedirs(neg, exist_ok=True)
W, H = 640, 480
for i, colour in enumerate(["#c0392b", "#2980b9", "#27ae60", "#ffffff", "#111111"]):
    Image.new("RGB", (W, H), colour).save(f"{neg}/solid_{i}.jpg")
for i in range(3):
    im = Image.linear_gradient("L").resize((W, H)).convert("RGB")
    ImageOps.colorize(im.convert("L"), random.choice(["navy", "darkred", "black"]), random.choice(["yellow", "white", "cyan"])).save(f"{neg}/gradient_{i}.jpg")
for i in range(3):
    Image.effect_noise((W, H), 60 + 30 * i).convert("RGB").save(f"{neg}/noise_{i}.jpg")
for i, lines in enumerate([
    ["Your parcel is on its way", "Track order #42213", "Estimated delivery: Tuesday"],
    ["Southampton City Council", "Council tax bill 2026/27", "Amount due: £1,742.00"],
    ["WhatsApp", "Mum: Are you coming for tea?", "Me: yes be there at 6"],
]):
    im = Image.new("RGB", (480, 860), "white")
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 480, 70], fill="#075e54" if i == 2 else "#00193c")
    for j, t in enumerate(lines):
        d.text((30, 120 + j * 70), t, fill="black")
    im.save(f"{neg}/screenshot_{i}.jpg")
im = Image.new("RGB", (W, H), "#f2efe9")
d = ImageDraw.Draw(im)
for x in range(0, W, 40):
    d.line([x, 0, x, H], fill="#d0ccc4")
for y in range(0, H, 40):
    d.line([0, y, W, y], fill="#d0ccc4")
d.line([0, 300, W, 120], fill="#f7c948", width=18)
d.line([200, 0, 320, H], fill="#ffffff", width=14)
im.save(f"{neg}/map_like.jpg")
im = Image.new("RGB", (595, 842), "white")
d = ImageDraw.Draw(im)
for j in range(30):
    d.line([60, 80 + j * 24, 535 - random.randint(0, 120), 80 + j * 24], fill="#555555", width=3)
im.save(f"{neg}/document.jpg")

# Variants of the in-scope real photos.
gt = json.load(open(os.path.join(HERE, "photo_ground_truth.json")))["photos"]
inscope = [p for p in gt if p["label"] in {"pothole", "road_damage", "fly_tipping", "litter", "graffiti", "bus_shelter"}]
var = os.path.join(HERE, "variants")
os.makedirs(var, exist_ok=True)


def jpeg(im, q):
    b = io.BytesIO()
    im.save(b, "JPEG", quality=q)
    return Image.open(io.BytesIO(b.getvalue())).convert("RGB")


TRANSFORMS = {
    "blur": lambda im: im.filter(ImageFilter.GaussianBlur(6)),
    "dark": lambda im: ImageEnhance.Brightness(im).enhance(0.25),
    "overexposed": lambda im: ImageEnhance.Brightness(im).enhance(2.2),
    "rotated": lambda im: im.rotate(90, expand=True),
    "tiny": lambda im: im.resize((max(1, im.width // 12), max(1, im.height // 12))).resize(im.size),
    "jpeg_q5": lambda im: jpeg(im, 5),
    "crop_centre": lambda im: im.crop((im.width // 4, im.height // 4, 3 * im.width // 4, 3 * im.height // 4)),
}
manifest = []
for p in inscope:
    im = ImageOps.exif_transpose(Image.open(f"{FMS}/{p['file']}")).convert("RGB")
    im.thumbnail((1024, 1024))
    for name, fn in TRANSFORMS.items():
        out = f"{name}__{p['file']}"
        fn(im).save(os.path.join(var, out), quality=90)
        manifest.append({"file": out, "transform": name, "source": p["file"], "label": p["label"]})
json.dump(manifest, open(os.path.join(var, "manifest.json"), "w"), indent=1)
print(len(os.listdir(neg)), "negatives,", len(manifest), "variants of", len(inscope), "photos")
