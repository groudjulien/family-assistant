-- Afficher ou non le compte dans les prévisions de trésorerie (Money → Trésorerie).
ALTER TABLE account ADD COLUMN forecast INTEGER NOT NULL DEFAULT 1;
-- Backfill : comportement historique = l'épargne était exclue des prévisions.
UPDATE account SET forecast = 0 WHERE type = 'savings';
