import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src";
import { Hono } from "hono";
import { beginGoogleOAuth } from "../src/lib/auth";
import { canonicalBrowserDestination, DOMAIN_ORIGIN, NAVIGATION_ASSET_PATHS, WORKER_ORIGIN } from "../src/lib/canonical-host";
import type { AppBindings, AppEnvironment } from "../src/types";

afterEach(() => vi.restoreAllMocks());
const request = (origin: string, path: string, method = "GET") => new Request(`${origin}${path}`, { method });
async function fetchWorker(req: Request, bindings: AppBindings = { ...env as AppBindings, APP_ORIGIN: DOMAIN_ORIGIN }) {
	const ctx = createExecutionContext();
	const response = await worker.fetch(req, bindings, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

describe("owned canonical browser host without signed-ingest or API redirects", () => {
	it.each(["login", "request", "connect"] as const)("builds the new registered callback for %s using fictional OAuth fixtures only", async (mode) => {
		const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("No provider calls."));
		const oauth = new Hono<AppEnvironment>();
		oauth.get("/start", (c) => beginGoogleOAuth(c, mode, mode === "connect" ? "11111111-1111-4111-8111-111111111111" : undefined));
		const response = await oauth.request(new Request(`${DOMAIN_ORIGIN}/start`), undefined, { ...env as AppBindings, APP_ORIGIN: DOMAIN_ORIGIN });
		expect(response.status).toBe(302);
		const destination = new URL(response.headers.get("location")!);
		expect(destination.origin).toBe("https://accounts.google.com");
		expect(destination.searchParams.get("redirect_uri")).toBe(`${DOMAIN_ORIGIN}/auth/google/callback`);
		const cookie = response.headers.get("set-cookie")!;
		expect(cookie).toContain("__Host-cc_oauth="); expect(cookie).toContain("Secure"); expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("SameSite=Lax"); expect(cookie).not.toMatch(/Domain=/i);
		expect(spy).not.toHaveBeenCalled();
	});
	it("keeps Connect authenticated instead of bypassing it to perform public callback QA", async () => {
		const response = await fetchWorker(request(DOMAIN_ORIGIN, "/auth/google/connect"));
		expect(response.status).toBe(401); expect(response.headers.get("location")).toBeNull();
		expect(response.headers.get("set-cookie")).toBeNull();
	});
	it.each(NAVIGATION_ASSET_PATHS)("redirects browser entry %s with its query before asset serving", (path) => {
		for (const alias of [WORKER_ORIGIN, "https://www.findinginternships.com"]) {
			expect(canonicalBrowserDestination(request(alias, `${path}?selectedJob=sample&category=legal`), DOMAIN_ORIGIN))
				.toEqual({ location: `${DOMAIN_ORIGIN}${path}?selectedJob=sample&category=legal`, status: 307 });
		}
	});
	it.each(["/auth/google/login", "/auth/google/request", "/auth/google/connect"])(
		"canonicalizes OAuth entry %s before state cookies or provider redirects", async (path) => {
			const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("No provider calls."));
			const response = await fetchWorker(request(WORKER_ORIGIN, `${path}?returnTo=%2F%3Fcategory%3Dlegal%23find-jobs`));
			expect(response.status).toBe(307);
			expect(response.headers.get("location")).toBe(`${DOMAIN_ORIGIN}${path}?returnTo=%2F%3Fcategory%3Dlegal%23find-jobs`);
			expect(response.headers.get("set-cookie")).toBeNull();
			expect(response.headers.get("cache-control")).toBe("no-store");
			expect(response.headers.get("cache-control")).toBe("no-store");
			expect(spy).not.toHaveBeenCalled();
		},
	);
	it("preserves the Google redirect URI and host-only state cookie on the canonical host", async () => {
		const response = await fetchWorker(request(DOMAIN_ORIGIN, "/auth/google/login?returnTo=%2F%23my-jobs"));
		expect(response.status).toBe(302);
		const google = new URL(response.headers.get("location")!);
		expect(google.origin).toBe("https://accounts.google.com");
		expect(google.searchParams.get("redirect_uri")).toBe(`${DOMAIN_ORIGIN}/auth/google/callback`);
		const cookie = response.headers.get("set-cookie")!;
		expect(cookie).toContain("__Host-cc_oauth="); expect(cookie).toContain("Secure");
		expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("SameSite=Lax"); expect(cookie).toContain("Path=/");
		expect(cookie).not.toMatch(/Domain=/i);
	});
	it("restarts an alias callback without forwarding OAuth code/state or deleting old cookies", async () => {
		const response = await fetchWorker(request(WORKER_ORIGIN, "/auth/google/callback?code=fictional-code&state=fictional-state&error=sample"));
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(`${DOMAIN_ORIGIN}/auth/google/login`);
		expect(response.headers.get("set-cookie")).toBeNull();
		expect(response.headers.get("location")).not.toMatch(/code|state|error/);
	});
	it("keeps mutations, APIs, signed-ingest, assets and verification files outside host redirects", async () => {
		for (const path of ["/api/internal/jobs/snapshot", "/api/health", "/api/session", "/logout", "/app.js", "/styles.css",
			"/launch/internship-coffee-chat-launch-dynamic.mp4", "/google608a0386c4068490.html"]) {
			expect(canonicalBrowserDestination(request(WORKER_ORIGIN, path), DOMAIN_ORIGIN)).toBeNull();
			expect(canonicalBrowserDestination(request(WORKER_ORIGIN, path, "POST"), DOMAIN_ORIGIN)).toBeNull();
		}
		const health = await fetchWorker(request(WORKER_ORIGIN, "/api/health"));
		expect(health.status).toBe(200); expect(health.headers.get("location")).toBeNull();
		const invalidIngest = await fetchWorker(request(WORKER_ORIGIN, "/api/internal/jobs/snapshot", "POST"));
		expect(invalidIngest.status).not.toBe(302); expect(invalidIngest.status).not.toBe(307); expect(invalidIngest.status).not.toBe(308);
		expect(invalidIngest.status).not.toBe(200); expect(invalidIngest.headers.get("location")).toBeNull();
	});
	it("supports safe asset-first transition back to workers.dev while its origin remains configured", () => {
		expect(canonicalBrowserDestination(request(DOMAIN_ORIGIN, "/auth/google/request"), WORKER_ORIGIN))
			.toEqual({ location: `${WORKER_ORIGIN}/auth/google/request`, status: 307 });
		expect(canonicalBrowserDestination(request(DOMAIN_ORIGIN, "/google608a0386c4068490.html"), WORKER_ORIGIN)).toBeNull();
		expect(canonicalBrowserDestination(request(WORKER_ORIGIN, "/auth/google/login"), WORKER_ORIGIN)).toBeNull();
	});
	it("does not reflect untrusted request hosts or change local/test origins", () => {
		expect(canonicalBrowserDestination(request("https://untrusted.example", "/auth/google/login"), DOMAIN_ORIGIN)).toBeNull();
		expect(canonicalBrowserDestination(request("http://example.com", "/"), "http://example.com")).toBeNull();
		expect(canonicalBrowserDestination(request(DOMAIN_ORIGIN, "/"), DOMAIN_ORIGIN)).toBeNull();
		expect(canonicalBrowserDestination(request("http://findinginternships.com", "/"), DOMAIN_ORIGIN))
			.toEqual({ location: `${DOMAIN_ORIGIN}/`, status: 307 });
	});
	it("uses uncached temporary redirects in both origin directions, including reversal after cutover", async () => {
		for (const [configured, alias] of [[WORKER_ORIGIN, DOMAIN_ORIGIN], [DOMAIN_ORIGIN, WORKER_ORIGIN], [WORKER_ORIGIN, DOMAIN_ORIGIN]]) {
			for (const path of ["/?category=legal", "/auth/google/request", "/auth/google/login", "/auth/google/connect"]) {
				const response = await fetchWorker(request(alias, path), { ...env as AppBindings, APP_ORIGIN: configured });
				expect(response.status).toBe(307);
				expect(response.headers.get("cache-control")).toBe("no-store");
				expect(response.headers.get("location")).toBe(`${configured}${path}`);
				expect(response.headers.get("set-cookie")).toBeNull();
			}
			const callback = await fetchWorker(request(alias, "/auth/google/callback?code=fictional&state=fictional"), { ...env as AppBindings, APP_ORIGIN: configured });
			expect(callback.status).toBe(302); expect(callback.headers.get("cache-control")).toBe("no-store");
			expect(callback.headers.get("location")).toBe(`${configured}/auth/google/login`);
		}
	});
	it("delegates the canonical HTML route to the original asset binding, rather than a new SPA/HTML implementation", async () => {
		const assets = { ...env.ASSETS, fetch: vi.fn(async () => new Response("fictional canonical HTML", { status: 200 })) };
		const response = await fetchWorker(request(DOMAIN_ORIGIN, "/"), { ...env as AppBindings, APP_ORIGIN: DOMAIN_ORIGIN, ASSETS: assets });
		expect(response.status).toBe(200); expect(await response.text()).toBe("fictional canonical HTML");
		expect(assets.fetch).toHaveBeenCalledOnce();
	});
	it("serves exact approved Google bytes with 200/no redirect on either transition origin and rejects SPA fallback", async () => {
		const content = "google-site-verification: google608a0386c4068490.html";
		for (const configured of [DOMAIN_ORIGIN, WORKER_ORIGIN]) for (const host of [DOMAIN_ORIGIN, WORKER_ORIGIN]) {
			const assets = { ...env.ASSETS, fetch: vi.fn(async (_input: RequestInfo | URL) => new Response(content, { status: 200 })) };
			const response = await fetchWorker(request(host, "/google608a0386c4068490.html"), { ...env as AppBindings, APP_ORIGIN: configured, ASSETS: assets });
			expect(response.status).toBe(200); expect(response.headers.get("location")).toBeNull();
			expect(await response.text()).toBe(content);
			const assetRequest = assets.fetch.mock.calls[0]![0];
			if (!(assetRequest instanceof Request)) throw new Error("Expected an asset Request.");
			expect(new URL(assetRequest.url).pathname).toBe("/google608a0386c4068490");
			const head = await fetchWorker(request(host, "/google608a0386c4068490.html", "HEAD"), { ...env as AppBindings, APP_ORIGIN: configured, ASSETS: assets });
			expect(head.status).toBe(200); expect(await head.text()).toBe("");
		}
		const assets = { ...env.ASSETS, fetch: vi.fn(async () => new Response("<html>wrong SPA fallback</html>", { status: 200 })) };
		const wrong = await fetchWorker(request(DOMAIN_ORIGIN, "/google608a0386c4068490.html"), { ...env as AppBindings, APP_ORIGIN: DOMAIN_ORIGIN, ASSETS: assets });
		expect(wrong.status).toBe(500);
	});
});
