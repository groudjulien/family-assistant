-- Versement d'épargne du mariage suivi par membre : sur un même mois, l'un peut
-- avoir versé et pas l'autre. `planned` (0 = mois réalisé) reste la vue mois
-- entier ; on la reprend telle quelle pour les lignes déjà cochées.
ALTER TABLE savings_contribution ADD COLUMN realized_a INTEGER NOT NULL DEFAULT 0;
ALTER TABLE savings_contribution ADD COLUMN realized_b INTEGER NOT NULL DEFAULT 0;

UPDATE savings_contribution SET realized_a = 1, realized_b = 1 WHERE planned = 0;
