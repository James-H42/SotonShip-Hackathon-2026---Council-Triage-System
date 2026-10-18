import sys, glob, numpy as np, torch, warnings; warnings.filterwarnings("ignore")
from PIL import Image
imgs=[Image.open(p).convert("RGB") for p in sorted(glob.glob(sys.argv[1]+"/photos/*"))[:24]]
def show(name,E):
    E=E/np.linalg.norm(E,axis=1,keepdims=True); mu=E.mean(0); o=np.argsort(-np.abs(mu))[:5]
    print(f"{name:40s} dim={E.shape[1]} top={o} vals={np.round(mu[o],2)} meancos={(E@E.T).mean():.2f}", flush=True)
from transformers import AutoModel, AutoProcessor, AutoImageProcessor, CLIPModel
def clip(mid):
    p=AutoProcessor.from_pretrained(mid); m=CLIPModel.from_pretrained(mid).eval()
    with torch.no_grad(): E=m.get_image_features(**p(images=imgs,return_tensors="pt"))
    E=getattr(E,"pooler_output",E); show(mid,E.numpy())
def auto(mid,pool):
    p=AutoImageProcessor.from_pretrained(mid); m=AutoModel.from_pretrained(mid).eval()
    with torch.no_grad(): o=m(**p(images=imgs,return_tensors="pt"))
    show(mid+" "+pool.__name__, pool(o).numpy())
def cls(o): return o.last_hidden_state[:,0]
def mean(o): return o.last_hidden_state[:,1:].mean(1)
def pooler(o): return o.pooler_output
for f in [lambda: clip("openai/clip-vit-large-patch14"), lambda: clip("openai/clip-vit-base-patch16"), lambda: clip("laion/CLIP-ViT-L-14-laion2B-s32B-b82K"),
          lambda: auto("facebook/dinov2-base",cls), lambda: auto("facebook/dinov2-base",mean),
          lambda: auto("google/vit-base-patch16-224",cls), lambda: auto("google/vit-base-patch16-224-in21k",mean),
          lambda: auto("microsoft/beit-base-patch16-224-pt22k-ft22k",pooler), lambda: auto("facebook/convnext-tiny-224",pooler)]:
    try: f()
    except Exception as e: print("ERR",str(e)[:120], flush=True)
