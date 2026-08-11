-- Liste de tâches liées au mariage
CREATE TABLE IF NOT EXISTS wedding_todo (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  description TEXT NOT NULL,
  due_date TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
