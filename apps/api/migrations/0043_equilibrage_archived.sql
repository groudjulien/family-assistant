-- Archivage des dépenses partagées et des remboursements (équilibrage).
-- Une ligne archivée n'entre plus dans le calcul du solde.
ALTER TABLE "transaction" ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE settlement ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
