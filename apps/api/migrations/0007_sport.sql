-- Suivi sport / bien-être
CREATE TABLE IF NOT EXISTS sport_config (
  member TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  series INTEGER NOT NULL DEFAULT 3,
  pompes INTEGER NOT NULL DEFAULT 2,
  gainage INTEGER NOT NULL DEFAULT 10,
  chaise INTEGER NOT NULL DEFAULT 10,
  corde INTEGER NOT NULL DEFAULT 20
);

CREATE TABLE IF NOT EXISTS sport_entry (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  member TEXT NOT NULL,
  date TEXT NOT NULL,
  sport INTEGER NOT NULL DEFAULT 0,
  boissons INTEGER NOT NULL DEFAULT 0,
  desserts INTEGER NOT NULL DEFAULT 0,
  failed TEXT NOT NULL DEFAULT '[]',
  sessions TEXT NOT NULL DEFAULT '[]'
);
CREATE UNIQUE INDEX IF NOT EXISTS sport_entry_unique ON sport_entry (member, date);
