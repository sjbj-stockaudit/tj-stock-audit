-- Allow a "storefront" photo type (one or more per visit, mandatory before submitting).
-- SQLite cannot change a CHECK rule in place, so rebuild the table and copy every row.
CREATE TABLE photos_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  tractor_id INTEGER REFERENCES tractors(id) ON DELETE CASCADE,
  accessory_id INTEGER REFERENCES accessories(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('chassis', 'tractor', 'accessory', 'storefront', 'signature', 'other')),
  r2_key TEXT NOT NULL,
  size_bytes INTEGER,
  lat REAL, lng REAL,
  taken_at TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users(id)
);
INSERT INTO photos_new (id, visit_id, tractor_id, accessory_id, kind, r2_key, size_bytes, lat, lng, taken_at, uploaded_by)
  SELECT id, visit_id, tractor_id, accessory_id, kind, r2_key, size_bytes, lat, lng, taken_at, uploaded_by FROM photos;
DROP TABLE photos;
ALTER TABLE photos_new RENAME TO photos;
CREATE INDEX idx_photos_visit ON photos(visit_id);
