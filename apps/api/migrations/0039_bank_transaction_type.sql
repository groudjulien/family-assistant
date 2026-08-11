-- Type de mouvement bancaire (virement_in/out, cb_in/out, retrait, autre).
ALTER TABLE bank_transaction ADD COLUMN type TEXT;

-- Backfill des lignes existantes par heuristique (libellé + sens du montant).
-- NB : les ex-« Avoir » (paiements CB) ont déjà eu leur préfixe retiré (migration 0038),
-- ils tombent donc dans le repli « sortie sans mot-clé = CB ».
UPDATE bank_transaction SET type = CASE
  WHEN lower(raw_label) LIKE '%retrait%' OR lower(raw_label) LIKE '%dab%' THEN 'retrait'
  WHEN lower(raw_label) LIKE '%trade%'
    OR lower(raw_label) LIKE '%savings plan%'
    OR lower(raw_label) LIKE '%interest%'
    OR lower(raw_label) LIKE '%bonus%'
    OR lower(raw_label) LIKE '%saveback%'
    OR lower(raw_label) LIKE '%dividend%' THEN 'autre'
  WHEN lower(raw_label) LIKE '%cb%' OR lower(raw_label) LIKE '%carte%'
    THEN (CASE WHEN amount >= 0 THEN 'cb_in' ELSE 'cb_out' END)
  WHEN lower(raw_label) LIKE '%vir%'
    OR lower(raw_label) LIKE '%paiement accepté%'
    OR lower(raw_label) LIKE '%payout%'
    OR lower(raw_label) LIKE '%prélèvement%'
    OR lower(raw_label) LIKE '%prlv%'
    OR lower(raw_label) LIKE '%sepa%'
    THEN (CASE WHEN amount >= 0 THEN 'virement_in' ELSE 'virement_out' END)
  ELSE (CASE WHEN amount >= 0 THEN 'virement_in' ELSE 'cb_out' END)
END;
