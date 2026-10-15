# Three Next.js onboarding prototypes

Local-only comparison for Internship & Coffee Chat, authored in **Next.js 16.4.0 / React 19.2.0 / JavaScript + JSX**, with native CSS/SVG/scroll/rAF. No motion package, external assets, runtime CDN, analytics or connected services.

Uses Next's Pages router/static generation and standard custom Document so the mandated early theme detection is the first emitted script. Three compositions share truthful data/state helpers but use distinct layouts and interactions. PRODUCT.md, DIRECTIONS.md and DESIGN.md are artifact-only, not production authorities.

## Run

```powershell
npm ci
npm test
npm run build
npm start
```

Default loopback preview: `http://127.0.0.1:8824`.

Routes: `/workspace/` (pinned tool scene), `/chapters/` (editorial guide), `/map/` (original SVG route). `/` compares all three. Deep routes support `?context=request|welcome&scoutTheme=light|dark`. Context/theme controls are preview-only and do not persist preferences.

Scroll through the stages or use chapter links, Skip tour, Back and Replay. Tool actions are explicitly fictional; the optional resume is an illustration, never a file picker. Access and welcome forms simulate only; no request/email/login/offer is real. State stays in current-page memory and resets on reload/another route. No credentials or provider are connected.

The native progress rail measures the tool tour, not applications. Boundaries are exact 0/25/50/75/100; reverse scrolling reverses it. All four descriptions remain in static HTML without JavaScript. Reduced motion turns off decorative transitions and smooth jumps. Phones use normal flow rather than oversized sticky scenes.

The separate source ZIP excludes `node_modules`, `.next`, logs, screenshots and any environment files. Build and preview output are not production publication. Repository/live app source, deployment/configuration and all D1/user data are untouched.
