-- Activités mises en favori (snapshot de l'événement OpenAgenda)
CREATE TABLE IF NOT EXISTS activity_favorite (
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

CREATE INDEX IF NOT EXISTS idx_activity_favorite_household ON activity_favorite (household_id);
