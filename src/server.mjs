import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { InputError, field, id, date, reading, csvImport, csvExport, now, metrics } from './domain.mjs';
import { openStore, transaction, addReading, seedDemo, verifyPassword, hashPassword, hashToken, audit } from './store.mjs';
import { radlabQuery, referenceWindow, createRadiationService } from './radlab.mjs';
import { summarize } from './insights.mjs';
import { evidenceSummary } from '../public/evidence.js';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/workspace.html', ['workspace.html', 'text/html; charset=utf-8']],
  ['/demo.html', ['demo.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/hero.js', ['hero.js', 'text/javascript; charset=utf-8']],
  ['/demo.js', ['demo.js', 'text/javascript; charset=utf-8']],
  ['/scenarios.js', ['scenarios.js', 'text/javascript; charset=utf-8']],
  ['/evidence.js', ['evidence.js', 'text/javascript; charset=utf-8']],
  ['/domain.mjs', ['../src/domain.mjs', 'text/javascript; charset=utf-8']],
  ['/iss-cupola.webp', ['iss-cupola.webp', 'image/webp']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/mark.svg', ['mark.svg', 'image/svg+xml']]
].map(([route, [file, type]]) => [route, { type, bytes: readFileSync(new URL('../public/' + file, import.meta.url)) }]));
const maxBody = 512 * 1024;
const cookieName = 'astrobyte_session';
const sessionLifetime = 8 * 3_600_000;
const usernamePattern = /^[a-z0-9][a-z0-9_.-]{2,47}$/;

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function body(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new InputError('Use application/json.', 415);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxBody) {
      req.resume();
      throw new InputError('Request exceeds 512 KiB.', 413);
    }
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new InputError('Send a valid JSON object.'); }
}

function filters(url) {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const source = url.searchParams.get('source');
  if (source && !['manual', 'synthetic'].includes(source)) throw new InputError('Invalid data source filter.');
  const start = from ? date(from, 'Start time') : '';
  const end = to ? date(to, 'End time') : '';
  if (start && end && start >= end) throw new InputError('End must be later than start.');
  return { start, end, source: source || '' };
}

function filterReadings(db, crewId, { start, end, source }, cap = 501) {
  const predicates = ['crew_id=?'];
  const values = [crewId];
  for (const [value, predicate] of [[start, 'observed_at>=?'], [end, 'observed_at<?'], [source, 'source=?']]) {
    if (value) { predicates.push(predicate); values.push(value); }
  }
  return db.prepare(`SELECT * FROM readings WHERE ${predicates.join(' AND ')} ORDER BY observed_at DESC LIMIT ?`)
    .all(...values, cap);
}

function assertRole(user, ...roles) {
  if (!roles.includes(user.role)) throw new InputError('Your role does not allow this action.', 403);
}

function findCrew(db, user, value) {
  const crewId = id(value, 'crew member');
  if (user.role === 'crew' && user.crew_id !== crewId) throw new InputError('Crew record was not found.', 404);
  const row = db.prepare('SELECT * FROM crew WHERE id=?').get(crewId);
  if (!row) throw new InputError('Crew record was not found.', 404);
  return row;
}

function routeId(path, pattern) {
  const match = path.match(pattern);
  return match ? id(match[1]) : null;
}

function clientIp(req, config) {
  if (!config.proxy) return req.socket.remoteAddress || 'unknown';
  return req.headers['x-forwarded-for']?.split(',').at(-1)?.trim() || req.socket.remoteAddress || 'unknown';
}

export function createApp(config) {
  const { db } = config;
  if (config.demo) seedDemo(db);
  const getRadiation = createRadiationService(db, config.nasaFetch);
  const limits = new Map();
  const guard = (key, limit, duration) => {
    const time = Date.now();
    if (limits.size >= 4096) {
      for (const [entry, value] of limits) if (value.until <= time) limits.delete(entry);
      if (limits.size >= 4096 && !limits.has(key)) throw new InputError('Too many requests. Try again later.', 429);
    }
    const entry = limits.get(key);
    if (!entry || entry.until <= time) limits.set(key, { until: time + duration, count: 1 });
    else if (++entry.count > limit) throw new InputError('Too many requests. Try again later.', 429);
  };
  const cookie = (value, seconds) => `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${config.secure ? '; Secure' : ''}`;
  const getToken = req => (req.headers.cookie || '').match(/(?:^|;\s*)astrobyte_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  const currentUser = token => token && db.prepare(`SELECT u.id,u.username,u.role,u.crew_id
    FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?`).get(hashToken(token), Date.now());
  const login = (res, user, previousToken) => {
    const token = randomBytes(32).toString('hex');
    transaction(db, () => {
      db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
      if (previousToken) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(previousToken));
      db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hashToken(token), user.id, Date.now() + sessionLifetime);
      audit(db, user.id, 'session.start');
    });
    res.setHeader('Set-Cookie', cookie(token, sessionLifetime / 1000));
    return json(res, { user: { id: user.id, username: user.username, role: user.role, crew_id: user.crew_id } });
  };

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const method = req.method;
    if (method === 'GET' && assets.has(path)) {
      const asset = assets.get(path);
      res.writeHead(200, { 'Content-Type': asset.type, 'Cache-Control': 'no-cache' });
      return res.end(asset.bytes);
    }
    if (method === 'GET' && path === '/healthz') return json(res, { ok: db.prepare('SELECT 1 AS ok').get().ok === 1 });
    if (!path.startsWith('/api/')) throw new InputError('Page not found.', 404);
    const ip = clientIp(req, config);
    guard(`general:${ip}`, 280, 60_000);
    if (!['GET', 'HEAD'].includes(method)) {
      const origin = req.headers.origin;
      const allowed = config.origin || `${config.secure ? 'https' : 'http'}://${req.headers.host}`;
      if ((origin && origin !== allowed) || ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) {
        throw new InputError('Cross-origin write blocked.', 403);
      }
    }
    if (method === 'GET' && path === '/api/demo/radiation') {
      guard(`demo-evidence:${ip}`, 20, 60_000);
      return json(res, await getRadiation(referenceWindow));
    }
    const token = getToken(req);
    const user = currentUser(token);
    if (method === 'GET' && path === '/api/session') return json(res, { user: user || null, demo: Boolean(config.demo) });
    if (method === 'POST' && path === '/api/login') {
      guard(`login:${ip}`, 12, 600_000);
      const data = await body(req);
      const username = field(data.username, 'Username', 48).toLowerCase();
      const password = field(data.password, 'Password', 256, true);
      const account = db.prepare('SELECT * FROM users WHERE username=?').get(username);
      if (!(await verifyPassword(password, account?.password_hash))) throw new InputError('Incorrect username or password.', 401);
      return login(res, account, token);
    }
    if (method === 'POST' && path === '/api/demo' && config.demo) {
      guard(`demo:${ip}`, 20, 600_000);
      db.prepare("INSERT OR IGNORE INTO users(username,password_hash,role) VALUES ('training-demo','','admin')").run();
      return login(res, db.prepare("SELECT * FROM users WHERE username='training-demo'").get(), token);
    }
    if (!user) throw new InputError('Sign in to access mission records.', 401);
    if (method === 'POST' && path === '/api/logout') {
      db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
      res.setHeader('Set-Cookie', cookie('', 0));
      return json(res, { ok: true });
    }
    if (method === 'GET' && path === '/api/catalog') {
      const crew = user.role === 'crew' ? db.prepare('SELECT * FROM crew WHERE id=?').all(user.crew_id) :
        db.prepare('SELECT * FROM crew ORDER BY id').all();
      const missions = user.role === 'crew' ? db.prepare('SELECT * FROM missions WHERE id=?').all(crew[0].mission_id) :
        db.prepare('SELECT * FROM missions ORDER BY id').all();
      return json(res, { crew, missions, metrics, radiation: referenceWindow, demo: Boolean(config.demo) });
    }
    const missionId = routeId(path, /^\/api\/missions\/(\d+)$/);
    if ((method === 'POST' && path === '/api/missions') || (method === 'PATCH' && missionId)) {
      assertRole(user, 'admin');
      const data = await body(req);
      const values = [field(data.name, 'Mission name', 90), field(data.environment, 'Environment', 110), field(data.objective, 'Objective', 500, true)];
      const target = transaction(db, () => {
        if (missionId && !db.prepare('UPDATE missions SET name=?,environment=?,objective=? WHERE id=?').run(...values, missionId).changes) {
          throw new InputError('Mission not found.', 404);
        }
        const targetId = missionId || Number(db.prepare('INSERT INTO missions(name,environment,objective) VALUES (?,?,?)').run(...values).lastInsertRowid);
        audit(db, user.id, missionId ? 'mission.update' : 'mission.create', targetId);
        return targetId;
      });
      return json(res, { id: target }, missionId ? 200 : 201);
    }
    const crewId = routeId(path, /^\/api\/crew\/(\d+)$/);
    if ((method === 'POST' && path === '/api/crew') || (method === 'PATCH' && crewId)) {
      assertRole(user, 'admin');
      const data = await body(req);
      const mission = id(data.mission_id, 'mission');
      if (!db.prepare('SELECT 1 FROM missions WHERE id=?').get(mission)) throw new InputError('Select an existing mission.');
      const values = [field(data.name, 'Crew name', 90), field(data.position, 'Position', 90), mission];
      const target = transaction(db, () => {
        if (crewId && !db.prepare('UPDATE crew SET name=?,position=?,mission_id=? WHERE id=?').run(...values, crewId).changes) {
          throw new InputError('Crew record was not found.', 404);
        }
        const targetId = crewId || Number(db.prepare('INSERT INTO crew(name,position,mission_id) VALUES (?,?,?)').run(...values).lastInsertRowid);
        audit(db, user.id, crewId ? 'crew.update' : 'crew.create', targetId);
        return targetId;
      });
      return json(res, { id: target }, crewId ? 200 : 201);
    }
    if (method === 'GET' && ['/api/readings', '/api/export'].includes(path)) {
      const crew = findCrew(db, user, url.searchParams.get('crew'));
      const cap = path === '/api/export' ? 5000 : 500;
      const records = filterReadings(db, crew.id, filters(url), cap + 1);
      if (path === '/api/readings') return json(res, { records: records.slice(0, cap), truncated: records.length > cap });
      if (records.length > cap) throw new InputError('Narrow the date range to export up to 5,000 observations.');
      const format = url.searchParams.get('format');
      if (!['csv','json'].includes(format)) throw new InputError('Choose CSV or JSON.');
      res.setHeader('Content-Disposition', `attachment; filename="astrobyte-crew-${crew.id}.${format}"`);
      if (format === 'json') {
        const rows = records.map(({ entered_by, updated_at, crew_id, id, revision, ...row }) => row);
        return json(res, { crew: { id: crew.id, name: crew.name }, readings: rows });
      }
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(csvExport(records));
    }
    const readingId = routeId(path, /^\/api\/readings\/(\d+)$/);
    if ((method === 'POST' && path === '/api/readings') || (method === 'PATCH' && readingId)) {
      const data = await body(req);
      const current = readingId ? db.prepare('SELECT * FROM readings WHERE id=?').get(readingId) : null;
      if (readingId && !current) throw new InputError('Observation not found.', 404);
      const crew = findCrew(db, user, current?.crew_id ?? data.crew_id);
      if (current && user.role === 'crew' && current.entered_by !== user.id) throw new InputError('You can edit observations you entered.', 403);
      if (current && data.revision !== current.revision) throw new InputError('The observation changed. Reload and try again.', 409);
      const row = reading(data);
      const target = transaction(db, () => {
        const targetId = addReading(db, crew.id, row, user.id, readingId);
        audit(db, user.id, readingId ? 'reading.update' : 'reading.create', targetId);
        return targetId;
      });
      return json(res, { id: target }, readingId ? 200 : 201);
    }
    if (method === 'POST' && path === '/api/import') {
      const data = await body(req);
      const crew = findCrew(db, user, data.crew_id);
      const rows = data.format === 'csv' && typeof data.payload === 'string' ? csvImport(data.payload) :
        data.format === 'json' ? (Array.isArray(data.payload) ? data.payload : data.payload?.readings) : null;
      if (!Array.isArray(rows) || rows.length < 1 || rows.length > 250) throw new InputError('Import 1–250 observations as CSV or JSON.');
      const validated = rows.map((row, index) => {
        try {
          if (!row || typeof row !== 'object' || Array.isArray(row)) throw new InputError('Observation must be an object.');
          return reading(row);
        } catch (error) {
          throw new InputError(`Observation ${index + 1}: ${error.message}`);
        }
      });
      transaction(db, () => {
        for (const row of validated) addReading(db, crew.id, row, user.id);
        audit(db, user.id, 'reading.import', crew.id);
      });
      return json(res, { count: rows.length }, 201);
    }
    if (method === 'GET' && path === '/api/alerts') {
      const crew = findCrew(db, user, url.searchParams.get('crew'));
      const state = url.searchParams.get('state') || '';
      if (state && !['open', 'acknowledged', 'resolved', 'withdrawn'].includes(state)) throw new InputError('Invalid alert state.');
      const alerts = db.prepare(`SELECT a.*, r.observed_at, r.source FROM alerts a JOIN readings r ON r.id=a.reading_id
        WHERE r.crew_id=? ${state ? 'AND a.state=?' : ''} ORDER BY r.observed_at DESC, CASE a.severity WHEN 'review' THEN 0 ELSE 1 END, a.id LIMIT 201`)
        .all(crew.id, ...(state ? [state] : []));
      return json(res, { alerts: alerts.slice(0, 200), truncated: alerts.length > 200 });
    }
    const evidenceAlertId = routeId(path, /^\/api\/alerts\/(\d+)\/evidence$/);
    if (method === 'GET' && evidenceAlertId) {
      const alert = db.prepare(`SELECT r.crew_id,r.source FROM alerts a JOIN readings r ON r.id=a.reading_id
        WHERE a.id=?`).get(evidenceAlertId);
      if (!alert) throw new InputError('Alert not found.', 404);
      findCrew(db, user, alert.crew_id);
      if (alert.source !== 'synthetic') throw new InputError('Historical reference is available for simulated observations.', 422);
      guard(`nasa:${user.id}`, 20, 60_000);
      return json(res, await getRadiation(referenceWindow));
    }
    const alertId = routeId(path, /^\/api\/alerts\/(\d+)$/);
    if (alertId && ['GET', 'PATCH'].includes(method)) {
      const alert = db.prepare('SELECT a.*,r.crew_id,r.source FROM alerts a JOIN readings r ON r.id=a.reading_id WHERE a.id=?').get(alertId);
      if (!alert) throw new InputError('Alert not found.', 404);
      findCrew(db, user, alert.crew_id);
      if (method === 'GET') {
        const followups = db.prepare('SELECT state,note,created_at,radiation_evidence FROM followups WHERE alert_id=? ORDER BY id')
          .all(alertId).map(({ radiation_evidence, ...entry }) => ({ ...entry, evidence: radiation_evidence ? JSON.parse(radiation_evidence) : null }));
        return json(res, { alert, followups });
      }
      const data = await body(req);
      const note = field(data.note, 'Follow-up note', 500);
      const transitions = { open: ['open', 'acknowledged', 'resolved'], acknowledged: ['acknowledged', 'resolved'], resolved: ['resolved'], withdrawn: [] };
      if (!transitions[alert.state].includes(data.state)) throw new InputError('This alert status change is unavailable.', 409);
      if (data.state === 'resolved' && alert.state !== 'resolved') assertRole(user, 'admin', 'reviewer');
      let evidence = null;
      if (data.attach_context === true) {
        if (alert.source !== 'synthetic') throw new InputError('Historical reference can only be attached to a simulated observation.', 422);
        guard(`nasa:${user.id}`, 20, 60_000);
        evidence = evidenceSummary(await getRadiation(referenceWindow));
        if (!evidence) throw new InputError('NASA evidence is unavailable. Save the note without an attachment or retry later.', 422);
      }
      const timestamp = now();
      transaction(db, () => {
        if (!db.prepare('UPDATE alerts SET state=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?').run(data.state, timestamp, alertId, data.revision ?? 0).changes) {
          throw new InputError('The alert changed. Reload and try again.', 409);
        }
        db.prepare('INSERT INTO followups(alert_id,actor,state,note,created_at,radiation_evidence) VALUES (?,?,?,?,?,?)')
          .run(alertId, user.id, data.state, note, timestamp, evidence ? JSON.stringify(evidence) : null);
        audit(db, user.id, 'alert.followup', alertId);
      });
      return json(res, { ok: true });
    }
    if (method === 'GET' && path === '/api/radiation') {
      guard(`nasa:${user.id}`, 20, 60_000);
      return json(res, await getRadiation(radlabQuery(Object.fromEntries(url.searchParams)), url.searchParams.get('refresh') === '1'));
    }
    if (method === 'POST' && path === '/api/insights') {
      guard(`insights:${user.id}`, 20, 60_000);
      const data = await body(req);
      const crew = findCrew(db, user, data.crew_id);
      const selected = filterReadings(db, crew.id, { start: '', end: '', source: '' }, 1)[0];
      const history = selected ? db.prepare(`SELECT * FROM readings WHERE crew_id=? AND source=? AND observed_at<?
        ORDER BY observed_at DESC LIMIT 14`).all(crew.id, selected.source, selected.observed_at) : [];
      return json(res, await summarize(selected, history, data.external === true, config.apiKey, config.aiFetch));
    }
    if (path === '/api/accounts' && ['GET','POST'].includes(method)) {
      assertRole(user, 'admin');
      if (method === 'GET') return json(res, { accounts: db.prepare('SELECT id,username,role,crew_id FROM users ORDER BY id').all() });
      guard(`accounts:${user.id}`, 15, 60_000);
      const data = await body(req);
      const username = field(data.username, 'Username', 48).toLowerCase();
      const password = field(data.password, 'Password', 256);
      if (!usernamePattern.test(username) || username === 'training-demo') throw new InputError('Use 3–48 letters, digits, dots, underscores or dashes for the username.');
      if (password.length < 12) throw new InputError('Use a password of at least 12 characters.');
      if (!['admin', 'reviewer', 'crew'].includes(data.role)) throw new InputError('Choose a valid role.');
      const linkedCrew = data.role === 'crew' ? findCrew(db, user, data.crew_id).id : null;
      const passwordHash = await hashPassword(password);
      const account = transaction(db, () => {
        const target = Number(db.prepare('INSERT INTO users(username,password_hash,role,crew_id) VALUES (?,?,?,?)')
          .run(username, passwordHash, data.role, linkedCrew).lastInsertRowid);
        audit(db, user.id, 'account.create', target);
        return target;
      });
      return json(res, { id: account }, 201);
    }
    if (method === 'GET' && path === '/api/audit') {
      assertRole(user, 'admin');
      return json(res, { events: db.prepare(`SELECT a.id,a.event,a.target,a.created_at,u.username
        FROM audit a LEFT JOIN users u ON a.actor=u.id ORDER BY a.id DESC LIMIT 100`).all() });
    }
    throw new InputError('Endpoint not found.', 404);
  }

  return createServer({ requestTimeout: 20_000, headersTimeout: 10_000 }, (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
    if (config.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    handler(req, res).catch(error => {
      if (res.headersSent) return res.destroy();
      if (error instanceof InputError) {
        if (error.status === 429) res.setHeader('Retry-After', '60');
        return json(res, { error: error.message }, error.status);
      }
      if (error.code === 'ERR_SQLITE_ERROR' && [1555, 2067].includes(error.errcode)) {
        return json(res, { error: 'A record already exists with this username or crew observation time.' }, 409);
      }
      console.error('Request failed', error.code || error.name);
      return json(res, { error: 'The server could not complete the request.' }, 500);
    });
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { values } = parseArgs({ options: { host: { type: 'string' }, port: { type: 'string' }, strictPort: { type: 'boolean' }, training: { type: 'boolean' } } });
  const port = Number(values.port || process.env.PORT || 3000);
  const host = values.host || process.env.HOST || '127.0.0.1';
  const production = process.env.NODE_ENV === 'production';
  const demo = Boolean(values.training) || process.env.DEMO_MODE === '1';
  const origin = process.env.APP_ORIGIN;
  if (production && (demo || !origin || new URL(origin).protocol !== 'https:' || new URL(origin).origin !== origin)) {
    throw new Error('Production requires APP_ORIGIN=https://your-domain and demo mode disabled.');
  }
  const db = openStore(process.env.DB_PATH || (demo ? './var/training.sqlite' : undefined));
  const server = createApp({ db, demo, origin, secure: production, proxy: process.env.TRUST_PROXY === '1', apiKey: process.env.OPENAI_API_KEY });
  server.listen(port, host, () => console.log(`AstroByte Health Monitor listening at http://${host}:${port}`));
  for (const signal of ['SIGTERM','SIGINT']) process.once(signal, () => server.close(() => db.close()));
}
