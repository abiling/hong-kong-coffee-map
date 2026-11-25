# Coffee Shops Map · Cloud Sync Edition

A mobile-first HTML5/PWA map for personal coffee-shop collections organized by country/region, city and area.

## Architecture

- Front end: GitHub Pages
- Map: MapLibre GL JS + OpenFreeMap
- Cloud database: Google Sheets
- API: Google Apps Script Web App
- Local browser storage: the administrator key, active country/city and the complete shop dataset use localStorage

## Current features

- Cloud loading of all coffee shops
- Search by shop name, address, district, region or notes
- Data-driven country/region → city → area navigation generated from canonical Sheet/API fields
- Dynamic area filters that only show areas containing shops
- Only important public-building POIs are shown; ordinary commercial POIs remain hidden
- Map, list and favorites views
- Jurisdiction policy for merchant links: Apple Maps for `CN`; Google Maps by default elsewhere
- Cloud-synced favorites
- Add a shop by pasting the map link required by its country/region policy
- Automatic link parsing with editable fields before saving
- JSON and CSV exports
- iPhone safe-area layout and installable PWA

The canonical city/provider policy and Apps Script validation contract are documented in [MAP_PROVIDER_RULES.md](MAP_PROVIDER_RULES.md).
The data-driven catalog architecture and parser boundary are documented in [docs/dynamic-location-catalog.md](docs/dynamic-location-catalog.md).

## Repository hygiene

The deployed app is fully static. Temporary extraction data belongs in `tmp/`, which is ignored by Git, and one-off data collection scripts are not part of the production repository.

## Security

The Apps Script Web App URL is public and read-only operations are open. All write operations require the private `ADMIN_KEY`. The key is entered by the owner in the app and is stored only in that device's localStorage. Never commit the key to this repository.

## Staging build

Build a Cloudflare Pages Direct Upload ZIP with Python 3 from the current source tree:

```sh
python3 tools/build_staging.py \
  --api-url 'https://your-test-api.example/exec' \
  --output /tmp/coffee-shops-v41-staging.zip
```

Use your staging Apps Script web app's HTTPS `/exec` URL. To build from a pinned
source revision, add `--commit <full-commit-sha>`. Use `--source-dir <path>` to read
another source directory or Git checkout. Choose a fresh output path for each run.
The ZIP has `index.html` at its root and includes only the static runtime assets.
The page and PWA are labeled Staging, and storage and Service Worker caches are
isolated by staging endpoint. Enter the staging admin key in the app on the
test device. Keep the generated ZIP and credentials out of Git.

For an existing Staging deployment, use the values from its deployed package
to retain storage, cache ownership, and installed PWA identity on the same origin.
The repository does not record the full v39/v40 deployment configuration.
Pass the exact localStorage prefix (including its trailing separator), Service
Worker `CACHE_PREFIX`, and manifest `id` as separate options.

```sh
python3 tools/build_staging.py \
  --api-url "$STAGING_API_URL" \
  --storage-prefix "$STAGING_STORAGE_PREFIX" \
  --cache-prefix "$STAGING_CACHE_PREFIX" \
  --manifest-id "$STAGING_MANIFEST_ID" \
  --output /tmp/coffee-shops-v41-compat.zip
```

If the deployed manifest omits `id`, use its effective identity resolved from
`start_url`. The builder appends the app version to the supplied cache prefix.
Omitted options keep the endpoint-hash defaults.
