-- Neutral wording: auditors are grouped by "team"
ALTER TABLE users RENAME COLUMN agency TO team;

-- Auditors must take a live selfie after signing in; a session is unusable until they do.
ALTER TABLE sessions ADD COLUMN selfie_key TEXT;

-- Every sign-in selfie, kept as proof of who used the account.
CREATE TABLE login_selfies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  r2_key TEXT NOT NULL,
  lat REAL,
  lng REAL,
  at TEXT NOT NULL
);
CREATE INDEX idx_login_selfies_user ON login_selfies(user_id, at);

-- Live selfie taken at the centre when checking in: proof the assigned auditor did the audit.
ALTER TABLE visits ADD COLUMN checkin_selfie_key TEXT;

-- Centre details collected from the client (template import)
ALTER TABLE centres ADD COLUMN manager_name TEXT;
ALTER TABLE centres ADD COLUMN manager_phone TEXT;
ALTER TABLE centres ADD COLUMN opening_hours TEXT;
ALTER TABLE centres ADD COLUMN weekly_off TEXT;
