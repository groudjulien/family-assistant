-- Journée de suivi déclarée terminée (« Clôturer la journée »).
-- Une ligne de saisie à zéro est supprimée par l'API — « non saisi » et « zéro »
-- restent distincts — donc la clôture ne peut pas s'écrire dans les logs.
CREATE TABLE IF NOT EXISTS wellness_day_close (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  member TEXT NOT NULL,
  date TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS wellness_day_close_uniq
  ON wellness_day_close (household_id, member, date);
