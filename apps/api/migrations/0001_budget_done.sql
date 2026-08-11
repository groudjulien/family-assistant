-- Ajoute l'état "validé" sur les postes de budget mariage
ALTER TABLE wedding_budget_item ADD COLUMN done INTEGER NOT NULL DEFAULT 0;
