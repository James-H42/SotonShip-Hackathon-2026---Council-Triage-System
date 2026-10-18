import glob, os, sys
from PIL import Image, ImageDraw, ImageOps
HERE = os.path.dirname(os.path.abspath(__file__))
label = sys.argv[1]
files = sorted(glob.glob(os.path.join(HERE, "internet", label, "*.jpg")))
cols, size = 6, 200
rows = (len(files) + cols - 1) // cols
sheet = Image.new("RGB", (cols * size, rows * (size + 18)), "white")
d = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    try:
        im = ImageOps.exif_transpose(Image.open(f)).convert("RGB")
    except Exception:
        continue
    im.thumbnail((size - 6, size - 6))
    x, y = (i % cols) * size, (i // cols) * (size + 18)
    sheet.paste(im, (x + 3, y + 16))
    d.text((x + 3, y + 2), f"{i}", fill="black")
sheet.save(os.path.join(HERE, "sheets", f"internet_{label}.jpg"), quality=75)
print("\n".join(f"{i} {os.path.basename(f)}" for i, f in enumerate(files)))
