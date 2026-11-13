import { once } from 'node:events';
import { openStore } from '../src/store.mjs';
import { createApp } from '../src/server.mjs';

const db = openStore(':memory:');
const server = createApp({ db, demo: true });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
try {
  const local = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(local + '/api/demo', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  });
  if (!session.ok) throw new Error('Could not start a local training session.');
  const cookie = session.headers.get('Set-Cookie').split(';')[0];
  const response = await fetch(local + '/api/radiation?refresh=1', { headers: { Cookie: cookie } });
  const result = await response.json();
  console.log(JSON.stringify({
    status: response.status, mode: result.mode, count: result.points?.length, first: result.points?.at(0),
    last: result.points?.at(-1), fetchedAt: result.fetchedAt, url: result.url, message: result.message
  }, null, 2));
  if (!response.ok || result.mode !== 'fetched' || !result.points.length) process.exitCode = 1;
} finally {
  server.close();
  await once(server, 'close');
  db.close();
}
