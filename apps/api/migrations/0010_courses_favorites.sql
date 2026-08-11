-- Quantité sur les articles + produits favoris (réordonnables)
ALTER TABLE shopping_item ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS shopping_favorite (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shopping_favorite_household ON shopping_favorite (household_id);
