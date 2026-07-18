# Hong Kong Coffee Shops · Cloud Sync Edition

A mobile-first HTML5/PWA map for a personal collection of Hong Kong coffee shops.

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
- Google Maps and Apple Maps links
- Cloud-synced status changes: 想去 / 优先去 / 去过
- Add a shop by pasting a Google Maps link
- Automatic link parsing with editable fields before saving
- JSON and CSV exports
- iPhone safe-area layout and installable PWA

## Security

The Apps Script Web App URL is public and read-only operations are open. All write operations require the private `ADMIN_KEY`. The key is entered by the owner in the app and is stored only in that device's localStorage. Never commit the key to this repository.
