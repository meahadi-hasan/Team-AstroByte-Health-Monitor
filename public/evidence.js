export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[ch]);

export const formatUtc = value => new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC'
}).format(new Date(value)) + ' UTC';

export const modes = {
  fetched: 'Fetched from NASA',
  cache: 'Cached NASA response',
  stale: 'Older cached NASA response',
  snapshot: 'Packaged NASA snapshot',
  unavailable: 'Unavailable'
};

export function evidenceSummary(payload) {
  if (!payload?.points?.length) return null;
  const groups = new Map();
  for (const point of payload.points) {
    if (!groups.has(point.instrument)) groups.set(point.instrument, []);
    groups.get(point.instrument).push(point);
  }
  const instruments = [...groups].map(([name, points]) => {
    const peak = points.reduce((largest, point) => point.dose > largest.dose ? point : largest);
    const ordered = points.map(point => point.dose).sort((a, b) => a - b);
    const middle = Math.floor(ordered.length / 2);
    const median = ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
    return { name, count: points.length, median, peak: peak.dose, peakAt: peak.timestamp };
  });
  return {
    attribution: payload.attribution, mode: payload.mode, fetchedAt: payload.fetchedAt,
    query: payload.query, sourceUrl: payload.snapshotSourceUrl || payload.url,
    count: payload.points.length, unit: payload.unit, instruments
  };
}

export function evidenceMarkup(evidence) {
  if (!evidence) return '<p class="muted">No readings are available for this reference window. Review the crew observation with the evidence on hand.</p>';
  const safe = escapeHtml;
  const range = [evidence.query.from, evidence.query.to].map(formatUtc).map(safe);
  const fetchTime = evidence.fetchedAt ? ` · Retrieved ${safe(formatUtc(evidence.fetchedAt))}` : '';
  return `<div class="evidence-meta"><span class="tag mint">${safe(modes[evidence.mode] || 'NASA data')}</span>
    <span>${safe(evidence.count)} measurements${fetchTime}</span></div>
    <p class="muted">${range[0]} to ${range[1]} · ISS absorbed dose rate (${safe(evidence.unit)})</p>
    <div class="table-wrap"><table class="evidence-table"><thead><tr><th>Instrument</th><th>Median</th><th>Peak</th><th>Peak time</th></tr></thead><tbody>
    ${evidence.instruments.map(item => `<tr><td>${safe(item.name)}</td><td>${item.median.toFixed(2)}</td><td>${item.peak.toFixed(2)}</td><td>${safe(formatUtc(item.peakAt))}</td></tr>`).join('')}
    </tbody></table></div>
    <p>Compare each detector’s peak with its own window median to see whether the highest reading represents the whole window. Use the context to document what you reviewed.</p>
    <p class="muted">Historical ISS reference for the simulation. The crew alert is based on its own observations.</p>
    <a href="${safe(evidence.sourceUrl)}" target="_blank" rel="noopener noreferrer">NASA OSDR RadLab source ↗</a>`;
}
