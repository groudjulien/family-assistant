-- Invités archivés (non invités, masqués par défaut)
ALTER TABLE wedding_guest ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
