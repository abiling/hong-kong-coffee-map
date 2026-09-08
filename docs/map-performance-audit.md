# Map performance audit — 2026-09-08

Status: **partial implementation; browser performance acceptance blocked. Not ready to release.**

Baseline: `d6499e6d14ecb45d6dcdc8620ebaa316d9b90df9` (v36).
Production origin: https://abiling.github.io/hong-kong-coffee-map/
The default GitHub branch and observed production resource references both use v36.
Scope: no new running cost, infrastructure, provider, visual style, camera UX,
data schema, or marker architecture. Candidate app resource version: v37.

## Evidence and limitations

The cloud Chrome browser loaded the production HTML and MapLibre library but
failed in the original Map constructor with `Failed to initialize WebGL`.
The error includes `GL_VENDOR = Disabled, GL_RENDERER = Disabled` and
`BindToCurrentSequence failed`. This is a test-environment blocker, not evidence
that the user's device or OpenFreeMap is broken. An unrelated extension metadata
error was also logged. No application regression can be inferred from it.

The browser API also does not expose arbitrary performance instrumentation through
its read-only DOM evaluator. A separate instrumented localhost harness was built;
the cloud browser rejects that localhost navigation with `ERR_BLOCKED_BY_CLIENT`.
Its HTTP routes and injected source were tested locally, but its interactive
browser behavior has **not** been validated. No alternate browser or fabricated
WebGL timings were substituted.

## Actual configuration

| Item | Baseline and candidate |
| --- | --- |
| MapLibre | GL JS 5.12.0; JS/CSS from unpkg.com |
| Style | `https://tiles.openfreemap.org/styles/positron` |
| Vector TileJSON | `https://tiles.openfreemap.org/planet` |
| Observed tile template | `https://tiles.openfreemap.org/planet/20260830_080001_pt/{z}/{x}/{y}.pbf` |
| Vector source zoom | 0–14; app may overscale up to 19 |
| Glyph | `https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf` |
| Sprite base | `https://tiles.openfreemap.org/sprites/ofm_f384/ofm` (JSON/PNG; DPR may select @2x) |
| Unreferenced raster source declaration | `ne2_shaded`, Natural Earth PNG template; no current layer uses it |
| App options | container `map`, maxZoom 19, attributionControl false |
| Effective minimum zoom | 0, applied by map-config.js and multicity.js wrappers |
| Initial Hong Kong | `[114.1588,22.2857]`, zoom 11.25 |
| Initial Tokyo | `[139.6917,35.6895]`, zoom 10.6 |
| Initial Beijing | `[116.4074,39.9042]`, zoom 10.6 |
| Cache defaults | maxTileCacheSize null (dynamic); maxTileCacheZoomLevels 5 |
| Expiry default | refreshExpiredTiles true |
| Zoom cancellation default | cancelPendingTileRequestsWhileZooming true |
| Worker defaults | 1 on non-Safari; Safari clamps available logical processors to 1–3 |
| Prewarm | Not called |
| CJK glyph handling | localIdeographFontFamily defaults to `sans-serif`; retained, no font substitution |

Default values were checked in the **5.12.0 source**, not assumed from the latest
documentation. The zoom-cache value is a dynamic sizing multiplier; it is not a
guarantee that exactly five complete zoom levels are retained. Cache capacity is
per source, not a byte-based memory ceiling. This memory cache is separate from
browser HTTP cache and does not persist when a Map instance is destroyed.

The document already preconnects to tiles.openfreemap.org. UI font data is embedded
in fonts.css and is separate from MapLibre's glyph PBF requests. The service worker
caches same-origin shell resources and ignores cross-origin requests; it does not
provide persistent OpenFreeMap tile storage. Browser HTTP caching still applies.

## Initialization and duplicate work

1. Browser parses markup, loads MapLibre, then map-config.js.
2. map-config.js installs a constructor subclass and document.writes multicity.js.
3. multicity.js installs another subclass to apply the remembered city's defaults.
   These are two wrappers around **one Map instance**, not two maps.
4. app.js calls trackLayout, then initMap, then binds events and reads shop data.
5. MapLibre starts its style → source/sprite → tiles/glyphs work independently of
   the async Apps Script request. Google Sheets does not block basemap creation.
6. applyCloudPayload → applyFilters creates DOM markers. They can be attached
   before style load; MapLibre Marker.addTo attaches to the canvas container and
   listens for map movement, with no style-load prerequisite.
7. The old load callback deletes and recreates these same markers if data arrived
   first. This redundant pass is removed. The data-after-map order still renders
   through applyFilters. Subsequent filtering, updates and city changes still
   replace markers as before.

The old trackLayout calls map.resize for font readiness, topbar observation,
window resize and visual viewport resize even when the map dimensions are unchanged.
MapLibre 5.12 already observes its container (trackResize defaults true). Its
resize method does not simply skip identical dimensions: it calls painter.resize
and emits movement/resize events. #map is inset:0 and the content-top variable
only positions overlays. The patch retains overlay updates, skips identical CSS
writes and lets MapLibre handle its actual container resizing.

No app-level repeated setStyle, Map.remove, or new Map on city changes was found.
Each new page still requests its style through the normal MapLibre mechanism.
Network-level duplicate style/glyph/sprite/tile requests cannot be established
without a successful rendered-page trace. Marker rendering does not call setStyle
or reload a basemap source.

Camera call-chain tests confirmed two additional deterministic cases. When cached
data arrives before map load, the same shop bounds were fitted once with the
existing 700 ms animation and again without animation in the load callback. The
load callback now skips only when shop bounds, padding and map CSS viewport are
identical **and the camera has already stopped moving**. MapLibre 5.12 can fire
`load` while a camera animation is still active: `load` checks loaded style/source
state, while only `idle` additionally requires `!isMoving()`. In that case the
old load-time `duration: 0` fit is retained, immediately completing the final
framing at the same event as v36. The correction is also retained if the header
height or viewport changed. A user gesture, locating, selecting a shop or starting
a city switch invalidates the comparison.

City switching previously always ran easeTo(default city) before fitting cached
shop bounds. It now reads the target-city cache first. Valid, active coordinates
go directly to the existing animated final fit. A missing cache or a cached city
without mappable shops still shows the default-city camera; remote data later
performs the existing final fit. The delayed resize after switching list/saved
views is left unchanged.

## Candidate decisions

| Candidate | Decision and evidence |
| --- | --- |
| prewarm | Not adopted: one long-lived Map; little lead time before construction; documented main benefit is repeated creation/destruction. No measured benefit here. |
| Larger/fixed tile cache | Not adopted: cache already exists; no measured eviction/revisit trace or mobile memory budget to justify a number. A fixed cap can even reduce cache on larger viewports. |
| refreshExpiredTiles false | Not adopted: sampled versioned tiles already cache for 10 years; no plausible routine-session expiry benefit established. |
| cancelPendingTileRequestsWhileZooming | Already true in 5.12.0. No redundant option or claimed improvement added. Handles pending lower-zoom tiles while zooming in, not every possible obsolete request. |
| Redundant load-time markers | Adopted: deterministic same-node replacement eliminated; operation-count tests pass for both arrival orders. |
| Redundant layout resizes | Adopted: duplicate CSS writes and external resizes eliminated; actual container observation stays enabled. |
| Duplicate initial data fit | Adopted conditionally: skip only for identical bounds/padding/CSS viewport after camera completion; retain the old duration-0 completion if load fires during animation. |
| Cached-city default waypoint | Adopted: skip default-city easeTo only when the final cached shop viewport is already determinable. |
| GeoJSON marker migration | Not adopted: small per-city list; no measured main-thread marker bottleneck warrants a rewrite. |
| Local MapLibre hosting / extra asset preload | Not adopted in this patch: would need a real initial-load comparison and asset update policy; not proven by this audit. |
| Style pruning / local CJK font change / pixel ratio reduction | Not adopted: changes appearance or needs separate visual verification. |

## Style audit (no changes)

The fetched style is 25,153 decoded bytes with 55 layers: 1 background, 9 fill,
26 line, 19 symbol. The app adds one public-building symbol layer at zoom 13.5+,
giving 56 after load. Font stacks: Noto Sans Regular, Italic and Bold.

There is **no generic POI symbol layer** and no standalone transit-label layer in
this Positron snapshot. Do not claim savings by removing layers that are absent.
The public-building layer uses the existing openmaptiles vector source.

Possible later candidates are airport labels, road shields, and waterway/water
name labels (including the Italic stack). These have real navigation/visual value;
none is established as entirely valueless. Country/state labels already have zoom
limits, so removing them would not necessarily improve a street-level viewport.
The common name expressions combine Latin/non-Latin names and fallback languages;
their complexity alone does not demonstrate a CPU bottleneck. The unused raster
source declaration has no rendered layer, so deleting it has no established tile
request saving. Hiding symbol layers does not remove features from shared vector
tile payloads. No layers were deleted.

## HTTP asset probes (not browser benchmarks)

Six independent GETs from the tool environment returned HTTP 200. All had roughly
10-second TTFB despite very different body sizes, making this sample unsuitable
for attributing latency to OpenFreeMap's origin versus the tool/network path.
The responses showed CDN cache hits. These numbers are **not Tokyo measurements**
and are not a cold-cache or before/after performance comparison.

| Asset | Transfer bytes (curl --compressed) | Cache-Control max-age |
| --- | ---: | ---: |
| Style | 3,560 | 86,400 seconds |
| TileJSON | 1,798 | 86,400 seconds |
| Sprite JSON | 3,366 | 315,360,000 seconds |
| Sprite PNG (1x sample) | 49,454 | 315,360,000 seconds |
| Regular glyph 0–255 | 42,599 | 604,800 seconds |
| Shibuya z14/14549/6452 vector tile | 340,566 | 315,360,000 seconds |

A dense sample tile is materially larger than the style, making tile transfer and
decode sensible profiling targets, **not a proven ranking of runtime bottlenecks**.
No percentage of the user's delay can currently be assigned to the public server.

## Before / after evidence

| Requested browser metric | Before | After |
| --- | --- | --- |
| Map create start (performance timestamp) | unavailable | unavailable |
| Map create → load | unavailable: WebGL initialization failed | unavailable |
| Map create → idle | unavailable | unavailable |
| DOMContentLoaded → load / idle | unavailable | unavailable |
| First-screen major tile count | unavailable; aborted initialization is not a valid zero | unavailable |
| Failed/duplicate network requests | no complete map request trace | unavailable |
| Rapid zoom wasted requests | unavailable | unavailable |
| Revisit requests/cache hits | unavailable | unavailable |
| Console | original Map failed WebGL; unrelated extension error | rendered comparison blocked |

The following are **executed application-function tests with test doubles**, not
WebGL, network, frame-time or memory measurements. The 30 shops are fixtures, not
a new read or modification of the user's database.

| Operation-count metric | Before | After |
| --- | ---: | ---: |
| 30 shops arriving before map load: Marker constructions | 60 | 30 |
| Same scenario: markers deleted at map load | 30 | 0 |
| Same scenario: load-time fit calls | 1 | 1 |
| Map loads before data: Marker constructions | 30 | 30 |
| 5 unchanged layout notifications: CSS writes | 5 | 1 |
| Same notifications: custom resize calls | 5 | 0 |
| Cached startup, stable layout: data framing calls | 2 × fitBounds | 1 × fitBounds |
| Cached startup, changed header or viewport | 2 × fitBounds | 2 × fitBounds (final correction retained) |
| Cached startup interrupted by user movement | 2 × fitBounds | 2 × fitBounds (duplicate guard invalidated) |
| Cached startup, load before moveend | 2 × fitBounds; second duration 0 | unchanged; old immediate completion retained |
| Data arrives after map load | 1 × fitBounds | 1 × fitBounds |
| Cached startup with one shop | 2 × flyTo | 1 × flyTo |
| City switch with valid cached shops | stop → easeTo → fitBounds | stop → fitBounds |
| City switch without cache, then remote data | stop → easeTo → fitBounds | unchanged |
| City switch with an empty cached city | stop → easeTo | unchanged |

Selected marker styling, updating the real overlay offset, subsequent filtering,
and a single constructed Map are asserted. JS syntax and whitespace checks pass;
the local audit server's seven primary routes/injection checks pass.

## Required real-browser scenarios — still pending

| Scenario | Acceptance status |
| --- | --- |
| Cold Tokyo initial map | Blocked by WebGL; not passed |
| Shibuya → Harajuku → Omotesando → Shibuya | Not rendered; no cache-hit claim |
| Rapid zoom in/out | Not rendered; no stability/FPS claim |
| Tokyo / Hong Kong / Beijing switch | Cached/uncached camera decisions tested; visual end-to-end verification pending |
| Mobile viewport / iPhone / Fire HD 8 memory | Not measured; viewport alone is not hardware emulation |

Expected experience: less avoidable work on data-first startup and layout
notifications. Cached city switching no longer renders a default-city waypoint
immediately replaced by shop bounds. In theory this avoids tile request attempts
for those intermediate viewports; actual transferred/aborted tile counts and time
saved are not measured. There is no demonstrated drag, zoom or revisit speedup in
seconds and no quantified network request reduction claim.

## Reproduction and release gate

Run dependency-free operation checks from repository root:

```sh
node tests/map-lifecycle.test.cjs d6499e6d14ecb45d6dcdc8620ebaa316d9b90df9
node tests/map-lifecycle.test.cjs
node tests/camera-operations.test.cjs f136f0e29f13de1554f0e751a6a20741e1de7bc8
node tests/camera-operations.test.cjs
python3 tools/performance/serve.py
```

Open http://127.0.0.1:8765/ in a WebGL-capable browser. The harness serves a pinned
baseline and working tree under isolated local paths and uses the same MapLibre,
style and API. It disables SW registration only in the served test copies, seeds
the requested initial city without changing production files, and exposes local
event/request reports. Nothing sends metrics to a third-party analytics service.
Both variants share localhost shop cache and HTTP cache: deliberately control
cold/warm state and data-arrival order; do not compare a cold before to a warm after.
Instrumentation adds overhead to both variants. Compare at least three trials
with identical viewport, DPR, network and data state. Use Network's Preserve log
for transfer/abort details: transformRequest counts are attempts, not guaranteed
wire requests, and missing cross-origin timing or zero transferSize is not proof
of a cache hit. Rapid-zoom controls use programmatic camera animation; also test
actual touch/pinch and drag on target devices. Complete the five scenarios above
and compare screenshots before marking this patch ready for merge.

The app resource and SW cache identity change to v37 so a release can fetch the
modified script. Unchanged assets retain v36 URLs intentionally. No SW caching
strategy, cloud API, CSS, city defaults, map options, data or visual style changes.
All audit code is outside the production import/precache paths. A single commit
contains this candidate so it can be reverted atomically, including cache URLs.
Do not start a second style/asset optimization stage until this acceptance gate
has been completed and the user authorizes the next stage.

## Primary references

- [MapLibre 5.12.0 Map source](https://unpkg.com/maplibre-gl@5.12.0/src/ui/map.ts)
- [MapLibre 5.12.0 Camera source](https://unpkg.com/maplibre-gl@5.12.0/src/ui/camera.ts)
- [MapLibre 5.12.0 cache config](https://unpkg.com/maplibre-gl@5.12.0/src/util/config.ts)
- [MapLibre 5.12.0 worker defaults](https://unpkg.com/maplibre-gl@5.12.0/src/util/worker_pool.ts)
- [MapLibre 5.12.0 prewarm implementation](https://unpkg.com/maplibre-gl@5.12.0/src/util/global_worker_pool.ts)
- [MapLibre 5.12.0 DOM Marker implementation](https://unpkg.com/maplibre-gl@5.12.0/src/ui/marker.ts)
- [OpenFreeMap live Positron style](https://tiles.openfreemap.org/styles/positron)
- [OpenFreeMap live TileJSON](https://tiles.openfreemap.org/planet)
