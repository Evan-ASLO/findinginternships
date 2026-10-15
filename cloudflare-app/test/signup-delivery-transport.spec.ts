import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "../src/lib/fetch";

describe("signup delivery native Worker transport", () => {
	afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
	it("uses a native Worker-supported no-follow mode, even when the caller asks to follow", async () => {
		const outbound = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const request = new Request(input instanceof Request ? input : input.toString(), init);
			expect(request.redirect).toBe("manual");
			expect(request.url).toBe("https://api.resend.com/emails");
			expect(request.method).toBe("POST");
			return Response.json({ id: "00000000-0000-4000-8000-000000000001" });
		});
		expect(await fetchJson("https://api.resend.com/emails", { method: "POST", body: {}, redirect: "follow", attempts: 4 }))
			.toEqual({ id: "00000000-0000-4000-8000-000000000001" });
		expect(outbound).toHaveBeenCalledTimes(1);
	});
	it.each([301, 302, 303, 307, 308])("rejects HTTP%s without following or retrying any destination", async (status) => {
		const outbound = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const request = new Request(input instanceof Request ? input : input.toString(), init);
			expect(request.redirect).toBe("manual");
			return new Response(null, { status, headers: { Location: "http://127.0.0.1/forbidden-target" } });
		});
		await expect(fetchJson("https://api.resend.com/emails", { method: "POST", body: {}, attempts: 4 }))
			.rejects.toMatchObject({ name: "ProviderHttpError", status, message: "Verification delivery redirects are not allowed." });
		expect(outbound).toHaveBeenCalledTimes(1);
	});
	it("keeps timeout cancellation and exactly one transport invocation", async () => {
		vi.useFakeTimers();
		const outbound = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
			const request = new Request(input instanceof Request ? input : input.toString(), init);
			return new Promise((_resolve, reject) => {
				request.signal.addEventListener("abort", () => reject(new DOMException("Fictional aborted request", "AbortError")), { once: true });
			});
		});
		const pending = expect(fetchJson("https://api.resend.com/emails", { method: "POST", body: {}, timeoutMs: 1000, attempts: 4 }))
			.rejects.toMatchObject({ name: "AbortError" });
		await vi.advanceTimersByTimeAsync(1000); await pending;
		expect(outbound).toHaveBeenCalledTimes(1);
	});
});
