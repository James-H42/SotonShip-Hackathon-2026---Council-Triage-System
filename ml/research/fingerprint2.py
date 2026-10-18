import sys, glob, numpy as np, torch, warnings; warnings.filterwarnings("ignore")
from PIL import Image
imgs=[Image.open(p).convert("RGB") for p in sorted(glob.glob(sys.argv[1]+"/photos/*"))[:24]]
def show(name,E):
    E=np.asarray(E,dtype=np.float32); E=E/np.linalg.norm(E,axis=1,keepdims=True); mu=E.mean(0); o=np.argsort(-np.abs(mu))[:5]
    print(f"{name:45s} dim={E.shape[1]} top={o} vals={np.round(mu[o],2)} meancos={(E@E.T).mean():.2f}", flush=True)
from transformers import AutoModel, AutoProcessor
def hfimg(mid, **kw):
    p=AutoProcessor.from_pretrained(mid, **kw); m=AutoModel.from_pretrained(mid, **kw).eval()
    with torch.no_grad(): E=m.get_image_features(**p(images=imgs,return_tensors="pt"))
    show(mid, getattr(E,"pooler_output",E))
import open_clip
def oc(name,pre):
    m,_,pp=open_clip.create_model_and_transforms(name,pretrained=pre)
    with torch.no_grad(): E=m.encode_image(torch.stack([pp(i) for i in imgs]))
    show(f"open_clip {name} {pre}",E)
for f in [lambda: hfimg("google/siglip-base-patch16-224"), lambda: hfimg("google/siglip2-base-patch16-224"),
          lambda: hfimg("facebook/metaclip-l14-fullcc2.5b"), lambda: oc("ViT-L-14","datacomp_xl_s13b_b90k"),
          lambda: oc("ViT-L-14","dfn2b"), lambda: oc("ViT-L-14-quickgelu","metaclip_fullcc"), lambda: oc("ViT-B-16-SigLIP","webli"),
          lambda: oc("ViT-L-14","commonpool_xl_s13b_b90k"), lambda: hfimg("openai/clip-vit-large-patch14-336")]:
    try: f()
    except Exception as e: print("ERR",str(e)[:150], flush=True)
