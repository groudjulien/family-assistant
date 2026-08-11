// Classification du type de mouvement bancaire à partir du libellé brut + du sens
// du montant. Fonctionne pour les relevés PDF (le libellé contient encore le type
// Trade Republic : « Virement », « Avoir » = CB, « Exécution d'ordre »…) comme pour
// LunchFlow (heuristique sur mots-clés + repli sur le signe).
import type { TxType } from "@gfa/shared";

export function classifyTxType(label: string, amountCents: number): TxType {
  const l = label.toLowerCase();
  const inbound = amountCents >= 0;

  // Retrait au distributeur.
  if (/\bretrait\b|\bdab\b|distributeur|withdrawal/.test(l)) return "retrait";

  // Opérations « à part » : ordres de bourse, intérêts, bonus… → autre.
  if (/\btrade\b|savings plan|\binterest\b|intérêt|\bbonus\b|saveback|dividend/.test(l)) return "autre";

  // Paiement par carte : « Avoir » (type Trade Republic), CB, carte.
  if (/\bavoir\b|\bcb\b|\bcarte\b|paiement carte|\bcard\b/.test(l)) {
    return inbound ? "cb_in" : "cb_out";
  }

  // Virement / prélèvement.
  if (/\bvir\b|virement|paiement accepté|payout|prélèvement|prelevement|\bprlv\b|\bsepa\b/.test(l)) {
    return inbound ? "virement_in" : "virement_out";
  }

  // Repli par signe : une entrée sans mot-clé = virement entrant ; une sortie = CB.
  return inbound ? "virement_in" : "cb_out";
}
