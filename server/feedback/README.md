# TheOne feedback receiver

A Cloudflare Worker at `https://feedback.yulid.org` that receives the problem reports users send
from TheOne's **Report a problem** dialog. Each report is stored in a D1 database for 90 days and
emailed to the maintainer (at most 30 emails a day; the rest are only stored).

- `POST /v1/reports`: a report as built by `src/feedback.ts` → `201 { id }` (e.g. `FB-7K3QXM`).
  Limits: 64 KB per request, 5 reports per sender per hour (`429`). Only a salted hash of the
  sender's address is kept, for an hour, for that limit.
- `GET /v1/health` → `{ ok: true }`.
- A daily cron deletes reports older than 90 days.

`handler.js` holds all the logic and runs under Node for tests (`npm run feedback:test`);
`worker.js` only wires in Cloudflare's bindings.

## Deploy

Needs: yulid.org on Cloudflare with Email Routing enabled, and your inbox verified under
**Email Routing → Destination addresses**. Run from this folder:

```sh
npx wrangler login                                    # opens the browser; no token to copy
npx wrangler d1 create theone-feedback                # put the printed database_id in wrangler.toml
npx wrangler d1 execute theone-feedback --remote --file=schema.sql
npx wrangler deploy                                   # also creates the feedback.yulid.org DNS record
npx wrangler secret put MAIL_TO                       # your verified inbox
npx wrangler secret put IP_SALT                       # any random text, e.g. from: openssl rand -hex 16
curl https://feedback.yulid.org/v1/health
```

Send a test report and check that the email arrives:

```sh
curl -X POST https://feedback.yulid.org/v1/reports -H 'content-type: application/json' \
  -d '{"v":1,"app":"theone","version":"0.3.21","lang":"zh","description":"测试报告"}'
```

## Reading and deleting reports

```sh
npx wrangler d1 execute theone-feedback --remote --command \
  "SELECT id, datetime(created_at/1000,'unixepoch') AS at, version, contact, description FROM reports ORDER BY created_at DESC LIMIT 20"
npx wrangler d1 execute theone-feedback --remote --command "SELECT diagnostics, reply FROM reports WHERE id = 'FB-XXXXXX'"
npx wrangler d1 execute theone-feedback --remote --command "DELETE FROM reports WHERE id = 'FB-XXXXXX'"
```

Delete a report when its sender asks; the README promises it.
