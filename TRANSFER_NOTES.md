# Transfer scope, external dependencies and rights

## Included

The current Worker application source/static assets, exact public verification
file, build configuration, manifests/lockfiles, migrations, tests, local
synthetic fixture tooling and relevant documentation are included.
The historical Apps Script implementation remains at the root. The standalone
onboarding prototype is included under `prototypes\onboarding`, including the
selected Journey Map and its two alternatives.

Source files are copied from the actual accepted working tree rather than a
Git archive or an old commit. LF/CRLF/BOM and binary bytes are preserved unless
a manifest explicitly identifies a portable-documentation/template change.
No old Git metadata or author history is transferred.

The export-only `.gitattributes` disables automatic line-ending normalization
so a later separately authorized initial commit can preserve these source
bytes, including the no-newline Google verification asset, across Windows
and other machines. It does not modify the original repository's settings.

## Not included or migrated

- Original `.git`, history, remotes, credentials, configured author identities
  and original repository settings.
- `node_modules`, build output, caches, logs, screenshots, local D1 databases,
  generated fixture instances and machine/editor state.
- Real environment files, credential stores, OAuth/browser sessions, API keys,
  resumes/profile data, private records or production exports.
- Copilot history, unrelated session files, internal/company material and
  GitHub Actions workflows.
- The separate job-catalog publisher/tracker source repository or its runner,
  schedule and secret stores. This package contains the consumer contract,
  validation and synthetic snapshot example, not that other repository.

The existing Cloudflare Worker/D1/queue/domain, Google OAuth client and
per-user grants, Resend account/domain, external job sources and selected
provider accounts remain external dependencies. Their data/secrets/permissions
are not supplied by a GitHub clone and have not been copied or changed here.
The existing signed job publisher must keep its own approved scheduling and
credential custody; moving this source does not migrate it.

Some retained operational runbooks describe earlier rollout stages. They are
historical references, not instructions to repeat migrations, exports, key
rotation, approval backfills, DNS changes or provider calls.

## Licensing and provenance

No top-level project license was found; none has been invented. Ownership,
employer/AI-use permission and permission to publish this code remain decisions
for the user to establish before upload. Private repository visibility does not
settle those questions.

The vendored Three.js MIT license and source/version receipt are preserved in
`cloudflare-app\public\vendor`. Other installed dependencies carry their own
licenses through npm; manifests and lockfile license metadata are retained.
Adzuna's official logo/source attribution instructions are retained in
`cloudflare-app\docs\SOURCE_ATTRIBUTION.md`; preserving them is not a general
license grant for other assets.

At the user's explicit direction, the12 formerly cropped decorative images
have been replaced **in this transfer copy only** with newly authored geometric
placeholders. The renderer starts from blank RGB canvases and uses independently
specified circles, rectangles and lines. It does not load, trace, crop or sample
any reference imagery. No old cropped image payload is in the transfer tree.
The authoritative release source, live site and previews are unchanged.

### Exact original-placeholder inventory

The existing `cloudflare-app/public/art/reference-art-receipt.json` path is
retained for compatibility. Its current entries describe these replacements,
their geometry, original dimensions and output hashes, not screenshot sources
or crop rectangles. Historical crop provenance and hashes remain in preparation
evidence outside the publish tree.

| Included path | Newly authored geometry |
|---|---|
| `cloudflare-app/public/art/jobs-hero.webp` | Paper and magnifying lens |
| `cloudflare-app/public/art/jobs-rail.webp` | Blank role sheet |
| `cloudflare-app/public/art/applications-hero.webp` | Three paper sheets |
| `cloudflare-app/public/art/applications-desk.webp` | Abstract stationery strip |
| `cloudflare-app/public/art/networking-hero.webp` | Three connected points |
| `cloudflare-app/public/art/networking-desk.webp` | Abstract stationery strip |
| `cloudflare-app/public/art/analytics-hero.webp` | Decorative bars and connecting line |
| `cloudflare-app/public/art/analytics-side.webp` | Vertical points and ticks |
| `cloudflare-app/public/art/settings-hero.webp` | Three abstract sliders |
| `cloudflare-app/public/art/settings-notebook.webp` | Blank notebook and pencil line |
| `cloudflare-app/public/art/home-hero.webp` | Simple route and blank paper |
| `cloudflare-app/public/art/home-coffee.webp` | Abstract overhead coffee cup |

These placeholders contain no user information, actual chart data, achievements
or embedded UI controls. The generation method is documented without inventing
a top-level license or asserting a legal ownership determination.

They are separate from the vendored
`cloudflare-app/public/vendor/three.core.min.js`,
`three.module.min.js`, `three.LICENSE.txt`, `three.RECEIPT.txt`, and the official
`cloudflare-app/public/adzuna_logo.png` with its attribution instructions.
The public demonstration's `cloudflare-app/public/launch/` video, poster and
captions are a further distinct media category, not a vendor license.
The unchanged public demo is labelled fictional. Media sample inspection and
textual credential scanning are not a comprehensive legal or forensic privacy
certification; general transfer/employer permissions remain for the user to establish.

All test/example/local-preview identities and data are authored fixtures, not
exported production rows. Placeholder/sample keys are not live credentials.
The transfer receipt outside this source root records included paths/hashes,
exclusions, scan results, validation and any unresolved concerns.
