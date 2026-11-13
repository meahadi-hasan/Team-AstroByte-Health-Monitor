CREATE TABLE missions (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, environment TEXT NOT NULL, objective TEXT NOT NULL
) STRICT;
CREATE TABLE crew (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, position TEXT NOT NULL,
  mission_id INTEGER NOT NULL REFERENCES missions(id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','reviewer','crew')),
  crew_id INTEGER REFERENCES crew(id) ON DELETE RESTRICT,
  CHECK ((role = 'crew') = (crew_id IS NOT NULL))
) STRICT;
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE TABLE readings (
  id INTEGER PRIMARY KEY, crew_id INTEGER NOT NULL REFERENCES crew(id),
  observed_at TEXT NOT NULL, source TEXT NOT NULL CHECK(source IN ('synthetic','manual')),
  heart_rate REAL, spo2 REAL, temperature REAL, sleep REAL, fatigue REAL, note TEXT NOT NULL,
  entered_by INTEGER REFERENCES users(id), updated_at TEXT NOT NULL,
  UNIQUE(crew_id, observed_at),
  CHECK (coalesce(heart_rate, spo2, temperature, sleep, fatigue) IS NOT NULL)
) STRICT;
CREATE TABLE alerts (
  id INTEGER PRIMARY KEY, reading_id INTEGER NOT NULL REFERENCES readings(id),
  rule TEXT NOT NULL, severity TEXT NOT NULL CHECK(severity IN ('watch','review')),
  evidence TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open'
    CHECK(state IN ('open','acknowledged','resolved','withdrawn')),
  updated_at TEXT NOT NULL, UNIQUE(reading_id, rule)
) STRICT;
CREATE TABLE followups (
  id INTEGER PRIMARY KEY, alert_id INTEGER NOT NULL REFERENCES alerts(id),
  actor INTEGER NOT NULL REFERENCES users(id), state TEXT NOT NULL,
  note TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE audit (
  id INTEGER PRIMARY KEY, actor INTEGER REFERENCES users(id), event TEXT NOT NULL,
  target INTEGER, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE radlab_cache (
  query_key TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, payload TEXT NOT NULL
) STRICT;
CREATE INDEX alerts_state ON alerts(state);
CREATE INDEX followups_alert ON followups(alert_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
