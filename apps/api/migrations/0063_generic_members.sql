-- Membres génériques : les prénoms et couleurs d'affichage deviennent de la
-- configuration foyer (slots techniques « a »/« b » partout ailleurs).
-- Les conversions de données du foyer d'origine ont été retirées avant
-- publication (jamais rejouées sur les instances existantes) ; le schéma
-- initial crée directement les colonnes génériques.
ALTER TABLE household ADD COLUMN member_a_name TEXT NOT NULL DEFAULT 'Membre A';
ALTER TABLE household ADD COLUMN member_b_name TEXT NOT NULL DEFAULT 'Membre B';
ALTER TABLE household ADD COLUMN member_a_color TEXT NOT NULL DEFAULT '#3b82f6';
ALTER TABLE household ADD COLUMN member_b_color TEXT NOT NULL DEFAULT '#f43f5e';
ALTER TABLE household ADD COLUMN extra_persons TEXT; -- JSON [{id,name,color}]
