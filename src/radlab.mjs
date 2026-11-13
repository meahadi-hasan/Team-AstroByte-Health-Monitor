import { readFileSync } from 'node:fs';
import { date, InputError, now } from './domain.mjs';

export const radlabDocumentation = 'https://visualization.osdr.nasa.gov/radlab/gui/data-api/';
export const referenceWindow = { from: '2022-04-01T23:00:00.000Z', to: '2022-04-02T01:05:00.000Z', instrument: 'DosTel' };
const base = 'https://visualization.osdr.nasa.gov/radlab/api/';
const snapshot = JSON.parse(readFileSync(new URL('../data/radlab-iss-dostel.json', import.meta.url), 'utf8'));
const snapshotMetadata = JSON.parse(readFileSync(new URL('../data/radlab-iss-dostel.metadata.json', import.meta.url), 'utf8'));

export function radlabQuery(query) {
  const from = date(query.from || referenceWindow.from, 'Radiation start');
  const to = date(query.to || referenceWindow.to, 'Radiation end');
  const instrument = query.instrument || referenceWindow.instrument;
  if (!['DosTel', 'DosTel1', 'DosTel2'].includes(instrument)) throw new InputError('Choose a supported ISS instrument.');
  if (!from.endsWith('.000Z') || !to.endsWith('.000Z')) throw new InputError('Radiation interval must use whole seconds.');
  if (to <= from || Date.parse(to) - Date.parse(from) > 86_400_000 || Date.parse(to) > Date.now()) {
    throw new InputError('Choose a historical UTC interval of up to 24 hours.');
  }
  return { from, to, instrument };
}

export function sourceUrl({ from, to, instrument }) {
  const timestamp = value => encodeURIComponent(value.slice(0, value.slice(17, 19) === '00' ? 16 : 19));
  return `${base}?spacecraft=ISS&instrument=${instrument}&timestamp%3E=${timestamp(from)}&timestamp%3C${timestamp(to)}&absorbed_dose_rate&format=json`;
}

export function normalizeRadlab(payload, query) {
  const rows = Array.isArray(payload) ? payload : payload?.data;
  if (!Array.isArray(rows)) throw new Error('Unsupported NASA data response.');
  const columns = Array.isArray(payload?.columns) ? payload.columns : null;
  if (rows.some(Array.isArray) && (!columns || !['timestamp','instrument_id','absorbed_dose_rate'].every(key => columns.includes(key)))) {
    throw new Error('NASA array response is missing required column names.');
  }
  const points = new Map();
  for (const item of rows) {
    const row = Array.isArray(item) ? Object.fromEntries(columns.map((column, index) => [column, item[index]])) : item;
    if (!row || typeof row !== 'object') continue;
    const instrument = row.instrument_id;
    if (!['DosTel1', 'DosTel2'].includes(instrument) || (query.instrument !== 'DosTel' && query.instrument !== instrument)) continue;
    if (row.spacecraft && row.spacecraft !== 'ISS') continue;
    let timestamp;
    try {
      const raw = row.timestamp;
      if (typeof raw !== 'string') continue;
      timestamp = date(raw.endsWith('Z') ? raw : raw + 'Z', 'NASA timestamp');
    } catch { continue; }
    const rawDose = row.absorbed_dose_rate;
    const dose = typeof rawDose === 'number' || (typeof rawDose === 'string' && rawDose.trim()) ? Number(rawDose) : NaN;
    if (timestamp < query.from || timestamp >= query.to || !Number.isFinite(dose) || dose < 0) continue;
    points.set(timestamp + instrument, { timestamp, instrument, dose });
  }
  if (rows.length && !points.size) throw new Error('NASA returned rows, but none matched the expected fields and interval.');
  return [...points.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.instrument.localeCompare(b.instrument));
}

export function createRadiationService(db, fetcher = fetch) {
  const inFlight = new Map();
  async function lookup(query, refresh) {
    const url = sourceUrl(query);
    const cache = db.prepare('SELECT fetched_at,payload FROM radlab_cache WHERE query_key=?').get(url);
    const result = (points, fetchedAt, mode, message = null) => ({
      points, fetchedAt, mode, message, query, url, unit: 'µGy/h', historical: true,
      attribution: 'NASA OSDR RadLab · ISS DosTel', documentation: radlabDocumentation
    });
    if (!refresh && cache && Date.now() - Date.parse(cache.fetched_at) < 6 * 3_600_000) {
      return result(JSON.parse(cache.payload), cache.fetched_at, 'cache');
    }
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(12_000), headers: { Accept: 'application/json' }, redirect: 'error' });
      if (!response.ok) throw new Error(`RadLab HTTP ${response.status}`);
      const points = normalizeRadlab(await response.json(), query);
      const fetchedAt = now();
      db.prepare(`INSERT INTO radlab_cache VALUES (?,?,?)
        ON CONFLICT(query_key) DO UPDATE SET fetched_at=excluded.fetched_at,payload=excluded.payload`).run(url, fetchedAt, JSON.stringify(points));
      db.prepare('DELETE FROM radlab_cache WHERE query_key IN (SELECT query_key FROM radlab_cache ORDER BY fetched_at DESC LIMIT -1 OFFSET 100)').run();
      return result(points, fetchedAt, 'fetched');
    } catch {
      const message = 'NASA RadLab could not be reached or returned an unusable response.';
      if (cache) return result(JSON.parse(cache.payload), cache.fetched_at, 'stale', message);
      if (query.from >= referenceWindow.from && query.to <= referenceWindow.to) {
        const saved = result(normalizeRadlab(snapshot, query), snapshotMetadata.retrievedAt, 'snapshot', message);
        return { ...saved, snapshotSourceUrl: snapshotMetadata.sourceUrl };
      }
      return result([], null, 'unavailable', message);
    }
  }
  return (query, refresh = false) => {
    const key = sourceUrl(query);
    if (!inFlight.has(key)) inFlight.set(key, lookup(query, refresh).finally(() => inFlight.delete(key)));
    return inFlight.get(key);
  };
}
