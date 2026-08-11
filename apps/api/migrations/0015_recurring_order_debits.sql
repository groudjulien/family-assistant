-- Ordre manuel des dépenses récurrentes + sous-débits (plusieurs débits par dépense)
ALTER TABLE recurring ADD COLUMN position REAL NOT NULL DEFAULT 0;
UPDATE recurring SET position = rowid;

CREATE TABLE IF NOT EXISTS recurring_debit (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  recurring_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL,
  day_of_month INTEGER,
  position REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_recurring_debit_recurring ON recurring_debit (recurring_id);
