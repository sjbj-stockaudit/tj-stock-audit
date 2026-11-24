-- 1) Planner login (plans which centre is audited on which date, by whom).
--    Stored as role 'auditor' + access 'planner' so the users table does not need rebuilding
--    (D1 cannot rebuild a table that other tables reference). The app treats it as its own role
--    "planner"; a planner is never assigned audits, so it can never see audit data.
ALTER TABLE users ADD COLUMN access TEXT;

-- 2) Weekly audit plan: one row per centre per date
CREATE TABLE plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_date TEXT NOT NULL,
  centre_id INTEGER NOT NULL REFERENCES centres(id),
  auditor_id INTEGER REFERENCES users(id),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  updated_at TEXT,
  UNIQUE (plan_date, centre_id)
);
CREATE INDEX idx_plans_date ON plans(plan_date);

-- A week (Monday date) approved and locked by the administrator
CREATE TABLE plan_weeks (
  week_start TEXT PRIMARY KEY,
  locked_at TEXT,
  locked_by INTEGER REFERENCES users(id)
);

-- 3) "Centre closed / could not audit": the visit is recorded with a reason instead of a stock check
ALTER TABLE visits ADD COLUMN outcome TEXT;        -- NULL = normal audit, 'not_done' = could not be carried out
ALTER TABLE visits ADD COLUMN outcome_reason TEXT;
