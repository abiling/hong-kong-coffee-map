# Coffee Shops Map · Cloud Sync Edition

A mobile-first HTML5/PWA map for personal coffee-shop collections in Hong Kong, Tokyo, and Beijing.

## Architecture

- Front end: GitHub Pages
- Map: MapLibre GL JS + OpenFreeMap
- Cloud database: Google Sheets
- API: Google Apps Script Web App
- Local browser storage: administrator key only; shop data is never stored locally

## Current features

- Cloud loading of all coffee shops
- Search by shop name, address, district, region, notes or status
- Region and district filters
- Map, list and priority-saved views
- City-specific merchant links: Google Maps for Hong Kong and Tokyo, Apple Maps for Beijing
- Cloud-synced status changes: 想去 / 优先去 / 去过
- Add a shop by pasting the map link required by its city
- Automatic link parsing with editable fields before saving
- JSON and CSV exports
- iPhone safe-area layout and installable PWA

The canonical city/provider policy and Apps Script validation contract are documented in [MAP_PROVIDER_RULES.md](MAP_PROVIDER_RULES.md).

## Security

The Apps Script Web App URL is public and read-only operations are open. All write operations require the private `ADMIN_KEY`. The key is entered by the owner in the app and is stored only in that device's localStorage. Never commit the key to this repository.
