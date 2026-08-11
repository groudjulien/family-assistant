CREATE TABLE trip_expense (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  label TEXT NOT NULL,
  amount INTEGER NOT NULL,
  paid_by TEXT NOT NULL,
  share_a INTEGER NOT NULL DEFAULT 0,
  share_b INTEGER NOT NULL DEFAULT 0,
  date TEXT NOT NULL,
  pushed_at TEXT,
  created_at TEXT NOT NULL
);
