-- Films / activités masqués ("ne plus me proposer")
CREATE TABLE IF NOT EXISTS film_hidden (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  audience TEXT,
  title TEXT,
  image_url TEXT,
  providers TEXT,
  year TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_hidden (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  city TEXT,
  address TEXT,
  start TEXT,
  end TEXT,
  date_label TEXT,
  image_url TEXT,
  url TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_film_hidden_household ON film_hidden (household_id);
CREATE INDEX IF NOT EXISTS idx_activity_hidden_household ON activity_hidden (household_id);
