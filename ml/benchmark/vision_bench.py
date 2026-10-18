"""Image model benchmark: accuracy, calibration, uncertainty, robustness and speed.

Compares the team classifier alone, SigLIP2 zero-shot alone and the deployed 50/50 ensemble on:
  A. 83 real FixMyStreet photos, hand-labelled (photo_ground_truth.json)
  B. openly licensed Wikimedia Commons photos (internet/, labels from their category)
  C. synthetic non-photos (negatives/) and degraded copies of real photos (variants/)
  D. the classifier's own training embeddings (5-fold cross-validation)
Writes results/vision.json.   Run: ../.venv/bin/python -I vision_bench.py
"""
import glob
import importlib.util
import json
import math
import os
import sys
import time
import warnings

warnings.filterwarnings("ignore")
import numpy as np  # noqa: E402
import torch  # noqa: E402
from PIL import Image, ImageOps  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
# FixMyStreet scrape photos (not in the repo). Override with FMS_PHOTOS.
FMS = os.environ.get("FMS_PHOTOS", os.path.join(HERE, "..", "..", "..", "FixMyStreet Scraper", "fixmystreet_sample", "photos"))
# The team classifier's training embeddings (X_train.npy, y_train.npy). Override with CLASSIFIER_DATA.
IC = os.environ.get("CLASSIFIER_DATA", os.path.join(HERE, "..", "..", "..", "Individual Components", "ImageClassificationModel"))
spec = importlib.util.spec_from_file_location("vision_service", os.path.join(HERE, "..", "vision_service.py"))
vs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vs)

t0 = time.time()
S = vs.load()
cold_load_s = time.time() - t0
CLASSES = list(S["clf"].classes_)

# Which model classes count as right for each ground-truth label.
STRICT = {"pothole": {"pothole"}, "road_damage": {"pothole"}, "fly_tipping": {"fly_tipping"}, "litter": {"litter"},
          "graffiti": {"graffiti"}, "bus_shelter": {"graffiti"}, "broken_lights": {"broken_lights"}}
ADJACENT = {**STRICT, "fly_tipping": {"fly_tipping", "litter"}, "litter": {"litter", "fly_tipping"}}
OUT_OF_SCOPE = {"other", "not_a_photo", "negative"}


def open_img(path):
    return ImageOps.exif_transpose(Image.open(path)).convert("RGB")


def probs(img):
    """Return (classifier, zero-shot, ensemble) class probabilities and per-image latency in ms."""
    t = time.perf_counter()
    e = vs.embed(img)
    clf = S["clf"].predict_proba(e)[0]
    logits = (S["class_text"] @ e[0]) * S["scale"]
    zs = np.exp(logits - logits.max())
    zs /= zs.sum()
    ens = (1 - vs.ENSEMBLE) * clf + vs.ENSEMBLE * zs
    return {"classifier": clf, "zero_shot": zs, "ensemble": ens}, (time.perf_counter() - t) * 1000


def uncertainty(p):
    return -sum(float(x) * math.log(float(x)) for x in p if x > 0) / math.log(len(p))


def auroc(pos, neg):
    """P(score of a positive > score of a negative): 0.5 = chance, 1 = perfect separation."""
    if not pos or not neg:
        return None
    wins = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    return wins / (len(pos) * len(neg))


def ece(conf, correct, bins=10):
    conf, correct = np.array(conf), np.array(correct, dtype=float)
    total = 0.0
    for b in range(bins):
        m = (conf > b / bins) & (conf <= (b + 1) / bins)
        if m.any():
            total += m.mean() * abs(conf[m].mean() - correct[m].mean())
    return float(total)


def evaluate(items, method):
    """items: list of {label, p}. Accuracy on in-scope items, plus uncertainty behaviour."""
    ins = [it for it in items if it["label"] in STRICT]
    outs = [it for it in items if it["label"] in OUT_OF_SCOPE]
    res = {"n_in_scope": len(ins), "n_out_of_scope": len(outs)}
    if ins:
        pred = [CLASSES[int(np.argmax(it["p"][method]))] for it in ins]
        strict = [p in STRICT[it["label"]] for p, it in zip(pred, ins)]
        adj = [p in ADJACENT[it["label"]] for p, it in zip(pred, ins)]
        conf = [float(np.max(it["p"][method])) for it in ins]
        unc = [uncertainty(it["p"][method]) for it in ins]
        f1s = []
        for c in CLASSES:
            tp = sum(1 for p, it in zip(pred, ins) if p == c and c in STRICT[it["label"]])
            fp = sum(1 for p, it in zip(pred, ins) if p == c and c not in STRICT[it["label"]])
            fn = sum(1 for p, it in zip(pred, ins) if p != c and c in STRICT[it["label"]])
            if tp + fn:
                f1s.append(2 * tp / (2 * tp + fp + fn))
        confusion = {}
        for p, it in zip(pred, ins):
            confusion.setdefault(it["label"], {}).setdefault(p, 0)
            confusion[it["label"]][p] += 1
        res.update(
            accuracy=float(np.mean(strict)), accuracy_adjacent=float(np.mean(adj)), macro_f1=float(np.mean(f1s)),
            ece=ece(conf, strict),
            error_detection_auroc=auroc([u for u, ok in zip(unc, strict) if not ok], [u for u, ok in zip(unc, strict) if ok]),
            unclear_rate_in_scope=float(np.mean([u > 0.7 for u in unc])),
            confusion=confusion,
        )
    if outs:
        unc_out = [uncertainty(it["p"][method]) for it in outs]
        res.update(unclear_rate_out_of_scope=float(np.mean([u > 0.7 for u in unc_out])))
        if ins:
            res.update(out_of_scope_auroc=auroc(unc_out, [uncertainty(it["p"][method]) for it in ins]))
    return res


METHODS = ["classifier", "zero_shot", "ensemble"]
results = {"cold_load_seconds": round(cold_load_s, 1), "device": vs.DEVICE, "encoder": vs.ENCODER_ID}
lat = []

# A. real FixMyStreet photos
gt = json.load(open(os.path.join(HERE, "photo_ground_truth.json")))["photos"]
A = []
for p in gt:
    pr, ms = probs(open_img(f"{FMS}/{p['file']}"))
    lat.append(ms)
    A.append({"label": p["label"], "p": pr, "file": p["file"]})
results["fixmystreet"] = {m: evaluate(A, m) for m in METHODS}
results["fixmystreet_labels"] = {k: sum(1 for p in gt if p["label"] == k) for k in sorted({p["label"] for p in gt})}

# B. Wikimedia Commons
B = []
man_path = os.path.join(HERE, "internet", "manifest.json")
files = json.load(open(man_path)) if os.path.exists(man_path) else [
    {"label": os.path.basename(os.path.dirname(f)), "file": os.path.relpath(f, os.path.join(HERE, "internet"))}
    for f in glob.glob(os.path.join(HERE, "internet", "*", "*.jpg"))]
excluded = set(json.load(open(os.path.join(HERE, "internet_excluded.json")))) if os.path.exists(os.path.join(HERE, "internet_excluded.json")) else set()
for f in files:
    if f["file"] in excluded:
        continue
    try:
        pr, ms = probs(open_img(os.path.join(HERE, "internet", f["file"])))
    except Exception:
        continue
    lat.append(ms)
    B.append({"label": f["label"], "p": pr, "file": f["file"]})
results["commons"] = {m: evaluate(B, m) for m in METHODS}
results["commons_labels"] = {k: sum(1 for b in B if b["label"] == k) for k in sorted({b["label"] for b in B})}

# C1. synthetic non-photos, plus the real "not a photo" images
C1 = [{"label": "negative", "p": probs(open_img(f))[0]} for f in sorted(glob.glob(os.path.join(HERE, "negatives", "*.jpg")))]
results["negatives"] = {m: {"n": len(C1), "unclear_rate": float(np.mean([uncertainty(it["p"][m]) > 0.7 for it in C1])),
                            "mean_uncertainty": float(np.mean([uncertainty(it["p"][m]) for it in C1]))} for m in METHODS}
results["all_out_of_scope_auroc"] = {m: auroc([uncertainty(it["p"][m]) for it in C1 + [a for a in A if a["label"] in OUT_OF_SCOPE]],
                                              [uncertainty(it["p"][m]) for it in A + B if it["label"] in STRICT]) for m in METHODS}

# C2. degraded copies of in-scope real photos (ensemble, as deployed)
vm = json.load(open(os.path.join(HERE, "variants", "manifest.json")))
clean = {a["file"]: a for a in A}
by_t = {}
for v in vm:
    pr, _ = probs(open_img(os.path.join(HERE, "variants", v["file"])))
    by_t.setdefault(v["transform"], []).append({"label": v["label"], "p": pr, "source": v["source"]})
rob = {"clean": evaluate([clean[s] for s in {v["source"] for v in vm}], "ensemble")}
for t, items in by_t.items():
    e = evaluate(items, "ensemble")
    flips = np.mean([CLASSES[int(np.argmax(it["p"]["ensemble"]))] != CLASSES[int(np.argmax(clean[it["source"]]["p"]["ensemble"]))] for it in items])
    rob[t] = {"accuracy_adjacent": e["accuracy_adjacent"], "accuracy": e["accuracy"], "unclear_rate": e["unclear_rate_in_scope"], "prediction_changed": float(flips)}
results["robustness"] = {k: {kk: vv for kk, vv in v.items() if kk in ("accuracy", "accuracy_adjacent", "unclear_rate", "unclear_rate_in_scope", "prediction_changed")} for k, v in rob.items()}

# D. in-distribution: the classifier's own training data, 5-fold cross-validation
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.model_selection import StratifiedKFold, cross_val_score  # noqa: E402

X, y = np.load(f"{IC}/X_train.npy"), np.load(f"{IC}/y_train.npy")
cv = cross_val_score(LogisticRegression(class_weight="balanced", max_iter=2000), X, y, cv=StratifiedKFold(5, shuffle=True, random_state=0))
results["training_set_cv_accuracy"] = {"mean": float(cv.mean()), "folds": [round(float(c), 3) for c in cv]}

# Severity sanity check (no severity labels exist): distribution per ground-truth class.
sev = {}
for a in A:
    if a["label"] in STRICT:
        r = vs.analyse_image(open_img(f"{FMS}/{a['file']}"))
        sev.setdefault(a["label"], {}).setdefault(r["severity"], 0)
        sev[a["label"]][r["severity"]] += 1
results["severity_by_label"] = sev

# Speed: warm per-image latency on this device, then on CPU, plus batch throughput.
lat_s = sorted(lat)
results["latency_ms"] = {"device": vs.DEVICE, "p50": lat_s[len(lat_s) // 2], "p95": lat_s[int(len(lat_s) * 0.95)], "mean": float(np.mean(lat_s)), "images": len(lat_s)}
sample = [open_img(f"{FMS}/{p['file']}") for p in gt[:16]]
with torch.no_grad():
    t = time.perf_counter()
    inputs = S["processor"](images=sample, return_tensors="pt").to(vs.DEVICE)
    S["model"].get_image_features(**inputs)
    results["batch16_images_per_second"] = round(16 / (time.perf_counter() - t), 1)
cpu_model = S["model"].to("cpu")
cpu_ms = []
with torch.no_grad():
    for img in sample[:8]:
        t = time.perf_counter()
        cpu_model.get_image_features(**S["processor"](images=[img], return_tensors="pt"))
        cpu_ms.append((time.perf_counter() - t) * 1000)
results["cpu_latency_ms_p50"] = sorted(cpu_ms)[len(cpu_ms) // 2]

os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
json.dump(results, open(os.path.join(HERE, "results", "vision.json"), "w"), indent=1, default=float)
print(json.dumps({k: results[k] for k in ("fixmystreet", "commons", "negatives", "latency_ms", "training_set_cv_accuracy")}, indent=1, default=float)[:4000])
