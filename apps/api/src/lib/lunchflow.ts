// Client de l'API LunchFlow (agrégation bancaire) + synchro des soldes.
// La clé est stockée chiffrée par foyer (cf. lib/crypto), avec repli sur la
// variable d'environnement LUNCHFLOW_API_KEY.
import { and, eq } from "drizzle-orm";
import { decryptSecret } from "./crypto";
import { account, bankTransaction } from "../db/schema";
import { classifyTxType } from "./txType";
import { newId, nowIso } from "./util";
import type { Db } from "./types";
import type { DbHousehold } from "../db/schema";

// L'API redirige lunchflow.app → www.lunchflow.app : on cible directement www
// pour éviter un 308 sur chaque appel.
const BASE_URL = "https://www.lunchflow.app/api/v1";

/**
 * Clé API LunchFlow effective : celle saisie par le foyer (chiffrée en base) en
 * priorité, sinon la variable d'environnement. Renvoie null si aucune dispo.
 */
export async function resolveLunchflowKey(
  household: { lunchflowApiKey: string | null },
  env: { SESSION_SECRET: string; LUNCHFLOW_API_KEY?: string },
): Promise<string | null> {
  if (household.lunchflowApiKey) {
    const key = await decryptSecret(household.lunchflowApiKey, env.SESSION_SECRET);
    if (key) return key;
  }
  return env.LUNCHFLOW_API_KEY || null;
}

export interface LunchflowRemoteAccount {
  id: string;
  name: string;
  institutionName: string | null;
  institutionLogo: string | null;
  provider: string | null;
  status: string;
}

interface RawAccount {
  id: number | string;
  name?: string;
  institution_name?: string | null;
  institution_logo?: string | null;
  provider?: string | null;
  status?: string;
}

/** Liste les comptes accessibles via LunchFlow. Lève en cas d'erreur HTTP. */
export async function lunchflowListAccounts(apiKey: string): Promise<LunchflowRemoteAccount[]> {
  const res = await fetch(`${BASE_URL}/accounts`, {
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`LunchFlow API error (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { accounts?: RawAccount[] };
  return (json.accounts ?? []).map((a) => ({
    id: String(a.id),
    name: a.name ?? "Compte",
    institutionName: a.institution_name ?? null,
    institutionLogo: a.institution_logo ?? null,
    provider: a.provider ?? null,
    status: a.status ?? "UNKNOWN",
  }));
}

// Message FR lisible pour les codes d'erreur documentés du endpoint balance.
function balanceErrorMessage(status: number): string {
  switch (status) {
    case 400:
      return "Compte suspendu — reconnexion nécessaire sur LunchFlow";
    case 401:
    case 403:
      return "Clé API LunchFlow invalide ou abonnement requis";
    case 404:
      return "Compte introuvable côté LunchFlow (dissocie puis ré-associe)";
    case 503:
      return "Données bancaires temporairement indisponibles";
    default:
      return `Erreur LunchFlow (${status})`;
  }
}

/**
 * Récupère le solde d'un compte LunchFlow, converti en centimes (l'API renvoie
 * un montant en euros flottant). Lève un Error au message FR en cas d'échec.
 */
export async function lunchflowGetBalance(apiKey: string, externalId: string): Promise<number> {
  const res = await fetch(`${BASE_URL}/accounts/${externalId}/balance`, {
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(balanceErrorMessage(res.status));
  const json = (await res.json()) as { balance?: { amount?: number; currency?: string } };
  const amount = json.balance?.amount;
  if (typeof amount !== "number" || !isFinite(amount)) {
    throw new Error("Solde LunchFlow indisponible");
  }
  return Math.round(amount * 100);
}

type LinkedAccount = {
  id: string;
  lunchflowAccountId: string | null;
};

/**
 * Synchronise le solde d'un compte local depuis LunchFlow et persiste le
 * résultat (solde + horodatage + éventuelle erreur). Ne lève jamais : les
 * erreurs sont stockées dans `lunchflow_error` pour affichage côté front.
 */
export async function syncAccountBalance(
  db: Db,
  apiKey: string,
  acct: LinkedAccount,
): Promise<void> {
  if (!acct.lunchflowAccountId) return;
  const now = nowIso();
  try {
    const cents = await lunchflowGetBalance(apiKey, acct.lunchflowAccountId);
    await db
      .update(account)
      .set({
        currentBalance: cents,
        balanceUpdatedAt: now,
        lunchflowSyncedAt: now,
        lunchflowError: null,
      })
      .where(eq(account.id, acct.id));
  } catch (e) {
    await db
      .update(account)
      .set({
        lunchflowSyncedAt: now,
        lunchflowError: e instanceof Error ? e.message : "Erreur de synchronisation",
      })
      .where(eq(account.id, acct.id));
  }
}

/* ------------------------------------------------------------------ */
/* Transactions                                                        */
/* ------------------------------------------------------------------ */

export interface LunchflowTransaction {
  externalId: string;
  amount: number; // centimes signés
  currency: string;
  date: string; // YYYY-MM-DD
  rawLabel: string;
  isPending: boolean;
}

interface RawTransaction {
  id: number | string;
  amount?: number;
  currency?: string;
  date?: string;
  merchant?: string;
  description?: string;
  isPending?: boolean;
}

/** Liste les transactions d'un compte LunchFlow (fenêtre glissante ~3 mois). */
export async function lunchflowListTransactions(
  apiKey: string,
  externalId: string,
): Promise<LunchflowTransaction[]> {
  const res = await fetch(`${BASE_URL}/accounts/${externalId}/transactions`, {
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(balanceErrorMessage(res.status));
  const json = (await res.json()) as { transactions?: RawTransaction[] };
  return (json.transactions ?? []).map((t) => ({
    externalId: String(t.id),
    amount: Math.round((t.amount ?? 0) * 100),
    currency: t.currency ?? "EUR",
    date: (t.date ?? "").slice(0, 10),
    rawLabel: (t.merchant || t.description || "").trim(),
    isPending: !!t.isPending,
  }));
}

type SyncableAccount = {
  id: string;
  householdId: string;
  lunchflowAccountId: string | null;
};

/**
 * Synchronise les transactions d'un compte : insère les nouvelles (dédoublonnage
 * par externalId) et met à jour les champs volatils (montant/date/pending) des
 * existantes. Conserve donc l'historique au-delà de la fenêtre de l'API. Les
 * lignes insérées restent `enriched_at = null` pour enrichissement ultérieur.
 * Ne lève jamais : sur échec on horodate quand même pour respecter le cache 1/h.
 */
export async function syncAccountTransactions(
  db: Db,
  apiKey: string,
  acct: SyncableAccount,
): Promise<void> {
  if (!acct.lunchflowAccountId) return;
  const now = nowIso();
  let txs: LunchflowTransaction[];
  try {
    txs = await lunchflowListTransactions(apiKey, acct.lunchflowAccountId);
  } catch {
    await db.update(account).set({ lunchflowTxSyncedAt: now }).where(eq(account.id, acct.id));
    return;
  }
  const existing = await db
    .select({ externalId: bankTransaction.externalId })
    .from(bankTransaction)
    .where(eq(bankTransaction.accountId, acct.id));
  const existingSet = new Set(existing.map((e) => e.externalId));
  for (const t of txs) {
    if (existingSet.has(t.externalId)) {
      await db
        .update(bankTransaction)
        .set({ amount: t.amount, date: t.date, isPending: t.isPending ? 1 : 0 })
        .where(
          and(eq(bankTransaction.accountId, acct.id), eq(bankTransaction.externalId, t.externalId)),
        );
    } else {
      await db.insert(bankTransaction).values({
        id: newId(),
        householdId: acct.householdId,
        accountId: acct.id,
        externalId: t.externalId,
        amount: t.amount,
        currency: t.currency,
        date: t.date,
        rawLabel: t.rawLabel,
        type: classifyTxType(t.rawLabel, t.amount),
        isPending: t.isPending ? 1 : 0,
        createdAt: now,
      });
    }
  }
  await db.update(account).set({ lunchflowTxSyncedAt: now }).where(eq(account.id, acct.id));
}

/**
 * Synchronise les transactions des comptes liés dont la dernière synchro date de
 * plus d'une heure (cache 1/h par compte). Renvoie les ids des comptes synchronisés.
 */
export async function syncStaleTransactions(
  db: Db,
  household: DbHousehold,
  env: { SESSION_SECRET: string; LUNCHFLOW_API_KEY?: string },
  accounts: (SyncableAccount & { lunchflowTxSyncedAt: string | null })[],
): Promise<void> {
  const stale = accounts.filter((a) => a.lunchflowAccountId && isSyncStale(a.lunchflowTxSyncedAt));
  if (stale.length === 0) return;
  const apiKey = await resolveLunchflowKey(household, env);
  if (!apiKey) return;
  await Promise.all(stale.map((a) => syncAccountTransactions(db, apiKey, a)));
}

const ONE_HOUR_MS = 60 * 60 * 1000;

/** Vrai si le compte doit être re-synchronisé (jamais synchro ou > 1h). */
export function isSyncStale(lunchflowSyncedAt: string | null): boolean {
  if (!lunchflowSyncedAt) return true;
  const last = Date.parse(lunchflowSyncedAt);
  if (isNaN(last)) return true;
  return Date.now() - last > ONE_HOUR_MS;
}

/**
 * Synchronise les soldes des comptes liés dont la dernière synchro date de plus
 * d'une heure (cache : au plus une synchro par heure et par compte). Les appels
 * sont parallélisés ; les erreurs sont absorbées par `syncAccountBalance`.
 */
export async function syncStaleLinkedAccounts(
  db: Db,
  household: DbHousehold,
  env: { SESSION_SECRET: string; LUNCHFLOW_API_KEY?: string },
  accounts: { id: string; lunchflowAccountId: string | null; lunchflowSyncedAt: string | null }[],
): Promise<void> {
  const stale = accounts.filter((a) => a.lunchflowAccountId && isSyncStale(a.lunchflowSyncedAt));
  if (stale.length === 0) return;
  const apiKey = await resolveLunchflowKey(household, env);
  if (!apiKey) return;
  await Promise.all(stale.map((a) => syncAccountBalance(db, apiKey, a)));
}
