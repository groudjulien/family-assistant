-- Motifs de nom pour matcher une charge récurrente à des transactions bancaires
-- dont le montant varie (ex. prélèvement DDFIP). JSON array de chaînes.
ALTER TABLE recurring ADD COLUMN match_names TEXT;
