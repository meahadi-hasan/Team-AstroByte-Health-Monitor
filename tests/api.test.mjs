import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store.mjs';
import { createApp } from '../src/server.mjs';

async function connect(db, demo) {
  const server = createApp({ db, demo, nasaFetch: async () => { throw new Error('Disabled during HTTP tests'); } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    close: async () => { server.close(); await once(server, 'close'); },
    call: async (path, { method = 'GET', cookie, data, origin, headers = {} } = {}) => {
      const response = await fetch(url + path, { method, headers: {
        ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}),
        ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers
      }, body: data !== undefined ? JSON.stringify(data) : undefined });
      const result = response.headers.get('Content-Type')?.includes('json') ? await response.json() : await response.text();
      return { status: response.status, result, headers: response.headers, cookie: response.headers.get('Set-Cookie')?.split(';')[0] };
    }
  };
}

test('HTTP workflow: session, roles, persistent observation, alerts, reports, and NASA fallback', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'astrobyte-test-'));
  const path = join(folder, 'test.sqlite');
  let db = openStore(path);
  let service = await connect(db, true);
  const assertStatus = (response, expected) => { assert.equal(response.status, expected, JSON.stringify(response.result)); return response; };
  try {
    const home = assertStatus(await service.call('/'), 200);
    assert.match(home.headers.get('Content-Security-Policy'), /object-src 'none'/);
    assert.match(home.result, /id="orbital-scene"/);
    for (const path of ['/hero.js', '/scenarios.js', '/domain.mjs']) {
      assert.match(assertStatus(await service.call(path), 200).headers.get('Content-Type'), /javascript/);
    }
    assertStatus(await service.call('/.env'), 404);
    assertStatus(await service.call('/api/catalog'), 401);
    assertStatus(await service.call('/api/demo', { method: 'POST', data: {}, origin: 'https://other.invalid' }), 403);
    const demo = assertStatus(await service.call('/api/demo', { method: 'POST', data: {} }), 200);
    const admin = demo.cookie;
    assert.match(demo.headers.get('Set-Cookie'), /HttpOnly; SameSite=Strict/);
    const adminCall = (path, options) => service.call(path, { ...options, cookie: admin });
    const mission = assertStatus(await adminCall('/api/missions', { method: 'POST', data: { name: 'Scout', environment: 'Test orbit' } }), 201).result.id;
    const crew = assertStatus(await adminCall('/api/crew', { method: 'POST', data: { name: 'Test crew', position: 'Engineer', mission_id: mission } }), 201).result.id;
    assertStatus(await adminCall('/api/accounts', { method: 'POST', data: { username: 'crew-test', password: 'training pass 123', role: 'crew', crew_id: crew } }), 201);
    assertStatus(await adminCall('/api/accounts', { method: 'POST', data: { username: 'review-test', password: 'review pass 123', role: 'reviewer' } }), 201);
    assertStatus(await service.call('/api/login', { method: 'POST', data: { username: 'crew-test', password: 'wrong' } }), 401);
    const session = assertStatus(await service.call('/api/login', { method: 'POST', data: { username: 'crew-test', password: 'training pass 123' } }), 200);
    const crewCall = (path, options) => service.call(path, { ...options, cookie: session.cookie });
    const reviewer = assertStatus(await service.call('/api/login', { method: 'POST', data: { username: 'review-test', password: 'review pass 123' } }), 200);
    const reviewerCall = (path, options) => service.call(path, { ...options, cookie: reviewer.cookie });
    assert.deepEqual((await crewCall('/api/catalog')).result.crew.map(row => row.id), [crew]);
    assertStatus(await crewCall('/api/readings?crew=1'), 404);
    assertStatus(await crewCall('/api/crew', { method: 'POST', data: {} }), 403);
    assertStatus(await crewCall('/api/accounts'), 403);
    const row = { crew_id: crew, observed_at: '2025-05-20T08:00:00Z', source: 'synthetic', heart_rate: 78, spo2: 92, sleep: 5 };
    const saved = assertStatus(await crewCall('/api/readings', { method: 'POST', data: row }), 201).result.id;
    const listUrl = '/api/readings?crew=' + crew;
    assertStatus(await crewCall('/api/readings', { method: 'POST', data: row }), 409);
    const observation = (await crewCall(listUrl)).result.records[0];
    assert.equal(observation.spo2, 92);
    const handover = assertStatus(await crewCall('/api/insights', { method: 'POST', data: { crew_id: crew } }), 200).result;
    assert.equal(handover.mode, 'local');
    assert.ok(handover.facts.some(fact => fact.includes('Oxygen saturation: 92')));
    const alertList = (await crewCall('/api/alerts?crew=' + crew)).result.alerts;
    assert.equal(alertList.length, 3);
    const alert = alertList.find(item => item.rule === 'combined');
    const pathToEvidence = '/api/alerts/' + alert.id + '/evidence';
    assertStatus(await service.call(pathToEvidence), 401);
    const evidence = assertStatus(await crewCall(pathToEvidence), 200).result;
    assert.equal(evidence.mode, 'snapshot');
    assert.equal(evidence.points.length, 180);
    assert.equal((await service.call('/api/demo/radiation')).result.points.length, 180);
    assertStatus(await service.call('/api/accounts'), 401);
    const follow = { revision: alert.revision, note: 'Checked the synthetic observation.', attach_context: true };
    assertStatus(await crewCall('/api/alerts/' + alert.id, { method: 'PATCH', data: { ...follow, state: 'resolved' } }), 403);
    assertStatus(await crewCall('/api/alerts/' + alert.id, { method: 'PATCH', data: { ...follow, state: 'acknowledged' } }), 200);
    const history = (await crewCall('/api/alerts/' + alert.id)).result.followups;
    assert.equal(history.length, 1);
    assert.equal(history[0].evidence.count, 180);
    assert.equal(history[0].evidence.mode, 'snapshot');
    assert.equal(history[0].evidence.instruments.length, 2);
    assertStatus(await reviewerCall('/api/accounts'), 403);
    const acknowledged = (await reviewerCall('/api/alerts?crew=' + crew)).result.alerts.find(item => item.id === alert.id);
    assert.equal(acknowledged.state, 'acknowledged');
    assertStatus(await reviewerCall('/api/alerts/' + alert.id, {
      method: 'PATCH', data: { revision: acknowledged.revision, state: 'resolved', note: 'Reviewed the attached reference.' }
    }), 200);
    assertStatus(await crewCall('/api/readings/' + saved, { method: 'PATCH', data: { ...row, revision: 0 } }), 409);
    assertStatus(await crewCall('/api/readings/' + saved, { method: 'PATCH', data: { ...row, revision: observation.revision, spo2: 99, sleep: 7 } }), 200);
    assert.equal((await crewCall('/api/alerts?state=withdrawn&crew=' + crew)).result.alerts.length, 3);
    const earlier = { ...row, observed_at: '2025-05-19T08:00:00Z', sleep: 7, spo2: 99 };
    assertStatus(await crewCall('/api/import', { method: 'POST', data: { crew_id: crew, format: 'json', payload: [earlier, row] } }), 409);
    assert.equal((await crewCall(listUrl)).result.records.length, 1);
    assertStatus(await crewCall('/api/import', { method: 'POST', data: { crew_id: crew, format: 'json', payload: [earlier] } }), 201);
    assert.equal((await crewCall(listUrl + '&from=2025-05-20T00:00:00Z')).result.records.length, 1);
    const report = assertStatus(await crewCall('/api/export?crew=' + crew + '&format=json'), 200);
    assert.equal(report.result.readings.length, 2);
    assert.match((await crewCall('/api/export?crew=' + crew + '&format=csv')).result, /observed_at,source,heart_rate/);
    const radiation = assertStatus(await crewCall('/api/radiation'), 200).result;
    assert.equal(radiation.mode, 'snapshot');
    assert.equal(radiation.points.length, 180);
    await service.close();
    db.close();
    db = openStore(path);
    service = await connect(db, false);
    assert.equal((await crewCall(listUrl)).result.records.length, 2);
    assert.equal((await crewCall('/api/session')).result.demo, false);
    assertStatus(await service.call('/api/demo', { method: 'POST', data: {} }), 401);
    assert.equal((await crewCall('/api/alerts/' + alert.id)).result.followups[0].evidence.count, 180);
    assertStatus(await crewCall('/api/logout', { method: 'POST' }), 200);
    assertStatus(await crewCall(listUrl), 401);
    assert.equal((await adminCall('/api/audit')).result.events[0].event, 'reading.import');
  } finally {
    await service.close();
    db.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
