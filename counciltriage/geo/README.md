# Geometry

`lib/geo.ts` loads these files at start-up. They drive ward assignment (the ward filter and route
planner) and the "On a major road" priority factor, which adds 10 points to potholes, road damage
and street lights within 40 m of a major road.

| File | Contents | Source | Licence |
| --- | --- | --- | --- |
| `wards.geojson` | The 17 Southampton wards (2023 boundaries, codes E05015490–E05015506) as Polygon features with `name` and `code` | ONS Open Geography Portal: Wards (May 2026) Boundaries UK BFE, filtered to Southampton (`LAD26CD = E06000045`) | Open Government Licence v3.0. Source: Office for National Statistics. Contains OS data © Crown copyright and database right 2026. |
| `key_roads.geojson` | Motorway, trunk and primary roads plus slip roads around Southampton (`name`, `ref`, `highway`), from the map team's `hampshire-roads.geojson`. Used for the priority score's road-proximity term; a simplified copy in `public/geo/key-roads.geojson` draws the red overlay. | OpenStreetMap | © OpenStreetMap contributors, Open Database Licence (ODbL) 1.0 |

Both files use WGS84 (EPSG:4326) coordinates rounded to 6 decimal places (about 0.1 m).

The full-extent (BFE) ward boundaries are used rather than the coastline-clipped ones. Reports on
the waterfront, Itchen Bridge or the docks therefore still fall inside a ward. Reports within 25 m
of the city boundary go to the nearest ward. The boundary often follows a road centreline, such as
West End Road.

In OpenStreetMap, UK motorways are tagged `motorway`, primary-route A-roads `trunk`, and other
A-roads `primary`. Together these cover the A33, A35, A3024, A3025, A335, A3057, M271 and the
rest of the city's A-road network. Unnumbered slip roads and roundabout arms take the number of
the road they join, for example "A33 slip road".

## Regenerating

1. Download the two sources, each into its own empty folder outside the repo:

   ```bash
   curl -o wards/wards_may2026_bfe.geojson "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/WD_MAY_2026_UK_BFE/FeatureServer/0/query?where=LAD26CD%3D%27E06000045%27&outFields=WD26CD,WD26NM,LAD26CD,LAD26NM&outSR=4326&geometryPrecision=6&f=geojson"
   ```

   ```bash
   curl -A "StreetTriage-geodata" -G -o roads/key_roads_osm.json "https://overpass-api.de/api/interpreter" --data-urlencode 'data=[out:json][timeout:120][bbox:50.86,-1.50,50.96,-1.31];way["highway"~"^(motorway|trunk|primary)(_link)?$"];out tags geom;'
   ```

   If the main Overpass server is busy, `https://z.overpass-api.de/api/interpreter` is a mirror of
   the same service. When ONS publishes a newer ward edition, change the service name and the
   `WD26*`/`LAD26CD` field names (also in `scripts/build-geo.mts`).

2. Build the files. This validates 17 wards, clips the roads to the union of the wards, merges
   them per road and simplifies them (1.5 m tolerance):

   ```bash
   npm run build:geo -- wards/wards_may2026_bfe.geojson roads/key_roads_osm.json
   ```

3. Recalculate stored wards and priorities. This keeps all reports and officer decisions:

   ```bash
   npm run retriage
   ```

The current files were built on 17 October 2026, from the OSM snapshot of 2026-10-17T16:06Z.

## Client map files (`public/geo/`)

The Leaflet maps in `components/map/` load browser copies of the geometry from `public/geo/`. The
server never reads them.

| File | Contents | Source | Licence |
| --- | --- | --- | --- |
| `public/geo/key-roads.geojson` | `key_roads.geojson` simplified to about 4 m (Douglas-Peucker) with coordinates rounded to 5 decimal places. Same LineString features and properties (`name`, `ref`, `highway`). About 390 KB, or 41 KB gzipped. | OpenStreetMap, from `key_roads.geojson` | © OpenStreetMap contributors, ODbL 1.0 |
| `public/geo/boundary.geojson` | The city outline: the 17 wards in `wards.geojson` merged into one polygon, simplified to about 3 m. About 8.5 KB. | ONS Wards (May 2026) BFE, from `wards.geojson` | Open Government Licence v3.0. Source: Office for National Statistics. Contains OS data © Crown copyright and database right 2026. |

The map also uses these online services at run time:

- OpenStreetMap tiles: © OpenStreetMap contributors, ODbL. The map shows this credit.
- postcodes.io: Open Government Licence data, including ONS Postcode Directory and OS data.
- Nominatim: © OpenStreetMap contributors, ODbL.
- what3words: only when `W3W_API_KEY` is set. Their terms of use apply.

To rebuild after `wards.geojson` or `key_roads.geojson` changes, run
`geo/build-client-geo.mjs`. Its header comment lists the Turf packages it needs.
