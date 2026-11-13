import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeRadlab, radlabDocumentation, referenceWindow } from '../src/radlab.mjs';

const destination = resolve(process.argv[2] || 'judge-dist');
mkdirSync(destination, { recursive: true });
const publicDir = new URL('../public/', import.meta.url);
for (const name of ['styles.css', 'mark.svg', 'hero.js', 'demo.js', 'scenarios.js', 'evidence.js']) {
  copyFileSync(new URL(name, publicDir), resolve(destination, name));
}
copyFileSync(new URL('../src/domain.mjs', import.meta.url), resolve(destination, 'domain.mjs'));
for (const name of ['index.html', 'demo.html']) {
  const html = readFileSync(new URL(name, publicDir), 'utf8')
    .replace(/<a class="[^"]*crew-link" href="\/workspace\.html">Crew Sign In<\/a>/g, '')
    .replace('data-radiation-endpoint="/api/demo/radiation"', 'data-radiation-endpoint="/radlab-reference.json"');
  writeFileSync(resolve(destination, name), html);
}

const payload = JSON.parse(readFileSync(new URL('../data/radlab-iss-dostel.json', import.meta.url)));
const metadata = JSON.parse(readFileSync(new URL('../data/radlab-iss-dostel.metadata.json', import.meta.url)));
const points = normalizeRadlab(payload, referenceWindow);
if (!points.length) throw new Error('The bundled RadLab reference is empty.');
writeFileSync(resolve(destination, 'radlab-reference.json'), JSON.stringify({
  points, fetchedAt: metadata.retrievedAt, mode: 'snapshot', query: referenceWindow,
  url: metadata.sourceUrl, unit: 'µGy/h', historical: true,
  attribution: 'NASA OSDR RadLab · ISS DosTel', documentation: radlabDocumentation
}));
console.log(`Judging demo exported with ${points.length} historical NASA measurements.`);
