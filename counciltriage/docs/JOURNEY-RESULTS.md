# Journey results

`npm run journeys` against http://localhost:3100 on 2026-10-18 10:59 UTC:
**29/29 checks passed.** Stories are in [USER-JOURNEYS.md](USER-JOURNEYS.md).

| Story | Check | Result | Evidence | Time |
| --- | --- | --- | --- | --- |
| R1 | Start page offers Resident and Council | Pass | both choices shown | 18 ms |
| R2 | One way to start a report, no draft prompt | Pass | 1 entry button (plus the site tab bar); category chosen in the form | 69 ms |
| R3 | Postcode and street search; outside Southampton refused | Pass | SO15 5DQ -> SO15 5DQ; "Westgate Street, St Mary's"; PO1 2AB refused | 386 ms |
| R5 | Duplicate check shows nearby reports with summary fields only | Pass | "Street light near Mayflower Roundabout", 1 m away, no private fields | 18 ms |
| R6 | Public report and list APIs never expose private fields | Pass | detail, photos and contact details absent | 25 ms |
| R5 | Adding support raises the incident's report count | Pass | 4 -> 5 people | 9 ms |
| R4 | Photo GPS becomes the report location | Pass | SR000005 at 50.9226, -1.4048 (from photo, Portswood); response in 9 ms | 10 ms |
| O7 | New report is triaged by both models within 15 s | Pass | pothole, critical 60; LLM urgency 5, injury true; photo pothole (96%), uncertainty 0.13, medium severity (6 s) | 5519 ms |
| R7 | Resident sees a reference and progress; duplicates are told where to look | Pass | SR000005: received; 1 public updates | 21 ms |
| R8 | Signed-out visitors are sent to sign in | Pass | redirect to /resident/login?next=%2Fmy-reports | 10 ms |
| O1 | Console requires staff sign-in | Pass | page redirects, API returns 401 | 6 ms |
| O2 | Queue is ordered by priority; injuries are at least high | Pass | 61 open incidents; 4 with injuries all >= high; top: SYN900001 critical 68; FMS10009043 critical 60; SYN900008 critical 60 | 8 ms |
| O2 | Ranking agrees with the synthetic ground truth | Pass | Spearman 0.81 (docs/EVALUATION.md) | 0 ms |
| O3 | Westgate Street lamp reports are one incident, each kept | Pass | SYN900001 + SYN900002, SYN900004, SYN900005; each keeps its own text | 5 ms |
| O3 | An officer can unmerge, and merge back | Pass | SYN900005 separated and merged back | 8 ms |
| O4 | Photo contradicting the report waits for an officer; confirming clears it | Pass | held because "Photo looks like pothole, which does not match the report"; cleared after confirming vandalism | 2 ms |
| O5 | Every ranking has a score breakdown | Pass | 61 incidents, all with risk terms | 1 ms |
| O6 | Route plan: 2-person crews, <= 5 jobs, starting at the first job | Pass | 2 crews: 5 + 5 jobs | 209 ms |
| O6 | Issuing the work order tells the residents | Pass | WO00001: SYN900021 now "Repair arranged" for residents | 44 ms |
| TC1 | Signed-in resident reports a new problem typed in their own words | Pass | SR000006: "Abandoned shopping trolleys" -> fly_tipping (LLM label "Fly-tipping"), low 22 | 4015 ms |
| TC2 | Possible repeat: the LLM finds the existing report from the resident's words | Pass | matched SYN900001 by llm in 1886 ms; a different light fault returned 1 match(es) | 1886 ms |
| TC2 | Resident confirms the duplicate, adds optional details; priority uses it | Pass | supporters 4 -> 5; priority 68 -> 69; volume term n/a; details stored privately; plain support OK | 22 ms |
| TC3 | Resident opens a past report from My reports and sees its full details | Pass | SR000004 opens with description and progress; hidden from other visitors | 65 ms |
| TC4 | Officer opens a merged incident: one row in the queue, expands to every report and photo | Pass | queue row expands; detail page lists the merged reports with 1 photos and the resident's extra details | 43 ms |
| TC5 | Marking an issue in progress, then completed, moves it between sections | Pass | SR000006: open -> in progress -> completed; resident sees "Fixed" | 50 ms |
| TC6 | Route for one issue type: shortest order, map path and a scheduled agenda | Pass | pothole route: 5 stops; 13.2 km by road along 825 road points (straight-line estimate 13.1 km) | 199 ms |
| TC7 | Filters by category and urgency change the map pins | Pass | all 61 pins (scores 3-69, coloured green to red) -> pothole + critical 3 | 6 ms |
| TC8 | what3words address puts the pin in Southampton (5 requests/s limit) | Pass | ///tiger.lion.fork -> 50.9097, -1.4044; typo suggests a fix; London refused | 1066 ms |
| TC9 | Latitude/longitude and postcode-area searches place the pin | Pass | 50.9097, -1.4044 placed (either order); London refused; SO17 -> centre 50.92723, -1.392502 | 73 ms |
