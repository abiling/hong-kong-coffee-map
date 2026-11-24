# Coffee Shops Map API v7

Backend only. Based on the user-supplied v6 source (SHA-256:
80e32ac8cd8fdc6224a17e01b3f1c86ae7dc4e7b588dc2218902219aac34d552).
No PR #8 frontend changes, schema migration, deployment identifier or admin key value in this patch.

- Select the parser by the submitted merchant URL. Legacy and new hint fields do not constrain geocoding.
- Prefer a merchant pin; never treat a Google map viewport center as a merchant pin. If only the name is available, try an unbiased lookup and reject ambiguous or partial results.
- Reverse-geocode with the existing Apps Script Maps service; derive city and country from structured components, and confirm CN Apple pins after the unchanged GCJ-02 conversion.
- Country and city configuration is not an ingestion or save allowlist. Use Apple for CN and Google elsewhere. Missing canonical location returns an error rather than falling back to the selected city.
- Apple duplicate matching preserves place IDs or coordinates instead of collapsing all /place URLs.

Local checks:

    node --check < apps-script/Coffee_Shops_Map_API_v7.gs
    node tests/api-v7-parser.test.cjs

These tests mock Maps, URL Fetch and Sheet writes. They are not production E2E.

## Release gates

1. In the existing project, record the current production numeric version privately. Verify the deployed source matches the supplied v6 baseline. Save v7 in the editor in place of the old Code file; do not load both files. Leave Script Properties alone. Do not run setup or legacy migrations.
2. Use **Deploy → Test deployments → Web app** in the Apps Script editor. Verify health reports API version 7. Test real merchant links for Hong Kong, Tokyo, Beijing and Xi'an against current records, including Google short-link redirects, real administrative components and stored Beijing/Xi'an coordinates. Compare region/district labels against existing filters. Test a real Paris/FR link as a completely unregistered case.
3. Create a separate versioned candidate and keep the production /exec unchanged. Use a private PR #8 preview pointed at the candidate. Parse a real Shanghai Apple Maps link with Beijing/CN hints and a Seoul Google Maps link with Tokyo/JP hints. Confirm the review form and provider. With authorized legitimate records only, save and verify the new country/city appears without reload. Do not write fixtures to the production Sheet.
4. Only after real tests pass, update the existing Web App deployment to the tested numeric version using **Deploy → Manage deployments**. Preserve its URL and access policy. Recheck production health, list and authenticated parse.
5. Rollback: point the same production deployment back to the recorded numeric v6 version. This does not revert Sheet writes.

API semantic version: 7. Apps Script numbered candidate/deployment: not created by this patch.
