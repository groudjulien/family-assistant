-- Durées des recettes : préparation et total (avec cuisson)
ALTER TABLE recipe ADD COLUMN prep_minutes INTEGER;
ALTER TABLE recipe ADD COLUMN total_minutes INTEGER;
