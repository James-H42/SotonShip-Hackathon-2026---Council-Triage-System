# User stories and journeys

Two example users, based on the demo accounts and the team's data. Each story has acceptance checks.
`npm run journeys` runs the automatable ones against the running app and writes
[`JOURNEY-RESULTS.md`](JOURNEY-RESULTS.md). Screens such as sign-in and sign-out were checked by
hand in the browser; results are at the end.

## Personas

**Alex Morgan, resident (Portswood).** Uses a phone and is not technical. Walks to the station past a
dark street light and a pothole that cyclists swerve around. Wants to report quickly, know it has
been dealt with, and not have neighbours read what they wrote.

**Sam Patel, council triage officer.** Starts each morning with a backlog of reports in different
wording, many about the same problem. Has two 2-person repair crews a day. Needs the most dangerous
problems first, a reason for every ranking, and to check only the cases the system is unsure about.

## Resident stories (Alex)

| ID | As a resident I want to... | So that... | Acceptance checks |
| --- | --- | --- | --- |
| R1 | choose "resident" when I arrive | I go straight to the public service | `/` offers Resident and Council; Resident opens `/resident` |
| R2 | start a report from one obvious button and finish in one go | it takes a couple of minutes | One "Report a problem" button on the home page; 5 short steps; no "continue your draft" prompt |
| R3 | say where the problem is without coordinates | I can report it even if I'm not standing there | A postcode (SO15 5DQ) and a street name resolve; places outside Southampton are refused |
| R4 | have my photo's location used automatically | I don't have to find it on a map | One GPS photo, or several within 100 m: the first photo's location is used. Photos far apart: my pin is used |
| R5 | see whether someone has already reported it | I add my support instead of a duplicate | Nearby reports appear in step 2 with type, rough place, status and date only; "add my support" raises the count |
| R6 | keep my description and photos private | neighbours can't read them | Public pages and APIs never include another resident's description, photos or contact details |
| R7 | follow progress | I know it's being dealt with | A reference on submission; "My reports" shows status; if merged, I'm told which report to follow |
| R8 | sign out on a shared computer | the next person can't see my reports | Sign out ends the session; `/my-reports` then asks me to sign in |

## Officer stories (Sam)

| ID | As an officer I want to... | So that... | Acceptance checks |
| --- | --- | --- | --- |
| O1 | sign in to a staff-only console | resident data is protected | `/council` redirects to sign-in; a wrong password is refused; nobody is signed in automatically |
| O2 | see the most urgent incidents first | crews go where people are at risk | The queue is sorted by priority; incidents with an injury are at least "high"; the ranking of the synthetic incidents agrees with the ground truth (Spearman ≥ 0.75) |
| O3 | have duplicates merged for me, but still see each report | I don't triage the same pothole five times | The Westgate Street lamp reports become one incident; each report keeps its own text and photos; I can unmerge |
| O4 | review only the uncertain cases | my time goes where the AI is unsure | A graffiti report with a pothole photo is held in "Needs review"; confirming the category clears it |
| O5 | see why something is ranked where it is | I can justify decisions | Each report shows the score terms (text, photo, road distance, injuries, vulnerable people, number of reports) |
| O6 | plan the crews' day in one click | two-person crews do 4-5 realistic jobs | At most 5 jobs per crew; the day starts at the first job; no coordinates to type; issuing marks reports "Repair arranged" for residents |
| O7 | see new reports triaged automatically | the queue is current | A new report is classified, scored and checked for duplicates within about 15 s |

## Journeys (using the team's data)

**Resident journey.** Alex opens the site, chooses *I'm a resident*, then *Report a problem*. Alex
picks *Street light*, types "SO14 2AY" (Westgate Street) and sees "Is it one of these? Street light
near Mayflower Roundabout, 4 people". Alex adds support instead of filing a duplicate. Later, Alex
reports a pothole on The Avenue: on the Location step Alex taps *Use my photo's location* and picks
two phone photos, the pin moves to The Avenue, and the report is sent. In *My reports* Alex sees it as "Received", and later "Repair arranged".

**Officer journey.** Sam signs in and sees the queue: a broken crossing on Shirley Road
(wheelchair and pushchair users) and the Westgate Street lamp with 5 reports and an injury are at
the top. Sam opens the lamp incident, reads each merged report and their photos, and checks the
score breakdown. In *Needs review* Sam finds the graffiti report with a pothole photo and confirms
the category. Sam opens the *Route planner*, plans 2 crews of 5 jobs, and issues the work order.
The residents involved now see "Repair arranged".

## Manual browser checks (18 Oct 2026, production build)

| Story | What was done | Result |
| --- | --- | --- |
| R1, O1 | Start page; council sign-in with the demo officer; a wrong password; Sign out, then `/council` | Pass: the console only opens after sign-in, and Sign out returns to the start page |
| R2 | Resident home and the 5-step form at desktop and phone widths | Pass: one entry button, no draft prompt, no sideways scrolling on a phone |
| R3 | Searched "Westgate Street" and "SO15 5DQ" | Pass: pin placed, with nearest postcode, ward and key-road check shown |
| R4 | One GPS photo, two agreeing photos, then a third about 2.2 km away; then **Use my photo's location** on the Location step | Pass: photo location used; "taken in different places, about 2218 m apart", so the pin is kept; the Location step is completed from the photos |
| R5 | Westgate Street light: "Is it one of these?" | Pass: summary card only, "4 people" |
| R7 | Resident sign-in, **My reports** | Pass: four reports with progress bars |
| O3 | Westgate incident: merged reports, **Unmerge** | Pass: each report shown with its LLM reading, unmerge recorded in the timeline |
| O4 | Graffiti report with a pothole photo, **Confirm category** | Pass: review cleared |
| O6 | Route planner (all types, 4 staff), **Create work order** | Pass: 2 crews with 5 numbered stops each; reports show "Repair arranged" |

## Evaluation and refinements

- **Journey evaluation:** the first automated run passed 18/19. The one failure (R2) was the check
  counting the site's navigation tab as a second entry button; the check was corrected. The final
  run passed 19/19.
- **Found while walking the journeys, and fixed:**
  1. The LLM read "poses a direct injury risk" as an injury, which made a litter report look like
     an injury incident. A grounding check now requires the text to describe harm that happened.
  2. Photo GPS could never save a step, because the location was required before the photo step.
     "Use my photo's location" is now on the Location step.
  3. Officers could unmerge only on the page; it is now in the API as well.
- **Still to note honestly:** what3words needs an API key. Real phone photos only carry GPS if
  location tagging is on.
