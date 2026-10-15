export function signupVerificationPage(mode: "pending" | "verify", enabled: boolean): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/><meta name="referrer" content="no-referrer"/>
<title>${mode === "verify" ? "Confirm your email" : "Check your email"} | Finding Internships</title>
<script src="/theme.js?v=20261009-critique-1"></script>
<link rel="stylesheet" href="/styles.css?v=20261015-dashboard-layout-1"/>
<link rel="stylesheet" href="/job-first.css?v=20261015-dashboard-layout-1"/>
<link rel="stylesheet" href="/signup-verification.css?v=20261015-1"/>
${enabled ? '<script src="/signup-verification.js?v=20261015-self-service-1" defer></script>' : ""}
</head>
<body class="signup-proof-page" data-signup-view="${mode}">
<header class="signup-proof-brand"><a href="/">Internship &amp; Coffee Chat</a><span>Finding Internships</span></header>
<main class="signup-proof-panel" aria-labelledby="signup-proof-title">
<div class="signup-proof-mail" aria-hidden="true"><svg viewBox="0 0 48 48"><rect x="6" y="12" width="36" height="26" rx="3"/><path d="m7 14 17 13 17-13"/></svg></div>
<h1 id="signup-proof-title">${enabled ? mode === "verify" ? "Confirm it’s your email." : "One more step: your email." : "Email verification is not enabled yet."}</h1>
<p id="signup-proof-intro">${enabled ? "Your Google signup and this email link verify it’s you. Confirm in the original signup browser to finish signup and open your workspace." : "Existing Google sign-in and access are unchanged. Extra email verification has not been activated."}</p>
<div id="signup-proof-state" role="status" aria-live="polite">${enabled ? "Loading your signup status…" : "No verification message has been sent by this page."}</div>
<p id="signup-proof-recipient" hidden></p>
<p id="signup-proof-error" role="alert" hidden></p>
<div class="signup-proof-actions">
<button id="signup-proof-confirm" class="primary" hidden>Confirm this email address</button>
<button id="signup-proof-resend" class="secondary" hidden>Send a fresh verification link</button>
<button id="signup-proof-refresh" class="secondary" ${enabled ? "" : "hidden"}>Refresh status</button>
<a id="signup-proof-login" class="button primary" href="/auth/google/login" ${enabled ? "hidden" : ""}>Sign in with Google</a>
</div>
<p id="signup-proof-expiry" class="signup-proof-help"></p>
<details class="signup-proof-help">
<summary>Link expired, forwarded or opened in another browser?</summary>
<p>Open the newest email in the browser where you started signup. Links last up to 30 minutes within the one-hour signup session. Resending replaces earlier links, including when a new delivery attempt fails.</p>
<p>A forwarded link cannot log another person in. If this is a different browser, use Google sign-in below to establish your own matching signup and request a fresh message. Existing users do not need this additional verification.</p>
</details>
<div class="signup-proof-links"><a href="/auth/google/login">Use Google sign-in again</a><a href="/privacy">Privacy</a><a href="/">Back to the website</a></div>
<noscript><p class="notice warning">JavaScript is needed for explicit confirmation of the email link. No link is consumed just by opening this page. Enable JavaScript, then reopen the email link.</p></noscript>
</main>
<footer class="signup-proof-footer">No owner approval is needed for ordinary verified signup. Account restrictions still apply. Connecting Google services and approving outreach remain separate.</footer>
</body></html>`;
}
