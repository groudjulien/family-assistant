-- Fin des conventions par nom de compte (« Trade », « épargne ») :
--  - account.is_primary = compte principal de dépenses de son propriétaire
--    (utilisé par la trésorerie pour imputer les dépenses prévues) ;
--  - household.default_account_id = compte proposé par défaut à la création
--    d'une transaction.
ALTER TABLE account ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0;
ALTER TABLE household ADD COLUMN default_account_id TEXT;

-- (Le backfill du foyer d'origine — flags posés d'après les noms de comptes —
-- a été retiré avant publication ; les flags se règlent dans Réglages du compte.)
