# Coffee Shops Map API v7 deployment

| Target | API version returned by `?action=health` | Apps Script deployment |
| --- | --- | --- |
| Production | `6` | The existing production `/exec` and its currently assigned numeric script version |
| Candidate | `7` | An independent test project with its own versioned `/exec` |

The API version identifies the application contract. Apps Script assigns its own numeric script version each time you create a version. Record the production deployment URL and its numeric v6 version privately before any release work. Record the candidate deployment separately.

## Prepare the isolated candidate

1. Make an access-restricted copy of the production spreadsheet. Confirm its `Coffee Shops` tab has the current v6 headers, including `favorite` and `country_code`. Use a test identity with access to the copy and without write access to the production spreadsheet when possible.
2. Create a separate Apps Script project and copy in `Coffee_Shops_Map_API_v7.gs`. In **Project Settings → Script properties**, set the following values before testing:
   - `DATABASE_ENVIRONMENT` to `candidate`.
   - `SPREADSHEET_ID` to the **test copy's** ID, taken from its URL between `/d/` and the next slash. Verify it against the copy's URL before saving.
   - `ADMIN_KEY` to a freshly generated test-only secret. Store it privately and enter it in the candidate preview only. Keep keys and other credentials out of the public GitHub repository, including source, commits, fixtures and PR text.
3. The backend requires explicit database properties and rejects the known production Sheet ID in candidate mode. Verify the candidate's `?action=list` against a test-only marker row added directly to the copy before issuing API writes. List and save operations check the schema. Resolve header mismatches before testing. Leave setup and legacy migration functions unused.
4. **Deploy → Test deployments → Web app** serves the latest saved source on `/dev` and requires a signed-in user with editor access to that project. Use it for Apps Script editor smoke checks. Deploy a numbered web app version in the **test project** for preview testing at its own `/exec`. Set access for the intended testers and verify that browser requests from the preview can follow the Apps Script redirect and receive JSON under that access policy. Verify `?action=health` reports `7` and the test-only marker row is visible on this exact `/exec`.

## Connect a private PR #8 v39 preview

Use a private preview copy of PR #8 at `dc9082de6fef30f6c00e54d313951665be1449ad` on a dedicated HTTPS origin (a different scheme, host or port from the production PWA). A different path on the production origin shares browser storage and may fall under an existing service worker.

- Set `API_URL` in **both** `app.js` and `admin-core.js` to the candidate `/exec`. Set `API_MARKER` in `multicity.js` to the matching `script.google.com/macros/s/<candidate-deployment-id>/exec` substring of that URL. The marker controls normalization of list, parse and save responses.
- Give the preview its own service-worker cache name (`CACHE` in `sw.js`) and data cache key (`ALL_DATA_CACHE_KEY` in `location-catalog.js`). Keep storage and the test admin key on the dedicated origin. Serve a refreshed preview shell with matching asset and service-worker revisions. Verify the production PWA still uses the v6 `/exec`.
- In the preview's network log, confirm list, parse, add and update all use the same candidate deployment ID. Confirm admin writes use only the test key.

## Real-environment release gates

1. Parse real merchant links in Hong Kong, Tokyo, Beijing, Xi'an, Shanghai, Seoul and Paris. Include a Google short-link redirect and an Apple merchant link with an explicit `coordinate`. Verify canonical country/city, region/district, and provider policy (CN uses Apple Maps, elsewhere Google Maps). Compare Beijing and Xi'an coordinates with known WGS-84 pins. Check that a Google viewport, an Apple `ll` or `center` viewport, and ambiguous name-only links produce a clear error.
2. On the copied Sheet, use the v39 preview to parse, add and edit. Verify new cities appear after a save, manually complete blank region/district fields, and confirm the saved pin matches the link. Changing coordinates in the form requires a matching merchant link. Verify mismatched locations and duplicate saves fail, two concurrent saves of the same merchant leave one row, and favorite and notes edits avoid extra geocoder calls.
3. Review the candidate source against the deployed v6 baseline before promotion. After real checks pass and promotion is authorized, configure the existing production project with `DATABASE_ENVIRONMENT=production` and `SPREADSHEET_ID` set to the verified production ID. Retain its existing `ADMIN_KEY`. Create a numbered v7 version in that project and point the existing production web app deployment to it using **Deploy → Manage deployments**. Preserve the production URL and access policy. Recheck production health, list and authenticated parse.
4. To roll back, point the same production deployment to the recorded numeric v6 version and confirm production health reports `6`. Deployment rollback changes the running code only. Sheet writes persist and require separate, authorized recovery.

Local checks use Node.js. The v7 parser suite mocks Apps Script Maps, redirects, locks and spreadsheet access. Real Apps Script and PR #8 E2E testing require the isolated candidate described above.

    node --check < apps-script/Coffee_Shops_Map_API_v7.gs
    node --test tests/api-v7-parser.test.cjs
