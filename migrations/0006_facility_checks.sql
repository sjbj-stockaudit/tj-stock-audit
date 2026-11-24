-- Facility condition checklist: how the centre keeps its stock (one row per area per visit)
CREATE TABLE facility_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  area TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_custom INTEGER NOT NULL DEFAULT 0,
  rating TEXT CHECK (rating IN ('good', 'average', 'poor', 'na')),
  remarks TEXT,
  updated_at TEXT
);
CREATE INDEX idx_facility_visit ON facility_checks(visit_id);

-- Facility photos are stored as kind 'other' linked to their checklist row
ALTER TABLE photos ADD COLUMN facility_id INTEGER REFERENCES facility_checks(id) ON DELETE CASCADE;
