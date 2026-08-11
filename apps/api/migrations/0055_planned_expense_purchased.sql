-- Dépense prévue « achetée » : date d'achat effectif (NULL = encore prévue).
ALTER TABLE planned_expense ADD COLUMN purchased_at TEXT;
