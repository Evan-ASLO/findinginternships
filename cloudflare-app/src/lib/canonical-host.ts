export const WORKER_ORIGIN = "https://coffee-chat-agent.evanastonlowe.workers.dev";
export const DOMAIN_ORIGIN = "https://findinginternships.com";
const browserHosts = new Set([
	new URL(WORKER_ORIGIN).hostname,
	new URL(DOMAIN_ORIGIN).hostname,
	"www.findinginternships.com",
]);

export const NAVIGATION_ASSET_PATHS = [
	"/",
	"/index.html",
	"/privacy",
	"/privacy.html",
	"/privacy/",
	"/terms",
	"/terms.html",
	"/terms/",
] as const;
const navigationPaths = new Set<string>(NAVIGATION_ASSET_PATHS);
const oauthPaths = new Set([
	"/auth/google/login",
	"/auth/google/request",
	"/auth/google/connect",
]);

export function canonicalBrowserDestination(
	request: Request,
	appOrigin: string,
): { location: string; status: 302 | 307 } | null {
	if (!["GET", "HEAD"].includes(request.method)) return null;
	const configured = new URL(appOrigin);
	// Keep test/local origins unchanged; production redirects are limited to owned app aliases.
	if (![WORKER_ORIGIN, DOMAIN_ORIGIN].includes(configured.origin)) return null;
	const incoming = new URL(request.url);
	if (!browserHosts.has(incoming.hostname) || incoming.origin === configured.origin) return null;
	if (incoming.pathname === "/signup/verify" || incoming.pathname === "/signup/pending") {
		return { location: `${configured.origin}/signup/pending#`, status: 302 };
	}
	if (incoming.pathname === "/auth/google/callback") {
		// An alias's in-flight OAuth cookie cannot cross hosts. Restart without forwarding its code/state.
		return { location: `${configured.origin}/auth/google/login`, status: 302 };
	}
	if (!navigationPaths.has(incoming.pathname) && !oauthPaths.has(incoming.pathname)) return null;
	const target = new URL(incoming.pathname, configured.origin);
	target.search = incoming.search;
	return { location: target.toString(), status: 307 };
}
