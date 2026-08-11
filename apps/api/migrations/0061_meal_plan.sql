-- Repas de la semaine : sélection figée de recettes, partagée par le foyer.
CREATE TABLE meal_plan (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL UNIQUE,
  recipe_ids TEXT NOT NULL DEFAULT '[]',
  count INTEGER NOT NULL DEFAULT 5,
  max_prep_minutes INTEGER,
  max_total_minutes INTEGER,
  created_at TEXT NOT NULL
);
