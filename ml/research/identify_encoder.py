"""Find which image encoder produced X_train.npy: the class centroids should
line up with matching CLIP text prompts in the right embedding space."""
import sys, numpy as np, torch, open_clip
X = np.load(sys.argv[1]); y = np.load(sys.argv[2])
classes = sorted(set(y))
cent = np.stack([X[y == c].mean(0) for c in classes]); cent /= np.linalg.norm(cent, axis=1, keepdims=True)
prompts = {"broken_lights": "a photo of a broken street light", "fly_tipping": "a photo of fly-tipping, dumped rubbish on the street",
           "graffiti": "a photo of graffiti on a wall", "litter": "a photo of litter on the ground", "pothole": "a photo of a pothole in the road"}
for name, pre in [("ViT-L-14", "openai"), ("ViT-L-14", "laion2b_s32b_b82k"), ("ViT-B-16-SigLIP", "webli")]:
    try:
        m, _, _ = open_clip.create_model_and_transforms(name, pretrained=pre); tok = open_clip.get_tokenizer(name)
        with torch.no_grad():
            t = m.encode_text(tok([prompts[c] for c in classes])).float().numpy()
        t /= np.linalg.norm(t, axis=1, keepdims=True)
        if t.shape[1] != X.shape[1]: print(name, pre, "dim", t.shape); continue
        sim = cent @ t.T
        print(name, pre, "diag acc", (sim.argmax(1) == np.arange(len(classes))).mean(), "diag mean", sim.diagonal().mean().round(3), "off", (sim.sum() - sim.trace()) / 20)
    except Exception as e:
        print(name, pre, "ERR", e)
