-- Voyages : un voyage (nom + période) et ses étapes (transport / logement / activité)
CREATE TABLE IF NOT EXISTS trip (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trip_item (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  type TEXT NOT NULL,
  mode TEXT,
  title TEXT,
  from_place TEXT,
  to_place TEXT,
  address TEXT,
  url TEXT,
  description TEXT,
  start_at TEXT,
  end_at TEXT,
  file_key TEXT,
  file_name TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trip_household ON trip (household_id);
CREATE INDEX IF NOT EXISTS idx_trip_item_trip ON trip_item (trip_id);
