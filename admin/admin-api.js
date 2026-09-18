// Client-safe Supabase Auth + dedicated admin RPCs. No service-role key,
// persistent session, cookies, content telemetry, or report cache is used here.
export class AdminAPIError extends Error {
  constructor(code, message, status = null) { super(message); this.name = "AdminAPIError"; this.code = code; this.status = status; }
}

const messages = {
  invalid_credentials: "We couldn’t sign in with that email and password.",
  session_expired: "Your admin session has expired. Sign in again to continue.",
  forbidden: "This account does not have access to Mystoria Admin.",
  rate_limited: "Too many requests. Wait a moment, then try again.",
  unavailable: "The admin service is unavailable. Try again shortly.",
  network: "The request could not reach the admin service. Check your connection and retry.",
  invalid_response: "The admin service returned data this dashboard could not verify.",
  aborted: "The request was cancelled.",
  invalid_request: "Choose a valid report date range and environment.",
};
const fail = (code, status = null) => new AdminAPIError(code, messages[code], status);
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function rangeInput({ from, to, environment }, accountScope = false) {
  const start = Date.parse(from), end = Date.parse(to);
  const environments = accountScope ? ["production", "development", "unknown", "all"] : ["production", "development"];
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start > 366 * 86400000 || !environments.includes(environment)) {
    throw fail("invalid_request");
  }
  return { p_from: new Date(start).toISOString(), p_to: new Date(end).toISOString(), p_environment: environment };
}

export function createAdminClient({ url, anonKey, fetchImpl = globalThis.fetch }) {
  let origin;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) throw new Error();
    origin = parsed.origin;
  } catch { throw new AdminAPIError("invalid_config", "Mystoria Admin is missing a valid Supabase project URL."); }
  if (typeof anonKey !== "string" || !anonKey || /\s/.test(anonKey) || typeof fetchImpl !== "function") {
    throw new AdminAPIError("invalid_config", "Mystoria Admin is missing its public authentication configuration.");
  }
  // Reject accidental legacy service-role configuration before a request. This
  // decode is a configuration safeguard, never an authorization decision.
  try {
    if (anonKey.startsWith("sb_secret_")) throw fail("forbidden");
    const part = anonKey.split(".")[1];
    if (part) {
      const payload = JSON.parse(globalThis.atob(part.replace(/-/g, "+").replace(/_/g, "/")));
      if (payload.role === "service_role") throw fail("forbidden");
    }
  } catch (error) {
    if (error instanceof AdminAPIError) throw new AdminAPIError("invalid_config", "Use the public anon key for the admin website, never a privileged key.");
  }

  async function post(path, body, { token, signal, auth = false, empty = false } = {}) {
    if (signal?.aborted) throw fail("aborted");
    if (!auth && (typeof token !== "string" || !token)) throw fail("session_expired");
    let response;
    try {
      response = await fetchImpl(origin + path, {
        method: "POST", headers: { apikey: anonKey, Authorization: "Bearer " + (token || anonKey), "Content-Type": "application/json" },
        body: JSON.stringify(body), signal, cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
      });
    } catch (error) {
      throw fail(signal?.aborted || error?.name === "AbortError" ? "aborted" : "network");
    }
    if (signal?.aborted) throw fail("aborted");
    if (!response.ok) {
      // Never reflect Supabase response bodies: they may contain identifiers,
      // auth-provider detail, or untrusted database exception text.
      const code = response.status === 429 ? "rate_limited" : response.status === 401 ? (auth ? "invalid_credentials" : "session_expired")
        : response.status === 403 ? "forbidden" : auth && [400, 422].includes(response.status) ? "invalid_credentials" : "unavailable";
      throw fail(code, response.status);
    }
    if (empty || response.status === 204) return null;
    try {
      const text = await response.text();
      if (signal?.aborted) throw fail("aborted");
      if (text.length > 12 * 1024 * 1024) throw fail("invalid_response");
      return JSON.parse(text);
    } catch (error) {
      if (error instanceof AdminAPIError) throw error;
      throw fail("invalid_response");
    }
  }
  return {
    async signIn(email, password, { signal } = {}) {
      if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) throw fail("invalid_credentials");
      const value = await post("/auth/v1/token?grant_type=password", { email: email.trim(), password }, { signal, auth: true });
      const seconds = value?.expires_in;
      if (typeof value?.access_token !== "string" || !value.access_token || !uuid(value?.user?.id) || !Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 604800) throw fail("invalid_response");
      // Deliberately discard refresh_token and all email/profile metadata.
      return { accessToken: value.access_token, userId: value.user.id, expiresAt: Date.now() + seconds * 1000 };
    },
    async signOut(token, { signal } = {}) { await post("/auth/v1/logout?scope=local", {}, { token, signal, empty: true }); },
    async isAdmin(token, { signal } = {}) {
      const value = await post("/rest/v1/rpc/product_analytics_is_admin", {}, { token, signal });
      if (typeof value !== "boolean") throw fail("invalid_response");
      return value;
    },
    async report(token, { from, to, environment, signal }) {
      return post("/rest/v1/rpc/product_analytics_admin_report", rangeInput({ from, to, environment }), { token, signal });
    },
    async accountReport(token, { accountId, from, to, environment, signal }) {
      if (!uuid(accountId)) throw fail("invalid_request");
      return post("/rest/v1/rpc/product_analytics_admin_account_report", { p_account: accountId, ...rangeInput({ from, to, environment }, true) }, { token, signal });
    },
  };
}
