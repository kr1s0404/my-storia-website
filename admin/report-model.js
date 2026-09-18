// Convert the strict, content-free SQL report to display values. These helpers
// never store a report or contact a service. Raw UUIDs are retained only as
// authorized drilldown arguments; the table displays stable hashed aliases.
export class ReportDataError extends Error {
  constructor(message = "This report contains data the dashboard could not verify.") { super(message); this.name = "ReportDataError"; this.code = "invalid_response"; }
}
const invalid = () => { throw new ReportDataError(); };
const record = value => value && typeof value === "object" && !Array.isArray(value) ? value : invalid();
const array = value => Array.isArray(value) ? value : invalid();
const number = (value, nullable = false) => {
  if (value === null && nullable) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e12) return invalid();
  return value;
};
const count = value => Number.isSafeInteger(number(value)) ? value : invalid();
const boolean = value => typeof value === "boolean" ? value : invalid();
const string = (value, max = 400) => typeof value === "string" && value.length <= max ? value : invalid();
const date = (value, nullable = true) => {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || !/(Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) return invalid();
  return new Date(value).toISOString();
};
const day = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? date(value + "T00:00:00Z", false) : invalid();
const identifier = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : invalid();

export function escapeHTML(value) { return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
export function formatUSD(value) {
  if (value === null) return "Unknown";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(number(value));
}
export function formatDate(value) {
  if (value === null) return "Not observed";
  return date(value, false).slice(0, 16).replace("T", " ") + " UTC";
}
export function percentage(numerator, denominator) {
  const n = count(numerator), d = count(denominator);
  if (n > d) return invalid();
  return d === 0 ? "—" : (n / d * 100).toFixed(1) + "%";
}
export async function accountAlias(value) {
  const account = identifier(value);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("mystoria-admin:" + account));
  return "Account " + [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

function reportRange(raw, expectedEnvironment) {
  record(raw);
  if (!["production", "development", "unknown", "all"].includes(raw.environment)) return invalid();
  if (expectedEnvironment && raw.environment !== expectedEnvironment) throw new ReportDataError("This response belongs to a different environment. Refresh the report.");
  const from = date(raw.from, false), to = date(raw.to, false);
  if (Date.parse(from) >= Date.parse(to)) return invalid();
  return { from, to, environment: raw.environment };
}

function costSegment(raw) {
  record(raw);
  if (!["production", "staging", "unknown"].includes(raw.environment)) return invalid();
  if (raw.sandbox !== null && typeof raw.sandbox !== "boolean") return invalid();
  const result = {
    environment: raw.environment, sandbox: raw.sandbox,
    label: raw.environment + " · " + (raw.sandbox === true ? "Sandbox" : raw.sandbox === false ? "Non-Sandbox" : "Sandbox status unknown"),
    requests: count(raw.requests), providerAttemptsPossible: count(raw.provider_attempts_possible),
    estimatedRequests: count(raw.estimated_requests), unknownCostRequests: count(raw.unknown_cost_requests),
    knownEstimatedCostUSD: number(raw.known_estimated_cost_usd, true), completeEstimatedCostUSD: number(raw.complete_estimated_cost_usd, true),
    successfulGenerations: count(raw.successful_generations), refundedGenerations: count(raw.refunded_generations),
  };
  if (result.successfulGenerations + result.refundedGenerations > result.requests || result.providerAttemptsPossible > result.requests || result.estimatedRequests + result.unknownCostRequests > result.requests
      || result.unknownCostRequests > 0 && result.completeEstimatedCostUSD !== null || result.estimatedRequests > 0 && result.knownEstimatedCostUSD === null) return invalid();
  result.knownSumLabel = formatUSD(result.knownEstimatedCostUSD);
  result.completeLabel = formatUSD(result.completeEstimatedCostUSD);
  result.coverage = percentage(result.estimatedRequests, result.estimatedRequests + result.unknownCostRequests);
  result.averageKnownCostUSD = result.estimatedRequests > 0 ? result.knownEstimatedCostUSD / result.estimatedRequests : null;
  return result;
}
function costSegments(raw) {
  const values = array(raw).map(costSegment), keys = values.map(value => `${value.environment}/${value.sandbox}`);
  if (new Set(keys).size !== keys.length) return invalid();
  return values;
}
function checkCostScope(rows, environment) {
  const expected = environment === "development" ? "staging" : environment;
  if (expected !== "all" && rows.some(row => row.environment !== expected)) return invalid();
  return rows;
}
function retention(raw, label, window) {
  record(raw);
  const eligible = count(raw.eligible), returned = count(raw.returned);
  return { label, window, eligible, returned, rate: percentage(returned, eligible) };
}

export async function normalizeReport(raw, { expectedEnvironment } = {}) {
  record(raw);
  if (raw.version !== 1) throw new ReportDataError("This dashboard needs an update for the report version returned by the service.");
  const range = reportRange(raw.range, expectedEnvironment), tracking = record(raw.tracking), funnel = record(raw.funnel);
  if (funnel.basis !== "first_observed_app_opened_in_range" || raw.retention?.basis !== "first_observed_app_opened" || raw.plus?.basis !== "latest_billing_snapshot") return invalid();
  const participants = count(funnel.participating_accounts);
  const normalized = {
    version: 1, generatedAt: date(raw.generated_at, false), range,
    tracking: {
      instrumentationStartedAt: date(tracking.instrumentation_started_at), firstEventAt: date(tracking.first_event_at),
      registeredAccounts: count(tracking.registered_accounts_in_range), observedAccounts: count(tracking.observed_accounts_in_range),
      participatingAccounts: count(tracking.participating_accounts_in_range), firstObservedAccounts: count(tracking.first_observed_accounts_in_range),
      preInstrumentationParticipants: count(tracking.pre_instrumentation_participants),
    },
    funnel: [
      ["participating_accounts", "First observed app open"], ["story_savers", "Saved a new ready story"],
      ["reading_completers", "Completed a reading"], ["saved_then_read", "Saved, then completed a reading"],
      ["return_readers", "Returned for another reading"], ["plus_signal", "Observed Plus activation"],
    ].map(([key, label]) => {
      const value = count(funnel[key]);
      return { key, label, count: value, denominator: participants, rate: percentage(value, participants), width: participants ? value / participants * 100 : 0 };
    }),
    retention: [retention(raw.retention.d1, "D1 app return", "An app open 24–48 hours after first observed app open"), retention(raw.retention.d7, "D7 app return", "An app open on days 7–8 after first observed app open")],
    community: { templateSaves: count(raw.community?.template_saves), accounts: count(raw.community?.accounts) },
    plus: { asOf: date(raw.plus.as_of, false), activeProduction: count(raw.plus.active_production), activeSandbox: count(raw.plus.active_sandbox), staleObservations: count(raw.plus.stale_observations) },
    costs: { scope: "all_provider_environments", segments: costSegments(raw.costs?.segments) },
    accountsTruncated: boolean(raw.accounts_truncated),
    cohorts: array(raw.cohorts).map(row => {
      const participants = count(row.participating_accounts);
      return { signupWeek: day(row.signup_week), participatingAccounts: participants,
        storySavers: count(row.story_savers), readingCompleters: count(row.reading_completers), plusSignal: count(row.plus_signal),
        saveRate: percentage(row.story_savers, participants), readingRate: percentage(row.reading_completers, participants),
        d1: retention({ eligible: row.d1_eligible, returned: row.d1_returned }, "D1", "24–48 hours"),
        d7: retention({ eligible: row.d7_eligible, returned: row.d7_returned }, "D7", "Days 7–8") };
    }),
    accounts: [], warnings: [],
  };
  normalized.accounts = await Promise.all(array(raw.accounts).map(async row => {
    const accountId = identifier(row.account_id);
    return { accountId, alias: await accountAlias(accountId), signedUpAt: date(row.signed_up_at, false),
      firstObservedAt: date(row.first_observed_at), firstStorySavedAt: date(row.first_story_saved_at),
      firstReadingCompletedAt: date(row.first_reading_completed_at), firstSavedThenReadAt: date(row.first_saved_then_read_at),
      returnedReading: boolean(row.returned_reading), plusSignal: boolean(row.plus_signal),
      d1Eligible: boolean(row.d1_eligible), d1Returned: boolean(row.d1_returned), d7Eligible: boolean(row.d7_eligible), d7Returned: boolean(row.d7_returned),
      eventCount: count(row.event_count), communityTemplateSaves: count(row.community_template_saves), costs: costSegments(row.ai_costs) };
  }));
  if (new Set(normalized.accounts.map(row => row.accountId)).size !== normalized.accounts.length) return invalid();
  normalized.warnings = [
    "Usage metrics cover accounts that opted in and sent events. They are not retention or conversion rates for every Mystoria account.",
    "A first observed event is not necessarily the account’s first-ever action. Historical and non-participating activity is unknown.",
    "Funnel rows share the participating cohort; they are not all sequential steps. Only ‘Saved, then completed a reading’ explicitly requires that order.",
    "A new ready-story save includes directly saved starter, community and import copies. Revisions and copies still in editing do not establish that milestone.",
    "D1/D7 app-return denominators include only accounts whose full follow-up window ended by the report end. Return readers separately counts a completed reading at least 24 hours after the first. Late events can revise these results.",
    "Plus activation is a client-observed signal, not a new purchase or revenue. Active Plus counts come from the latest billing snapshot and are separate from the funnel.",
    "USD amounts are provider-cost estimates, not invoices, subscription revenue, or profit. Unknown costs are never treated as zero; refunded allowance can still have provider cost.",
    "The usage filter applies only to app activity. Costs cover every provider environment in the selected date range, with production, staging, unknown, Sandbox and Non-Sandbox kept separate.",
  ];
  if (participants === 0) normalized.warnings.unshift("No participating accounts were first observed in this range. This does not mean nobody used Mystoria.");
  if (normalized.accountsTruncated) normalized.warnings.push("The account list is limited to 5,000 rows. Aggregate metrics include the full eligible cohort.");
  if (normalized.costs.segments.some(row => row.unknownCostRequests > 0)) normalized.warnings.push("Some provider attempts have no reliable cost estimate. Known USD sums are partial, and complete totals are unavailable for those segments.");
  return normalized;
}

export async function normalizeAccountReport(raw, { expectedAccountId, expectedEnvironment } = {}) {
  record(raw);
  if (raw.version !== 1) return invalid();
  const accountId = identifier(raw.account_id);
  if (expectedAccountId && accountId !== identifier(expectedAccountId)) throw new ReportDataError("This response belongs to a different account. Open the account again.");
  const result = { accountId, alias: await accountAlias(accountId), generatedAt: date(raw.generated_at, false), range: reportRange(raw.range, expectedEnvironment),
    lifetime: costSegments(raw.lifetime), rangeCosts: checkCostScope(costSegments(raw.range_costs), raw.range.environment), requestsTruncated: boolean(raw.requests_truncated),
    requests: array(raw.requests).map(row => {
      if (!["production", "staging", "unknown"].includes(row.environment) || row.sandbox !== null && typeof row.sandbox !== "boolean" || !["estimated", "unknown"].includes(row.cost_status)) return invalid();
      const estimate = number(row.estimated_cost_usd, true);
      if (row.cost_status === "unknown" && estimate !== null || row.cost_status === "estimated" && estimate === null) return invalid();
      return { requestId: identifier(row.request_id), createdAt: date(row.created_at, false), operation: string(row.operation, 80), unit: string(row.unit, 30),
        state: string(row.state, 40), environment: row.environment, sandbox: row.sandbox,
        requestedModel: row.requested_model === null ? "Not recorded" : string(row.requested_model, 180),
        providerModel: row.provider_model === null ? "Not recorded" : string(row.provider_model, 180),
        costStatus: row.cost_status, costReason: string(row.cost_reason, 180), estimatedCostUSD: estimate,
        costLabel: formatUSD(estimate), httpStatus: row.http_status === null ? null : count(row.http_status), elapsedMs: row.elapsed_ms === null ? null : count(row.elapsed_ms) };
    }) };
  if (result.requests.length > 50 || new Set(result.requests.map(row => row.requestId)).size !== result.requests.length) return invalid();
  checkCostScope(result.requests, result.range.environment);
  return result;
}
