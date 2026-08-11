-- Idées repas générées par le LLM + ingrédients exclus du foyer.
CREATE TABLE recipe_idea (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  course TEXT NOT NULL DEFAULT 'plat',
  ingredients TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT NOT NULL
);
ALTER TABLE household ADD COLUMN excluded_ingredients TEXT;
