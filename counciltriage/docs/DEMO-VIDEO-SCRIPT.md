# Demo video: 3 minutes

**Story:** one resident reports a problem in under a minute. The council officer sees it ranked,
merged with matching reports and planned into tomorrow's repair route.

## Before recording (10 minutes)

1. `npm run demo` (wait for "Ready"), then open http://localhost:3100 in a clean browser window.
2. Have the photos ready to upload: `data/demo-photos/pothole-the-avenue-1.jpg` and
   `pothole-the-avenue-2.jpg`. Their location data says The Avenue.
3. Logins are in `.secrets/demo-accounts.json`. Type them off-camera, or blur them in the edit.
4. Browser zoom at 110%, notifications off. Use two browser profiles (or a normal and a private
   window) so the resident and the officer can be signed in at the same time. Sign in as the
   resident (Alex) and the officer (Sam) off-camera.
5. Don't run `npm run journeys` after resetting: it adds test reports.

## Shot list

| Time | On screen | Say (roughly) |
| --- | --- | --- |
| 0:00-0:15 | Start page: "How would you like to continue?" | "Southampton gets thousands of street reports a year: potholes, fly-tipping, broken lights. Most arrive as messy text, many about the same problem. This is StreetTriage." |
| 0:15-0:25 | Resident window: **I'm a resident**, then **Report a problem** | "For residents, there's one button and one short form." |
| 0:25-0:40 | Choose **Street light**. On Location, type **SO14 2AY**. "Is it one of these?" shows the Westgate Street light. Click **Yes, add my support** | "Before anything is sent, it checks whether someone has already reported it, without showing anyone else's details. One click adds your voice instead of a duplicate." |
| 0:40-1:05 | **Report a problem** again. Choose **Pothole**. On Location, click **Use my photo's location** and pick the two Avenue photos: the pin jumps to The Avenue with "We've used the location saved in your photos". On Details, answer the depth questions and type: "Deep pothole by the bus stop on The Avenue, a cyclist came off this morning." | "If the photo knows where it was taken, we use that, so there's no hunting on a map. If the photos don't agree, we keep the resident's pin." |
| 1:05-1:15 | **Check and send**, then **Report sent** with its reference | "Done in under a minute. They get a reference and updates." |
| 1:15-1:30 | Officer window: **Priority queue** (refresh) | "On the council side, everything is already sorted. A local AI read every report, checked every photo and ranked them by risk." |
| 1:30-1:50 | Open the new pothole: **Critical**, injury reported, near The Avenue (a key road). Expand **Incident Risk Priority Score** | "Our report is at the top: an injury, a deep pothole, right on a main road. And officers can see exactly why it's ranked there." |
| 1:50-2:10 | Back to the queue. Open **Street light out Westgate Street** and scroll to **Merged incident: 4 reports** | "Five residents described this lamp in five different ways. The AI recognised it as one problem, so the officer deals with it once, but every report and photo is still here." |
| 2:10-2:25 | **Needs review**: open **Tagging on wall** (a graffiti report with a pothole photo). Click **Confirm category** | "When the photo and the words disagree, it doesn't guess. It asks a person." |
| 2:25-2:45 | **Route planner**: All problem types, 4 staff, **Plan routes**. Show the map with two numbered routes | "Then it plans the day: two-person crews, about five jobs each, in the best order, starting at the first job." |
| 2:45-2:55 | **Create work order**, then switch to the resident window: **My reports** shows the pothole as "Repair arranged" | "Issue it, and residents are told straight away." |
| 2:55-3:00 | Back to the start page or the logo | "StreetTriage: every report understood, ranked and on the way to being fixed." |

## If something goes wrong on camera

- The new report isn't at the top yet: AI triage takes about 5 seconds, so refresh the queue.
- Photo location doesn't appear: check you uploaded the files from `data/demo-photos/`. Others have no GPS.
- Map tiles are slow: it's the internet connection. Everything else runs locally.
