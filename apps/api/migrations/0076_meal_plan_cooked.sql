-- Menu de la semaine : repas déjà cuisinés (JSON { recipeId: date ISO }).
-- Ils restent affichés dans le menu et sortent des tirages suivants.
ALTER TABLE meal_plan ADD COLUMN cooked TEXT;
