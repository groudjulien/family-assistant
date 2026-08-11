-- Menus par défaut du foyer (définis par le wizard d'installation) : ordre et
-- menus masqués. Les préférences par utilisateur (user.menu_order/menu_hidden)
-- restent prioritaires quand elles existent.
ALTER TABLE household ADD COLUMN default_menu_order TEXT;  -- JSON string[]
ALTER TABLE household ADD COLUMN default_menu_hidden TEXT; -- JSON string[]
