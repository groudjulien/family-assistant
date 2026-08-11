ALTER TABLE wedding_budget_item ADD COLUMN position REAL NOT NULL DEFAULT 0;
-- Ordre initial = ordre d'insertion.
UPDATE wedding_budget_item SET position = rowid;
