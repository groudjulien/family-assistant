-- Date de réalisation d'une tâche (tri de l'onglet « Faites »).
ALTER TABLE task ADD COLUMN completed_at TEXT;
-- Backfill : pour les tâches déjà faites, la dernière modification fait foi.
UPDATE task SET completed_at = updated_at WHERE status = 'done';
