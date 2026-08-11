-- Rattache les anciennes échéances orphelines (budget_item_id NULL) à une dépense
-- lorsque leur "prestataire" (texte libre de l'ancien échéancier) correspond
-- exactement au libellé d'UN seul poste du même foyer.
UPDATE wedding_payment
SET budget_item_id = (
  SELECT b.id
  FROM wedding_budget_item b
  WHERE lower(trim(b.label)) = lower(trim(wedding_payment.prestataire))
    AND b.household_id = wedding_payment.household_id
)
WHERE budget_item_id IS NULL
  AND (
    SELECT count(*)
    FROM wedding_budget_item b
    WHERE lower(trim(b.label)) = lower(trim(wedding_payment.prestataire))
      AND b.household_id = wedding_payment.household_id
  ) = 1;
