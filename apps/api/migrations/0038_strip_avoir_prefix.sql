-- Trade Republic préfixe les paiements par carte par « Avoir » (type de l'opération).
-- On le retire des libellés bruts existants pour ne garder que le commerçant.
UPDATE bank_transaction
SET raw_label = TRIM(SUBSTR(raw_label, 7))
WHERE raw_label LIKE 'Avoir %';
