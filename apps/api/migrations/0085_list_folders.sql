-- Dossiers de listes : un niveau, même portée (perso / partagé) que les listes
-- qu'ils rangent. Une liste sans dossier reste à la racine de son onglet.
CREATE TABLE list_folder (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  owner_id TEXT,
  name TEXT NOT NULL,
  emoji TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX list_folder_household_scope ON list_folder (household_id, scope);

ALTER TABLE custom_list ADD COLUMN folder_id TEXT;
