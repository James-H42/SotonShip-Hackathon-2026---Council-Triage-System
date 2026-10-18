# Integration contract

Three components are being built separately and will plug into StreetTriage:

1. the interactive city map
2. the LLM report evaluation service
3. the image classification model

This document describes what each one receives and returns. **All three are now integrated**:
the team's Leaflet map (`components/map/`), the local LLM (`lib/ai/ollama.ts`, qwen3:8b via Ollama)
and the image model (`ml/vision_service.py`, called from `lib/ai/vision.ts`). See README "AI triage".
The HTTP contracts below are still supported, so a different model can be plugged in without code
changes: set `LLM_TRIAGE_URL` / `VISION_API_URL` (push mode), or set `AI_PIPELINE=off` and pull
from the queue.

## Authentication

External services send `x-integration-key: <INTEGRATION_API_KEY>` with every request to
`/api/integrations/*`.
- With no key configured, these endpoints are open in development only.
- A signed-in council officer can also call them.

The `/api/council/*` endpoints use the officer session cookie. The map component runs inside the
console, so it gets this automatically.

## Report record

All AI endpoints use the FixMyStreet scrape schema, so models built on `reports.jsonl` work
unchanged:

```json
{
  "id": 90000001,
  "status": "open",
  "service_name": "Potholes",
  "service_code": "Potholes",
  "category": "pothole",
  "title": "Deep pothole by Portswood Road crossing",
  "detail": "Very deep pothole in the carriageway...",
  "description": "Deep pothole by Portswood Road crossing: Very deep pothole in the carriageway...",
  "lat": 50.924339,
  "lon": -1.394167,
  "has_photo": false,
  "in_sample": false,
  "photo_path": null
}
```

Extension fields:

| Field | Contents |
| --- | --- |
| `ref` | Report reference |
| `requested_at` | Submission time |
| `source` | `resident` or `fixmystreet` |
| `ward` | Ward name |
| `location_text` | Resident's location description |
| `custom_type` | Free-text type for "something else" reports |
| `hazard_level` | `low`, `medium` or `high` |
| `answers` | Raw form answers |
| `answers_text` | Answers as question/answer pairs, readable by an LLM |
| `photos` | Each photo's `id`, `url` and `mime` |
| `geo_context` | Ward and nearest major road with distance |
| `supporters` | Number of extra residents reporting it |

Category ids are `pothole`, `road_pavement_damage`, `fly_tipping`, `litter`, `vandalism`,
`street_light`, `bus_shelter` and `other`. Analysers may also answer `tbc` (cannot tell).

## LLM text triage

### Pull mode (default)

```
GET /api/integrations/queue?stage=llm&limit=50&after=0&claim=1
```

Returns `items[]`, each with:
- `reportId`
- `report`: the record above
- `baseline`: the keyword analysis, for comparison
- `nearbyReports`: up to 5 likely duplicates, as records

The response also includes `taxonomy` and `nextAfter` for paging. `claim=1` marks the returned items
as `processing`.

### Push mode

Set `LLM_TRIAGE_URL`. Every new report is POSTed there straight after submission, with the same item
body. The response must be the `analysis` object below.

### Result

```
POST /api/integrations/llm-results
{ "reportId": 90000001, "analysis": { ... } }   or   { "results": [ ... up to 500 ... ] }
```

```json
{
  "model": "your-model-name",
  "category": "pothole",
  "categoryConfidence": 0.92,
  "alternatives": [{ "category": "road_pavement_damage", "confidence": 0.3 }],
  "severity": 0.8,
  "keyFeatures": ["Risk to cyclists", "On a bus route"],
  "flags": [{ "code": "near_school", "label": "Next to a primary school", "severity": "info", "dubious": false }],
  "duplicateOf": [1034721],
  "summary": "Deep carriageway pothole by a crossing on a bus route."
}
```

| Field | Meaning |
| --- | --- |
| `categoryConfidence` | 0-1. Below `TBC_CONFIDENCE_THRESHOLD` (0.5) the report moves to the TBC review queue. |
| `severity` | 0-1. Adds up to 15 priority points. |
| `flags[].dubious` | `true` marks the report dubious: it goes to review and loses 15 points. |
| `duplicateOf` | Report ids. Each is added as a suggested duplicate with score 0.9 for officers to confirm. |

Send `{ "reportId": 1, "error": "reason" }` to mark a report as failed.

The LLM result replaces the keyword baseline and is kept through later re-triage. Officer overrides
of category or priority always take precedence.

## Image model

### Pull mode

```
GET /api/integrations/queue?stage=vision&limit=50
```

Returns `items[]`, each with:
- `reportId`
- `residentCategory`
- `photos[]`: `photoId`, absolute `url` and `mime`

### Push mode

Set `VISION_API_URL`. Each photo is POSTed as:

```json
{ "reportId": 1, "photoId": 2, "residentCategory": "pothole", "mime": "image/jpeg", "imageBase64": "..." }
```

### Result (one per photo)

```
POST /api/integrations/vision-results
{ "photoId": 84, "analysis": { "model": "pothole-vit-v1", "category": "pothole", "categoryConfidence": 0.88,
  "severity": 0.7, "labels": [{ "label": "pothole", "confidence": 0.88 }], "notes": "..." } }
```

| Situation | Effect |
| --- | --- |
| `category: null` with confidence ≥ 0.8 | "Photo does not show a problem": −8 points |
| Image category ≥ 0.8 confident and text confidence < 0.7 | Report is recategorised |
| Unrelated category ≥ 0.6 confident | `image_conflict` flag: officer review |
| Any result with `severity` | Adds up to 15 × confidence points |

## Active learning feedback

```
GET /api/integrations/feedback?since=<ISO date>&field=category|priority|duplicate|dubious
```

Each officer override returns:
- `modelValue`
- `officerValue`
- `modelSource`
- a snapshot of the report record

## Training export

```
GET /api/integrations/export[?source=resident&status=open]
```

Returns JSON Lines: every report in the record format, plus the current triage outcome.

## Interactive map

The map components implement these props (`components/map/types.ts`):

- `MapPanel`: used on the officer dashboard, report detail, route planner and work orders. It
  receives:
  - `pins` (`id`, `ref`, `lat`, `lon`, `category`, `priorityBand`, `priorityScore`, `status`,
    `title`, `href`)
  - optional `routes` (ordered `path` of lat/lon, `colour`, `label`)
  - optional `selectedId` (and `depot`, used only by plans saved before routes started at the first job)

  Pin colours by band are in `BAND_HEX` (`components/ui.tsx`).
- `LocationPicker`: used in the resident form. It receives `value` (`{lat, lon}` or null), `nearby`
  pins and `base`. It must call `onChange({ lat, lon })` when the resident marks a point. Address
  or postcode search belongs here.

Data endpoints (officer session):

| Endpoint | Purpose |
| --- | --- |
| `GET /api/council/map/pins` | GeoJSON FeatureCollection. Takes the dashboard filters: `category`, `ward`, `status`, `band`, `queue`, `q`, `source`, `photo`, `near=lat,lon&radius=m`, `limit`. |
| `GET /api/council/reports` | Paginated report list, same filters |
| `PATCH /api/council/reports/:id` | Actions from a pin popup: `{status, message, public}`, `{category}`, `{priorityScore, reason}`, `{moderation}`, `{note}`, `{mergeInto}` |
| `POST /api/council/routes` | Crew routes: `{category, minBand, wards[], staff, shiftHours, jobsPerCrew, limit}` (category `all` for every type). Each crew's `path` is ready to draw as a polyline. |
| `GET /api/reports/nearby?lat&lon&category&radius` | Public: open reports near a point, for the resident picker |
| `GET /api/geo/lookup?lat&lon` | Ward, in-boundary check and nearest major road |

### Geometry

Ward boundaries and major roads are committed in [`geo/`](../geo/README.md):
- `geo/wards.geojson`: ONS May 2026 boundaries for the 17 wards, as Polygon or MultiPolygon features
  with `properties.name`.
- `geo/key_roads.geojson`: OpenStreetMap motorway, trunk and primary roads around the city (the map team's overlay), as
  LineString or MultiLineString features with `properties.name`.

The map component can draw these files directly. To replace them, keep the same shape (WGS84
GeoJSON with `properties.name`). `npm run build:geo` regenerates them from fresh downloads, as
described in `geo/README.md`.

They are loaded at start-up. Run `npm run retriage` after changing them to recalculate stored wards
and priorities (this keeps all reports and officer decisions). If a file is missing, coarse built-in
approximations are used and the integrations page shows the source as `approximate`.
Extra context can be added to `geo_context`; the priority model already uses it:
- `nearSchool` (+5)
- `nearBusStop` (+4)
- `roadClass: "a_road"` (+10 for road defects)
