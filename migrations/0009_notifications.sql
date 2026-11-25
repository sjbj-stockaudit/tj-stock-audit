-- Notifications (in-app list + phone alerts) and reach-by times on the weekly plan

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at);

-- Phones that receive alerts (Firebase registration tokens)
CREATE TABLE device_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  platform TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_device_tokens_user ON device_tokens(user_id);

ALTER TABLE plans ADD COLUMN reach_by TEXT;              -- 'HH:MM'; NULL = 10:00
ALTER TABLE plans ADD COLUMN notified_auditor_id INTEGER; -- auditor last told about this line
ALTER TABLE plans ADD COLUMN reminded_eve_at TEXT;
ALTER TABLE plans ADD COLUMN reminded_day_at TEXT;
ALTER TABLE plans ADD COLUMN late_alerted_at TEXT;
