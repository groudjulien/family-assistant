-- Allowlist en base : remplace le secret ALLOWED_EMAILS comme source de vérité.
-- La table est remplie paresseusement depuis ALLOWED_EMAILS au premier login
-- (cf. ensureAllowlist) ; le secret env reste accepté en repli.
CREATE TABLE allowed_email (
  email TEXT PRIMARY KEY,
  member_slot TEXT, -- 'a' | 'b' | NULL (premier arrivé = a, deuxième = b)
  created_at TEXT NOT NULL
);
