import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { evaluate, now, metricKeys } from './domain.mjs';

const derive = promisify(scrypt);
const columns = ['observed_at', 'source', ...metricKeys, 'note'];

export function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function openStore(path = process.env.DB_PATH || './var/astrobyte.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  const migrations = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(migrations).filter(file => /^\d+_.+\.sql$/.test(file)).sort()) {
    const version = Number(file.split('_')[0]);
    transaction(db, () => {
      if (db.prepare('PRAGMA user_version').get().user_version >= version) return;
      db.exec(readFileSync(new URL(file, migrations), 'utf8'));
      db.exec(`PRAGMA user_version=${version}`);
    });
  }
  return db;
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + (await derive(password, salt, 64)).toString('hex');
}

export async function verifyPassword(password, encoded) {
  const [salt, hash] = (encoded || '0'.repeat(32) + ':' + '0'.repeat(128)).split(':');
  const computed = await derive(password, salt, 64);
  return Boolean(encoded) && timingSafeEqual(computed, Buffer.from(hash, 'hex'));
}

export const hashToken = token => createHash('sha256').update(token).digest('hex');
export function audit(db, actor, event, target = null) {
  db.prepare('INSERT INTO audit(actor,event,target,created_at) VALUES (?,?,?,?)').run(actor, event, target, now());
}

export function addReading(db, crewId, row, actor = null, readingId = null) {
  const updated = now();
  const values = columns.map(key => row[key]);
  if (readingId === null) {
    readingId = Number(db.prepare(`INSERT INTO readings (crew_id,${columns.join(',')},entered_by,updated_at)
      VALUES (${Array(columns.length + 3).fill('?').join(',')})`).run(crewId, ...values, actor, updated).lastInsertRowid);
  } else {
    db.prepare(`UPDATE readings SET ${columns.map(key => key + '=?').join(',')}, updated_at=?, revision=revision+1 WHERE id=?`)
      .run(...values, updated, readingId);
  }
  const flags = evaluate(row);
  const previous = db.prepare('SELECT * FROM alerts WHERE reading_id=?').all(readingId);
  for (const alert of previous) {
    if (!flags.some(flag => flag.rule === alert.rule) && alert.state !== 'withdrawn') {
      db.prepare("UPDATE alerts SET state='withdrawn',updated_at=?,revision=revision+1 WHERE id=?").run(updated, alert.id);
    }
  }
  for (const flag of flags) {
    const existing = previous.find(alert => alert.rule === flag.rule);
    if (!existing) {
      db.prepare('INSERT INTO alerts (reading_id,rule,severity,evidence,updated_at) VALUES (?,?,?,?,?)')
        .run(readingId, flag.rule, flag.severity, flag.evidence, updated);
    } else if (existing.state === 'withdrawn' || existing.evidence !== flag.evidence ||
               (flag.rule === 'combined' && previous.some(alert => alert.rule !== 'combined' &&
                 ((alert.state !== 'withdrawn') !== flags.some(next => next.rule === alert.rule) ||
                   flags.some(next => next.rule === alert.rule && next.evidence !== alert.evidence))))) {
      db.prepare("UPDATE alerts SET severity=?,evidence=?,state='open',updated_at=?,revision=revision+1 WHERE id=?")
        .run(flag.severity, flag.evidence, updated, existing.id);
    }
  }
  return readingId;
}

export function seedDemo(db) {
  transaction(db, () => {
    if (db.prepare('SELECT 1 FROM missions LIMIT 1').get()) return;
    db.prepare('INSERT INTO missions VALUES (1,?,?,?)').run('Aster-07', 'Lunar habitat simulation', 'Evaluate crew self-monitoring across a simulated surface mission.');
    db.prepare('INSERT INTO missions VALUES (2,?,?,?)').run('Horizon-02', 'Low Earth orbit simulation', 'Practice routine observations and shift handovers.');
    const crew = db.prepare('INSERT INTO crew VALUES (?,?,?,?)');
    crew.run(1, 'Maya Chen', 'Mission specialist', 1);
    crew.run(2, 'Alex Rivera', 'Flight engineer', 1);
    crew.run(3, 'Samira Malik', 'Payload specialist', 2);
    const today = new Date();
    today.setUTCHours(8, 0, 0, 0);
    if (+today > Date.now()) today.setUTCDate(today.getUTCDate() - 1);
    for (let crewId = 1; crewId <= 3; crewId++) {
      for (let offset = 13; offset >= 0; offset--) {
        const observedAt = new Date(+today - offset * 86_400_000).toISOString();
        addReading(db, crewId, {
          observed_at: observedAt, source: 'synthetic', heart_rate: 62 + (offset * 7 + crewId * 3) % 21,
          spo2: 96 + offset % 4, temperature: 36.4 + (offset % 5) / 10,
          sleep: crewId === 1 && offset === 0 ? 5.2 : 6.5 + offset % 4 / 2,
          fatigue: crewId === 1 && offset === 0 ? 7 : 1 + offset % 5,
          note: 'Fictional training observation.'
        });
      }
    }
  });
}
