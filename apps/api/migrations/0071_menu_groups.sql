-- Noms des groupes de menu (par utilisateur).
-- JSON { "<clé de séparateur>": "<nom du groupe>" } — les séparateurs de
-- `menu_order` deviennent des groupes titrés dans la navigation.
ALTER TABLE user ADD COLUMN menu_groups TEXT;
