import test from 'node:test';
import { evidenceSummary } from '../public/evidence.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reading, evaluate, insightFacts, csvExport, csvImport, date } from '../src/domain.mjs';
import { normalizeRadlab, radlabQuery, referenceWindow, sourceUrl, createRadiationService } from '../src/radlab.mjs';
import { openStore } from '../src/store.mjs';
import { summarize } from '../src/insights.mjs';

const row = { observed_at: '2025-11-04T12:30:00.000Z', source: 'synthetic', heart_rate: 72, sleep: 5, fatigue: 7, note: 'Shift "A", check\nfollow-up' };
const snapshot = JSON.parse(readFileSync(new URL('../data/radlab-iss-dostel.json', import.meta.url)));
test('validates UTC, required measurements, bounds, and data provenance', () => {
  assert.equal(reading(row).spo2, null);
  assert.throws(() => reading({ ...row, observed_at: '2025-02-30T12:00:00Z' }), /Invalid/);
  assert.throws(() => date('2025-01-01T12:00:00+06:00', 'Date'), /UTC/);
  assert.throws(() => reading({ ...row, spo2: 101 }), /Oxygen saturation/);
  assert.throws(() => reading({ ...row, source: 'NASA' }), /valid data source/);
  assert.throws(() => reading({ observed_at: row.observed_at, source: row.source }), /at least one/);
});
test('generates evidence and a same-observation combined flag; median uses prior inputs', () => {
  assert.deepEqual(evaluate(row).map(flag => flag.rule), ['sleep','fatigue','combined']);
  assert.ok(insightFacts(row, [{ heart_rate: 71 }, { heart_rate: 75 }, { heart_rate: 74 }]).some(text => text.includes('74 bpm')));
  assert.equal(evaluate({ spo2: 94, sleep: 6, fatigue: 6 }).length, 0);
});
test('CSV handles multiline quoted fields, bad headers and spreadsheet formulas', () => {
  assert.equal(csvImport(csvExport([row]))[0].note, row.note);
  assert.equal(csvImport(csvExport([row]))[0].fatigue, 7);
  assert.match(csvExport([{ ...row, note: '=1+1' }]), /'=1\+1/);
  assert.throws(() => csvImport('source,source\nmanual,manual'), /headers/);
  assert.throws(() => csvImport('observed_at,source,heart_rate\n"bad'), /Unclosed/);
});
test('normalizes actual column-tagged NASA arrays and validates object rows', () => {
  const points = normalizeRadlab(snapshot, referenceWindow);
  assert.equal(points.length, 180);
  assert.equal(points[0].timestamp, '2022-04-01T23:00:00.000Z');
  assert.equal(new Set(points.map(point => point.instrument)).size, 2);
  const normal = { timestamp: '2022-04-01T23:00:00', instrument_id: 'DosTel2', absorbed_dose_rate: 10 };
  assert.equal(normalizeRadlab([{ ...normal, absorbed_dose_rate: '' }, normal, normal], referenceWindow).length, 1);
  assert.throws(() => normalizeRadlab({ data: [[normal.timestamp,'DosTel2',10]] }, referenceWindow), /column names/);
  assert.throws(() => radlabQuery({ instrument: 'https://malicious.invalid' }), /supported/);
  assert.match(sourceUrl(referenceWindow), /absorbed_dose_rate&format=json/);
});
test('radiation adapter persists usable data and exposes cache, snapshot and failure explicitly', async () => {
  const db = openStore(':memory:');
  try {
    const unavailable = async () => { throw new Error('Network failure'); };
    const offline = createRadiationService(db, unavailable);
    assert.equal((await offline(referenceWindow)).mode, 'snapshot');
    assert.equal((await offline({ ...referenceWindow, from: '2022-04-01T00:00:00.000Z' })).mode, 'unavailable');
    const connected = createRadiationService(db, async () => new Response(JSON.stringify(snapshot)));
    assert.equal((await connected(referenceWindow)).mode, 'fetched');
    assert.equal((await offline(referenceWindow)).mode, 'cache');
    assert.equal((await offline(referenceWindow, true)).mode, 'stale');
  } finally { db.close(); }
});
test('AI validates indices and sends synthetic numeric findings without identifiers or notes', async () => {
  const model = async (url, init) => {
    assert.match(url, /api.openai.com/);
    assert.ok(!init.body.includes('private-notes'));
    assert.ok(!init.body.includes('person-id'));
    const output = [{ content: [{ type: 'output_text', text: '{"indices":[2,0,1]}' }] }];
    return new Response(JSON.stringify({ output }));
  };
  const synthetic = { ...row, name: 'person-id', note: 'private-notes' };
  assert.equal((await summarize(synthetic, [], true, 'fake', model)).mode, 'openai-prioritized');
  const noCall = async () => assert.fail('Should not call AI for manual data.');
  assert.equal((await summarize({ ...row, source: 'manual' }, [], true, 'fake', noCall)).mode, 'local');
  assert.equal((await summarize(row, [], true, '', model)).mode, 'local');
  const invalid = async () => new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: '{"indices":[1,1,99]}' }] }] }));
  assert.equal((await summarize(row, [], true, 'fake', invalid)).mode, 'local');
});

test('historical review summarizes each detector independently and preserves provenance', () => {
  const points = [
    { instrument: 'DosTel1', dose: 3, timestamp: '2022-04-01T23:10:00Z' },
    { instrument: 'DosTel2', dose: 7, timestamp: '2022-04-01T23:10:00Z' },
    { instrument: 'DosTel1', dose: 9, timestamp: '2022-04-01T23:20:00Z' }
  ];
  const data = evidenceSummary({ points, mode: 'snapshot', unit: 'µGy/h', url: 'https://example.test/source' });
  assert.deepEqual(data.instruments.map(({ name, median, peak, count }) => ({ name, median, peak, count })), [
    { name: 'DosTel1', median: 6, peak: 9, count: 2 },
    { name: 'DosTel2', median: 7, peak: 7, count: 1 }
  ]);
  assert.equal(data.mode, 'snapshot');
  assert.equal(evidenceSummary({ mode: 'unavailable', points: [] }), null);
});
