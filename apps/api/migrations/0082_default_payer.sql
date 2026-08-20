-- Membre proposé par défaut comme payeur d'une dépense partagée (Réglages →
-- Argent). Le slot `a` reste le comportement historique du formulaire.
ALTER TABLE household ADD COLUMN default_payer TEXT NOT NULL DEFAULT 'a';
