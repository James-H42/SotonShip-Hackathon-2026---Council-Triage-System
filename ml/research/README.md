# How the image encoder was identified

`soton_triage_classifier.joblib` is a logistic regression over 768-d, L2-normalised image
embeddings (`X_train.npy`), but the encoder was not recorded. These scripts found it:

- `identify_encoder.py`: aligns class centroids with CLIP text prompts (ruled out OpenAI/LAION CLIP).
- `probe_photos.py`, `fingerprint.py`, `fingerprint2.py`: embed real FixMyStreet photos with
  candidate encoders and compare the large "outlier" dimensions of the mean embedding with the
  training set's. Training set: dims 242, 215, 186, 362 (0.52, 0.46, 0.10, -0.09).
  `google/siglip2-base-patch16-224` gives 242, 215, 186, 362 (0.52, 0.44, 0.12, -0.11), and the
  cosine between mean embeddings is 0.91. No CLIP, MetaCLIP, DFN, DataComp, DINOv2, ViT, BEiT or
  ConvNeXt variant matched.
