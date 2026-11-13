export const metrics = {
  heart_rate: { label: 'Heart rate', unit: 'bpm', min: 20, max: 250, demo: [50, 105] },
  spo2: { label: 'Oxygen saturation', unit: '%', min: 50, max: 100, demo: [94, 100] },
  temperature: { label: 'Temperature', unit: '°C', min: 28, max: 45, demo: [35.5, 38] },
  sleep: { label: 'Sleep duration', unit: 'h', min: 0, max: 24, demo: [6, 12] },
  fatigue: { label: 'Fatigue index', unit: '/ 10', min: 0, max: 10, demo: [0, 6] }
};
export const metricKeys = Object.keys(metrics);
export const now = () => new Date().toISOString();

export class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function field(value, label, max, optional = false) {
  if (optional && (value == null || value === '')) return '';
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) {
    throw new InputError(`${label} must contain ${optional ? 'at most' : '1 to'} ${max} characters.`);
  }
  return value.trim();
}

export function id(value, label = 'ID') {
  if (!/^[1-9]\d{0,14}$/.test(String(value))) throw new InputError(`Invalid ${label}.`);
  return Number(value);
}

export function date(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) {
    throw new InputError(`${label} must be an ISO 8601 UTC timestamp.`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new InputError(`Invalid ${label}.`);
  }
  return new Date(ms).toISOString();
}

export function reading(data) {
  const row = {
    observed_at: date(data.observed_at, 'Observation time'),
    source: data.source,
    note: field(data.note, 'Note', 500, true)
  };
  if (Date.parse(row.observed_at) > Date.now() + 5 * 60_000) {
    throw new InputError('Observation time is more than five minutes in the future.');
  }
  if (!['synthetic', 'manual'].includes(row.source)) throw new InputError('Choose a valid data source.');
  for (const [key, metric] of Object.entries(metrics)) {
    const value = data[key];
    if (value == null || value === '') {
      row[key] = null;
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < metric.min || value > metric.max) {
      throw new InputError(`${metric.label} must be between ${metric.min} and ${metric.max} ${metric.unit}.`);
    }
    row[key] = value;
  }
  if (metricKeys.every(key => row[key] === null)) throw new InputError('Enter at least one measurement.');
  return row;
}

export function evaluate(row) {
  const flags = [];
  for (const [key, { label, unit, demo: [low, high] }] of Object.entries(metrics)) {
    const value = row[key];
    if (value == null || (value >= low && value <= high)) continue;
    flags.push({
      rule: key, severity: 'watch',
      evidence: `${label}: ${value} ${unit}. Demo range: ${low}–${high} ${unit}.`
    });
  }
  if (flags.length >= 2) {
    flags.push({
      rule: 'combined', severity: 'review',
      evidence: `${flags.length} indicators are outside demonstration ranges in the same observation.`
    });
  }
  return flags;
}

export function insightFacts(latest, history) {
  if (!latest) return ['Record an observation to generate a summary.'];
  const flags = evaluate(latest);
  const facts = [
    `The latest ${latest.source === 'synthetic' ? 'synthetic' : 'user-entered'} observation has ${flags.filter(f => f.rule !== 'combined').length} indicators outside the demo ranges.`
  ];
  facts.push(...flags.filter(f => f.rule !== 'combined').map(f => f.evidence));
  for (const key of metricKeys) {
    if (latest[key] == null) continue;
    const samples = history.filter(row => row[key] != null);
    if (samples.length < 3) continue;
    const values = samples.map(row => row[key]).sort((a, b) => a - b);
    const median = (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2;
    facts.push(`${metrics[key].label} is ${latest[key]} ${metrics[key].unit}; the median of ${values.length} earlier same-source readings is ${Number(median.toFixed(2))} ${metrics[key].unit}.`);
  }
  if (flags.length) facts.push('Verify the measurement and record context using established mission procedures.');
  facts.push('Demonstration ranges are unvalidated. This summary provides monitoring context.');
  return facts;
}

export const exportKeys = ['observed_at', 'source', ...metricKeys, 'note'];
export function csvExport(rows) {
  const quote = value => {
    const raw = String(value ?? '');
    const safe = typeof value === 'string' && /^[\s]*[=+\-@\t\r]/.test(raw) ? "'" + raw : raw;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  return [exportKeys.join(','), ...rows.map(row => exportKeys.map(key => quote(row[key])).join(','))].join('\r\n') + '\r\n';
}

export function csvImport(input) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { cell += ch; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else cell += ch;
    } else if (ch === ',' || ch === '\n' || ch === '\r') {
      row.push(cell);
      cell = '';
      closed = false;
      if (ch !== ',') {
        rows.push(row);
        row = [];
        if (ch === '\r' && input[i + 1] === '\n') i++;
      }
    } else if (closed) throw new InputError('Unexpected character after a quoted CSV field.');
    else if (ch === '"' && !cell) quoted = true;
    else if (ch === '"') throw new InputError('Unexpected quote in CSV field.');
    else cell += ch;
  }
  if (quoted) throw new InputError('Unclosed quoted CSV field.');
  if (row.length || cell || closed) rows.push([...row, cell]);
  const columns = rows.shift()?.map(column => column.replace(/^\uFEFF/, '').trim());
  if (!columns || new Set(columns).size !== columns.length || columns.some(key => !exportKeys.includes(key)) ||
      !columns.includes('observed_at') || !columns.includes('source') || !columns.some(key => metricKeys.includes(key))) {
    throw new InputError('CSV headers must include observed_at, source and at least one supported indicator.');
  }
  return rows.filter(values => values.some(Boolean)).map((values, index) => {
    if (values.length !== columns.length) throw new InputError(`CSV row ${index + 2} has the wrong number of fields.`);
    return Object.fromEntries(columns.map((key, i) => [
      key, metricKeys.includes(key) && values[i].trim() !== '' ? Number(values[i]) : values[i].trim() === '' && metricKeys.includes(key) ? null : values[i]
    ]));
  });
}
