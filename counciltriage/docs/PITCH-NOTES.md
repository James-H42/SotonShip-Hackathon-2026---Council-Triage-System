# Pitch notes: evidence against the judging criteria

Talking points for the team, mapped to the five criteria in the project notes. Figures come from
the team's notes (with their sources) or from this system's own measurements (`npm run ai:eval`,
`docs/EVALUATION.md`). Check any number before quoting it on stage.

## Problem and user (20%)

- **Who:** council officers who sort street reports, and residents who make them.
- **Local evidence (team notes):** about 12,200 fly-tipping cases in Southampton in 2024/25, 47.1
  per 1,000 people and more than double the national rate (data.southampton.gov.uk/place/environment/waste).
  The 2025-2030 City Plan adds £500M for road maintenance, which needs careful prioritising.
- **National (team notes):** 1.26m fly-tipping incidents in England in 2024/25 (gov.uk). The local
  road repair backlog is about £16.8bn (ALARM, via localgov.co.uk).
- **What happens today:** a separate semi-structured form for each problem, buried in council web
  menus. FixMyStreet's free text holds 8,000+ Southampton reports that mostly bypass council
  systems. Officers sort messy, duplicated reports by hand.
- **Demo data:** 14,858 real Southampton FixMyStreet reports (2007 to 6 Oct 2026). The last 120 days
  are the live queue and older reports are history.

## AI at the core (20%)

- **What AI does that a form can't:** it reads free text ("the lamp by the steps is dark, my
  neighbour tripped and hurt her wrist") and turns it into a category, an injury flag, a
  vulnerable-people flag and an urgency. It merges differently worded reports of the same problem,
  and checks photos against what the resident said.
- **Compared with a simple baseline** on the team's 40 labelled reports:

  | | Keyword rules | Local LLM |
  | --- | --- | --- |
  | Category (incl. adjacent) | 70% | 93% |
  | Urgency within one level | 55% | 100% |

  The keyword rules come close on injury flags (98% vs 100%), which depend on explicit words. Be honest that the
  prompt was refined on this same set, and that the next step is a held-out set labelled by officers.
- **Model choice:** qwen3:8b runs locally. qwen3:4b was twice as fast, but its merge recall fell
  from 80% to 29%, so we kept 8b. The image model is the team's classifier over SigLIP2 embeddings,
  plus a zero-shot ensemble (47% → 61% on real photos).
- **Grounded outputs:** the LLM's answers are schema-constrained and validated. Council policy, the
  escalation override and the injury floor always apply, and officers can override anything.
- **Prioritisation:** the team's Incident Risk Priority Score, adjusted. On the same inputs, the
  adjusted version ranks incidents closer to the ground truth (Spearman 0.80-0.83 vs 0.59-0.67).

## Working product (25%)

- Runs live, end to end, on a MacBook Air M3. A resident submits with a photo and gets a reference
  in under 100 ms. The image model, LLM, merge check and priority update finish in about 5-6 s in
  the background.
- **Bad input and missing data** (README "When things go wrong"): a model offline falls back to the
  rules and retries later. A screenshot instead of a photo has uncertainty 0.95 and is ignored. A
  photo that contradicts the report goes to review. A location outside the city is refused or flagged.
- **Outside the area:** the map is locked to the ward boundary, and the server checks every point.
- **Tests:** 69 automated tests, plus 19/19 user-journey checks against the live app (`docs/JOURNEY-RESULTS.md`). Evaluation report in `docs/EVALUATION.md`.

## Business and scale (20%)

- **Who pays:** the council, as a triage layer in front of its existing systems. It does not replace them.
- **Running cost:** inference is local, so there is no per-report API fee. One GPU machine handles a
  city's daily volume at about 6 s per report. 10x or 100x volume means a small GPU server or a
  queue, and the code already processes one job at a time through a queue.
- **Second city:** swap the ward boundaries and road overlay (`geo/`, with a script to rebuild them
  from ONS and OpenStreetMap) and the council branding. The AI and formula do not change.
- **Outcomes a council could measure:** time from report to triage, duplicates merged, critical
  incidents resolved within 24 h, and crew jobs per day (routes for 2-person crews, up to 5 jobs each).

## Responsibility and trust (15%)

- **No external AI:** report text and photos never leave the machine.
- **Personal data minimised:** residents see only a summary of other people's reports (type,
  approximate place, status), never descriptions, photos or contact details. The phone number field
  was removed. Photos are served only to officers and the reporter.
- **Who catches errors:** uncertain or conflicting cases go to the "Needs review" queue. Officers
  can override the category or priority, mark reports dubious or genuine, and unmerge. Every
  correction is logged as feedback for retraining.
- **Uncertainty is shown to officers:** confidence and uncertainty for each photo, and an itemised
  priority breakdown.
- **Safety:** the form tells residents to call 999 if someone is in danger, and links to the
  council's official contact page.
- **Accessibility:** a single structured form, an "I cannot use the map" option, postcode and street
  search, and a mobile layout.
