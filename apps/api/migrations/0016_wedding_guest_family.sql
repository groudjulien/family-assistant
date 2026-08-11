-- Familles d'invités : regroupement sous un invité principal + adresse
ALTER TABLE wedding_guest ADD COLUMN parent_id TEXT;
ALTER TABLE wedding_guest ADD COLUMN address TEXT;
