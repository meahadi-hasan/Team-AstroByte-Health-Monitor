import { evaluate, field, metrics, reading } from './domain.mjs';
import { evidenceMarkup, evidenceSummary, escapeHtml as h, formatUtc } from './evidence.js';
import { presets } from './scenarios.js';

const $ = selector => document.querySelector(selector);
const observationForm = $('#demo-observation');
const followupForm = $('#demo-followup');
const loadButton = $('#load-evidence');
const attach = followupForm.elements.attach;
const presetButtons = [...document.querySelectorAll('[data-scenario]')];
let observations = [];
let active = null;
let activeAlert = null;
let reference = null;
let loadGeneration = 0;
let notice = 'Enter values or choose a scenario to begin. Changes stay in this page session.';

$('#demo-inputs').innerHTML = Object.entries(metrics).map(([key, metric]) =>
  `<label>${h(metric.label)} (${h(metric.unit)})<input name="${key}" type="number" inputmode="decimal" step="any" min="${metric.min}" max="${metric.max}" placeholder="Optional"></label>`).join('');

function applyPreset(name) {
  const preset = presets[name];
  for (const [key, value] of Object.entries(preset)) observationForm.elements[key].value = value;
  for (const button of presetButtons) button.setAttribute('aria-pressed', String(button.dataset.scenario === name));
  $('#observation-error').textContent = '';
}
for (const button of presetButtons) button.addEventListener('click', () => applyPreset(button.dataset.scenario));
observationForm.addEventListener('input', () => {
  for (const button of presetButtons) button.setAttribute('aria-pressed', 'false');
});

function renderFollowups() {
  const list = activeAlert?.followups || [];
  $('#demo-followups').innerHTML = list.length ? `<h3 class="history-title">Review history</h3><ul class="list">${list.map(entry => `<li>
    <p>${h(entry.note)}</p><small>${h(formatUtc(entry.createdAt))}</small>
    ${entry.evidence ? `<details class="followup-context"><summary>Attached NASA reference</summary>${evidenceMarkup(entry.evidence)}</details>` : ''}
    </li>`).join('')}</ul>` : '';
}

function renderReference() {
  attach.disabled = !reference || !activeAlert;
  if (attach.disabled) attach.checked = false;
  if (reference) $('#demo-evidence').innerHTML = evidenceMarkup(reference);
}

function selectAlert(rule) {
  activeAlert = active?.alerts.find(item => item.rule === rule) || null;
  followupForm.reset();
  $('#followup-error').textContent = '';
  renderAlertPanel();
}

function renderAlertPanel() {
  const flags = active?.alerts || [];
  $('#alert-description').textContent = !active ? 'Save an observation to see which rules fire.' :
    !flags.length ? 'This observation is within the demonstration ranges.' :
    'Choose a flag to review its trigger and record a follow-up.';
  $('#demo-alerts').innerHTML = flags.length ? `<div class="actions alert-selector">${flags.map(flag => `<button type="button" class="secondary" data-rule="${h(flag.rule)}" aria-pressed="${flag === activeAlert}">
    ${h(flag.rule === 'combined' ? 'Combined signals' : metrics[flag.rule].label)}${flag.followups.length ? ' · Reviewed' : ''}</button>`).join('')}</div>` : '';
  if (activeAlert) {
    const evidenceList = activeAlert.rule === 'combined' ? flags.filter(flag => flag.rule !== 'combined') : [activeAlert];
    $('#demo-alerts').insertAdjacentHTML('beforeend', `<div class="flag-explanation">
      <span class="tag ${activeAlert.severity === 'review' ? 'red' : 'amber'}">${h(activeAlert.severity)}</span>
      <h3>${h(activeAlert.evidence)}</h3>
      ${evidenceList.length > 1 ? `<ul>${evidenceList.map(flag => `<li>${h(flag.evidence)}</li>`).join('')}</ul>` : ''}
      <p class="muted">These rules use illustrative ranges for the simulation.</p></div>`);
  }
  $('#demo-context').hidden = !activeAlert;
  followupForm.hidden = !activeAlert;
  renderReference();
  renderFollowups();
}

function render() {
  $('#demo-status').textContent = notice;
  $('#export-demo').disabled = !observations.length;
  $('#history-empty').hidden = observations.length > 0;
  $('#demo-history').innerHTML = [...observations].reverse().map(item => `<li><button class="history-row" type="button" data-observation="${item.id}" aria-pressed="${item === active}">
    <span>Observation ${item.id}</span><small>${item.alerts.length} flag${item.alerts.length === 1 ? '' : 's'}</small></button></li>`).join('');
  renderAlertPanel();
}

observationForm.addEventListener('submit', event => {
  event.preventDefault();
  $('#observation-error').textContent = '';
  try {
    if (observations.length >= 40) throw new Error('Export or reset this session before adding more observations.');
    const fields = Object.fromEntries(new FormData(observationForm));
    const numbers = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value === '' ? null : Number(value)]));
    const observation = reading({ ...numbers, source: 'synthetic', observed_at: new Date().toISOString() });
    const flags = evaluate(observation).map(flag => ({ ...flag, followups: [] }));
    active = { id: observations.length + 1, observation, alerts: flags };
    observations.push(active);
    selectAlert(flags.find(flag => flag.rule === 'combined')?.rule || flags[0]?.rule);
    notice = 'Observation saved. ' + (flags.length ? 'Review the alert and load its NASA reference.' : 'No demonstration rule fired.');
    render();
  } catch (err) { $('#observation-error').textContent = err.message; }
});

$('#demo-history').addEventListener('click', event => {
  const button = event.target.closest('[data-observation]');
  if (!button) return;
  active = observations.find(item => item.id === Number(button.dataset.observation));
  selectAlert(active.alerts.find(flag => flag.rule === 'combined')?.rule || active.alerts[0]?.rule);
  render();
});
$('#demo-alerts').addEventListener('click', event => {
  const button = event.target.closest('[data-rule]');
  if (!button) return;
  const rule = button.dataset.rule;
  selectAlert(rule);
  $('#demo-alerts').querySelector(`[data-rule="${rule}"]`)?.focus();
});

loadButton.addEventListener('click', async () => {
  const generation = ++loadGeneration;
  loadButton.disabled = true;
  reference = null;
  renderReference();
  $('#demo-evidence').textContent = 'Loading NASA reference…';
  try {
    const response = await fetch(document.body.dataset.radiationEndpoint, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error('NASA reference could not be loaded.');
    const summary = evidenceSummary(await response.json());
    if (generation !== loadGeneration) return;
    reference = summary;
    $('#demo-evidence').innerHTML = evidenceMarkup(reference);
    loadButton.textContent = summary ? 'Reload NASA reference' : 'Retry NASA reference';
    renderReference();
  } catch {
    if (generation !== loadGeneration) return;
    reference = null;
    $('#demo-evidence').innerHTML = evidenceMarkup(null);
    loadButton.textContent = 'Retry NASA reference';
    renderReference();
  } finally {
    if (generation === loadGeneration) loadButton.disabled = false;
  }
});

followupForm.addEventListener('submit', event => {
  event.preventDefault();
  if (!activeAlert) return;
  $('#followup-error').textContent = '';
  try {
    const note = field(followupForm.elements.note.value, 'Follow-up note', 500);
    if (activeAlert.followups.length >= 15) throw new Error('This alert already has 15 notes. Export the session to keep a copy.');
    activeAlert.followups.push({ note, createdAt: new Date().toISOString(), evidence: attach.checked ? reference : null });
    notice = attach.checked ? 'Follow-up saved with NASA evidence.' : 'Follow-up saved.';
    followupForm.reset();
    render();
  } catch (err) { $('#followup-error').textContent = err.message; }
});

$('#reset-demo').addEventListener('click', () => {
  observations = [];
  active = null;
  activeAlert = null;
  reference = null;
  loadGeneration++;
  loadButton.disabled = false;
  loadButton.textContent = 'Load NASA reference';
  $('#demo-evidence').innerHTML = '<p class="muted">Load an ISS DosTel reference window to compare each detector’s readings.</p>';
  followupForm.reset();
  $('#followup-error').textContent = '';
  applyPreset('combined');
  notice = 'Session reset. The multi-signal preset is ready to save.';
  render();
});

$('#export-demo').addEventListener('click', () => {
  const payload = { title: 'AstroByte judging demo', crew: 'Maya Chen (fictional)', source: 'synthetic', observations };
  const href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href, download: 'astrobyte-demo-session.json' });
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  notice = 'Session report exported.';
  $('#demo-status').textContent = notice;
});

applyPreset('combined');
render();
