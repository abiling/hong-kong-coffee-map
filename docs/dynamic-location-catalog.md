# Dynamic Location Catalog — v38

## Source of truth

The complete `shops` dataset returned by the Apps Script `list` action is the only
source that decides which countries and cities exist. `location-catalog.js` groups
active, complete records by `country_code`, then by the canonical `city` value.

Display overrides may improve labels, ordering, region ordering or a provisional
camera for existing locations. They do not create catalog entries and are not an
allowlist. A city without an override still receives shops, bounds, regions,
districts and a provider policy.

Records are complete when `city`, `country` and a two-letter `country_code` are
present. Incomplete records remain in `catalog.incomplete`; they are not rewritten,
hidden inside another city or defaulted to Hong Kong.

## Runtime flow

1. `multicity.js` builds the initial catalog from the persisted complete-data cache.
2. `app.js` creates the MapLibre map without requiring a city configuration.
3. Every complete API refresh rebuilds the catalog before the UI uses city data.
4. Selecting a city filters by the pair `(country_code, city)`.
5. Cached shop coordinates go directly through the existing `fitBounds` path.
6. Region and district choices are de-duplicated from that city's actual shops.
7. The last selected city is stored per `country_code`.

Provider policy is jurisdiction-based: `CN` uses Apple Maps; all other current
countries default to Google Maps. The policy receives the record's canonical
`country_code`, not a city registry lookup.

## Parser boundary

The deployed Apps Script source is not versioned in this repository, and the
`parse` action requires the private administrator key. The public `list` response
does prove that the ingestion path currently emits complete canonical fields for
Hong Kong, Tokyo, Beijing and Xi'an.

This frontend patch removes all address/coordinate city inference and preserves
canonical parser fields. It also accepts a previously unseen complete location
returned by `parse`. It does not claim that the deployed parser can independently
normalize every Google/Apple Maps link worldwide: that requires a separate backend
source review. Without a paid geocoder, Apple place URLs can often supply address,
name and source coordinates, while Google short links require redirect/page
metadata; neither guarantees globally normalized administrative fields. A parser
that cannot determine `city`, `country` and `country_code` must return an incomplete
record for manual confirmation instead of guessing.

## Acceptance evidence

`tests/location-catalog.test.cjs` adds unregistered Seoul (`KR`) and Shanghai
(`CN`) fixtures. It verifies automatic country/city discovery, strict shop
isolation, bounds, dynamic regions/districts, last-city restoration and provider
policy. The same test contains the three canonical Xi'an rows from the live Sheet.

The public API was replayed through the catalog module on 2026-09-18. It returned
83 active records and generated China with two cities: Beijing (3) and Xi'an (3).
Xi'an generated three regions and valid WGS-84 bounds without a required camera
configuration.
