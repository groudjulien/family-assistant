-- Dépenses prévues (anticipées)
CREATE TABLE IF NOT EXISTS planned_expense (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  amount INTEGER NOT NULL,
  date TEXT,
  created_at TEXT NOT NULL
);
