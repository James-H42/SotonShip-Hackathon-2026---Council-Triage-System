# Demo video: plan

Recorded automatically by `scripts/record-demo.mjs` against a freshly reset demo (`npm run demo`).
The video has **no title or end card**. A caption bar explains each step, an English (UK)
voice-over reads each caption as it appears, orange boxes show where to look, and a visible cursor
shows each click.
Output: `docs/StreetTriage-demo.mp4`.

## Who is watching and what they must take away

Hackathon judges who have not seen the app. They should understand:

1. **For residents, it is quick.** One form, a map, photos that place themselves, and an LLM
   check that stops duplicate reports.
2. **Merged reports are the key officer feature.** Several residents' reports of the same problem
   become one incident in the queue. It expands into each individual report, and the incident page
   keeps every original report, photo and extra detail.
3. **For officers, it is ranked.** The queue is sorted by risk, the map runs from green to red and
   can be filtered, and status changes move work between sections.
4. **It ends in action.** The shortest route between same-type issues follows real roads (with the
   straight line dashed) and is booked as a work order.

## Rules

- Captions carry the story, so each scene stays up long enough to read (about 3.3 words a second).
- Real data: about 14,900 FixMyStreet reports from Southampton, plus the team's synthetic incidents.
  New reports are typed live.
- No passwords on screen (the field is masked). The accounts are demo accounts only.
- The database is snapshotted before recording and restored afterwards, so judges start clean.

## Shot list (follows the team's test cases)

| # | Test case | On screen | Caption |
| --- | --- | --- | --- |
| 1 | - | Start page | StreetTriage: Southampton street reports, triaged by local AI |
| 2 | 1. New report | Resident signs in | A resident signs in to their account |
| 3 | 1. New report | Pothole; photos set the pin; click the map; questions; description; send | Pick the problem; photo GPS places the pin; a few questions; sent with a reference |
| 4 | 2. Possible repeat | Street light on Westgate Street; Check and send shows the LLM match; "Yes, add my details" | The local LLM found a match; the resident confirms and adds details |
| 5 | 3. Check progress | My reports, open a past report | The resident opens a past report |
| 6 | 4. Officer review | Queue; open the new pothole: photos and score breakdown | Sorted by risk, with photos and a full score breakdown |
| 7 | 5. Status change | Start processing; In progress tab | Moves to In progress; the resident is told |
| 8 | Merged reports | Queue row highlighted, "Merged incident: N reports" expanded into each report | Several residents reported the same street light; the AI merged them into one incident |
| 9 | Merged reports | Incident page: every original report with its own words, photos and date | Each original report is kept |
| 10 | Merged reports | Timeline: the confirming resident's extra details, highlighted | Officers see the extra details |
| 11 | 6. Map and filters | All reports from green to red; Pothole chip; Critical filter | The map from green to red; filter by issue and urgency |
| 12 | 7. Route | Pothole route along real roads, straight line dashed; create work order | The shortest route following real roads, booked as a work order |

## How it is made

1. `npm run demo` (full reset), then `sqlite3 data/counciltriage.db ".backup data/clean.db"`.
2. `PLAYWRIGHT_DIR=<dir with playwright> node scripts/record-demo.mjs`.
3. Restore: stop the server, `mv data/clean.db data/counciltriage.db`, remove `-wal`/`-shm`,
   then `npm run start -- -p 3100`.
4. Add the voice-over: `python3 scripts/narrate-demo.py <silent video> docs/StreetTriage-demo.mp4`.
   If the recording changes, re-measure the caption times in the script's `LINES`.
5. Watch it through (extract frames with ffmpeg) and check each caption matches the screen and the voice.
