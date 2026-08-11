-- Lie les lignes de synthèse d'équilibrage à leur voyage, pour pouvoir les
-- recréer/rafraîchir de façon idempotente (« Créer un équilibrage »).
ALTER TABLE "transaction" ADD COLUMN trip_id TEXT;
