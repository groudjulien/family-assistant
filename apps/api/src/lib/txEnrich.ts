// Enrichissement des transactions bancaires via Claude : à partir du libellé
// bancaire brut (multiligne, format SEPA), déduit un nom de vendeur lisible, une
// catégorie de dépense du foyer, et — best-effort — un site web. L'adresse est
// rarement déductible et reste généralement nulle.
import { and, desc, eq, isNull } from "drizzle-orm";
import { bankTransaction } from "../db/schema";
import { resolveAnthropicKey, callClaude } from "./anthropic";
import { nowIso } from "./util";
import type { Db } from "./types";
import type { DbHousehold } from "../db/schema";

const ENRICH_MODEL = "claude-haiku-4-5-20251001";
const BATCH = 30; // transactions par appel Claude (mutualise les appels → moins de coût)
const MAX_PER_RUN = 60; // plafond par défaut (borne coût/latence sur le chemin « à la volée »)

// Extrait le premier tableau JSON d'une réponse (tolère les fences ```json).
function extractJsonArray(text: string): unknown {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) throw new Error("no json array");
  return JSON.parse(text.slice(start, end + 1));
}

interface EnrichResult {
  id?: string;
  name?: string | null;
  category?: string | null;
  website?: string | null;
  address?: string | null;
}

/**
 * Enrichit les transactions non enrichies (les plus récentes d'abord), par lots
 * mutualisés (BATCH par appel Claude). Idempotent et résilient : en cas d'échec
 * d'un lot, les lignes restent non enrichies et seront retentées au prochain passage.
 *
 * `opts.accountId` cible un compte précis (import d'un relevé) ; `opts.max` relève
 * le plafond (par défaut MAX_PER_RUN pour l'enrichissement « à la volée »).
 */
export async function enrichTransactions(
  db: Db,
  household: DbHousehold,
  env: { SESSION_SECRET: string; ANTHROPIC_API_KEY?: string },
  categoryKeys: string[],
  opts: { accountId?: string; max?: number } = {},
): Promise<void> {
  const apiKey = await resolveAnthropicKey(household, env);
  if (!apiKey) return;

  const conds = [eq(bankTransaction.householdId, household.id), isNull(bankTransaction.enrichedAt)];
  if (opts.accountId) conds.push(eq(bankTransaction.accountId, opts.accountId));
  const rows = await db
    .select()
    .from(bankTransaction)
    .where(and(...conds))
    .orderBy(desc(bankTransaction.date))
    .limit(opts.max ?? MAX_PER_RUN);
  if (rows.length === 0) return;

  const system =
    "Tu catégorises des transactions bancaires françaises. À partir du libellé bancaire brut " +
    "(souvent au format SEPA, multiligne), tu déduis : un nom de commerçant/vendeur court et " +
    "lisible (ex. « MAIF », « EDF », « Free », « Carrefour »), une catégorie, et si tu le connais " +
    "avec certitude le site web officiel (domaine seul, ex. « maif.fr »). Ne devine jamais une " +
    "adresse ni un site incertain : mets null. Réponds UNIQUEMENT par un tableau JSON, sans texte.";

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const items = batch.map((r) => ({
      id: r.id,
      amount: r.amount / 100,
      label: r.rawLabel,
    }));
    const prompt =
      `Catégories autorisées (utilise la clé exacte, ou null si aucune ne convient, ` +
      `par ex. pour un revenu/virement reçu) : ${categoryKeys.join(", ")}.\n` +
      `Pour chaque transaction ci-dessous, renvoie un objet ` +
      `{"id","name","category","website","address"}. « name » = nom lisible du vendeur ; ` +
      `« category » = une clé autorisée ou null ; « website »/« address » = best-effort ou null.\n` +
      `Transactions :\n${JSON.stringify(items)}`;

    let parsed: EnrichResult[];
    try {
      const res = await callClaude(apiKey, ENRICH_MODEL, system, [{ role: "user", content: prompt }], 5000);
      parsed = extractJsonArray(res.text) as EnrichResult[];
      if (!Array.isArray(parsed)) throw new Error("not an array");
    } catch {
      continue; // lot laissé non enrichi, retenté plus tard
    }

    const now = nowIso();
    const byId = new Map(parsed.filter((p) => p.id).map((p) => [p.id as string, p]));
    for (const r of batch) {
      const p = byId.get(r.id);
      const category = p?.category && categoryKeys.includes(p.category) ? p.category : null;
      await db
        .update(bankTransaction)
        .set({
          merchantName: p?.name?.trim() || null,
          category,
          merchantWebsite: p?.website?.trim() || null,
          merchantAddress: p?.address?.trim() || null,
          enrichedAt: now, // marqué enrichi même si absent de la réponse (évite les boucles)
        })
        .where(eq(bankTransaction.id, r.id));
    }
  }
}
