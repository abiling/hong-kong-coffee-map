# Coffee Shops Map · Cloud Sync Edition

A mobile-first HTML5/PWA map for personal coffee-shop collections in Hong Kong, Tokyo, and Beijing.

## Architecture

- Front end: GitHub Pages
- Map: MapLibre GL JS + OpenFreeMap
- Cloud database: Google Sheets
- API: Google Apps Script Web App
- Local browser storage: the administrator key uses localStorage; each city's shop list uses sessionStorage and is cleared when the tab session ends

## Current features

- Cloud loading of all coffee shops
- Search by shop name, address, district, region or notes
- Region and district filters
- Only important public-building POIs are shown; ordinary commercial POIs remain hidden
- Map, list and favorites views
- City-specific merchant links: Google Maps for Hong Kong and Tokyo, Apple Maps for Beijing
- Cloud-synced favorites
- Add a shop by pasting the map link required by its city
- Automatic link parsing with editable fields before saving
- JSON and CSV exports
- iPhone safe-area layout and installable PWA

The canonical city/provider policy and Apps Script validation contract are documented in [MAP_PROVIDER_RULES.md](MAP_PROVIDER_RULES.md).

## Repository hygiene

The deployed app is fully static. Temporary extraction data belongs in `tmp/`, which is ignored by Git, and one-off data collection scripts are not part of the production repository.

## Security

The Apps Script Web App URL is public and read-only operations are open. All write operations require the private `ADMIN_KEY`. The key is entered by the owner in the app and is stored only in that device's localStorage. Never commit the key to this repository.
