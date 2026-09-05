-- Catégories : une liste partagée au niveau du foyer organisateur, posée
-- ensuite sur les foyers invités (tags) et sur les personnes (catégories).
--
-- Les trois colonnes portent du JSON et démarrent à NULL, lu comme « aucune » :
-- rien à rétro-remplir, la liste part vide et se construit à l'usage.
ALTER TABLE household ADD COLUMN wedding_categories TEXT;
ALTER TABLE wedding_guest ADD COLUMN categories TEXT;
ALTER TABLE wedding_guest ADD COLUMN family_categories TEXT;
