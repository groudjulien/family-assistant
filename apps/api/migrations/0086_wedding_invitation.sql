-- Faire-part : configuration du foyer organisateur + code d'accès par famille.

-- Menus, déroulé, lieux, FAQ, date limite de réponse (JSON, cf. weddingInviteConfigSchema).
ALTER TABLE household ADD COLUMN wedding_invite_config TEXT;

-- Code de 4 caractères imprimé dans l'URL publique /i/<code>, porté par le chef
-- de famille. Unique globalement : la page publique n'a pas de foyer en contexte,
-- elle retrouve la famille par le seul code.
ALTER TABLE wedding_guest ADD COLUMN invite_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS wedding_guest_invite_code_idx ON wedding_guest (invite_code);

-- Logé sur place (1) ou à se loger par ses propres moyens (0) — par famille.
ALTER TABLE wedding_guest ADD COLUMN housed INTEGER NOT NULL DEFAULT 0;

-- Réponse au faire-part, par personne. rsvp_days NULL = pas encore répondu.
ALTER TABLE wedding_guest ADD COLUMN rsvp_days TEXT;
ALTER TABLE wedding_guest ADD COLUMN rsvp_starter TEXT;
ALTER TABLE wedding_guest ADD COLUMN rsvp_main TEXT;
ALTER TABLE wedding_guest ADD COLUMN rsvp_diet TEXT;
ALTER TABLE wedding_guest ADD COLUMN rsvp_at TEXT;
