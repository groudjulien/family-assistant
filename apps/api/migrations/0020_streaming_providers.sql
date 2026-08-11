-- Plateformes de streaming suivies + âge max enfants (configurables)
ALTER TABLE household ADD COLUMN kids_max_cert TEXT NOT NULL DEFAULT 'U';

CREATE TABLE IF NOT EXISTS streaming_provider (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  tmdb_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0
);

-- (Le pré-remplissage des plateformes du foyer d'origine a été retiré : la
-- liste se gère dans Réglages.)
