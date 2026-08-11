CREATE TABLE IF NOT EXISTS trip_packing_item (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  label TEXT NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trip_packing_trip ON trip_packing_item (trip_id);
ALTER TABLE household ADD COLUMN default_packing TEXT;
