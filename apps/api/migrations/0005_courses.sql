-- Courses : liste à acheter + recettes
CREATE TABLE IF NOT EXISTS shopping_item (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipe (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_url TEXT,
  servings INTEGER NOT NULL DEFAULT 4,
  ingredients TEXT NOT NULL,
  steps TEXT NOT NULL,
  created_at TEXT NOT NULL
);
