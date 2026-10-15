# Fresh-computer setup

## Tools and source

Install the current supported **Node.js LTS** and its bundled npm from
https://nodejs.org/ and Git from its official distribution. This snapshot was
prepared using Node24 LTS. Use a short working path on Windows, for example
`C:\src\findinginternships`, to avoid long local SQLite/build paths.

After a separately approved initial private upload, clone
`https://github.com/Evan-ASLO/findinginternships.git` with the confirmed personal
identity. Do not copy work credentials, old `.git` history, global Git settings,
browser sessions or a machine's credential stores. A personal repository does
not establish permission to transfer employer-owned or otherwise restricted work.

## Current Worker application

```powershell
Set-Location C:\src\findinginternships\cloudflare-app
npm ci --no-audit --no-fund
npm run typecheck
npm run test:ui
npm test -- --maxWorkers 1 --no-file-parallelism test/signup-verification.spec.ts test/signup-delivery-transport.spec.ts test/index.spec.ts test/private-jobs.spec.ts test/canonical-host.spec.ts test/beta-notifications.spec.ts test/owner-admin.spec.ts
npm run deploy -- --dry-run
```

The typecheck/tests use the included source, migrations and fictional fixtures;
they do not need production credentials or private user data. Package lockfiles
pin the dependency graphs. The legacy root package has no dependency lockfile
because its static test uses only Node built-ins; run `npm test` there separately.

Edit application behavior in `src`, frontend code in `public`, and signup email
subject/body in `cloudflare-app\src\lib\signup-verification.ts`. Keep the native
manual/no-follow mail transport, explicit3xx rejection, proof/browser/CSRF
binding and ordinary-versus-owner permission boundaries.

`npm run dev` uses a local Worker database, not a restored copy of production.
Unconfigured Google/provider features are not ready for real use merely because
the server starts. The supplied `scripts\prepare-*-preview.mjs` and local test
adapters are synthetic review tooling; read their safeguards before use. Never
populate local files with exported production keys, accounts or resumes.

The example variable file contains placeholders, not working credentials.
Never commit `.dev.vars`, `.env`, local D1/SQLite files or generated previews.

## Journey Map welcome prototype

```powershell
Set-Location C:\src\findinginternships\prototypes\onboarding
npm ci --no-audit --no-fund
npm test
npm run build
npm start
```

Open `http://127.0.0.1:8824/map/`. The other alternatives remain at
`/workspace/` and `/chapters/`. Use another free local port if8824 is already in
use. These demos contain fictional role/profile/resume/outreach state only.
They do not authenticate users, contact providers or send mail.
The selected map's historical `context=request|welcome` copy is not the current
access policy; the future approved direction is Register -> Google identity ->
explicit email proof -> enter workspace.

## Existing production hosting — separate approval required

No deployment is part of this source transfer. Only an authorized operator,
with permission to access the existing Cloudflare account, may authenticate
Wrangler on a new computer. Confirm the existing `coffee-chat-agent` Worker,
D1 binding, queue, canonical origin and domain before any write.

For a separately reviewed and approved release:

```powershell
Set-Location C:\src\findinginternships\cloudflare-app
npm run deploy
```

The package script includes `--keep-vars --no-autoconfig`. Do not bypass it
with bare `wrangler deploy`: the installed runtime
`ENABLE_SIGNUP_EMAIL_VERIFICATION=true` is not in the source vars block and
must not be dropped. Do not read/export/reinstall live secrets as a transfer
step. Keep existing D1 schema/proofs/frozen legacy membership and verify the
actual flag is `true` after release.

Keep `APP_ORIGIN=https://findinginternships.com`, the exact public Google
verification file and protected old Worker signed-ingest endpoint intact.
Do not run `db:migrate:remote`, restore a database, replace OAuth clients/scopes,
change DNS, reset the cohort or send test mail merely to clone this repository.

GitHub source synchronization is not synchronization or backup of live D1,
secrets, mailboxes or Google files. There is no automatic production workflow
in this snapshot. Erasure and broader UI/audit work are not included.
