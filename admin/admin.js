import { createAdminClient } from './admin-api.js';
import { normalizeReport, normalizeAccountReport, formatUSD, formatDate } from './report-model.js';
import { publicConfig } from './config.js';

const $ = id => document.getElementById(id);
const api = createAdminClient(publicConfig);
let session = null;
let report = null;
let range = null;
let generation = 0;
let reportGeneration = 0;
let detailGeneration = 0;
let sessionTimer;
let pending;
let detailPending;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}
function count(value) { return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US') : '—'; }
function percent(value) { return typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'; }
function clearPrivate() {
  report = null; range = null;
  for (const id of ['metrics','funnel','retention','community','cost-summary','cost-rows','coverage','account-rows','detail-summary','request-rows','definitions']) $(id).replaceChildren();
  $('report-content').hidden = true; $('detail-body').hidden = true;
  $('account-dialog').close(); $('account-title').textContent = 'Account';
  $('account-search').value = ''; $('detail-status').textContent = '';
  for (const id of ['account-count','account-limit','request-limit','updated']) $(id).textContent = ''; 
}
function leaveSession(message = '') {
  generation++; reportGeneration++; detailGeneration++;
  pending?.abort(); detailPending?.abort(); clearTimeout(sessionTimer);
  session = null; clearPrivate();
  $('workspace').hidden = true; $('navigation').hidden = true;
  $('sign-out').hidden = true; $('login').hidden = false;
  $('password').value = ''; $('login-status').textContent = message;
  $('sign-in-form').querySelector('button').disabled = false; $('refresh').disabled = false;
}
function handleError(error, target) {
  if (error?.code === 'aborted') return;
  if (error?.code === 'session_expired') { leaveSession('Your session ended. Sign in again to continue.'); return; }
  if (error?.code === 'forbidden') { leaveSession('This account does not have access to Mystoria Operations. An administrator needs to grant access first.'); return; }
  $(target).textContent = error?.message || 'Could not load this report. Please try again.';
}
function metric(label, value, note) {
  const el = node('article', undefined, 'metric');
  el.append(node('div', label, 'metric-label'), node('div', value, 'metric-value'), node('p', note, 'metric-note'));
  return el;
}
function summary(parent, value, label) {
  const el = node('div'); el.append(node('strong', value), node('span', label)); parent.append(el);
}
function segmentLabel(segment) {
  return `${segment.environment || 'Unknown environment'} · ${segment.sandbox === true ? 'Sandbox' : segment.sandbox === false ? 'Non-Sandbox' : 'Unknown purchase type'}`;
}
function costValue(segment) { return formatUSD(segment.known_estimated_cost_usd ?? segment.knownEstimatedCostUSD); }
function costUnknown(segment) { return segment.unknown_cost_requests ?? segment.unknownCostRequests; }
function costRequests(segment) { return segment.requests ?? segment.generationRequests; }
function renderCosts(segments) {
  $('cost-summary').replaceChildren(); $('cost-rows').replaceChildren();
  if (!segments.length) {
    const row = node('tr'); const cell = node('td', 'No generation costs recorded for this environment and window.', 'empty'); cell.colSpan = 5; row.append(cell); $('cost-rows').append(row); return;
  }
  for (const s of segments) {
    summary($('cost-summary'), costValue(s), `Known estimate · ${segmentLabel(s)}`);
    const row = node('tr');
    row.append(node('td', s.environment), node('td', s.sandbox === true ? 'Sandbox' : s.sandbox === false ? 'Non-Sandbox' : 'Unknown'), node('td', count(costRequests(s))), node('td', costValue(s)), node('td', count(costUnknown(s))));
    $('cost-rows').append(row);
  }
}
function renderCoverage(model) {
  const t = model.tracking, p = model.plus;
  const items = [
    ['Optional usage sharing', 'The usage report includes participating accounts only. No events are sent while Share app usage is off.'],
    ['Instrumentation started', formatDate(t.instrumentationStartedAt) + '. Older activity cannot be reconstructed.'],
    ['Accounts observed in this window', `${count(t.observedAccounts)} with an app event; ${count(t.firstObservedAccounts)} first observed in this window.`],
    ['Registered accounts', `${count(t.registeredAccounts)} registered in this window. This count is context, not the usage funnel denominator.`],
    ['Current Plus · Non-Sandbox', `${count(p.activeProduction)} active in the latest billing snapshot.`],
    ['Current Plus · Sandbox', `${count(p.activeSandbox)} active test subscriptions in the latest billing snapshot.`],
    ['Billing freshness', `${count(p.staleObservations)} stale observations. Snapshot as of ${formatDate(p.asOf)}; this is not historical revenue.`],
    ['Reporting environments', 'The filter selects app-usage events only. Cost tables include all provider environments in the selected date window, with Sandbox, Non-Sandbox and unclassified records kept separate.']
  ];
  $('coverage').replaceChildren(...items.map(([title, text]) => { const e = node('div', undefined, 'coverage-item'); e.append(node('strong', title), node('p', text)); return e; }));
}
function renderReport(model) {
  const t = model.tracking;
  const first = model.funnel.find(x => x.key === 'participating_accounts');
  const saved = model.funnel.find(x => x.key === 'story_savers');
  const read = model.funnel.find(x => x.key === 'reading_completers');
  $('metrics').replaceChildren(
    metric('Participating accounts', count(first?.count ?? t.firstObservedAccounts), 'First observed in this window'),
    metric('Saved a story', count(saved?.count), 'Accounts saving a ready story'),
    metric('Finished reading', count(read?.count), 'Accounts with a completed reading'),
    metric('Community templates saved', count(model.community.templateSaves), `${count(model.community.accounts)} ${model.community.accounts === 1 ? 'account' : 'accounts'} in this window`)
  );
  $('funnel').replaceChildren(...model.funnel.map(item => {
    const el = node('div', undefined, 'funnel-item'); const line = node('div', undefined, 'funnel-label');
    const number = node('strong', count(item.count), 'funnel-number'); number.append(node('span', percent(item.rate)));
    line.append(node('span', item.label), number); const track = node('div', undefined, 'bar-track'); const fill = node('div', undefined, 'bar-fill');
    fill.style.width = `${Math.max(0, Math.min(100, Number(item.width) || 0))}%`; track.append(fill); el.append(line, track); return el;
  }));
  $('retention').replaceChildren(...model.retention.map(item => {
    const el = node('div', undefined, 'retention-item'); el.append(node('h3', item.label), node('div', percent(item.rate), 'retention-value'), node('p', `${count(item.returned)} of ${count(item.eligible)} eligible accounts`), node('p', item.window)); return el;
  }));
  $('community').replaceChildren(node('p', 'Read again on another day'), node('strong', count(model.funnel.find(x => x.key === 'return_readers')?.count)), node('p', 'Accounts completing another reading at least 24 hours after the first observed completion.'));
  renderCosts(model.costs.segments); renderCoverage(model); renderAccounts();
  $('updated').textContent = `Updated ${formatDate(model.generatedAt)} · ${model.range.environment === 'production' ? 'Production' : 'Development'} usage`;
  $('report-status').textContent = model.warnings.filter(text => /^(No participating|Some provider|The account list)/.test(text)).join(' ');
  $('definitions').replaceChildren(...model.warnings.map(text => node('p', text)));
}
function renderAccounts() {
  if (!report) return;
  const query = $('account-search').value.trim().toLowerCase();
  const accounts = report.accounts.filter(a => `${a.accountId} ${a.alias}`.toLowerCase().includes(query));
  $('account-count').textContent = `${count(accounts.length)} accounts shown`;
  $('account-limit').textContent = report.accountsTruncated ? 'This list is limited to the most recent participating accounts. Narrow the reporting window to inspect another group.' : 'Activity reflects the selected window. Cost details also show lifetime totals from the generation ledger.';
  $('account-rows').replaceChildren(...accounts.map(a => {
    const row = node('tr'); const id = node('td', a.alias);
    const activity = node('td', a.firstStorySavedAt ? 'Saved a story' : 'No observed save'); activity.append(node('small', a.firstReadingCompletedAt ? 'Completed a reading' : 'No observed completion'));
    const requests = node('td'); const cost = node('td');
    for (const s of (a.costs || [])) { requests.append(node('div', count(costRequests(s))), node('small', segmentLabel(s))); cost.append(node('div', costValue(s)), node('small', `${segmentLabel(s)} · ${count(costUnknown(s))} unknown`)); }
    if (!a.costs?.length) { requests.textContent = '0'; cost.textContent = 'No requests'; }
    const action = node('td'); const button = node('button', 'View costs', 'secondary'); button.type = 'button'; button.addEventListener('click', () => openAccount(a)); action.append(button);
    row.append(id, node('td', formatDate(a.firstObservedAt)), activity, node('td', count(a.communityTemplateSaves)), requests, cost, action); return row;
  }));
  if (!accounts.length) { const row = node('tr'); const cell = node('td', query ? 'No matching account in this report.' : 'No participating accounts observed yet. Usage measurements begin when someone chooses to share app usage.', 'empty'); cell.colSpan = 7; row.append(cell); $('account-rows').append(row); }
}
async function loadReport() {
  if (!session) return;
  const owner = generation, request = ++reportGeneration;
  pending?.abort(); pending = new AbortController();
  detailGeneration++; detailPending?.abort(); clearPrivate();
  const now = new Date(); range = {from:new Date(now.getTime() - Number($('period').value) * 86400000).toISOString(),to:now.toISOString(),environment:$('environment').value};
  $('report-status').textContent = 'Loading your report…'; $('refresh').disabled = true;
  try {
    const capturedRange = {...range};
    const raw = await api.report(session.accessToken, {...capturedRange,signal:pending.signal});
    if (generation !== owner || reportGeneration !== request || !session) return;
    const result = await normalizeReport(raw, {expectedEnvironment:capturedRange.environment});
    if (generation !== owner || reportGeneration !== request || !session) return;
    report = result; renderReport(result); $('report-content').hidden = false;
  } catch (error) { if (generation === owner && reportGeneration === request) handleError(error, 'report-status'); }
  finally { if (generation === owner && reportGeneration === request) $('refresh').disabled = false; }
}
async function openAccount(account) {
  if (!session || !range) return;
  const owner = generation, request = ++detailGeneration;
  detailPending?.abort(); detailPending = new AbortController();
  $('detail-body').hidden = true; $('detail-summary').replaceChildren(); $('request-rows').replaceChildren();
  $('account-title').textContent = account.alias; $('detail-status').textContent = 'Loading generation history…'; $('account-dialog').showModal();
  try {
    const capturedRange = {...range,environment:'all'};
    const raw = await api.accountReport(session.accessToken, {...capturedRange,accountId:account.accountId,signal:detailPending.signal});
    if (generation !== owner || detailGeneration !== request || !session) return;
    const detail = await normalizeAccountReport(raw, {expectedAccountId:account.accountId,expectedEnvironment:capturedRange.environment});
    if (generation !== owner || detailGeneration !== request || !session) return;
    for (const s of detail.lifetime) summary($('detail-summary'), costValue(s), `Lifetime known estimate · ${segmentLabel(s)} · ${count(costRequests(s))} requests · ${count(costUnknown(s))} unknown`);
    if (!detail.lifetime.length) summary($('detail-summary'), 'No requests', 'No lifetime generation records');
    $('request-rows').replaceChildren(...detail.requests.map(r => {
      const tr = node('tr'); const date = node('td', formatDate(r.created_at ?? r.createdAt)); date.append(node('small', r.request_id ?? r.requestId));
      const cost = node('td', (r.cost_status ?? r.costStatus) === 'estimated' ? formatUSD(r.estimated_cost_usd ?? r.estimatedCostUSD) : 'Unknown');
      cost.append(node('small', `${segmentLabel(r)}${(r.cost_reason ?? r.costReason) ? ' · ' + (r.cost_reason ?? r.costReason) : ''}`));
      const elapsed = r.elapsed_ms ?? r.elapsedMs;
      tr.append(date,node('td',r.operation),node('td',r.providerModel && r.providerModel !== 'Not recorded' ? r.providerModel : r.requestedModel ?? 'Not recorded'),node('td',r.state),node('td',typeof elapsed === 'number' ? `${(elapsed/1000).toFixed(1)} s` : '—'),cost); return tr;
    }));
    if (!detail.requests.length) { const row = node('tr'); const cell = node('td', 'No generation requests in this window.', 'empty'); cell.colSpan = 6; row.append(cell); $('request-rows').append(row); }
    $('request-limit').textContent = `${detail.requestsTruncated ? 'Showing the latest 50 requests. Narrow the window to see another period. ' : ''}Failed generation costs are retained even when allowance was refunded. Amounts are API estimates, not invoices.`;
    $('detail-status').textContent = ''; $('detail-body').hidden = false;
  } catch (error) { if (generation === owner && detailGeneration === request) handleError(error, 'detail-status'); }
}
$('sign-in-form').addEventListener('submit', async event => {
  event.preventDefault(); const owner = ++generation;
  pending?.abort(); pending = new AbortController(); const button = event.currentTarget.querySelector('button');
  button.disabled = true; $('login-status').textContent = 'Signing in…';
  const password = $('password').value; $('password').value = '';
  try {
    const next = await api.signIn($('email').value.trim(), password, {signal:pending.signal});
    if (generation !== owner) return;
    if (!await api.isAdmin(next.accessToken, {signal:pending.signal})) {
      if (generation === owner) leaveSession('This account does not have access to Mystoria Operations. Admin access has not been granted.');
      api.signOut(next.accessToken).catch(() => {}); return;
    }
    if (generation !== owner) return;
    session = next; $('login-status').textContent = '';
    $('login').hidden = true; $('workspace').hidden = false; $('navigation').hidden = false; $('sign-out').hidden = false;
    sessionTimer = setTimeout(() => leaveSession('Your session ended. Sign in again to continue.'), Math.max(0, next.expiresAt - Date.now()));
    await loadReport();
  } catch (error) { if (generation === owner) handleError(error,'login-status'); }
  finally { if (generation === owner) button.disabled = false; }
});
$('sign-out').addEventListener('click', () => { const token = session?.accessToken; leaveSession('Signed out.'); if (token) api.signOut(token).catch(() => {}); });
$('refresh').addEventListener('click', loadReport);
$('filters').addEventListener('submit', e => e.preventDefault());
$('environment').addEventListener('change', loadReport);
$('period').addEventListener('change', loadReport);
$('account-search').addEventListener('input', renderAccounts);
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  const accounts = button.dataset.view === 'accounts';
  $('overview-view').hidden = accounts; $('accounts-view').hidden = !accounts;
  $('page-title').textContent = accounts ? 'Accounts & costs' : 'Overview';
  document.querySelectorAll('[data-view]').forEach(b => { if (b === button) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); });
}));
function closeDetail() { detailGeneration++; detailPending?.abort(); $('detail-body').hidden = true; $('detail-summary').replaceChildren(); $('request-rows').replaceChildren(); $('detail-status').textContent = ''; }
$('close-detail').addEventListener('click', () => $('account-dialog').close());
$('account-dialog').addEventListener('close', closeDetail);
window.addEventListener('pagehide', () => leaveSession());
document.addEventListener('visibilitychange', () => { if (!document.hidden && session && session.expiresAt <= Date.now()) leaveSession('Your session ended. Sign in again to continue.'); });
