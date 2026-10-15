(() => {
	let token = new URLSearchParams(location.hash.slice(1)).get("t");
	if (location.hash || location.search) history.replaceState(null, "", location.pathname);
	let current = null, busy = false;
	const byId = (id) => document.getElementById(`signup-proof-${id}`);
	const messages = {
		READY: "A verification message has not been accepted for delivery yet.",
		SENDING: "The delivery attempt is still being processed. Refresh status before trying again.",
		ACCEPTED: "The email service accepted a verification message. Check your inbox and spam folder; mailbox delivery is not yet confirmed.",
		FAILED: "The verification message was not accepted. Wait before requesting a fresh link.",
		UNCERTAIN: "Delivery could not be confirmed. Check your mailbox first, then request a fresh link if needed.",
		NOT_CONFIGURED: "Verification email delivery is not configured yet. Your signup remains incomplete; no workspace access has been granted.",
	};
	function showError(message) { byId("error").textContent = message; byId("error").hidden = !message; }
	function controls() {
		const complete = current?.verified, expired = current?.expired || current?.replaced || current?.restricted;
		byId("confirm").hidden = !(current && token && !complete && !expired && !current.linkExpired);
		byId("resend").hidden = !(current && !complete && !expired);
		byId("login").hidden = !(!current || complete || expired);
		if (current?.loginUrl) byId("login").href = current.loginUrl;
		for (const button of document.querySelectorAll(".signup-proof-actions button")) button.disabled = busy;
	}
	async function request(path, body) {
		const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
		try {
			const headers = { Accept: "application/json" };
			if (body !== undefined) {
				const cookie = document.cookie.split("; ").find((value) => value.startsWith(`${current?.csrfCookieName}=`));
				headers["X-CSRF-Token"] = cookie ? decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1)) : "";
				headers["Content-Type"] = "application/json";
			}
			const response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers,
				body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin", signal: controller.signal });
			let data;
			try { data = await response.json(); } catch { throw new Error("The signup response could not be read. Refresh status before retrying."); }
			if (!response.ok) throw new Error(data.message || "Signup verification could not be completed.");
			return data;
		} finally { clearTimeout(timer); }
	}
	async function refresh() {
		if (busy) return;
		busy = true; controls(); showError("");
		try {
			current = await request("/api/signup-verification");
			if (!current || typeof current.email !== "string" || typeof current.verified !== "boolean" ||
				typeof current.expired !== "boolean" || typeof current.replaced !== "boolean" ||
				typeof current.restricted !== "boolean" ||
				!Object.hasOwn(messages, current.delivery) || typeof current.csrfCookieName !== "string" ||
				typeof current.loginUrl !== "string" || new URL(current.loginUrl, location.origin).origin !== location.origin ||
				new URL(current.loginUrl, location.origin).pathname !== "/auth/google/login") {
				throw new Error("The signup status was incomplete. Refresh before trying again.");
			}
			byId("recipient").textContent = `Google-verified signup address: ${current.email}`; byId("recipient").hidden = false;
			byId("intro").textContent = current.restricted ? "Your Google identity and email proof cannot remove an account restriction."
				: current.verified ? "Your confirmation is saved. Continue with Google to enter your own workspace."
				: "Your Google signup and this email link verify it’s you. Confirm in the original signup browser to finish signup and open your workspace.";
			byId("title").textContent = current.restricted ? "Account access is restricted."
				: current.verified ? "Your email is verified."
				: current.expired || current.replaced ? "Restart with Google."
				: current.linkExpired ? "Request a fresh link."
				: document.body.dataset.signupView === "verify" ? "Confirm it’s your email." : "One more step: your email.";
			byId("state").textContent = current.restricted ? "This account cannot enter the workspace. Contact the site owner to review the restriction."
				: current.verified ? "Your email is verified. Sign in with Google to open your workspace; no owner approval is needed."
				: current.expired ? "The signup session expired. Use Google sign-in again to restart."
				: current.replaced ? "This signup was replaced by a later Google sign-in. Use the newest signup browser."
				: current.linkExpired ? "This email link expired. Request a fresh link in this signup browser."
				: current.failureCode === "THROTTLED" ? "Verification messages are temporarily limited. At most three attempts per hour are allowed."
				: messages[current.delivery] || "Verification is incomplete. Refresh status to retry.";
			byId("expiry").textContent = current.restricted ? "Email verification cannot remove an account restriction."
				: current.verified ? "This status check has not signed you in. Continue with Google to use your verified account."
				: "Email links last up to 30 minutes within the signup session. Fresh links replace earlier ones: at most three attempts per hour, at least a minute apart.";
			if (document.body.dataset.signupView === "verify" && !token && !current.verified) {
				showError("This page has no current email-link proof. Reopen the newest email link; refreshing a link page removes its proof from browser history.");
			}
		} catch (error) {
			current = null; byId("recipient").hidden = true;
			byId("title").textContent = "Restart with Google.";
			byId("state").textContent = "This browser has no valid pending Google signup.";
			showError(`${error.message} Open the newest email in the original signup browser, or sign in with Google to establish a fresh signup.`);
		} finally { busy = false; controls(); }
	}
	async function action(kind) {
		if (busy || !current) return;
		busy = true; controls(); showError("");
		let confirmed = false;
		try {
			const result = await request(`/api/signup-verification/${kind}`, kind === "confirm" ? { token } : {});
			if (kind === "confirm") {
				const destination = typeof result.redirectTo === "string" ? new URL(result.redirectTo, location.origin) : null;
				if (result.emailVerified !== true || result.fullSessionCreated !== true || !destination ||
					destination.origin !== location.origin || destination.pathname !== "/" || !result.redirectTo.startsWith("/") || result.redirectTo.startsWith("//")) {
					throw new Error("Workspace entry could not be confirmed. Refresh status, then sign in with Google.");
				}
				confirmed = true;
				token = null;
				current.verified = true; 				byId("state").textContent = "Your email is confirmed. Opening your workspace…";
				byId("title").textContent = "Your email is verified.";
				byId("expiry").textContent = "You are signed in. Google service connections and outreach permissions stay separate.";
				location.assign(`${destination.pathname}${destination.search}${destination.hash}`);
			} else {
				token = null;
				byId("state").textContent = "The email service accepted a fresh verification message. Open that newest link in this browser; previous links are replaced.";
			}
		} catch (error) { showError(`${error.message} Refresh status before retrying.`); }
		finally { busy = false; controls(); if (confirmed) byId("login").focus(); }
	}
	byId("confirm").addEventListener("click", () => action("confirm"));
	byId("resend").addEventListener("click", () => action("resend"));
	byId("refresh").addEventListener("click", refresh);
	refresh();
})();
