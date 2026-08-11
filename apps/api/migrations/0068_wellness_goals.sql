-- Bien-être : objectifs personnalisables par membre.
--
-- Remplace le modèle figé (sport_config / sport_entry avec des colonnes
-- boissons/desserts/pompes/…) par des objectifs créés par l'utilisateur :
--   objectif = nom + emoji + périodicité (jour/semaine/mois) + nature
--              (max N / min N / à faire / à ne pas faire)
-- Un objectif peut être « typé sport » : il est alors associé à une séance
-- (nombre de séries + liste d'activités mesurées en répétitions ou en temps).
--
-- Les anciennes tables sont conservées telles quelles (sauvegarde) : la fin de
-- ce fichier importe leur contenu dans le nouveau modèle.

CREATE TABLE wellness_activity (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  member TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '💪',
  unit TEXT NOT NULL DEFAULT 'reps', -- reps | sec | min | hour
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_wellness_activity_member ON wellness_activity (household_id, member);

CREATE TABLE wellness_session (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  member TEXT NOT NULL,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🏋️',
  series INTEGER NOT NULL DEFAULT 1,
  items TEXT NOT NULL DEFAULT '[]', -- JSON [{ activityId, amount }]
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_wellness_session_member ON wellness_session (household_id, member);

CREATE TABLE wellness_goal (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  member TEXT NOT NULL,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🎯',
  period TEXT NOT NULL DEFAULT 'daily', -- daily | weekly | monthly
  kind TEXT NOT NULL DEFAULT 'todo',    -- max | min | todo | nottodo
  target INTEGER,
  goal_type TEXT NOT NULL DEFAULT 'simple', -- simple | sport
  session_id TEXT,
  days TEXT, -- JSON number[] (0 = dimanche) ; NULL = tous les jours
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_wellness_goal_member ON wellness_goal (household_id, member);

CREATE TABLE wellness_log (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  member TEXT NOT NULL,
  date TEXT NOT NULL, -- YYYY-MM-DD
  goal_id TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  sessions TEXT NOT NULL DEFAULT '[]' -- JSON séances réalisées (snapshot)
);
CREATE UNIQUE INDEX idx_wellness_log_unique ON wellness_log (member, date, goal_id);
CREATE INDEX idx_wellness_log_member ON wellness_log (household_id, member);

/* ------------------------------------------------------------------ */
/* Reprise de l'existant : activités, séance type, objectifs, saisies  */
/* ------------------------------------------------------------------ */

-- Les deux slots de membre sont énumérés via json_each : D1 limite le nombre de
-- termes d'un SELECT composé, donc pas de UNION ALL ici.

-- Activités des deux membres (une instruction par activité).
INSERT INTO wellness_activity (id, household_id, member, name, icon, unit, position)
SELECT 'wa_' || m.value || '_pompes', h.id, m.value, 'Pompes', '💪', 'reps', 0
FROM household h, json_each('["a","b"]') m;

INSERT INTO wellness_activity (id, household_id, member, name, icon, unit, position)
SELECT 'wa_' || m.value || '_gainage', h.id, m.value, 'Gainage', '🧘', 'sec', 1
FROM household h, json_each('["a","b"]') m;

INSERT INTO wellness_activity (id, household_id, member, name, icon, unit, position)
SELECT 'wa_' || m.value || '_chaise', h.id, m.value, 'Chaise', '🪑', 'sec', 2
FROM household h, json_each('["a","b"]') m;

INSERT INTO wellness_activity (id, household_id, member, name, icon, unit, position)
SELECT 'wa_' || m.value || '_corde', h.id, m.value, 'Corde à sauter', '🪢', 'sec', 3
FROM household h, json_each('["a","b"]') m;

-- Séance type de chaque membre, alimentée par sport_config (repli sur les
-- valeurs par défaut de l'ancien code quand aucune config n'existe).
INSERT INTO wellness_session (id, household_id, member, name, emoji, series, items, position)
SELECT
  'ws_' || m.value || '_type',
  h.id,
  m.value,
  'Séance type',
  '🏋️',
  COALESCE((SELECT series FROM sport_config WHERE member = m.value), 3),
  json_array(
    json_object('activityId', 'wa_' || m.value || '_pompes',
                'amount', COALESCE((SELECT pompes FROM sport_config WHERE member = m.value), 12)),
    json_object('activityId', 'wa_' || m.value || '_gainage',
                'amount', COALESCE((SELECT gainage FROM sport_config WHERE member = m.value), 60)),
    json_object('activityId', 'wa_' || m.value || '_chaise',
                'amount', COALESCE((SELECT chaise FROM sport_config WHERE member = m.value), 60)),
    json_object('activityId', 'wa_' || m.value || '_corde',
                'amount', COALESCE((SELECT corde FROM sport_config WHERE member = m.value), 60))
  ),
  0
FROM household h, json_each('["a","b"]') m;

-- Objectifs équivalents à ceux codés en dur dans l'ancienne page.
INSERT INTO wellness_goal
  (id, household_id, member, name, emoji, period, kind, target, goal_type, session_id, days, position)
SELECT 'wg_' || m.value || '_sport', h.id, m.value, 'Sport', '🏋️', 'weekly', 'min', 4,
       'sport', 'ws_' || m.value || '_type', NULL, 0
FROM household h, json_each('["a","b"]') m;

INSERT INTO wellness_goal
  (id, household_id, member, name, emoji, period, kind, target, goal_type, session_id, days, position)
SELECT 'wg_' || m.value || '_boissons', h.id, m.value, 'Boissons', '🍷', 'weekly', 'max', 2,
       'simple', NULL, NULL, 1
FROM household h, json_each('["a","b"]') m;

INSERT INTO wellness_goal
  (id, household_id, member, name, emoji, period, kind, target, goal_type, session_id, days, position)
SELECT 'wg_' || m.value || '_desserts', h.id, m.value, 'Desserts', '🍰', 'weekly', 'max', 3,
       'simple', NULL, NULL, 2
FROM household h, json_each('["a","b"]') m;

INSERT INTO wellness_goal
  (id, household_id, member, name, emoji, period, kind, target, goal_type, session_id, days, position)
SELECT 'wg_' || m.value || '_grignotage', h.id, m.value, 'Grignotage', '🍪', 'daily', 'nottodo', NULL,
       'simple', NULL, NULL, 3
FROM household h, json_each('["a","b"]') m;

INSERT INTO wellness_goal
  (id, household_id, member, name, emoji, period, kind, target, goal_type, session_id, days, position)
SELECT 'wg_' || m.value || '_petitdej', h.id, m.value, 'Petit déjeuner', '🥐', 'daily', 'nottodo', NULL,
       'simple', NULL, NULL, 4
FROM household h, json_each('["a","b"]') m;

INSERT INTO wellness_goal
  (id, household_id, member, name, emoji, period, kind, target, goal_type, session_id, days, position)
SELECT 'wg_' || m.value || '_coucher', h.id, m.value, 'Couché avant 23h', '🌙', 'daily', 'todo', NULL,
       'simple', NULL, '[1,2,3,4,5]', 5
FROM household h, json_each('["a","b"]') m;

-- Compteurs boissons / desserts.
INSERT OR IGNORE INTO wellness_log (id, household_id, member, date, goal_id, value, sessions)
SELECT e.id || '_boissons', e.household_id, e.member, e.date,
       'wg_' || e.member || '_boissons', e.boissons, '[]'
FROM sport_entry e
WHERE e.boissons > 0;

INSERT OR IGNORE INTO wellness_log (id, household_id, member, date, goal_id, value, sessions)
SELECT e.id || '_desserts', e.household_id, e.member, e.date,
       'wg_' || e.member || '_desserts', e.desserts, '[]'
FROM sport_entry e
WHERE e.desserts > 0;

-- Objectifs « à ne pas faire » : l'ancien modèle ne stockait que les échecs
-- (présence de l'id dans sport_entry.failed) → value = 1 (fait, donc raté).
INSERT OR IGNORE INTO wellness_log (id, household_id, member, date, goal_id, value, sessions)
SELECT e.id || '_grignotage', e.household_id, e.member, e.date,
       'wg_' || e.member || '_grignotage', 1, '[]'
FROM sport_entry e
WHERE instr(e.failed, '"grignotage"') > 0;

INSERT OR IGNORE INTO wellness_log (id, household_id, member, date, goal_id, value, sessions)
SELECT e.id || '_petitdej', e.household_id, e.member, e.date,
       'wg_' || e.member || '_petitdej', 1, '[]'
FROM sport_entry e
WHERE instr(e.failed, '"petitdej"') > 0;

-- « Couché avant 23h » devient un « à faire » : une journée saisie sans échec
-- vaut objectif tenu (value = 1), un échec vaut 0.
INSERT OR IGNORE INTO wellness_log (id, household_id, member, date, goal_id, value, sessions)
SELECT e.id || '_coucher', e.household_id, e.member, e.date,
       'wg_' || e.member || '_coucher',
       CASE WHEN instr(e.failed, '"coucher"') > 0 THEN 0 ELSE 1 END,
       '[]'
FROM sport_entry e
WHERE CAST(strftime('%w', e.date) AS INTEGER) BETWEEN 1 AND 5;

-- Séances réalisées : snapshot converti depuis sport_entry.sessions.
INSERT OR IGNORE INTO wellness_log (id, household_id, member, date, goal_id, value, sessions)
SELECT
  e.id || '_sport',
  e.household_id,
  e.member,
  e.date,
  'wg_' || e.member || '_sport',
  json_array_length(e.sessions),
  (
    SELECT json_group_array(json_object(
      'sessionId', 'ws_' || e.member || '_type',
      'name', 'Séance type',
      'emoji', '🏋️',
      'series', COALESCE(json_extract(s.value, '$.series'), 1),
      'items', json_array(
        json_object('name', 'Pompes', 'icon', '💪', 'unit', 'reps',
                    'amount', COALESCE(json_extract(s.value, '$.pompes'), 0)),
        json_object('name', 'Gainage', 'icon', '🧘', 'unit', 'sec',
                    'amount', COALESCE(json_extract(s.value, '$.gainage'), 0)),
        json_object('name', 'Chaise', 'icon', '🪑', 'unit', 'sec',
                    'amount', COALESCE(json_extract(s.value, '$.chaise'), 0)),
        json_object('name', 'Corde à sauter', 'icon', '🪢', 'unit', 'sec',
                    'amount', COALESCE(json_extract(s.value, '$.corde'), 0))
      )
    ))
    FROM json_each(e.sessions) s
  )
FROM sport_entry e
WHERE json_array_length(e.sessions) > 0;
