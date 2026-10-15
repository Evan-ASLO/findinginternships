interface JsonRequest {
	method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
	headers?: Record<string, string>;
	body?: unknown;
	timeoutMs?: number;
	attempts?: number;
	signal?: AbortSignal;
	redirect?: RequestRedirect;
}

export class ProviderHttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "ProviderHttpError";
	}
}

const allowedHosts = new Set([
	"api.tavily.com",
	"api.hunter.io",
	"api.apollo.io",
	"generativelanguage.googleapis.com",
	"api.openai.com",
	"api.anthropic.com",
	"oauth2.googleapis.com",
	"gmail.googleapis.com",
	"sheets.googleapis.com",
	"api.resend.com",
]);

export async function fetchJson<T>(
	url: string,
	options: JsonRequest = {},
): Promise<T> {
	const parsed = new URL(url);
	if (parsed.protocol !== "https:" || !allowedHosts.has(parsed.hostname)) {
		throw new Error("Outbound destination is not allowed.");
	}
	const verificationMail = parsed.hostname === "api.resend.com";
	if (verificationMail && (parsed.pathname !== "/emails" || parsed.search || parsed.hash || parsed.port || parsed.username || parsed.password ||
		(options.method ?? (options.body === undefined ? "GET" : "POST")) !== "POST")) {
		throw new Error("Resend verification delivery destination is not allowed.");
	}
	const attempts = verificationMail ? 1 : Math.min(Math.max(options.attempts ?? 2, 1), 4);
	let lastError: Error | undefined;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		options.signal?.throwIfAborted();
		const controller = new AbortController();
		const abort = () => controller.abort(options.signal?.reason);
		options.signal?.addEventListener("abort", abort, { once: true });
		const timeout = setTimeout(
			() => controller.abort(),
			Math.min(Math.max(options.timeoutMs ?? 15000, 1000), 30000),
		);
		try {
			const response = await fetch(url, {
				method: options.method ?? (options.body === undefined ? "GET" : "POST"),
				headers: {
					Accept: "application/json",
					...(options.body === undefined
						? {}
						: { "Content-Type": "application/json" }),
					...options.headers,
				},
				body:
					options.body === undefined ? undefined : JSON.stringify(options.body),
				signal: controller.signal,
				redirect: verificationMail ? "manual" : options.redirect ?? "follow",
			});
			if (verificationMail && response.status >= 300 && response.status < 400) {
				throw new ProviderHttpError(response.status, "Verification delivery redirects are not allowed.");
			}
			const text = await response.text();
			if (!response.ok) {
				const retryable = [429, 500, 502, 503, 504].includes(response.status);
				if (retryable && attempt < attempts) {
					await sleep(300 * 2 ** (attempt - 1));
					continue;
				}
				throw new ProviderHttpError(
					response.status,
					`Provider request failed with HTTP ${response.status}: ${safeProviderMessage(text)}`,
				);
			}
			return text ? (JSON.parse(text) as T) : ({} as T);
		} catch (error) {
			lastError =
				error instanceof Error ? error : new Error("Provider request failed.");
			if (
				options.signal?.aborted ||
				attempt >= attempts ||
				(!lastError.message.includes("aborted") &&
					!lastError.message.includes("HTTP 5") &&
					!lastError.message.includes("HTTP 429"))
			) {
				throw lastError;
			}
			await sleep(300 * 2 ** (attempt - 1));
		} finally {
			clearTimeout(timeout);
			options.signal?.removeEventListener("abort", abort);
		}
	}
	throw lastError ?? new Error("Provider request failed.");
}

export async function fetchForm<T>(
	url: string,
	body: URLSearchParams,
	options: Omit<JsonRequest, "body"> = {},
): Promise<T> {
	const parsed = new URL(url);
	if (parsed.protocol !== "https:" || !allowedHosts.has(parsed.hostname)) {
		throw new Error("Outbound destination is not allowed.");
	}
	if (parsed.hostname === "api.resend.com") throw new Error("Resend form requests are not allowed.");
	const response = await fetch(url, {
		method: options.method ?? "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded",
			...options.headers,
		},
		body,
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(
			`Provider request failed with HTTP ${response.status}: ${safeProviderMessage(text)}`,
		);
	}
	return text ? (JSON.parse(text) as T) : ({} as T);
}

function safeProviderMessage(value: string): string {
	const compact = value.replace(/\s+/g, " ").trim().slice(0, 500);
	return compact
		.replace(/AIza[A-Za-z0-9_-]+/g, "[REDACTED]")
		.replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
		.replace(/tvly-[A-Za-z0-9_-]+/g, "[REDACTED]");
}

function sleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
