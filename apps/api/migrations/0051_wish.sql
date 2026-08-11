CREATE TABLE IF NOT EXISTS wish (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT,
  description TEXT,
  url TEXT,
  address TEXT,
  date TEXT,
  feasibility TEXT,
  done_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wish_household ON wish (household_id);
