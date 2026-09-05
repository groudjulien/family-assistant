-- Plusieurs repas par mariage : chaque personne choisit pour chacun.
--
-- Les trois colonnes d'avant ne portaient qu'un repas, celui de
-- `wedding_invite_config.mealDayKey`. On les range dans la nouvelle colonne
-- JSON sous cette même clé — c'est aussi l'`id` que la lecture de la config
-- donne au repas historique, donc les réponses retrouvent bien leur repas.
--
-- Les anciennes colonnes ne sont pas supprimées : elles ne coûtent rien et
-- restent le seul filet si ce report devait être rejoué.
ALTER TABLE wedding_guest ADD COLUMN rsvp_meals TEXT;

UPDATE wedding_guest
SET rsvp_meals = json_object(
  COALESCE(
    (SELECT json_extract(h.wedding_invite_config, '$.mealDayKey')
       FROM household h WHERE h.id = wedding_guest.household_id),
    'samedi'
  ),
  json_object('starterId', rsvp_starter, 'mainId', rsvp_main, 'dessertId', rsvp_dessert)
)
WHERE rsvp_starter IS NOT NULL OR rsvp_main IS NOT NULL OR rsvp_dessert IS NOT NULL;
