-- Rayons de la liste de courses.
-- `shopping_item.category` : clé de rayon (NULL pour les articles antérieurs,
-- affichés dans « autre »). `household.shopping_categories` : JSON
-- [{ key, name }] — NULL = DEFAULT_SHOPPING_CATEGORIES.
ALTER TABLE shopping_item ADD COLUMN category TEXT;
ALTER TABLE household ADD COLUMN shopping_categories TEXT;
