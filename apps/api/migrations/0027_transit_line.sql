CREATE TABLE IF NOT EXISTS transit_line (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  line_code TEXT NOT NULL,
  label TEXT NOT NULL,
  color TEXT NOT NULL,
  station_a TEXT NOT NULL,
  station_b TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'principal',
  position REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transit_line_household ON transit_line (household_id);

-- Pré-remplissage de la configuration existante pour le foyer principal.

-- (Le pré-remplissage des lignes du foyer d'origine a été retiré : la liste
-- se gère dans Réglages → Accueil → Transports.)
