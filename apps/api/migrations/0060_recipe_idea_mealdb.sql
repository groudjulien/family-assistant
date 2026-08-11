-- Les idées repas viennent désormais de TheMealDB (photo officielle du plat).
-- external_id = idMeal TheMealDB (dédoublonnage). Les anciennes idées générées
-- sans vraie photo sont masquées : la prochaine génération repart proprement.
ALTER TABLE recipe_idea ADD COLUMN external_id TEXT;
UPDATE recipe_idea SET status = 'hidden' WHERE status = 'proposed';
