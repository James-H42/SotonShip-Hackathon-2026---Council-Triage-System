# Overnight build status (SotonShip 2026)

## Update (03:00, 18 Oct): second request done

- **Photo GPS:** photos' location data sets the report location if it is inside Southampton. With
  several photos, all must be within 100 m, and the first is used; otherwise the resident's pin is
  used. Available on the Location step ("Use my photo's location") and on Details. Officers see
  "(from photo GPS)". Demo photos with GPS are in `data/demo-photos/`.
- **User stories and journeys:** `docs/USER-JOURNEYS.md` (Alex the resident, Sam the officer). The
  automated run (`npm run journeys`) passes 19/19 (`docs/JOURNEY-RESULTS.md`), plus manual browser checks.
- **Refinements from the journeys:** an injury grounding check (injury accuracy 98% → 100%), the
  photo location on the Location step, and unmerge in the API.
- **Refactor:** removed the schematic-map leftovers, the duplicated bounds, the unused overview
  roads file and about ten dead functions. 69 tests pass; lint and typecheck are clean.
- **Scripts for the pitch:** `docs/DEMO-VIDEO-SCRIPT.md` (3-minute shot list) and
  `docs/PITCH-SCRIPT.md` (about 5 minutes, organised by mark-scheme section, with likely questions).

## Morning summary (written 02:25, 18 Oct)

**All requested tasks are done and verified in the browser.** The demo runs with `npm run demo`
(production on http://localhost:3100). Logins are in `.secrets/demo-accounts.json`.

- Start page asks Resident or Council. There is one "Report a problem" entry and no draft prompt.
  Sign-out and the staff and resident logins work, with no auto sign-in. The footer shows SCC contact
  details only. Residents see only privacy-safe summaries of other people's reports, and the duplicate
  check happens inside the form.
- The team's Leaflet map, with its key-roads overlay, replaces the old map everywhere. It is limited
  to the city boundary and takes postcodes, streets and what3words (**a what3words key is needed:
  `W3W_API_KEY` in `.env.local`**).
- Image model: the team classifier over SigLIP2 embeddings (encoder identified from the training
  data), ensembled with zero-shot, giving category, confidence, uncertainty and severity. A photo that
  contradicts the report goes to officer review.
- Local LLM: qwen3:8b via Ollama, using the team's civic_triage prompt. It extracts category, injury,
  vulnerable people and urgency, checks merges, and feeds injuries per week. Merged reports stay
  separate and can be viewed and unmerged.
- Incident Risk Priority Score is implemented with and without photos. The changes are explained in
  the README, and the adjusted formula ranks better (Spearman 0.80-0.83 vs 0.59-0.67 for the original).
- Routes: up to 5 jobs per 2-person crew, starting at the first job, with no depot inputs. Documented
  in the README.
- Only the last 120 days of FixMyStreet reports are open, and older ones are history.
- Evidence is in docs/EVALUATION.md (`npm run ai:eval`). 60 tests pass, and lint, typecheck and build
  are clean.

**For the pitch:** `docs/PITCH-NOTES.md` maps the evidence to each judging criterion.

**Before the pitch:** run `ollama serve` if the Ollama app is not running, then `npm run demo`
(~9 min with a full reset, or `npm run demo -- --fast` to keep data). Restart the server after any
`npm run seed`.

Kept up to date by the coordinating Claude session so work can resume after a usage-limit reset.
Deadline: team returns ~07:00 UK; pitch 13:00 UK.

## Parallel sessions (same folder, no git)
- `ux-auth`: landing chooser, resident/officer login, sign-out fix, footer, privacy, duplicate check in the form. Progress: docs/STATUS-ux-auth.md
- `map`: Leaflet map + key-roads overlay + boundary + postcode/what3words search in components/map/**. Progress: docs/STATUS-map.md
- coordinator (AI core): lib/ai/**, lib/triage/**, lib/repo/**, lib/geo.ts, lib/routing.ts, scripts/**, ml/**, README.md

## AI core: done
- Image model: ml/vision_service.py (SigLIP2-base embeddings + team joblib classifier, uncertainty = normalised entropy, zero-shot severity). Start: `npm run ai:vision` (port 8765).
- LLM: lib/ai/ollama.ts (qwen3:8b via Ollama, civic_triage prompt + schema). ~2.7 s warm.
- Pipeline: lib/ai/pipeline.ts (vision -> LLM -> retriage -> LLM-confirmed auto-merge), hooked into dispatchNewReport.
- Priority: lib/triage/priority.ts implements the Incident Risk Priority Score (adjusted); cluster stats in lib/repo/reports.ts clusterStats().
- Mismatch review: lib/triage/combine.ts (image vs resident vs LLM category).
- Seed: archives open FMS reports older than 120 days; loads 40 synthetic reports (data/synthetic); `npm run seed && npm run ai:process`.

## AI core: also done (01:45)
- Merging: shortlist = open incidents within 60 m of a related category (same LLM label for "other"); LLM judges "same problem?" against the whole incident text.
- Image ensemble (classifier + SigLIP2 zero-shot, 47% -> 61% on FMS photos).
- Injury floor (>= high). Tests updated/added (54 passing).
- scripts/evaluate-ai.mts -> docs/EVALUATION.md (LLM vs baseline, merge P/R, Spearman).
- Routing rewritten: <= 5 jobs per 2-person crew, starts at first job, exact ordering; depot inputs removed.
- Officer report page: merged incident card (each report's text, photos, AI outputs) + risk-term breakdown.
- README: AI triage, Prioritisation (formula + changes), Route planning, Libraries sections.

## Also done (01:05)
- Verified in browser: start chooser, staff login/sign-out, resident login + My reports, dashboard, report detail (merged incident), route planner (2 crews x 5 jobs), resident form search + privacy-safe duplicate check, live API submission -> AI triage in ~5 s.
- Merge sweep in ai:process (recall 53% -> 80%, precision 95%); uncertainty cut-off 0.7; real photos for synthetic reports.
- Resident's choice wins between adjacent categories; fly-tipping vs litter defined in the LLM prompt.
- `npm run demo` (scripts/demo.sh) one-command pitch setup; production server on :3100.
- Removed unneeded inputs: phone field (resident form), "jobs to consider" (planner), depot lat/lon (planner).

## Also done (02:10)
- qwen3:4b vs 8b evaluated (4b 2x faster but merge recall 29%) -> 8b kept; README documents why.
- Original vs adjusted formula ranking: Spearman 0.59-0.67 vs 0.80-0.83 (in EVALUATION.md + README).
- Officer queue rows show "injury reported" / "vulnerable people"; dashboard map shown before the list below 2xl.
- Failure modes tested (vision down, recovery incl. merged reports) + README table.
- Unmerge action (officer undo of AI merge) + test (60 tests passing).

## Also done (02:30)
- AI queue counts exclude closed history (seed marks it `skipped`); AI merges no longer counted as officer corrections.
- `docs/PITCH-NOTES.md` (evidence per judging criterion); `ml/requirements.txt`; `ml/research/` (encoder identification).
- tests/ai.test.ts (LLM answer validation): 60 tests passing. Demo script warms both models.
- Final full reset done at 02:30: production on :3100 with fresh, AI-processed data. Eval: category 93%, merge P/R 95%/80%, Spearman 0.81 (original formula 0.66).

## Remaining (optional, low risk only)
All requested tasks are complete. A resumed session should only:
1. Verify: `curl -s localhost:3100/` returns 200, `curl -s localhost:8765/health` ok, `ollama ps` shows qwen3:8b. If anything is down, run `npm run demo -- --fast`.
2. Make only small, tested fixes (npm test, lint, typecheck). Do not change the AI prompts, formula or seed data (the evaluation numbers in README/PITCH-NOTES depend on them).
3. If any data-changing test is done in the browser, finish with `npm run demo` (full reset) before 06:45.
03:21: resume task found the coordinator active, exited
