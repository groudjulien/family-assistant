-- Films : favoris + déjà vus (par foyer)
CREATE TABLE IF NOT EXISTS film_favorite (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  audience TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  providers TEXT,
  year TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS film_seen (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_film_favorite_household ON film_favorite (household_id);
CREATE INDEX IF NOT EXISTS idx_film_seen_household ON film_seen (household_id);
