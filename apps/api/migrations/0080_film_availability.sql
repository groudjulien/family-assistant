-- Films : où le film se regarde, figé dans l'instantané au moment où il est
-- retenu / vu / masqué. « subscription » (un abonnement du foyer), « vod »
-- (à la demande en France) ou « unknown » (aucune offre FR connue de TMDB).
-- Les lignes existantes restent NULL : elles datent d'avant la recherche hors
-- plateforme, donc elles portent toutes une plateforme dans `providers`.
ALTER TABLE film_favorite ADD COLUMN availability TEXT;
ALTER TABLE film_seen ADD COLUMN availability TEXT;
ALTER TABLE film_hidden ADD COLUMN availability TEXT;
