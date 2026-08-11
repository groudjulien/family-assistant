-- Archivage d'un voyage : séparation des voyages « Prévu » / « Archivé ».
ALTER TABLE trip ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
