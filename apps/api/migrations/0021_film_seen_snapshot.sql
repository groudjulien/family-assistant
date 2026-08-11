-- Aperçu des films déjà vus (pour l'onglet "Vues")
ALTER TABLE film_seen ADD COLUMN audience TEXT;
ALTER TABLE film_seen ADD COLUMN image_url TEXT;
ALTER TABLE film_seen ADD COLUMN providers TEXT;
ALTER TABLE film_seen ADD COLUMN year TEXT;
