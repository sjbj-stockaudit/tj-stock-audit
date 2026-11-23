-- Users: admin (you), auditor (field staff), client (Tractor Junction, read-only)
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'auditor', 'client')),
  agency TEXT,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE centres (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  state TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  lat REAL,
  lng REAL,
  radius_m INTEGER NOT NULL DEFAULT 300,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (state, name)
);

-- Other names the client's stock sheets use for a centre (e.g. a nearby town)
CREATE TABLE centre_aliases (
  alias TEXT PRIMARY KEY,           -- normalised: lower-case, no spaces/punctuation
  centre_id INTEGER NOT NULL REFERENCES centres(id) ON DELETE CASCADE
);

CREATE TABLE stock_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  audit_date TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One visit = one auditor auditing one centre on one date. This is the billing unit.
CREATE TABLE visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  centre_id INTEGER NOT NULL REFERENCES centres(id),
  auditor_id INTEGER REFERENCES users(id),
  upload_id INTEGER REFERENCES stock_uploads(id),
  audit_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'in_progress', 'submitted', 'approved', 'returned')),
  checkin_at TEXT, checkin_lat REAL, checkin_lng REAL, checkin_accuracy REAL, checkin_distance_m REAL,
  checkout_at TEXT, checkout_lat REAL, checkout_lng REAL,
  manager_name TEXT,
  auditor_signature_key TEXT,
  manager_signature_key TEXT,
  general_remarks TEXT,
  submitted_at TEXT,
  reviewed_at TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_visits_date ON visits(audit_date);
CREATE INDEX idx_visits_auditor ON visits(auditor_id, status);
CREATE INDEX idx_visits_centre ON visits(centre_id);

-- Tractors: rows from the client's stock statement ('inventory') plus tractors found on site that were not listed ('extra')
CREATE TABLE tractors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('inventory', 'extra')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  reg_no TEXT,
  engine_no TEXT,
  chassis_no TEXT,
  verified_reg TEXT,
  verified_chassis TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'mismatch', 'not_found', 'extra')),
  remarks TEXT,
  updated_at TEXT
);
CREATE INDEX idx_tractors_visit ON tractors(visit_id);

CREATE TABLE accessories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  remarks TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_accessories_visit ON accessories(visit_id);

CREATE TABLE photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  tractor_id INTEGER REFERENCES tractors(id) ON DELETE CASCADE,
  accessory_id INTEGER REFERENCES accessories(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('chassis', 'tractor', 'accessory', 'signature', 'other')),
  r2_key TEXT NOT NULL,
  size_bytes INTEGER,
  lat REAL, lng REAL,
  taken_at TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users(id)
);
CREATE INDEX idx_photos_visit ON photos(visit_id);

-- GPS trail recorded between check-in and check-out
CREATE TABLE location_pings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  accuracy REAL,
  at TEXT NOT NULL
);
CREATE INDEX idx_pings_visit ON location_pings(visit_id, at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES
  ('firm_name', 'M/s SJBJ & Associates'),
  ('client_name', 'Tractor Junction');
