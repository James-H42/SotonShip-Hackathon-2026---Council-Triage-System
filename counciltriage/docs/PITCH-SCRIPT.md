# Pitch script (about 5 minutes)

Plain language, with one idea per line. Time for each section follows the mark scheme weights.
Facts and sources are in `PITCH-NOTES.md`; the live demo follows `DEMO-VIDEO-SCRIPT.md`.

---

## 1. The problem (about 1 minute): Problem and user, 20%

- Southampton had about **12,200 fly-tipping reports** last year, over **twice the national rate**.
- Add potholes, broken lights and graffiti, and that's a huge pile of reports for a small team.
- Reports come in as messy free text, through different forms, and many describe the same problem.
- Officers sort them by hand, so the dangerous ones can wait behind the trivial ones.
- The council has an extra **£500 million** for roads: it needs to go on the right repairs first.
- **Our users:** the triage officer, and the resident who just wants it fixed.

## 2. What the AI does (about 1 minute): AI at the core, 20%

- A form collects words, but it can't **understand** them. Our AI does three things a form can't:
  1. **Reads** each report: what it is, whether anyone was hurt, whether children or disabled people are at risk, and how urgent it is.
  2. **Looks** at the photo, and flags it when the photo doesn't match the words.
  3. **Spots duplicates**: five different descriptions of one broken lamp become one incident.
- It then ranks every incident with a clear score: how serious, how close to a main road, injuries, vulnerable people, and how many people reported it.
- **Is it better than simple rules?** On our test set it got the category right **93%** of the time against **70%** for keyword rules, and urgency within one level **100%** against **55%**.
- We tested the team's original scoring formula too. Our adjusted version ranks the test incidents much closer to the expected order.

## 3. Show it working (about 1.5 minutes): Working product, 25%

*(Live demo, short version of the video script.)*
- A resident reports a pothole with a photo. The photo's location fills in, and it's done in under a minute.
- Switch to the officer: it's already triaged and at the top, with the reason shown.
- Open the merged Westgate Street lamp: five reports, one incident, every photo kept.
- Plan tomorrow's route: two-person crews, five jobs each. Issue it, and the resident sees "Repair arranged".
- **When things go wrong:** if a model is offline the report is still accepted, and a screenshot instead of a photo is ignored. Anything unclear goes to a person.
- It runs on **real Southampton FixMyStreet data** (almost 15,000 reports) on this laptop, with 69 automated tests and 19 user-journey checks.

## 4. Business and scale (about 1 minute): Business and scale, 20%

- **Who pays:** the council. It sits in front of existing systems and doesn't replace them.
- **Cost:** the AI runs on the council's own hardware, so there's no fee per report. One machine handles a city's daily volume.
- **First customers:** Southampton, then neighbouring councils with the same problems, such as Portsmouth, Hampshire and Bournemouth.
- **A new city** only needs its map and ward boundaries swapped. The AI and scoring stay the same.
- **What a council would measure:** time from report to action, duplicates removed, dangerous problems fixed within 24 hours, and jobs per crew per day.

## 5. Trust and responsibility (about 45 seconds): Responsibility and trust, 15%

- **Nothing leaves the council.** No report or photo is sent to an outside AI company.
- **Privacy:** residents only see the type of problem and roughly where it is. Never anyone's words, photos or name.
- **People stay in charge:** officers can override any decision, and every correction is logged so the system can learn.
- **Honest about uncertainty:** unsure cases go to a review queue instead of being guessed.
- **Accessible:** one simple form, postcode search, and an "I can't use the map" option.

## Close (10 seconds)

> "StreetTriage turns messy reports into a ranked, de-duplicated plan for tomorrow, so the most
> dangerous problems in Southampton get fixed first."

---

### Likely questions, with short answers

- **"What if the AI is wrong?"** It never acts alone on uncertain cases. They go to a person, and officers can undo anything, including merges.
- **"Why not ChatGPT?"** Council data shouldn't leave the council, and a local model costs nothing per report.
- **"How accurate is the photo model?"** It's the weakest part (about 6 in 10 on real photos), so it counts for less and conflicts always go to a person.
- **"How do you know duplicates are right?"** On the test set, 95% of the merges were correct. We'd rather miss a merge than wrongly hide a report.
- **"What's next?"** Test on real reports labelled by officers, and connect to the council's works system.
