-- Villes suivies pour les activités (modifiables dans les Réglages)
CREATE TABLE IF NOT EXISTS followed_city (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_followed_city_household ON followed_city (household_id);

-- (Le pré-remplissage des villes du foyer d'origine a été retiré : la liste
-- se gère dans Réglages → Activités.)
