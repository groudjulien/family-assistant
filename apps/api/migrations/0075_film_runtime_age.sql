-- Films : durée et limite d'âge, figées dans l'instantané au moment où le film
-- est retenu / vu / masqué (la carte les affiche sans rappeler TMDB).
ALTER TABLE film_favorite ADD COLUMN runtime INTEGER;
ALTER TABLE film_favorite ADD COLUMN age_limit TEXT;
ALTER TABLE film_seen ADD COLUMN runtime INTEGER;
ALTER TABLE film_seen ADD COLUMN age_limit TEXT;
ALTER TABLE film_hidden ADD COLUMN runtime INTEGER;
ALTER TABLE film_hidden ADD COLUMN age_limit TEXT;
