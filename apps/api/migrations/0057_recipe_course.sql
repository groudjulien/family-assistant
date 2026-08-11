-- Type de plat d'une recette : entrée, plat ou dessert (catégorisé par le LLM à l'import).
ALTER TABLE recipe ADD COLUMN course TEXT NOT NULL DEFAULT 'plat';
