# Finding Internships — private source snapshot

This is a fresh, code-only snapshot prepared for the private repository
`Evan-ASLO/findinginternships`. It contains no original Git history, account
database, user uploads, installed credentials or local development state.
Local preparation is not authorization to upload, a Microsoft/employer-policy
clearance, an ownership determination or a license grant.

## Start here

- **Current application:** `cloudflare-app` — the existing Cloudflare Worker and
  static web UI at https://findinginternships.com.
- **Selected welcome work:** `prototypes/onboarding` — standalone Next.js /
  JavaScript prototypes. `/map/` is the selected Journey Map direction; it has
  not replaced the production Worker. Historical simulated request/approval
  copy in these prototypes needs a separately reviewed registration redesign.
- **Legacy implementation:** root `.gs` files, `Index.html`, `appsscript.json`
  and `tests` — historical Apps Script source, not the current site's runtime.
  Original documentation is retained in `docs/LEGACY_APPS_SCRIPT_README.md`.
- **Fresh-computer instructions:** [SETUP.md](SETUP.md).
- **Dependencies, rights and exclusions:** [TRANSFER_NOTES.md](TRANSFER_NOTES.md).

The accepted application requires Google identity plus explicit email proof for
new signups, then ordinary access without owner approval. Existing legacy
membership and explicit account restrictions remain. Owner capabilities,
Google service consent and contact/draft/send approvals are separate.

Hosting, the D1 database, server secrets, domain and OAuth client stay in their
existing services. Copying code does not move or back up those resources.
Do not re-create them or run production migrations as a transfer step.

No GitHub Actions workflows are included. The parent reported Actions disabled
on the new destination repository. Nothing in this bundle activates CI,
scheduled jobs or production deployment.

The12 decorative `cloudflare-app/public/art/*.webp` images in this transfer
are newly authored geometric placeholders, not screenshot crops. Their existing
paths, WebP formats and dimensions are preserved. This export-only replacement
does not change the live website or authoritative release source. The updated
art receipt records each geometry/dimension/hash; vendor/logo/demo assets remain
separate and unchanged.

Initial commit/push, personal identity verification and any further production,
erasure or design work remain separately authorized operations.
