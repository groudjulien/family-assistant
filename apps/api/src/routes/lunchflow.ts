import { Hono } from "hono";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import {
  linkLunchflowSchema,
  DEFAULT_EXPENSE_CATEGORIES,
  PAYER,
  type LunchflowAccount,
  type BankTransaction,
} from "@gfa/shared";
import { account, bankTransaction } from "../db/schema";
import type { DbHousehold } from "../db/schema";
import { parseBody } from "../lib/validate";
import {
  resolveLunchflowKey,
  lunchflowListAccounts,
  syncAccountBalance,
  syncStaleTransactions,
} from "../lib/lunchflow";
import { enrichTransactions } from "../lib/txEnrich";
import { importStatementPdf } from "../lib/statementImport";
import { classifyTxType } from "../lib/txType";
import type { AppContext } from "../lib/types";

// Clés de catégories de dépenses du foyer (config perso, sinon défauts).
function categoryKeysFor(h: DbHousehold): string[] {
  try {
    const v = h.expenseCategories ? JSON.parse(h.expenseCategories) : null;
    if (Array.isArray(v)) {
      return v
        .filter((c) => c && typeof c.key === "string" && !c.hidden)
        .map((c) => c.key as string);
    }
  } catch {
    // ignore
  }
  return DEFAULT_EXPENSE_CATEGORIES.map((c) => c.key);
}

const lunchflow = new Hono<AppContext>();

/** Comptes accessibles via LunchFlow, enrichis du compte local déjà associé. */
lunchflow.get("/accounts", async (c) => {
  const apiKey = await resolveLunchflowKey(c.get("household"), c.env);
  if (!apiKey) return c.json({ error: "no-key" }, 400);

  let remote;
  try {
    remote = await lunchflowListAccounts(apiKey);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "LunchFlow indisponible" }, 502);
  }

  const local = await c
    .get("db")
    .select({ id: account.id, lunchflowAccountId: account.lunchflowAccountId })
    .from(account)
    .where(eq(account.householdId, c.get("household").id));
  const linkedBy = new Map(
    local.filter((a) => a.lunchflowAccountId).map((a) => [a.lunchflowAccountId as string, a.id]),
  );

  const accounts: LunchflowAccount[] = remote.map((r) => ({
    ...r,
    linkedAccountId: linkedBy.get(r.id) ?? null,
  }));
  return c.json({ accounts });
});

/** Associe un compte local à un compte LunchFlow et synchronise immédiatement. */
lunchflow.put("/link/:accountId", async (c) => {
  const db = c.get("db");
  const accountId = c.req.param("accountId");
  const body = await parseBody(c, linkLunchflowSchema);

  const acct = (
    await db
      .select()
      .from(account)
      .where(and(eq(account.id, accountId), eq(account.householdId, c.get("household").id)))
      .limit(1)
  )[0];
  if (!acct) return c.json({ error: "not-found" }, 404);

  // Un compte LunchFlow ne peut être associé qu'à un seul compte local : on
  // détache d'abord toute autre association existante pour cet id externe.
  await db
    .update(account)
    .set({ lunchflowAccountId: null, lunchflowSyncedAt: null, lunchflowError: null })
    .where(
      and(
        eq(account.householdId, c.get("household").id),
        eq(account.lunchflowAccountId, body.lunchflowAccountId),
      ),
    );

  await db
    .update(account)
    .set({ lunchflowAccountId: body.lunchflowAccountId, lunchflowError: null, lunchflowSyncedAt: null })
    .where(eq(account.id, accountId));

  const apiKey = await resolveLunchflowKey(c.get("household"), c.env);
  if (apiKey) {
    await syncAccountBalance(db, apiKey, { id: accountId, lunchflowAccountId: body.lunchflowAccountId });
  }

  return c.json((await db.select().from(account).where(eq(account.id, accountId)).limit(1))[0]);
});

/** Dissocie un compte local de LunchFlow (le solde manuel est conservé). */
lunchflow.delete("/link/:accountId", async (c) => {
  const db = c.get("db");
  const accountId = c.req.param("accountId");
  await db
    .update(account)
    .set({ lunchflowAccountId: null, lunchflowSyncedAt: null, lunchflowError: null })
    .where(and(eq(account.id, accountId), eq(account.householdId, c.get("household").id)));
  return c.json({ ok: true });
});

/** Force la re-synchronisation du solde (ignore le cache d'une heure). */
lunchflow.post("/sync/:accountId", async (c) => {
  const db = c.get("db");
  const accountId = c.req.param("accountId");
  const acct = (
    await db
      .select()
      .from(account)
      .where(and(eq(account.id, accountId), eq(account.householdId, c.get("household").id)))
      .limit(1)
  )[0];
  if (!acct) return c.json({ error: "not-found" }, 404);
  if (!acct.lunchflowAccountId) return c.json({ error: "not-linked" }, 400);

  const apiKey = await resolveLunchflowKey(c.get("household"), c.env);
  if (!apiKey) return c.json({ error: "no-key" }, 400);

  await syncAccountBalance(db, apiKey, acct);
  return c.json((await db.select().from(account).where(eq(account.id, accountId)).limit(1))[0]);
});

/**
 * Import d'un relevé de compte PDF (comptes non connectés à LunchFlow). Claude
 * extrait les opérations du PDF, insérées au format LunchFlow avec dédoublonnage.
 */
lunchflow.post("/import/:accountId", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const accountId = c.req.param("accountId");

  const acct = (
    await db
      .select()
      .from(account)
      .where(and(eq(account.id, accountId), eq(account.householdId, hid)))
      .limit(1)
  )[0];
  if (!acct) return c.json({ error: "not-found" }, 404);

  type UploadFile = { name: string; type: string; arrayBuffer(): Promise<ArrayBuffer> };
  let file: UploadFile | null = null;
  try {
    const form = await c.req.formData();
    const f = form.get("file");
    if (f && typeof f !== "string") file = f as unknown as UploadFile;
  } catch {
    return c.json({ error: "bad-form" }, 400);
  }
  if (!file) return c.json({ error: "no-file" }, 400);
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) return c.json({ error: "not-pdf" }, 400);

  const buf = await file.arrayBuffer();
  if (buf.byteLength > 15_000_000) return c.json({ error: "too-large" }, 413);

  try {
    const result = await importStatementPdf(db, { id: acct.id, householdId: hid }, buf);
    // Enrichissement des lignes importées dès l'import (en tâche de fond, par lots
    // mutualisés). Le reliquat éventuel d'un très gros import sera complété à la volée.
    c.executionCtx.waitUntil(
      enrichTransactions(db, c.get("household"), c.env, categoryKeysFor(c.get("household")), {
        accountId: acct.id,
        max: 600,
      }).catch((e) => console.error("[enrich import] échec:", e)),
    );
    return c.json(result);
  } catch (e) {
    console.error("[import] échec de l'import du relevé:", e);
    const msg = e instanceof Error ? e.message : "import-failed";
    return c.json({ error: msg }, 502);
  }
});

// Fenêtre de pagination : 100 jours par page (page 0 = 100 derniers jours).
const TX_WINDOW_DAYS = 100;
function dayOffsetIso(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Transactions bancaires du membre demandé (défaut : utilisateur connecté), paginées
 * par fenêtres de 100 jours (`?page=0` = 100 derniers jours ; pages suivantes = plus
 * ancien). Vue par membre = comptes dont il est propriétaire. Synchronise et enrichit
 * (page 0 uniquement). Renvoie `{ transactions, hasOlder, page }`.
 */
lunchflow.get("/transactions", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  // Vue = propriétaire des comptes : a / b / joint (« Commun »).
  const q = c.req.query("member");
  const owner = (PAYER as readonly string[]).includes(q ?? "") ? (q as string) : c.get("user").member;
  const page = Math.max(0, parseInt(c.req.query("page") ?? "0", 10) || 0);

  const myAccounts = await db
    .select()
    .from(account)
    .where(and(eq(account.householdId, hid), eq(account.owner, owner)));

  // Synchro (cache 1/h) + enrichissement borné : uniquement sur la 1re page.
  // L'enrichissement (appels Claude, ~10 s) tourne en tâche de fond (waitUntil)
  // pour ne pas bloquer la réponse : les noms enrichis apparaissent au prochain chargement.
  if (page === 0) {
    await syncStaleTransactions(
      db,
      c.get("household"),
      c.env,
      myAccounts.map((a) => ({
        id: a.id,
        householdId: hid,
        lunchflowAccountId: a.lunchflowAccountId,
        lunchflowTxSyncedAt: a.lunchflowTxSyncedAt,
      })),
    );
    const enrichPromise = enrichTransactions(
      db,
      c.get("household"),
      c.env,
      categoryKeysFor(c.get("household")),
    ).catch((e) => console.error("[enrich] échec:", e));
    c.executionCtx.waitUntil(enrichPromise);
  }

  const acctIds = myAccounts.map((a) => a.id);
  if (acctIds.length === 0) return c.json({ transactions: [], hasOlder: false, page });

  // Fenêtre [lower, upper) : page 0 = date >= today-100j (inclut le futur/à venir) ;
  // pages suivantes = fenêtre de 100 jours plus ancienne.
  const lower = dayOffsetIso((page + 1) * TX_WINDOW_DAYS);
  const upper = page === 0 ? null : dayOffsetIso(page * TX_WINDOW_DAYS);
  const conds = [
    eq(bankTransaction.householdId, hid),
    inArray(bankTransaction.accountId, acctIds),
    gte(bankTransaction.date, lower),
  ];
  if (upper) conds.push(lt(bankTransaction.date, upper));

  const rows = await db
    .select()
    .from(bankTransaction)
    .where(and(...conds))
    .orderBy(desc(bankTransaction.date), desc(bankTransaction.createdAt));

  // Existe-t-il des transactions plus anciennes que cette fenêtre ? (bouton « charger plus »)
  const older = await db
    .select({ id: bankTransaction.id })
    .from(bankTransaction)
    .where(
      and(
        eq(bankTransaction.householdId, hid),
        inArray(bankTransaction.accountId, acctIds),
        lt(bankTransaction.date, lower),
      ),
    )
    .limit(1);

  const nameById = new Map(myAccounts.map((a) => [a.id, a.name]));
  const today = new Date().toISOString().slice(0, 10);
  const transactions: BankTransaction[] = rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    accountName: nameById.get(r.accountId) ?? "—",
    amount: r.amount,
    currency: r.currency,
    date: r.date,
    rawLabel: r.rawLabel,
    type: (r.type as BankTransaction["type"] | null) ?? classifyTxType(r.rawLabel, r.amount),
    isPending: !!r.isPending,
    future: r.date > today,
    merchantName: r.merchantName,
    category: r.category,
    merchantWebsite: r.merchantWebsite,
    merchantAddress: r.merchantAddress,
  }));
  return c.json({ transactions, hasOlder: older.length > 0, page });
});

export default lunchflow;
