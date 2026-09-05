-- La présence n'a plus qu'un champ.
--
-- `rsvp_days` doublonnait les colonnes `vendredi` / `samedi` / `dimanche` : les
-- unes disaient qui était convié, l'autre qui venait, et les trois écrans de
-- l'app en montraient des versions différentes. Les colonnes de jours portent
-- désormais la présence, que les mariés pré-remplissent et que le foyer corrige
-- depuis son faire-part. La **portée** de l'invitation reste `guest_group`
-- (« à partir du vendredi » / « à partir du samedi »).
--
-- Reprise : une réponse déjà reçue fait foi sur la présence supposée.
UPDATE wedding_guest
SET vendredi = CASE WHEN rsvp_days LIKE '%vendredi%' THEN 1 ELSE 0 END,
    samedi   = CASE WHEN rsvp_days LIKE '%samedi%'   THEN 1 ELSE 0 END,
    dimanche = CASE WHEN rsvp_days LIKE '%dimanche%' THEN 1 ELSE 0 END
WHERE rsvp_days IS NOT NULL;

ALTER TABLE wedding_guest DROP COLUMN rsvp_days;
