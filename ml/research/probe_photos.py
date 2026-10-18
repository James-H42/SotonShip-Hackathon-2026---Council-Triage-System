"""Embed real FixMyStreet photos with candidate encoders; the right encoder gives
embeddings whose mean matches the training mean and confident sensible predictions."""
import sys, glob, json, os, numpy as np, torch, joblib, warnings
warnings.filterwarnings("ignore")
from PIL import Image
IC, FMS = sys.argv[1], sys.argv[2]
X = np.load(f"{IC}/X_train.npy"); mu = X.mean(0)
clf = joblib.load(f"{IC}/soton_triage_classifier.joblib")
rows = {str(json.loads(l)["id"]): json.loads(l) for l in open(f"{FMS}/reports.jsonl")}
photos = sorted(glob.glob(f"{FMS}/photos/*"))[:40]
imgs = [Image.open(p).convert("RGB") for p in photos]
cats = [rows.get(os.path.basename(p).split(".")[0].split("_")[0], {}).get("category") for p in photos]
def report(name, E):
    E = E / np.linalg.norm(E, axis=1, keepdims=True)
    m = E.mean(0); cos = float(m @ mu / np.linalg.norm(m) / np.linalg.norm(mu))
    P = clf.predict_proba(E); pred = clf.classes_[P.argmax(1)]
    print(f"{name:32s} cos(mean)={cos:.3f} meanconf={P.max(1).mean():.3f}", list(zip(cats[:12], pred[:12])))
def hf(model_id, pool):
    from transformers import AutoModel, AutoImageProcessor
    proc = AutoImageProcessor.from_pretrained(model_id); m = AutoModel.from_pretrained(model_id).eval()
    with torch.no_grad():
        out = m(**proc(images=imgs, return_tensors="pt"))
    return pool(out).float().numpy()
cands = {
 "dinov2-base CLS": lambda: hf("facebook/dinov2-base", lambda o: o.last_hidden_state[:, 0]),
 "dinov2-base pooler": lambda: hf("facebook/dinov2-base", lambda o: o.pooler_output),
 "vit-base-in21k CLS": lambda: hf("google/vit-base-patch16-224-in21k", lambda o: o.last_hidden_state[:, 0]),
 "vit-base-in21k pooler": lambda: hf("google/vit-base-patch16-224-in21k", lambda o: o.pooler_output),
 "clip-vit-l14 image_embeds": None,
}
for k, f in cands.items():
    if f is None:
        from transformers import CLIPModel, CLIPProcessor
        p = CLIPProcessor.from_pretrained("openai/clip-vit-large-patch14"); m = CLIPModel.from_pretrained("openai/clip-vit-large-patch14").eval()
        with torch.no_grad(): E = m.get_image_features(**p(images=imgs, return_tensors="pt"))
        E = E.pooler_output if hasattr(E, "pooler_output") else E
        report(k, E.float().numpy()); continue
    try: report(k, f())
    except Exception as e: print(k, "ERR", e)
