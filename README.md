# StreetTriage Southampton

**AI triage for council street reports. Built for SotonShip 2026 with Southampton City Council.**

Residents report potholes, fly-tipping, litter, graffiti, broken street lights and other problems
in under a minute. A local AI reads every report and checks every photo. It ranks the reports by
risk and merges duplicates. Council officers get one prioritised, de-duplicated queue, a
colour-coded map and a route planner that turns the worst problems into tomorrow's work orders.
Everything runs on a council laptop, so no report data is sent to a cloud AI service.

- **Demo video (2 min 16 s, silent with captions):** [`counciltriage/docs/StreetTriage-demo.mp4`](counciltriage/docs/StreetTriage-demo.mp4)
- **150-word summary:** [`counciltriage/docs/SUMMARY-150.md`](counciltriage/docs/SUMMARY-150.md)
- **Full technical README:** [`counciltriage/README.md`](counciltriage/README.md)
- **Benchmarks:** [`counciltriage/docs/BENCHMARKS.md`](counciltriage/docs/BENCHMARKS.md)

> Prototype for a hackathon. It is not a live council service, and the accounts are demo accounts.

---

## Contents

1. [What is in this repository](#what-is-in-this-repository)
2. [Software setup](#software-setup)
3. [Data sources](#data-sources)
4. [Training data for the image model (credits)](#training-data-for-the-image-model-credits)
5. [What the AI does](#what-the-ai-does)
6. [Tests and benchmarks](#tests-and-benchmarks)
7. [Limits](#limits)
8. [Privacy and security](#privacy-and-security)
9. [Credits for models, data and software](#credits-for-models-data-and-software)

---

## What is in this repository

```
counciltriage/            Next.js web app: resident site, council console, APIs, triage logic
  app/                    pages and API routes (resident: /report, /my-reports; officers: /council)
  lib/ai/                 local LLM client (Ollama) and AI pipeline
  lib/triage/             priority score, duplicate detection, keyword baseline
  lib/routing.ts          crew route planning (job selection and ordering)
  lib/road-routing.ts     road-network routing (OSRM) on top of the straight-line plan
  scripts/                seed, AI processing, evaluation, journeys, benchmarks, video recorder
  tests/                  Vitest unit and workflow tests
  data/synthetic/         the team's 40 synthetic reports with ground truth
  data/benchmark/         40 hold-out reports and 16 merge pairs for the LLM benchmark, plus results
  geo/                    Southampton wards (ONS) and key roads (OpenStreetMap)
  docs/                   benchmarks, evaluation, user journeys, video plan, pitch notes, demo video
ml/                       Python image service and benchmarks
  vision_service.py       FastAPI service: team classifier + SigLIP2 zero-shot ensemble (port 8765)
  models/                 soton_triage_classifier.joblib (the team's trained classifier)
  benchmark/              image benchmark scripts, hand-labelled ground truth and results
  research/               how the classifier's image encoder was identified
```

Not in the repository (licensing and size):
- the FixMyStreet scrape and its photos;
- the classifier's training images and embeddings;
- the downloaded Wikimedia Commons benchmark photos;
- the local database;
- the demo login file.

The app still runs without them: see below.

---

## Software setup

### Requirements

| Tool | Version | Used for |
| --- | --- | --- |
| Node.js | 22.5 or later (tested on 24) | The web app (uses the built-in `node:sqlite`) |
| [Ollama](https://ollama.com) | recent | Runs the local LLM `qwen3:8b` (about 5 GB) |
| Python | 3.11 or later | The image model service (PyTorch, Transformers) |
| macOS / Linux | | Tested on a MacBook Air M3, 24 GB (Apple GPU via MPS; CPU also works) |

### Steps

```bash
# 1. Web app dependencies
cd counciltriage
npm install

# 2. Local LLM
ollama pull qwen3:8b

# 3. Image model service (downloads SigLIP2 from Hugging Face on first run)
cd ../ml
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd ../counciltriage

# 4. Demo data and accounts
npm run seed
```

`npm run seed` creates `.secrets/demo-accounts.json` (git-ignored) with a council officer and a
resident account and random passwords; the logins are in that file. Without the FixMyStreet
scrape, it loads the 40 synthetic reports and the demo resident's history. To import the
14,858 real Southampton reports, set `FMS_DATA_DIR` (see `.env.example`).

```bash
# 5. One command for the full demo: checks Ollama, starts the image service,
#    seeds, runs AI triage, builds and serves on http://localhost:3100
npm run demo

# or, for development:
npm run ai:vision          # image service on :8765 (in its own terminal)
npm run dev                # http://localhost:3000
npm run ai:process         # triage any reports still waiting for the AI
```

Open the app, choose **I'm a resident** or **I work for the council**, and sign in with the
accounts in `.secrets/demo-accounts.json`.

### Optional settings (`counciltriage/.env.local`, see `.env.example`)

| Variable | Effect |
| --- | --- |
| `FMS_DATA_DIR` | Folder with the FixMyStreet scrape (`reports.jsonl`, `photos/`) to import real reports |
| `W3W_API_KEY` | Enables what3words search (`///word.word.word`). Server-side only, limited to 5 requests a second |
| `OSRM_URL` | Road-routing server for crew routes (default: the public OSRM server). A council would host its own |
| `LLM_MODEL` | Ollama model (default `qwen3:8b`) |

If Ollama or the image service is not running, reports are still accepted and ranked by the
keyword baseline and council policy rules. `npm run ai:process` triages them later.

---

## Data sources

| Data | What it is | Used for | In the repo? |
| --- | --- | --- | --- |
| **FixMyStreet reports** ([fixmystreet.com](https://www.fixmystreet.com), run by [mySociety](https://www.mysociety.org)) | 14,858 public Southampton reports with categories and photos, scraped by the team | Realistic queue, map and duplicates; hand-labelled photo benchmark | No: set `FMS_DATA_DIR` |
| **Team synthetic reports** | 40 reports across 16 real-world scenarios, with ground truth for category, injury, vulnerability, urgency and duplicates | Evaluation (`npm run ai:eval`) and the demo incidents | Yes: `counciltriage/data/synthetic/` |
| **LLM hold-out set** | 40 reports and 16 "same problem?" pairs, written after the prompt was finished and never used for tuning | LLM benchmark | Yes: `counciltriage/data/benchmark/` |
| **Wikimedia Commons photos** | 64 openly licensed photos of potholes, graffiti, fly-tipping, litter and broken street lights, screened by eye | Image benchmark | Manifest, with authors and licences: `ml/benchmark/internet/manifest.json` (re-download with `ml/benchmark/fetch_search.py`) |
| **Synthetic images** | Non-photos (colours, noise, screenshots, a map, a document) and degraded copies of real photos | Image model uncertainty and robustness | Generated by `ml/benchmark/make_synthetic.py` |
| **Ward boundaries** | ONS Wards (May 2026) for Southampton | Ward filter and route planning | Yes: `counciltriage/geo/` (see `geo/README.md`) |
| **Key roads** | Motorway, trunk and primary roads from OpenStreetMap | "Near a busy road" priority term and the map overlay | Yes: `counciltriage/geo/` |
| **Live lookups** | [postcodes.io](https://postcodes.io) (postcodes), [Nominatim](https://nominatim.org) (street names), [what3words](https://what3words.com) (three-word addresses), [OSRM](https://project-osrm.org) (road routes), [OpenStreetMap](https://www.openstreetmap.org) map tiles | Location search, crew routes, maps | Called at runtime; only search text or coordinates are sent |

---

## Training data for the image model (credits)

The team's image classifier (`ml/models/soton_triage_classifier.joblib`) was trained on images
from these public datasets. Our thanks to their authors. Please see each dataset's page for its
licence and terms.

| Problem type | Dataset | Link |
| --- | --- | --- |
| Potholes and road surface damage | Pothole Detection Dataset (AndrewMVD) | https://www.kaggle.com/datasets/andrewmvd/pothole-detection |
| Litter and street trash | TACO: Trash Annotations in Context (Pedro Proença) | https://github.com/pedropro/TACO |
| Fly-tipping and bulky waste | Garbage / Waste Classification Dataset v2 (sumn2u) | https://www.kaggle.com/datasets/sumn2u/garbage-classification-v2 |
| Graffiti and vandalism | Graffiti Classification Dataset (PinStripeZebra) | https://www.kaggle.com/datasets/pinstripezebra/graffiti-classification |
| Overgrown vegetation and weeds | Weed Image Detection Dataset (JaiDalmotra) | https://www.kaggle.com/datasets/jaidalmotra/weed-detection |
| Street light faults and damaged infrastructure | Road Issues Detection Dataset (programmerrdai) | https://www.kaggle.com/datasets/programmerrdai/road-issues-detection-dataset |

The classifier is a logistic regression over 768-dimensional
[SigLIP2-base](https://huggingface.co/google/siglip2-base-patch16-224) image embeddings
(`ml/research/README.md` explains how the encoder was identified). Its five output classes are
pothole, fly-tipping, litter, graffiti and broken street light.

---

## What the AI does

Everything below runs locally. The AI suggests; council rules and officers decide.

1. **Reads the report (local LLM: Qwen3 8B in Ollama).** It extracts the category, a short
   summary, whether someone was injured, whether vulnerable people are affected, and an urgency
   from 1 to 5. Answers are JSON checked against a schema. Two guards back it up:
   - an **injury grounding check** keeps an injury flag only if the text says harm actually happened;
   - a **prompt-injection guard** removes sentences that try to instruct the AI, and flags the
     report for an officer.
2. **Checks the photos (image model).** The team classifier and SigLIP2 zero-shot are averaged
   50/50. The result gives a category, a severity, and an **uncertainty** score. Photos with
   uncertainty above 0.7 (screenshots, blur, things the model has no class for) are marked
   "unclear" and ignored. A photo that contradicts the report sends it to an officer.
3. **Finds duplicates.**
   - *For residents:* before a report is sent, the LLM compares their words with open reports of
     the same type within 150 m. If it is the same problem, the resident joins that report and can
     add details. Their confirmation raises its priority.
   - *For officers:* location, category and text shortlist candidates, the LLM makes the final
     call, and merged reports appear as **one incident** that expands into every original report
     and photo. Officers can merge and unmerge by hand.
4. **Ranks by risk (Incident Risk Priority Score).** A transparent 0-100 score combines:
   - text and image severity;
   - closeness to a busy road;
   - injuries per week;
   - vulnerable people;
   - the number of reports.

   Every factor is listed on the report page. Council policy (for example pothole depth rules) and
   officer overrides always win over the model.
5. **Plans repairs.**
   - Two-person crews get up to five jobs each. The jobs are chosen for the most priority per
     minute of driving (using straight-line distance).
   - Every visiting order is then checked on real road driving times (OSRM on OpenStreetMap).
   - The route is drawn along the roads, with the straight line dashed.

---

## Tests and benchmarks

```bash
cd counciltriage
npm test             # 76 unit and workflow tests (Vitest)
npm run typecheck    # TypeScript
npm run lint         # ESLint
npm run journeys     # 29 end-to-end checks against the running app (adds test data; reset after)
npm run ai:eval      # LLM and ranking accuracy on the synthetic set -> docs/EVALUATION.md
```

**User journeys (`npm run journeys`, 29/29 pass).** These cover the team's test cases:
- a new report typed in a resident's own words;
- a possible repeat found by the LLM, then confirmed with optional details;
- opening a past report;
- an officer reviewing merged reports and photos;
- moving an issue to In progress and then Completed;
- a route for one issue type, drawn on real roads and scheduled;
- category and urgency filters updating the map;
- what3words, latitude/longitude and postcode-area search.

Results are in `counciltriage/docs/JOURNEY-RESULTS.md`.

**Benchmarks** (full tables in [`counciltriage/docs/BENCHMARKS.md`](counciltriage/docs/BENCHMARKS.md)):

| Measure | Result |
| --- | --- |
| LLM category accuracy, 40 unseen reports | **93%** (keyword baseline 80%) |
| LLM urgency within one level | **95%** (baseline 50%) |
| LLM injury flag | 100% |
| LLM duplicate judgement, 16 pairs | 100% (qwen3:4b found only 13% of duplicates, so 8b is used) |
| Messy text: typos, shouting, textspeak, long emails | 90-100% category accuracy |
| Prompt injection | Without the guard, category accuracy fell to 0%. With it, the attack has no effect and the report is flagged |
| Image ensemble, 83 real FixMyStreet photos | 77% (96% counting litter and fly-tipping as near categories); classifier alone 54% |
| Image ensemble, 64 Wikimedia Commons photos | 75% (97% counting near categories) |
| Photos it cannot classify marked "unclear" | 66% of out-of-scope real photos, 56% of non-photos |
| Speed (M3 laptop) | About 4 s per report for the LLM, 30 ms per photo |

---

## Limits

- **The image model is the weakest signal.**
  - Trained on clean dataset images, the classifier scores 100% in cross-validation but 54% on
    residents' photos, and it calls most fly-tipping "litter".
  - SigLIP2 zero-shot alone is more accurate (88%). The ensemble is kept because it is better at
    saying "unclear", but it should weight zero-shot more or be retrained on local photos.
  - For these reasons the text decides the category.
- **The LLM still misses some urgent cases** in the hold-out set, such as needles and exposed
  wires rated too low. The form's safety questions and council policy rules set a minimum priority
  for these, and officers make the final call. Benchmarks are on small sets of 40 reports, 16
  pairs and 83 photos.
- **Severity from photos has no ground truth.** It is a sanity check only.
- **what3words:** the current key's plan allows autosuggest but not exact coordinates. The pin goes
  to the nearest named place and the resident drags it to the spot.
- **Road routing** uses the public OSRM server, and needs internet. A council would host its own;
  without it the plan falls back to straight lines.
- **Prototype only.**
  - No email notifications are sent.
  - Resident sign-in on a new device uses an email plus a report reference, not a verified link.
  - SQLite and a single laptop are fine for a demo. A city-wide service would run the same models
    on a small GPU server.
- **Speed:** the LLM takes about 4 s per report in the background. That is fine for Southampton's
  daily volume, but not instant.

---

## Privacy and security

- Report text and photos never go to a cloud AI. The LLM (Ollama) and image model run locally.
- Residents see only privacy-safe summaries of other people's reports: an approximate place and a
  generic title, with no description, photos or contact details.
- A confirming resident's extra details are shown to officers only.
- API keys and demo passwords live in git-ignored files (`.env.local`, `.secrets/`). The
  what3words key is used server-side only.
- External lookups receive only what they need: a postcode, street name or three words for
  search, and job coordinates for road routing.

---

## Credits for models, data and software

- **LLM:** [Qwen3 8B](https://huggingface.co/Qwen/Qwen3-8B) (Alibaba Qwen team, Apache 2.0), run
  with [Ollama](https://ollama.com).
- **Image encoder:** [SigLIP2-base](https://huggingface.co/google/siglip2-base-patch16-224) (Google,
  Apache 2.0) via Hugging Face Transformers.
- **Image classifier training data:** see [Training data for the image model](#training-data-for-the-image-model-credits).
- **Reports:** [FixMyStreet](https://www.fixmystreet.com) by [mySociety](https://www.mysociety.org),
  and the residents of Southampton who reported problems.
- **Maps and roads:** © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL),
  [OSRM](https://project-osrm.org) and [Leaflet](https://leafletjs.com).
- **Boundaries:** Office for National Statistics, Open Government Licence v3.0. Contains OS data
  © Crown copyright and database right 2026.
- **Lookups:** [postcodes.io](https://postcodes.io) (Open Government Licence data),
  [Nominatim](https://nominatim.org) and [what3words](https://what3words.com).
- **Benchmark photos:** Wikimedia Commons contributors (authors and licences in
  `ml/benchmark/internet/manifest.json`).
- **Software:** Next.js, React, Tailwind CSS, TypeScript, Vitest, FastAPI, PyTorch, scikit-learn,
  Font Awesome and Playwright (for the video).
- **Branding:** Southampton City Council (SotonShip 2026 challenge partner), used for the
  hackathon prototype only.
