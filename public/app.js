import { evidenceMarkup, evidenceSummary } from './evidence.js';
const $ = (selector, root = document) => root.querySelector(selector);
const h = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const stamp = value => value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value)) + ' UTC' : '—';
const utcField = value => (value || new Date().toISOString()).slice(0, 19);
const utcISO = value => value ? new Date(value + 'Z').toISOString() : '';
const selected = (actual, expected) => String(actual) === String(expected) ? 'selected' : '';
const sources = { synthetic: 'Synthetic', manual: 'User-entered' };
const routes = [
  ['overview', 'Overview', 'grid'], ['observations', 'Observations', 'pulse'],
  ['alerts', 'Alerts', 'bell'], ['radiation', 'NASA RadLab', 'orbit'],
  ['crew', 'Crew & missions', 'crew'], ['reports', 'Reports', 'file'],
  ['access', 'Access & audit', 'lock']
];
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  pulse: '<path d="M2 12h5l3-7 4 14 3-7h5"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0"/>',
  orbit: '<circle cx="12" cy="12" r="5"/><ellipse cx="12" cy="12" rx="11" ry="5" transform="rotate(-35 12 12)"/>',
  crew: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2m2-14a3 3 0 0 1 0 6m2 2a5 5 0 0 1 2 4v2"/>',
  file: '<path d="M5 3h9l5 5v13H5zm9 0v5h5M8 12h8m-8 4h8"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
const state = { user: null, crewId: null, catalog: null, page: '', generation: 0, observationFilter: {}, reportFilter: {}, radiation: null, alertState: '', metric: 'heart_rate', result: null };
const view = $('#view');
const dialog = $('#dialog');
let toastTimer;

async function api(url, options = {}, raw = false) {
  const response = await fetch(url, {
    ...options, headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  if (!response.ok) {
    if (response.status === 401 && state.user) showAuth(state.catalog?.demo);
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'The service could not complete this request.');
  }
  return raw ? response : response.json();
}

function notify(message) {
  const notice = $('#notice');
  notice.textContent = message;
  notice.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { notice.hidden = true; }, 4800);
}

function showAuth(demo) {
  state.user = null;
  state.crewId = null;
  state.generation++;
  state.observationFilter = {};
  state.reportFilter = {};
  state.result = null;
  state.page = '';
  $('#navigation').replaceChildren();
  if (dialog.open) dialog.close();
  view.replaceChildren();
  $('#auth').hidden = false;
  $('#boot').hidden = true;
  $('#app').hidden = true;
  $('#demo-button').hidden = !demo;
}

async function loadCatalog() {
  state.catalog = await api('/api/catalog');
  if (!state.catalog.crew.some(person => person.id === state.crewId)) state.crewId = state.catalog.crew[0]?.id ?? null;
  $('#crew-selector').innerHTML = state.catalog.crew.length ? state.catalog.crew.map(person =>
    `<option value="${person.id}" ${selected(person.id, state.crewId)}>${h(person.name)}</option>`).join('') : '<option>No crew assigned</option>';
  $('#crew-selector').disabled = !state.crewId;
  $('#top-add').disabled = !state.crewId;
  $('#training').hidden = !state.catalog.demo;
}

async function openWorkspace(user) {
  state.user = user;
  await loadCatalog();
  $('#account-label').textContent = `${user.username} · ${user.role}`;
  $('#boot').hidden = true;
  $('#auth').hidden = true;
  $('#app').hidden = false;
  await render();
}

function pageHeading(kicker, title, description, actions = '') {
  return `<div class="page-head"><div><p class="kicker">${h(kicker)}</p><h1>${h(title)}</h1><p class="lead">${h(description)}</p></div><div class="actions">${actions}</div></div>`;
}
const tag = (label, tone = '') => `<span class="tag ${tone}">${h(label)}</span>`;
const empty = text => `<div class="empty">${h(text)}</div>`;
const error = text => `<p class="error" role="alert">${h(text)}</p>`;
const panel = (title, subtitle, content, control = '') =>
  `<section class="panel"><div class="panel-head"><div><h2>${h(title)}</h2>${subtitle ? `<p class="muted">${h(subtitle)}</p>` : ''}</div>${control}</div>${content}</section>`;
function params(filter = {}) {
  const query = new URLSearchParams({ crew: state.crewId });
  if (filter.from) query.set('from', utcISO(filter.from));
  if (filter.to) query.set('to', utcISO(filter.to));
  if (filter.source) query.set('source', filter.source);
  return query;
}
function hasCrew() {
  return state.crewId !== null;
}

function plot(groups, unit, label, domainTimes = []) {
  const all = groups.flatMap(group => group.points);
  if (!all.length) return empty('No measurements are available for this view.');
  const times = domainTimes.length ? domainTimes : all.map(point => point.time);
  const start = Math.min(...times);
  const end = Math.max(...times);
  const low = Math.min(...all.map(point => point.value));
  const high = Math.max(...all.map(point => point.value));
  const padding = Math.max((high - low) * .13, high === low ? Math.abs(high) * .025 : .015, .015);
  const min = low - padding;
  const max = high + padding;
  const x = time => end === start ? 320 : 63 + 530 * (time - start) / (end - start);
  const y = value => 145 - 116 * (value - min) / (max - min);
  const grid = Array.from({ length: 4 }, (_, i) => {
    const value = min + (max - min) * i / 3;
    return `<line class="grid" x1="63" x2="593" y1="${y(value)}" y2="${y(value)}"/><text x="55" y="${y(value) + 4}" text-anchor="end">${Number(value.toFixed(2))}</text>`;
  }).join('');
  const lines = groups.map((group, index) => group.segments.map(segment =>
    segment.length === 1 ? `<circle class="series${index}" cx="${x(segment[0].time)}" cy="${y(segment[0].value)}" r="4"/>` :
      `<polyline class="series${index}" points="${segment.map(point => `${x(point.time)},${y(point.value)}`).join(' ')}"/>`
  ).join('')).join('');
  const dateLabel = time => new Date(time).toISOString().slice(5, 16).replace('T', ' ');
  return `<svg class="plot" viewBox="0 0 624 177" role="img" aria-label="${h(`${label}. Range ${low} to ${high} ${unit}. See the corresponding records for exact values.`)}">
    <text x="6" y="14">${h(unit)}</text>${grid}${lines}
    <text x="63" y="169">${dateLabel(start)}</text><text x="593" y="169" text-anchor="end">${dateLabel(end)} UTC</text>
    </svg><div class="legend">${groups.map((group, index) => group.points.length ? `<span><i class="${index ? 'alt' : ''}"></i>${h(group.label)}</span>` : '').join('')}</div>`;
}

function healthPlot(records, key) {
  const ordered = [...records].reverse();
  const groups = Object.entries(sources).map(([source, label]) => {
    const segments = [];
    let segment = [];
    for (const row of ordered.filter(row => row.source === source)) {
      if (row[key] == null) {
        if (segment.length) segments.push(segment);
        segment = [];
      } else segment.push({ time: Date.parse(row.observed_at), value: row[key] });
    }
    if (segment.length) segments.push(segment);
    return { label, segments, points: segments.flat() };
  });
  const metric = state.catalog.metrics[key];
  return plot(groups, metric.unit, metric.label, ordered.map(row => Date.parse(row.observed_at)));
}

const metricSelect = () => `<label><span class="sr-only">Chart indicator</span><select id="metric-select">${Object.entries(state.catalog.metrics).map(([key, metric]) =>
  `<option value="${key}" ${selected(key, state.metric)}>${h(metric.label)}</option>`).join('')}</select></label>`;
const buttons = (label, data, value = '') => `<button type="button" class="secondary" data-${data}="${h(value)}">${h(label)}</button>`;
function alertList(alerts, compact = false) {
  if (!alerts.length) return empty('No alerts match this view.');
  return `<ul class="list">${alerts.map(item => `<li class="alert-row"><div>
    <div class="actions">${tag(item.severity === 'review' ? 'Review' : 'Watch', item.severity === 'review' ? 'red' : 'amber')}${tag(item.state)}${tag(sources[item.source])}</div>
    <p>${h(item.evidence)}</p><small>${h(stamp(item.observed_at))}</small></div>
    ${buttons(compact ? 'View' : 'Follow-up', 'alert', item.id)}</li>`).join('')}</ul>`;
}

async function overview() {
  if (!hasCrew()) return pageHeading('MISSION CONTROL', 'Crew health overview', 'Create a mission and crew profile to get started.') + panel('Workspace setup', '', '<a class="button" href="#crew">Open crew & missions</a>');
  const [readingData, alertData, insight] = await Promise.all([
    api('/api/readings?' + params()), api('/api/alerts?' + params({}) + '&state=open'),
    api('/api/insights', { method: 'POST', body: { crew_id: state.crewId } })
  ]);
  const member = state.catalog.crew.find(person => person.id === state.crewId);
  if (!member) return '';
  const mission = state.catalog.missions.find(item => item.id === member.mission_id);
  const records = readingData.records;
  const latest = records[0];
  const hero = `<section class="hero">
    <svg class="hero-orbit" aria-hidden="true" viewBox="0 0 330 260" fill="none" stroke="currentColor">
      <circle cx="215" cy="128" r="77"/><circle cx="215" cy="128" r="103" stroke-dasharray="4 9"/><circle cx="215" cy="128" r="47"/>
      <ellipse cx="215" cy="128" rx="128" ry="39" transform="rotate(-27 215 128)"/><circle cx="126" cy="169" r="4" fill="currentColor"/>
      <path d="M215 15v225M96 128h234" opacity=".35"/>
    </svg>
    <div class="hero-content"><p class="kicker">MISSION CONTROL / ${h(mission.name.toUpperCase())}</p><h1>Crew health overview</h1>
    <p class="lead">${h(member.name)} · ${h(member.position)} · ${h(mission.environment)}</p>
    <div class="hero-tags">${tag(latest ? sources[latest.source] + ' observations' : 'Awaiting observations', 'amber')}${tag('Monitoring workspace', 'mint')}</div></div></section>`;
  const cards = Object.entries(state.catalog.metrics).map(([key, metric]) => {
    const value = latest?.[key];
    const tone = value == null ? '' : value < metric.demo[0] || value > metric.demo[1] ? 'amber' : 'mint';
    return `<div class="metric"><div class="metric-label">${icon('pulse')}${h(metric.label)}</div><div class="metric-number">${h(value ?? '—')} <small>${h(metric.unit)}</small></div>${tag(value == null ? 'No value' : tone === 'amber' ? 'Outside demo range' : 'In demo range', tone)}</div>`;
  }).join('');
  return hero + `<div class="section-title"><h2>Latest observation</h2><small>${h(latest ? stamp(latest.observed_at) : 'No timestamp')}</small></div><div class="metric-grid">${cards}</div>` +
    `<div class="split">${panel('Health trends', 'Most recent 14 saved observations.', `<div id="health-plot">${healthPlot(records.slice(0, 14), state.metric)}</div>`, metricSelect())}
    ${panel('Open alerts', alertData.truncated ? '200+ open alerts' : `${alertData.alerts.length} currently open`, alertList(alertData.alerts.slice(0, 3), true), '<a href="#alerts">All alerts</a>')}</div>` +
    panel('Shift handover', 'Transparent findings from the latest observation and its same-source history.',
      `<div id="insight-result">${showFacts(insight)}</div>${latest?.source === 'synthetic' ? buttons('Prioritize synthetic findings with OpenAI', 'insights') : ''}`);
}

function showFacts(result) {
  return `<div class="actions">${tag(result.mode === 'openai-prioritized' ? 'OpenAI prioritized' : 'Local rule-based', 'mint')}</div>
  <ul>${result.facts.map(fact => `<li>${h(fact)}</li>`).join('')}</ul>${result.message ? `<p class="muted">${h(result.message)}</p>` : ''}`;
}

function filtersForm(name, values) {
  return `<form class="filters" id="${name}-filters"><label>Start UTC<input type="datetime-local" step="1" name="from" value="${h(values.from)}"></label>
    <label>End UTC (exclusive)<input type="datetime-local" step="1" name="to" value="${h(values.to)}"></label>
    <label>Data source<select name="source"><option value="">All sources</option>${Object.entries(sources).map(([key, label]) =>
      `<option value="${key}" ${selected(key, values.source)}>${label}</option>`).join('')}</select></label>
    <button class="secondary">Apply filters</button>${buttons('Clear', 'clear', name)}</form>`;
}
function readingTable(records) {
  if (!records.length) return empty('No saved observations match these filters.');
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="Observations table"><table><thead><tr><th>Time</th><th>Source</th>
    ${Object.values(state.catalog.metrics).map(metric => `<th>${h(metric.label)}<br>${h(metric.unit)}</th>`).join('')}<th>Note</th><th>Action</th></tr></thead>
    <tbody>${records.map(row => `<tr><td>${h(stamp(row.observed_at))}</td><td>${tag(sources[row.source])}</td>
      ${Object.keys(state.catalog.metrics).map(key => `<td>${h(row[key] ?? '—')}</td>`).join('')}<td class="note">${h(row.note || '—')}</td>
      <td>${state.user.role !== 'crew' || row.entered_by === state.user.id ? buttons('Edit', 'edit-reading', row.id) : '—'}</td></tr>`).join('')}</tbody></table></div>`;
}
async function observations() {
  const title = pageHeading('TELEMETRY LOG', 'Observations', 'Review timestamped crew data, filter its history, and add or import measurements.',
    hasCrew() ? buttons('Import CSV / JSON', 'import') : '');
  if (!hasCrew()) return title + empty('Create a crew profile to log observations.');
  const generation = state.generation;
  const data = await api('/api/readings?' + params(state.observationFilter));
  if (generation === state.generation) state.result = data.records;
  return title + filtersForm('observation', state.observationFilter) +
    panel('Indicator trend', 'Blank measurements split the plotted trace for that source.', `<div id="health-plot">${healthPlot(data.records, state.metric)}</div>`, metricSelect()) +
    panel('Observation history', data.truncated ? 'Showing the latest 500 results. Narrow the filters to review older entries.' : `${data.records.length} saved observations`, readingTable(data.records));
}

async function alerts() {
  const title = pageHeading('REVIEW QUEUE', 'Alerts & follow-up', 'Review evidence from demonstration rules and keep a record of acknowledgments and follow-up.');
  if (!hasCrew()) return title + empty('No crew profiles are available.');
  const q = params();
  if (state.alertState) q.set('state', state.alertState);
  const data = await api('/api/alerts?' + q);
  const filter = `<label>Status<select id="alert-state"><option value="">All statuses</option>${['open','acknowledged','resolved','withdrawn'].map(value =>
    `<option ${selected(value, state.alertState)}>${value}</option>`).join('')}</select></label>`;
  return title + panel('Review queue', data.truncated ? 'Showing the latest 200 matches.' : `${data.alerts.length} matching alerts`, alertList(data.alerts), filter) +
    panel('About the rules', 'Illustrative monitoring thresholds, with no clinical validation.', `<ul>${Object.values(state.catalog.metrics).map(metric =>
    `<li>${h(metric.label)} · ${metric.demo.join('–')} ${h(metric.unit)}</li>`).join('')}</ul><p class="muted">A combined review flag is triggered when two or more measurements in one observation are outside the demonstration ranges.</p>`);
}

async function radiation(refresh = false) {
  const query = state.radiation || state.catalog.radiation;
  const q = new URLSearchParams(query);
  if (refresh) q.set('refresh', '1');
  const data = await api('/api/radiation?' + q);
  const title = pageHeading('ENVIRONMENTAL CONTEXT', 'NASA RadLab', 'Historical radiation measurements from the International Space Station. Crew alert calculations use physiological observations.');
  const form = `<form id="radiation-filter" class="filters">
    <label>Start UTC<input name="from" type="datetime-local" step="1" value="${utcField(query.from)}" required></label>
    <label>End UTC (exclusive)<input name="to" type="datetime-local" step="1" value="${utcField(query.to)}" required></label>
    <label>Instrument<select name="instrument">${['DosTel','DosTel1','DosTel2'].map(value => `<option ${selected(value, query.instrument)}>${value}</option>`).join('')}</select></label>
    <button class="secondary">Load interval</button>${buttons('Refresh from NASA', 'refresh-nasa')}${buttons('Reference interval', 'reset-nasa')}
    <span id="radiation-error" class="error" role="alert"></span></form>`;
  const labels = { fetched: 'Fetched from NASA', cache: 'Cached NASA response', stale: 'Older cached NASA response', snapshot: 'Packaged NASA snapshot', unavailable: 'Source unavailable' };
  const points = data.points;
  const groups = ['DosTel1', 'DosTel2'].map(instrument => {
    const values = points.filter(row => row.instrument === instrument).map(row => ({ time: Date.parse(row.timestamp), value: row.dose }));
    return { label: instrument, points: values, segments: [values].filter(segment => segment.length) };
  });
  const stats = groups.filter(group => group.points.length).map(group => {
    const values = group.points.map(point => point.value);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return `<li><strong>${group.label}</strong> · ${values.length} measurements · mean ${mean.toFixed(2)} µGy/h · peak ${Math.max(...values).toFixed(2)} µGy/h</li>`;
  }).join('');
  return title + form +
    panel('Absorbed dose rate', data.fetchedAt ? `NASA response captured ${stamp(data.fetchedAt)}` : 'The selected window has no saved response.',
      `${data.message ? `<p class="error">${h(data.message)}</p>` : ''}${points.length ? plot(groups, 'µGy/h', 'ISS absorbed radiation dose rate') + `<ul>${stats}</ul>` : empty('No radiation measurements are available for this interval.')}`, tag(labels[data.mode], data.mode === 'fetched' ? 'mint' : 'amber')) +
    panel('Data provenance', 'NASA Open Science Data Repository (OSDR) · RadLab', `<p>ISS / ${h(query.instrument)} · ${h(stamp(query.from))} to ${h(stamp(query.to))}. Dose rate describes instrument measurements in this historical interval.</p>
      <p class="actions"><a href="${h(data.snapshotSourceUrl || data.url)}" target="_blank" rel="noopener noreferrer">Source query</a>
      <a href="${h(data.documentation)}" target="_blank" rel="noopener noreferrer">API documentation</a></p>`) +
    (points.length ? panel('Measurement table', `${points.length} valid records · UTC timestamps`, `<details><summary>Show radiation measurements</summary><div class="table-wrap"><table><thead><tr><th>Observed at</th><th>Instrument</th><th>Absorbed dose rate (µGy/h)</th></tr></thead><tbody>${points.map(row => `<tr><td>${h(row.timestamp)}</td><td>${h(row.instrument)}</td><td>${row.dose.toFixed(4)}</td></tr>`).join('')}</tbody></table></div></details>`) : '');
}

function crew() {
  const admin = state.user.role === 'admin';
  const { missions, crew: members } = state.catalog;
  const list = (rows, kind) => rows.length ? `<ul class="list">${rows.map(row => `<li><div class="panel-head"><div><h3>${h(row.name)}</h3>
    <p class="muted">${h(kind === 'mission' ? row.environment : row.position + ' · ' + missions.find(m => m.id === row.mission_id)?.name)}</p></div>
    ${admin ? buttons('Edit', 'catalog', kind + ':' + row.id) : ''}</div>${row.objective ? `<p>${h(row.objective)}</p>` : ''}</li>`).join('')}</ul>` : empty('No entries yet.');
  return pageHeading('MISSION ADMINISTRATION', 'Crew & missions', 'Organize mission contexts and the crew profiles used by the monitoring workspace.') +
    `<div class="split equal">${panel('Missions', '', list(missions, 'mission'), admin ? buttons('Add mission', 'catalog', 'mission') : '')}
    ${panel('Crew roster', '', list(members, 'crew'), admin && missions.length ? buttons('Add crew member', 'catalog', 'crew') : '')}</div>`;
}

function reports() {
  return pageHeading('DATA EXCHANGE', 'Reports & exports', 'Download observations for the selected crew profile. Reports retain each record’s source and timestamp.') +
    (!hasCrew() ? empty('No crew profiles are available.') : panel('Export observations', 'Choose a time range and source, then download up to 5,000 records.', filtersForm('report', state.reportFilter) +
    `<div class="actions">${buttons('Download CSV', 'export', 'csv')}${buttons('Download JSON', 'export', 'json')}</div>`));
}

async function access() {
  const [accounts, audit] = await Promise.all([api('/api/accounts'), api('/api/audit')]);
  const list = accounts.accounts.map(row => `<li><strong>${h(row.username)}</strong> ${tag(row.role)} ${row.crew_id ? h(state.catalog.crew.find(person => person.id === row.crew_id)?.name) : ''}</li>`).join('');
  const log = audit.events.map(row => `<tr><td>${h(stamp(row.created_at))}</td><td>${h(row.username || 'System')}</td><td>${h(row.event)}</td><td>${h(row.target ?? '—')}</td></tr>`).join('');
  return pageHeading('ADMINISTRATION', 'Access & audit', 'Assign access and review recent workspace changes.') +
    panel('Accounts', 'Crew accounts are limited to their linked crew profile. Reviewers can review observations and resolve alerts.', `<ul class="list">${list}</ul>`, buttons('Create account', 'account')) +
    panel('Recent activity', 'Latest 100 audit events. Observation values and notes are stored with their respective records.', `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Actor</th><th>Event</th><th>Target ID</th></tr></thead><tbody>${log}</tbody></table></div>`);
}

const pages = { overview, observations, alerts, radiation, crew, reports, access };
async function render(options = {}) {
  if (!state.user) return;
  const gen = ++state.generation;
  const available = routes.filter(([key]) => key !== 'access' || state.user.role === 'admin');
  const route = available.find(([key]) => location.hash === '#' + key) || available[0];
  const changed = state.page !== route[0];
  state.page = route[0];
  $('#crumb').textContent = route[1];
  document.title = `${route[1]} | AstroByte Health Monitor`;
  if (changed || !$('#navigation').children.length) {
    $('#navigation').innerHTML = available.map(([key, name, glyph]) =>
      `<a href="#${key}" class="nav-link" ${key === state.page ? 'aria-current="page"' : ''}>${icon(glyph)}${name}</a>`).join('');
  }
  view.setAttribute('aria-busy', 'true');
  if (changed) {
    view.textContent = 'Loading workspace…';
    $('#main').focus();
  }
  try {
    const html = await pages[state.page](options.refresh);
    if (gen === state.generation) view.innerHTML = html;
  } catch (err) {
    if (gen !== state.generation) return;
    if (!changed && options.onError) options.onError(err);
    else view.innerHTML = pageHeading('WORKSPACE', route[1], 'This view could not be loaded.') + panel('Request failed', '', error(err.message), buttons('Try again', 'reload'));
  } finally {
    if (gen === state.generation) view.setAttribute('aria-busy', 'false');
  }
}

function modal(title, fields, submitText, action) {
  dialog.innerHTML = `<div class="panel-head"><h2 id="dialog-title">${h(title)}</h2><button type="button" class="text-button" aria-label="Close dialog" id="close-dialog">✕</button></div>
    ${action ? `<form class="form-grid form-two">${fields}<p class="error wide" role="alert"></p><div class="actions wide"><button class="primary">${h(submitText)}</button></div></form>` : fields}`;
  $('#close-dialog', dialog).onclick = () => dialog.close();
  if (action) $('form', dialog).onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $('button.primary', form);
    const problem = $('.error', form);
    problem.textContent = '';
    button.disabled = true;
    try {
      const message = await action(Object.fromEntries(new FormData(form)));
      dialog.close();
      notify(message);
      await render();
    } catch (err) {
      problem.textContent = err.message;
    } finally { button.disabled = false; }
  };
  if (!dialog.open) dialog.showModal();
}

function readingModal(row = null) {
  const crewId = state.crewId;
  const member = state.catalog.crew.find(person => person.id === crewId);
  if (!member) return;
  const fields = `<p class="muted wide">Crew profile · ${h(member.name)}. Enter at least one measurement. Time is in UTC.</p>
    <label>Observation time (UTC)<input name="observed_at" type="datetime-local" step="0.001" value="${h(row ? row.observed_at.slice(0, -1) : utcField())}" required></label>
    <label>Data source<select name="source">${Object.entries(sources).map(([key, label]) =>
      `<option value="${key}" ${selected(key, row?.source || (state.catalog.demo ? 'synthetic' : 'manual'))}>${label}</option>`).join('')}</select></label>
    ${Object.entries(state.catalog.metrics).map(([key, metric]) => `<label>${h(metric.label)} (${h(metric.unit)})
      <input type="number" step="any" min="${metric.min}" max="${metric.max}" name="${key}" value="${h(row?.[key])}"></label>`).join('')}
    <label class="wide">Observation note<textarea name="note" maxlength="500">${h(row?.note)}</textarea></label>`;
  modal(row ? 'Edit observation' : 'Log observation', fields, 'Save observation', async data => {
    data.observed_at = utcISO(data.observed_at);
    data.crew_id = crewId;
    if (row) data.revision = row.revision;
    for (const key of Object.keys(state.catalog.metrics)) data[key] = data[key] === '' ? null : Number(data[key]);
    await api('/api/readings' + (row ? '/' + row.id : ''), { method: row ? 'PATCH' : 'POST', body: data });
    return row ? 'Observation updated.' : 'Observation saved.';
  });
}

function importModal() {
  const crewId = state.crewId;
  modal('Import observations', `<p class="wide muted">Import up to 250 records to the selected crew profile. CSV requires <code>observed_at</code>, <code>source</code>, and one or more of <code>heart_rate, spo2, temperature, sleep, fatigue</code>. A JSON export can be re-imported to another crew profile.</p>
    <p class="wide muted">Use ISO UTC timestamps and source values <code>synthetic</code> or <code>manual</code>. A duplicate timestamp cancels the import.</p>
    <label class="wide">CSV or JSON file<input type="file" name="file" accept=".csv,.json" required></label>`, 'Validate and import', async data => {
    const file = data.file;
    const format = file.name.toLowerCase().split('.').at(-1);
    if (!['json','csv'].includes(format) || file.size > 300 * 1024) throw new Error('Select a CSV or JSON file up to 300 KiB.');
    let payload = await file.text();
    if (format === 'json') {
      try { payload = JSON.parse(payload.replace(/^\uFEFF/, '')); }
      catch { throw new Error('The JSON file is invalid.'); }
    }
    const result = await api('/api/import', { method: 'POST', body: { crew_id: crewId, format, payload } });
    return `Imported ${result.count} observations.`;
  });
}

async function alertModal(id) {
  const crew = state.crewId;
  const data = await api('/api/alerts/' + id);
  if (crew !== state.crewId) return;
  const { alert, followups } = data;
  const canResolve = state.user.role !== 'crew';
  const choices = alert.state === 'open' ? ['open', 'acknowledged', ...(canResolve ? ['resolved'] : [])] :
    alert.state === 'acknowledged' ? ['acknowledged', ...(canResolve ? ['resolved'] : [])] : [alert.state];
  const history = followups.length ? `<ul class="list">${followups.map(row => `<li>${tag(row.state)} <small>${h(stamp(row.created_at))}</small><p>${h(row.note)}</p>
    ${row.evidence ? `<details class="followup-context"><summary>Attached NASA reference</summary>${evidenceMarkup(row.evidence)}</details>` : ''}</li>`).join('')}</ul>` : empty('No follow-up has been logged.');
  const info = `<div class="wide"><p>${h(alert.evidence)}</p><p class="muted">Status · ${h(alert.state)}</p><h3>Follow-up history</h3>${history}</div>`;
  if (alert.state === 'withdrawn') return modal('Alert details', info);
  const radiation = alert.source === 'synthetic' ? `<section class="review-context wide">
    <div class="panel-head"><h3>NASA radiation context</h3><button type="button" class="secondary" id="review-radiation">Load NASA reference</button></div>
    <div id="review-evidence" aria-live="polite"><p class="muted">Compare the ISS DosTel reference window alongside this simulated alert.</p></div>
    <label class="check-line"><input type="checkbox" name="attach_context" disabled> Attach NASA reference to this note</label>
    </section>` : '';
  modal('Alert follow-up', info + radiation + `<label class="wide">Status<select name="state">${choices.map(status => `<option>${status}</option>`).join('')}</select></label>
    <label class="wide">Follow-up note<textarea name="note" required maxlength="500"></textarea></label>`, 'Save follow-up', async data => {
    await api('/api/alerts/' + id, { method: 'PATCH', body: { ...data, attach_context: data.attach_context === 'on', revision: alert.revision } });
    return 'Follow-up recorded.';
  });
  const button = $('#review-radiation', dialog);
  if (!button) return;
  const output = $('#review-evidence', dialog);
  const attach = $('[name=attach_context]', dialog);
  button.onclick = async () => {
    button.disabled = true;
    attach.checked = false;
    attach.disabled = true;
    output.textContent = 'Loading NASA reference…';
    try {
      const evidence = evidenceSummary(await api('/api/alerts/' + id + '/evidence'));
      output.innerHTML = evidenceMarkup(evidence);
      attach.disabled = !evidence;
      if (!evidence) attach.checked = false;
      button.textContent = evidence ? 'Reload NASA reference' : 'Retry NASA reference';
    } catch (err) {
      output.textContent = err.message;
      attach.disabled = true;
      attach.checked = false;
    } finally { button.disabled = false; }
  };
}

function catalogModal(value) {
  const [kind, item] = value.split(':');
  const mission = kind === 'mission';
  const table = mission ? 'missions' : 'crew';
  const row = state.catalog[table].find(entry => entry.id === Number(item));
  const label = mission ? 'mission' : 'crew member';
  const fields = `<label class="wide">Name<input name="name" maxlength="90" value="${h(row?.name)}" required></label>` + (mission ?
    `<label class="wide">Environment<input name="environment" maxlength="110" value="${h(row?.environment)}" required></label>
      <label class="wide">Objective<textarea name="objective" maxlength="500">${h(row?.objective)}</textarea></label>` :
    `<label>Position<input name="position" maxlength="90" value="${h(row?.position)}" required></label><label>Mission<select name="mission_id">${state.catalog.missions.map(entry =>
      `<option value="${entry.id}" ${selected(entry.id, row?.mission_id)}>${h(entry.name)}</option>`).join('')}</select></label>`);
  modal((row ? 'Edit ' : 'Add ') + label, fields, 'Save', async data => {
    const result = await api('/api/' + table + (row ? '/' + row.id : ''), { method: row ? 'PATCH' : 'POST', body: data });
    if (!mission && !row) state.crewId = result.id;
    await loadCatalog();
    return mission ? 'Mission saved.' : 'Crew profile saved.';
  });
}

function accountModal() {
  const names = state.catalog.crew.map(person => `<option value="${person.id}">${h(person.name)}</option>`).join('');
  modal('Create workspace account', `<label>Username<input name="username" autocomplete="off" required minlength="3" maxlength="48"></label>
    <label>Initial password<input name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="256"></label>
    <label>Role<select name="role"><option value="reviewer">Reviewer</option><option value="admin">Admin</option>${names ? '<option value="crew">Crew member</option>' : ''}</select></label>
    <label id="link-crew" hidden>Linked crew<select name="crew_id">${names}</select></label>`, 'Create account', async data => {
    await api('/api/accounts', { method: 'POST', body: data });
    return 'Account created.';
  });
  $('select[name=role]', dialog).onchange = event => { $('#link-crew', dialog).hidden = event.currentTarget.value !== 'crew'; };
}

async function download(format) {
  const query = params(state.reportFilter);
  query.set('format', format);
  const response = await api('/api/export?' + query, {}, true);
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'astrobyte.' + format;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  notify('Export downloaded.');
}

view.addEventListener('click', async event => {
  const button = event.target.closest('button[type=button]');
  if (!button || button.disabled) return;
  const data = button.dataset;
  button.disabled = true;
  try {
    if ('alert' in data) await alertModal(data.alert);
    if ('import' in data) importModal();
    if ('editReading' in data) {
      const record = state.result?.find(row => row.id === Number(data.editReading));
      if (record) readingModal(record);
    }
    if ('catalog' in data) catalogModal(data.catalog);
    if ('account' in data) accountModal();
    if ('reload' in data) await render();
    if ('clear' in data) {
      if (data.clear === 'observation') state.observationFilter = {};
      else state.reportFilter = {};
      await render();
    }
    if ('export' in data) await download(data.export);
    if ('refreshNasa' in data || 'resetNasa' in data) {
      if ('resetNasa' in data) state.radiation = null;
      await render({ refresh: 'refreshNasa' in data });
    }
    if ('insights' in data) {
      const generation = state.generation;
      const summary = await api('/api/insights', { method: 'POST', body: { crew_id: state.crewId, external: true } });
      if (generation === state.generation && $('#insight-result')) $('#insight-result').innerHTML = showFacts(summary);
    }
  } catch (err) { notify(err.message); }
  finally { button.disabled = false; }
});

view.addEventListener('change', event => {
  if (event.target.id === 'metric-select') { state.metric = event.target.value; void render(); }
  if (event.target.id === 'alert-state') { state.alertState = event.target.value; void render(); }
});

view.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  if (form.id === 'observation-filters' || form.id === 'report-filters') {
    if (data.from && data.to && utcISO(data.from) >= utcISO(data.to)) return notify('End must be later than start.');
    if (form.id === 'observation-filters') state.observationFilter = data;
    else state.reportFilter = data;
    await render();
  }
  if (form.id === 'radiation-filter') {
    const previous = state.radiation;
    state.radiation = { from: utcISO(data.from), to: utcISO(data.to), instrument: data.instrument };
    await render({ onError(err) {
      state.radiation = previous;
      $('#radiation-error').textContent = err.message;
    } });
  }
});

window.addEventListener('hashchange', () => { if (state.user && location.hash !== '#main') void render(); });
$('#crew-selector').onchange = event => {
  state.crewId = Number(event.target.value);
  state.result = null;
  view.replaceChildren();
  void render();
};
$('#top-add').onclick = () => readingModal();
$('#sign-out').onclick = async () => {
  try {
    await api('/api/logout', { method: 'POST' });
    $('#navigation').replaceChildren();
    showAuth(state.catalog.demo);
  } catch (err) { notify(err.message); }
};

async function authenticate(path, body) {
  const form = $('#login-form');
  const buttons = [...form.querySelectorAll('button'), $('#demo-button')];
  buttons.forEach(button => { button.disabled = true; });
  $('#login-error').textContent = '';
  try {
    const data = await api(path, { method: 'POST', body });
    form.reset();
    await openWorkspace(data.user);
  } catch (err) { $('#login-error').textContent = err.message; }
  finally { buttons.forEach(button => { button.disabled = false; }); }
}
$('#login-form').onsubmit = event => {
  event.preventDefault();
  void authenticate('/api/login', Object.fromEntries(new FormData(event.currentTarget)));
};
$('#demo-button').onclick = () => { void authenticate('/api/demo', {}); };

try {
  const session = await api('/api/session');
  if (session.user) await openWorkspace(session.user);
  else showAuth(session.demo);
} catch (err) {
  $('#boot').textContent = 'Workspace could not start. Refresh to try again. ' + err.message;
}
