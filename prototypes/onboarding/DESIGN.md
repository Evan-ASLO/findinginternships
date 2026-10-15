# Artifact-only built visual system

This document records the three **preview alternatives**, not a replacement authority for the production app. No winner is selected or published.

## Shared identity and product boundaries

Exact mandatory Clawpilot Light/Dark variable blocks are retained in `styles/globals.css`. The incumbent derived `--cp-coffee-bg`, `--cp-coffee-surface`, `--cp-clay`, `--cp-clay-strong` and `--cp-clay-soft` carry the warm cream/clay identity. Every component uses CP variables/current inherited foreground; no new hardcoded palette, font CDN, photography or competitor asset.

Primary typography is Segoe UI/Aptos/Calibri, with Georgia regular display headings. Main display is 32–52px, comparison 40–72px; mobile chapters use shorter semantically equivalent 28px titles. Tool text is readable UI type; all actions are at least 44px and fields 16px. Most controls use 10px corners and workspace sheets 16px. Paper, rules and original SVG provide structure; no glass or heavy decoration.

Derived `--cp-readable-muted` mixes 40% muted with the foreground to preserve dark coffee-background contrast. Final desktop/phone Light/Dark axe checks have zero violations. This is mechanical evidence, not a claim of artistic success.

## Three compositions

**Pinned Workspace**: compact welcome → four-quarter rail → narrative column paired with a sticky fictional role/workspace. Scene changes follow native chapter boundaries while the user's sample actions remain independent. Four readable chapter controls sit under the tool. Small scene arrivals use a bounded translate/clip reveal; no loop. Phone/no-JS uses normal in-flow chapter tools.

**Chapter Guide**: editorial chapter sequence with sticky contents at left. Tool sheets use open rule-separated composition instead of nested cards. Phone contents becomes a horizontal native-scroll navigation strip. No decorative reveal sequence; content is available in ordinary reading order.

**Journey Map**: original drawn SVG route at left, stations at right. One continuous ink stroke follows native scroll progress forward/backward. Slight paper orientation is removed under reduced motion. Phone collapses the map and wayfinding before normal-flow tools; the small route is decorative/aria-hidden, with separate accessible chapter links.

## Motion and focus

Native scroll is never hijacked. A single scheduled rAF measures five increasing boundaries and maps each interval to one quarter, with a 1px boundary snap for browser fractional-scroll rounding. Exact endpoints are 0/25/50/75/100; midpoints progress continuously. Only rounded progress/current scene update React; rail/path writes are bounded. Hidden-tab scheduling pauses.

Chapter links focus the target heading with `preventScroll` then use native smooth scrolling, or instant jumps for reduced motion. Reduced motion disables the desk reveal and paper transforms without removing useful tour progress. Hidden desktop chapter demos use `display:none` and cannot be tabbable. Replay resets only sample actions, never real records.

## Preview contexts and state

`context=request|welcome` switches local simulated access-request and approved-welcome examples. `scoutTheme=light|dark` supports preview themes, with OS preference only when absent. No storage, actual login, request, provider, email or file handling exists. Separate preparation, draft review and simulated-send controls demonstrate approval boundaries. Outcome selection/recording is manual and cannot be advanced by scroll.

Next Pages router was chosen for the standard custom `_document.jsx`, guaranteeing the required synchronous theme-detection script is the first emitted script before all framework JS. Static generation covers each separate route; source remains JavaScript/JSX.

## Review status

One independent screenshot-focused reviewer returned three material fixes: dark contrast, mobile staging and tiny pinned navigation. They were corrected together, then the scoped confirmation scored all resolved. Sync-helper continuation was unavailable, so final scoring was performed inline against its original findings without a second helper. No blocking issue remains; no approved comp/QUALITY BAR means no artistic-ceiling certification. Map's first mobile demo begins near the fold, intentionally normal-flow.
