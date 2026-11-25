-- Blind count: the auditor records what is physically shown; the system matches it to the stock list.

-- What the auditor actually saw for each tractor (inventory rows are filled in when matched)
ALTER TABLE tractors ADD COLUMN seen_engine TEXT;
ALTER TABLE tractors ADD COLUMN meter_reading REAL;
ALTER TABLE tractors ADD COLUMN meter_unit TEXT;          -- 'km' or 'hours'
ALTER TABLE tractors ADD COLUMN location_id INTEGER;      -- NULL = at the centre, else an off-site location
ALTER TABLE tractors ADD COLUMN seen_at TEXT;
ALTER TABLE tractors ADD COLUMN chassis_key TEXT;         -- normalised chassis actually seen (links weeks together)
ALTER TABLE tractors ADD COLUMN related_id INTEGER;       -- stock row this extra resembles (office only)
ALTER TABLE tractors ADD COLUMN related_reason TEXT;      -- 'near_chassis' | 'same_plate'
ALTER TABLE tractors ADD COLUMN retyped INTEGER;          -- 1 = auditor re-typed the chassis after a typo warning
CREATE INDEX idx_tractors_chassis_key ON tractors(chassis_key);

-- Count finished, tractors not shown, and the manager's explanation / declaration
ALTER TABLE visits ADD COLUMN count_done_at TEXT;
ALTER TABLE visits ADD COLUMN pending_at_count INTEGER;
ALTER TABLE visits ADD COLUMN missing_explanation TEXT;
ALTER TABLE visits ADD COLUMN manager_phone TEXT;

-- Other places where the centre says tractors are kept (yard, service centre…)
CREATE TABLE visit_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT,
  address TEXT,
  lat REAL, lng REAL, accuracy REAL,
  distance_m REAL,
  arrived_at TEXT NOT NULL
);
CREATE INDEX idx_visit_locations_visit ON visit_locations(visit_id);

ALTER TABLE photos ADD COLUMN location_id INTEGER;
