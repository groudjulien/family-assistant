-- Listes libres : emoji de contenu + trace de la dernière modification
-- (affichés par la sous-page mobile d'une liste).
ALTER TABLE custom_list ADD COLUMN emoji TEXT;
ALTER TABLE custom_list ADD COLUMN updated_at TEXT;
ALTER TABLE custom_list ADD COLUMN updated_by TEXT;
