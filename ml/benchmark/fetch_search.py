"""Gentle Wikimedia Commons fetch by file-title search (one request every ~6 s).
Appends to internet/manifest.json. Usage: python fetch_search.py <label> <per_class> "<query>" ["<query>" ...]"""
import json, os, re, sys, time, urllib.parse, urllib.request
UA = {"User-Agent": "StreetTriage-benchmark/1.0 (SotonShip 2026 hackathon prototype; small one-off research download)"}
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "internet")
label, per = sys.argv[1], int(sys.argv[2])
queries = sys.argv[3:]

def get(url):
    for i in range(8):
        time.sleep(6)
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read()
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(30 * (i + 1)); continue
            raise
    raise RuntimeError("rate limited")

man_path = os.path.join(OUT, "manifest.json")
manifest = json.load(open(man_path)) if os.path.exists(man_path) else []
have = {m["file"] for m in manifest}
os.makedirs(os.path.join(OUT, label), exist_ok=True)
excluded = set(json.load(open(os.path.join(HERE, "internet_excluded.json")))) if os.path.exists(os.path.join(HERE, "internet_excluded.json")) else set()
got = sum(1 for m in manifest if m["label"] == label and m["file"] not in excluded)
for q in queries:
    if got >= per: break
    api = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "generator": "search", "gsrsearch": f"filetype:bitmap {q}", "gsrnamespace": "6", "gsrlimit": "40",
        "prop": "imageinfo", "iiprop": "url|mime|extmetadata", "iiurlwidth": "640", "format": "json"})
    pages = json.loads(get(api)).get("query", {}).get("pages", {})
    for p in sorted(pages.values(), key=lambda x: x.get("index", 0)):
        if got >= per: break
        ii = (p.get("imageinfo") or [{}])[0]
        if ii.get("mime") != "image/jpeg" or "thumburl" not in ii: continue
        name = re.sub(r"[^A-Za-z0-9_.-]+", "_", p["title"].replace("File:", ""))[:80]
        rel = os.path.join(label, os.path.splitext(name)[0] + ".jpg")
        if rel in have: continue
        try:
            open(os.path.join(OUT, rel), "wb").write(get(ii["thumburl"]))
        except Exception as ex:
            print("skip", name, ex); continue
        meta = ii.get("extmetadata", {})
        manifest.append({"label": label, "file": rel, "source": ii.get("descriptionurl"), "query": q,
                         "licence": meta.get("LicenseShortName", {}).get("value"), "author": re.sub("<[^>]+>", "", meta.get("Artist", {}).get("value", ""))[:100]})
        have.add(rel); got += 1
        json.dump(manifest, open(man_path, "w"), indent=1)
    print(label, q, "->", got, flush=True)
