CREATE TABLE wedding_budget_file (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  budget_item_id TEXT NOT NULL,
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_wedding_budget_file_item ON wedding_budget_file (budget_item_id);
