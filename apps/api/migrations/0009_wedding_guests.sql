-- Invités du mariage : deux groupes (vendredi / samedi) + présence par jour
CREATE TABLE IF NOT EXISTS wedding_guest (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'famille',        -- famille | amis | temoin
  guest_group TEXT NOT NULL DEFAULT 'vendredi', -- vendredi | samedi
  vendredi INTEGER NOT NULL DEFAULT 0,
  samedi INTEGER NOT NULL DEFAULT 0,
  dimanche INTEGER NOT NULL DEFAULT 0,
  position REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wedding_guest_household ON wedding_guest (household_id);
