-- Classification des recettes : végétarien, type de viande, féculent, présence de légumes
ALTER TABLE recipe ADD COLUMN vegetarian INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recipe ADD COLUMN meat TEXT;
ALTER TABLE recipe ADD COLUMN starch TEXT NOT NULL DEFAULT 'aucun';
ALTER TABLE recipe ADD COLUMN vegetables INTEGER NOT NULL DEFAULT 0;
