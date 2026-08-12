-- Listes libres (menu « Listes ») : partagées au foyer ou personnelles.
-- scope = 'shared' (visible de tout le foyer) | 'personal' (owner_id obligatoire).
CREATE TABLE custom_list (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  owner_id TEXT,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_custom_list_household ON custom_list (household_id, scope, owner_id);

CREATE TABLE custom_list_item (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL,
  label TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_custom_list_item_list ON custom_list_item (list_id);
