-- Réglages de la section Films, partagés par le foyer (Réglages → Films) :
-- type de média proposé par défaut (film / série), publics proposés, et genres
-- interrogés quand aucun n'est choisi dans les filtres.
-- NULL = les valeurs d'origine (`DEFAULT_FILM_CONFIG` côté @gfa/shared).
ALTER TABLE household ADD COLUMN film_config TEXT;
