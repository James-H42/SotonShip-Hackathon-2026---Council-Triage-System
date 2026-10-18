"""
Image triage service for the Street Triage app.

Wraps the team's pre-trained classifier (soton_triage_classifier.joblib, a
logistic regression over 768-d image embeddings). The embeddings were produced
by Google SigLIP2-base (google/siglip2-base-patch16-224, L2-normalised image
features): we identified it by matching the training set's embedding statistics
(see README "Image model"). SigLIP2's text tower also gives a zero-shot
severity estimate for the predicted category.

Run:  ml/.venv/bin/python ml/vision_service.py   (listens on 127.0.0.1:8765)

POST /analyse   multipart field "file"  or  JSON {"path": "/abs/path.jpg"}
 -> {
      "predicted_category": "pothole",        # classifier label
      "category": "pothole",                  # mapped to the app taxonomy
      "confidence": 0.91,                     # top class probability
      "uncertainty_score": 0.18,              # normalised entropy, 0 = certain, 1 = maximally uncertain
      "severity": "high",                     # low | medium | high
      "severity_score": 0.83,                 # 0..1
      "probabilities": {...}, "model": "...", "elapsed_ms": 120
    }
"""
import io
import math
import os
import time
import warnings

warnings.filterwarnings("ignore")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import joblib  # noqa: E402
import numpy as np  # noqa: E402
import torch  # noqa: E402
from fastapi import FastAPI, File, HTTPException, Request, UploadFile  # noqa: E402
from PIL import Image, ImageOps  # noqa: E402
from transformers import AutoModel, AutoProcessor  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.environ.get("VISION_CLASSIFIER", os.path.join(HERE, "models", "soton_triage_classifier.joblib"))
ENCODER_ID = os.environ.get("VISION_ENCODER", "google/siglip2-base-patch16-224")
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"

# Classifier labels -> app taxonomy ids (lib/taxonomy.ts).
TAXONOMY = {
    "pothole": "pothole",
    "fly_tipping": "fly_tipping",
    "litter": "litter",
    "graffiti": "vandalism",
    "broken_lights": "street_light",
}

# Zero-shot severity prompts per class: (low, medium, high).
SEVERITY_PROMPTS = {
    "pothole": ("a small shallow crack in the road surface", "a pothole in the road", "a very large deep dangerous pothole in a busy road"),
    "fly_tipping": ("a single small bag of rubbish dumped on a pavement", "a pile of dumped rubbish and furniture", "a huge pile of fly-tipped waste blocking the street"),
    "litter": ("a few pieces of litter on the ground", "litter scattered across a pavement", "broken glass and lots of litter covering the ground"),
    "graffiti": ("a small tag of graffiti", "graffiti on a wall", "large offensive graffiti covering a whole wall"),
    "broken_lights": ("a street light that is slightly dim", "a broken street light", "a damaged street light column with exposed wires leaning over"),
}
LEVELS = ("low", "medium", "high")

# Zero-shot class prompts. On 62 labelled FixMyStreet photos the classifier alone scored 47%
# (it over-predicts "litter" on real photos), zero-shot 69%, and the 50/50 ensemble 61%
# (README "Image model"). The ensemble keeps the team's classifier central while
# correcting its domain bias. Set VISION_ENSEMBLE=0 for the classifier alone.
CLASS_PROMPTS = {
    "broken_lights": "a photo of a broken street light",
    "fly_tipping": "a photo of fly-tipping: furniture, mattresses or bags of rubbish dumped in the street",
    "graffiti": "a photo of graffiti spray painted on a wall",
    "litter": "a photo of litter and rubbish scattered on the ground",
    "pothole": "a photo of a pothole or damaged road surface",
}
ENSEMBLE = float(os.environ.get("VISION_ENSEMBLE", "0.5"))

app = FastAPI(title="Street Triage vision service")
_state: dict = {}


def load():
    if _state:
        return _state
    t = time.time()
    clf = joblib.load(MODEL_PATH)
    processor = AutoProcessor.from_pretrained(ENCODER_ID)
    model = AutoModel.from_pretrained(ENCODER_ID).eval().to(DEVICE)
    prompts = {k: list(v) for k, v in SEVERITY_PROMPTS.items()}
    flat = [p for k in clf.classes_ for p in prompts[k]] + [CLASS_PROMPTS[k] for k in clf.classes_]
    with torch.no_grad():
        tok = processor(text=flat, padding="max_length", max_length=64, return_tensors="pt").to(DEVICE)
        te = model.get_text_features(**tok)
        te = getattr(te, "pooler_output", te)
        te = torch.nn.functional.normalize(te.float(), dim=-1).cpu().numpy()
    n = len(clf.classes_)
    text = {k: te[i * 3:(i + 1) * 3] for i, k in enumerate(clf.classes_)}
    _state.update(clf=clf, processor=processor, model=model, text=text, class_text=te[n * 3:],
                  scale=float(model.logit_scale.exp().item()) if hasattr(model, "logit_scale") else 100.0)
    print(f"vision service ready on {DEVICE} in {time.time() - t:.1f}s", flush=True)
    return _state


def embed(img: Image.Image) -> np.ndarray:
    s = load()
    with torch.no_grad():
        inputs = s["processor"](images=[img], return_tensors="pt").to(DEVICE)
        e = s["model"].get_image_features(**inputs)
        e = getattr(e, "pooler_output", e)
        e = torch.nn.functional.normalize(e.float(), dim=-1).cpu().numpy()
    return e


def analyse_image(img: Image.Image) -> dict:
    t = time.time()
    s = load()
    img = ImageOps.exif_transpose(img).convert("RGB")
    e = embed(img)
    clf_probs = s["clf"].predict_proba(e)[0]
    logits = (s["class_text"] @ e[0]) * s["scale"]
    zs = np.exp(logits - logits.max())
    zs /= zs.sum()
    probs = (1 - ENSEMBLE) * clf_probs + ENSEMBLE * zs
    classes = list(s["clf"].classes_)
    top = int(np.argmax(probs))
    label = classes[top]
    # Normalised Shannon entropy: 0 = one class certain, 1 = all classes equally likely.
    entropy = -sum(float(p) * math.log(float(p)) for p in probs if p > 0)
    uncertainty = entropy / math.log(len(classes))
    sims = s["text"][label] @ e[0]
    w = np.exp((sims - sims.max()) * s["scale"])
    w /= w.sum()
    severity_score = float(w @ np.array([0.15, 0.5, 0.9]))
    severity = LEVELS[int(np.argmax(w))]
    return {
        "predicted_category": label,
        "category": TAXONOMY.get(label),
        "confidence": round(float(probs[top]), 4),
        "uncertainty_score": round(uncertainty, 4),
        "severity": severity,
        "severity_score": round(severity_score, 4),
        "probabilities": {c: round(float(p), 4) for c, p in zip(classes, probs)},
        "classifier_probabilities": {c: round(float(p), 4) for c, p in zip(classes, clf_probs)},
        "classifier_category": classes[int(np.argmax(clf_probs))],
        "model": f"{os.path.basename(MODEL_PATH)} + {ENCODER_ID}" + (f" (ensemble {ENSEMBLE:g} zero-shot)" if ENSEMBLE else ""),
        "elapsed_ms": int((time.time() - t) * 1000),
    }


@app.get("/health")
def health():
    load()
    return {"ok": True, "device": DEVICE, "encoder": ENCODER_ID}


@app.post("/analyse")
async def analyse(request: Request, file: UploadFile | None = File(default=None)):
    try:
        if file is not None:
            img = Image.open(io.BytesIO(await file.read()))
        else:
            body = await request.json()
            img = Image.open(body["path"])
    except Exception as ex:  # bad input -> clear 400, never a crash
        raise HTTPException(status_code=400, detail=f"Could not read image: {ex}")
    return analyse_image(img)


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:  # CLI: python vision_service.py photo.jpg ...
        import json

        for p in sys.argv[1:]:
            print(p, json.dumps(analyse_image(Image.open(p))))
    else:
        import uvicorn

        load()
        uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("VISION_PORT", 8765)), log_level="warning")
