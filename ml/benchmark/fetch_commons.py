"""Download a small labelled benchmark set from Wikimedia Commons (640 px thumbnails).
Saves images to internet/<label>/ and a manifest with source page, licence and author."""
import json, os, re, sys, time, urllib.parse, urllib.request
UA = {"User-Agent": "StreetTriage-benchmark/1.0 (SotonShip 2026 hackathon prototype; one-off research download)"}
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "internet")
CATEGORIES = {
    "pothole": ["Category:Potholes in the United Kingdom", "Category:Potholes"],
    "graffiti": ["Category:Graffiti in England"],
    "litter": ["Category:Litter"],
    "fly_tipping": ["Category:Illegal dumping", "Category:Fly-tipping in the United Kingdom"],
    "broken_lights": ["Category:Damaged street lights"],
}
PER_CLASS = int(sys.argv[1]) if len(sys.argv) > 1 else 30

def get(url, tries=6):
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read()
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(15 * (i + 1)); continue
            raise
    raise RuntimeError("rate limited")

manifest = []
for label, cats in CATEGORIES.items():
    os.makedirs(os.path.join(OUT, label), exist_ok=True)
    got = 0
    for cat in cats:
        if got >= PER_CLASS: break
        q = urllib.parse.urlencode({"action": "query", "generator": "categorymembers", "gcmtitle": cat, "gcmtype": "file", "gcmlimit": "200",
                                    "prop": "imageinfo", "iiprop": "url|mime|extmetadata", "iiurlwidth": "640", "format": "json"})
        time.sleep(5)
        pages = json.loads(get("https://commons.wikimedia.org/w/api.php?" + q)).get("query", {}).get("pages", {})
        for p in sorted(pages.values(), key=lambda x: x["title"]):
            if got >= PER_CLASS: break
            ii = (p.get("imageinfo") or [{}])[0]
            if ii.get("mime") not in ("image/jpeg", "image/png") or "thumburl" not in ii: continue
            meta = ii.get("extmetadata", {})
            name = re.sub(r"[^A-Za-z0-9_.-]+", "_", p["title"].replace("File:", ""))[:80]
            path = os.path.join(OUT, label, os.path.splitext(name)[0] + ".jpg")
            if not os.path.exists(path):
                time.sleep(1.5)
                try:
                    data = get(ii["thumburl"])
                except Exception as ex:
                    print("skip", name, ex); continue
                open(path, "wb").write(data)
            got += 1
            manifest.append({"label": label, "file": os.path.relpath(path, OUT), "source": ii.get("descriptionurl"), "category": cat,
                             "licence": meta.get("LicenseShortName", {}).get("value"), "author": re.sub("<[^>]+>", "", meta.get("Artist", {}).get("value", ""))[:100]})
        print(label, cat, "->", got, flush=True)
json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), indent=1)
print("total", len(manifest))
