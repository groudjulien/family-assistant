// Import d'un relevé de compte PDF, 100 % JS (aucun appel externe) :
// - extraction du texte via unpdf (pdf.js serverless, sans dépendance native),
// - parsing par heuristique (calibré sur les relevés Trade Republic),
// - insertion au même format que LunchFlow avec dédoublonnage stable.
//
// Format Trade Republic : le texte extrait est un flux continu où chaque opération
// se présente « DATE TYPE DESCRIPTION <montant> € <SOLDE> € ». Le sens (débit /
// crédit) n'est pas explicite : on le déduit de la variation du SOLDE cumulé
// (solde qui monte = entrée d'argent, qui baisse = sortie).
import { eq } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import type { TxType } from "@gfa/shared";
import { bankTransaction } from "../db/schema";
import { newId, nowIso } from "./util";
import { classifyTxType } from "./txType";
import type { Db } from "./types";

interface ParsedTx {
  date: string; // YYYY-MM-DD
  amount: number; // centimes signés
  soldeCents: number; // solde cumulé après l'opération (sens + clé de dédoublonnage)
  label: string;
  type: TxType;
}

// Mois français abrégés (Trade Republic) → index 0-11.
const MONTHS: Record<string, number> = {
  janv: 0, févr: 1, fevr: 1, mars: 2, avr: 3, mai: 4, juin: 5,
  juil: 6, août: 7, aout: 7, sept: 8, oct: 9, nov: 10, déc: 11, dec: 11,
};

// « 01 nov. 2024 » → jour / mois (mot) / année.
const DATE_RE = /(\d{2})\s+([A-Za-zÀ-ÿ]+)\.?\s+(\d{4})/g;
// Montant : « 209,00 € », « 144731,98 € » (pas de séparateur de milliers chez TR).
const AMOUNT_RE = /(\d+),(\d{2})\s*€/g;

// Clé de dédoublonnage : jour + montant + solde cumulé (unique et stable d'un
// relevé à l'autre — le solde après une opération donnée ne change jamais).
function externalIdFor(t: ParsedTx): string {
  return `pdf:${t.date}:${t.amount}:${t.soldeCents}`;
}

// Extrait le texte brut du PDF (couche texte). Renvoie "" si le PDF est scanné.
async function extractPdfText(pdf: ArrayBuffer): Promise<string> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const { text } = await extractText(doc, { mergePages: true });
  return (Array.isArray(text) ? text.join("\n") : text).trim();
}

function centsFromMatch(m: RegExpMatchArray): number {
  return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
}

/**
 * Parse un relevé Trade Republic. La table des opérations commence après le
 * marqueur « TRANSACTIONS » (avant : en-tête + synthèse, qu'on ignore). Chaque
 * opération = une date valide suivie, jusqu'à la date suivante, d'un libellé
 * puis de deux montants (montant de l'opération, puis solde cumulé).
 */
function parseStatementText(fullText: string): ParsedTx[] {
  // Solde de début de période (« Compte courant 0,00 € … ») pour le sens de la 1re op.
  const openM = fullText.match(/Compte courant\s+(\d+),(\d{2})\s*€/);
  let prevSolde = openM ? parseInt(openM[1], 10) * 100 + parseInt(openM[2], 10) : 0;

  // On ne parse que la table des transactions : de « TRANSACTIONS » (après l'en-tête
  // et la synthèse) jusqu'au récapitulatif de fin « COMPTES ESPÈCES » s'il existe.
  const startIdx = fullText.indexOf("TRANSACTIONS");
  let text = startIdx >= 0 ? fullText.slice(startIdx) : fullText;
  const endIdx = text.indexOf("COMPTES ESPÈCES");
  if (endIdx > 0) text = text.slice(0, endIdx);

  // Bornes = toutes les vraies dates (mois valide).
  const raw: { index: number; end: number; date: string }[] = [];
  DATE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DATE_RE.exec(text)) !== null) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (mon === undefined) continue;
    const date = `${m[3]}-${String(mon + 1).padStart(2, "0")}-${m[1]}`;
    raw.push({ index: m.index, end: m.index + m[0].length, date });
  }

  const out: ParsedTx[] = [];
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i];
    const chunk = text.slice(b.end, raw[i + 1]?.index ?? text.length);
    const amts = [...chunk.matchAll(AMOUNT_RE)];
    if (amts.length < 2) continue; // pas une ligne d'opération (en-tête, footer…)

    const amtMatch = amts[amts.length - 2]; // avant-dernier = montant de l'opération
    const soldeMatch = amts[amts.length - 1]; // dernier = solde cumulé
    const printed = centsFromMatch(amtMatch);
    const soldeCents = centsFromMatch(soldeMatch);

    const fullLabel = chunk.slice(0, amtMatch.index ?? 0).replace(/\s+/g, " ").trim();
    const sign = soldeCents >= prevSolde ? 1 : -1;
    prevSolde = soldeCents;
    const amount = sign * printed;
    // Le type se déduit du libellé complet (qui contient encore le type TR :
    // « Avoir » = CB, « Virement »…) ; on classe AVANT de retirer le préfixe.
    const type = classifyTxType(fullLabel, amount);
    // « Avoir » = paiement par carte chez TR : on le retire pour ne garder que le commerçant.
    const label = fullLabel.replace(/^Avoir\s+/i, "");

    out.push({ date: b.date, amount, soldeCents, label: label || "Opération", type });
  }
  return out;
}

export interface ImportResult {
  added: number;
  skipped: number;
  total: number;
}

/**
 * Extrait le texte d'un relevé PDF, le parse en transactions (JS pur) et les
 * insère pour le compte donné (format LunchFlow). Idempotent : les opérations
 * déjà présentes (même clé jour/montant/solde) sont ignorées. Lève « no-text »
 * si le PDF ne contient pas de couche texte (relevé scanné).
 */
export async function importStatementPdf(
  db: Db,
  account: { id: string; householdId: string },
  pdf: ArrayBuffer,
): Promise<ImportResult> {
  const text = await extractPdfText(pdf);
  if (text.length < 20) throw new Error("no-text");

  const parsed = parseStatementText(text).filter(
    (t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date) && t.label !== "",
  );

  const existing = await db
    .select({ externalId: bankTransaction.externalId })
    .from(bankTransaction)
    .where(eq(bankTransaction.accountId, account.id));
  const seen = new Set(existing.map((e) => e.externalId));

  const now = nowIso();
  const rows: (typeof bankTransaction.$inferInsert)[] = [];
  for (const t of parsed) {
    const externalId = externalIdFor(t);
    if (seen.has(externalId)) continue;
    seen.add(externalId); // dédoublonne aussi à l'intérieur du même relevé
    rows.push({
      id: newId(),
      householdId: account.householdId,
      accountId: account.id,
      externalId,
      amount: t.amount,
      currency: "EUR",
      date: t.date,
      rawLabel: t.label,
      type: t.type,
      isPending: 0,
      createdAt: now,
    });
  }

  // Insertion via db.batch : un seul aller-retour D1. Chaque requête est limitée à
  // 100 variables liées → 10 colonnes ⇒ 10 lignes max par requête (marge : 9).
  if (rows.length > 0) {
    const stmts = [];
    for (let i = 0; i < rows.length; i += 9) {
      stmts.push(db.insert(bankTransaction).values(rows.slice(i, i + 9)));
    }
    await db.batch(stmts as unknown as Parameters<typeof db.batch>[0]);
  }

  return { added: rows.length, skipped: parsed.length - rows.length, total: parsed.length };
}
