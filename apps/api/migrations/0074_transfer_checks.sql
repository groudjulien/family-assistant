-- Virements de début de mois : une ligne par virement coché (rien = à faire).
CREATE TABLE IF NOT EXISTS transfer_check (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  month TEXT NOT NULL,
  key TEXT NOT NULL,
  done_at TEXT NOT NULL,
  done_by TEXT NOT NULL
);

-- Un virement ne peut être coché qu'une fois par mois et par foyer.
CREATE UNIQUE INDEX IF NOT EXISTS transfer_check_unique
  ON transfer_check (household_id, month, key);
