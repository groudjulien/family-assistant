-- Flux RSS d'événements suivis pour l'onglet Activités (agendas municipaux…).
CREATE TABLE activity_feed (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL
);
