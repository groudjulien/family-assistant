-- Jours du mariage configurables : nombre (1 à 3) et libellés.
--
-- Les présences restent stockées dans les colonnes historiques de
-- `wedding_guest` (vendredi / samedi / dimanche), qui deviennent de simples
-- emplacements « jour 1 / jour 2 / jour 3 ». Cette colonne dit combien
-- d'emplacements sont utilisés et sous quel nom les afficher.
-- NULL = les trois jours historiques (aucun changement pour les foyers en place).
ALTER TABLE household ADD COLUMN wedding_days TEXT; -- JSON [{ key, label }]
