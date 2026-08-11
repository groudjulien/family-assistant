import { Hono } from "hono";
import { and, eq, asc, like } from "drizzle-orm";
import {
  updateAccountSchema,
  createAccountSchema,
  createCategorySchema,
  createTransactionSchema,
  createRecurringSchema,
  reorderRecurringSchema,
  addMatchNameSchema,
  createSettlementSchema,
} from "@gfa/shared";
import {
  account,
  category,
  transaction,
  recurring,
  recurringDebit,
  settlement,
  bankTransaction,
} from "../db/schema";
import { parseBody } from "../lib/validate";
import { computeBalance } from "../lib/balance";
import { syncStaleLinkedAccounts } from "../lib/lunchflow";
import { newId, nowIso } from "../lib/util";
import type { AppContext } from "../lib/types";
import type { Db } from "../lib/types";

// Remplace les sous-débits d'une dépense et renvoie la somme (signée) si fournis.
async function replaceDebits(
  db: Db,
  hid: string,
  recurringId: string,
  debits: { label?: string; amount: number; dayOfMonth?: number | null }[] | undefined,
): Promise<number | null> {
  if (debits === undefined) return null;
  await db.delete(recurringDebit).where(eq(recurringDebit.recurringId, recurringId));
  let sum = 0;
  for (let i = 0; i < debits.length; i++) {
    const d = debits[i];
    sum += d.amount;
    await db.insert(recurringDebit).values({
      id: newId(),
      householdId: hid,
      recurringId,
      label: d.label ?? "",
      amount: d.amount,
      dayOfMonth: d.dayOfMonth ?? null,
      position: i,
    });
  }
  return debits.length > 0 ? sum : null;
}

// Parse défensif de la colonne TEXT JSON `match_names` → liste de chaînes.
function parseMatchNames(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const money = new Hono<AppContext>();

/* ---------------- Accounts ---------------- */

money.get("/accounts", async (c) => {
  const db = c.get("db");
  // Le front a besoin du solde ici : on synchronise depuis LunchFlow les comptes
  // liés dont la dernière synchro date de plus d'une heure (cache 1/h par compte).
  const linked = await db
    .select({
      id: account.id,
      lunchflowAccountId: account.lunchflowAccountId,
      lunchflowSyncedAt: account.lunchflowSyncedAt,
    })
    .from(account)
    .where(eq(account.householdId, c.get("household").id));
  await syncStaleLinkedAccounts(db, c.get("household"), c.env, linked);

  const rows = await db
    .select()
    .from(account)
    .where(eq(account.householdId, c.get("household").id))
    .orderBy(asc(account.name));
  return c.json(rows.map((r) => ({ ...r, isPrimary: Boolean(r.isPrimary), forecast: Boolean(r.forecast) })));
});

// Un seul compte principal par propriétaire : poser le flag le retire des autres.
async function clearPrimaryForOwner(db: Db, hid: string, owner: string) {
  await db
    .update(account)
    .set({ isPrimary: 0 })
    .where(and(eq(account.householdId, hid), eq(account.owner, owner)));
}

money.post("/accounts", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, createAccountSchema);
  const hid = c.get("household").id;
  if (body.isPrimary) await clearPrimaryForOwner(db, hid, body.owner);
  const id = newId();
  await db.insert(account).values({
    id,
    householdId: hid,
    name: body.name,
    owner: body.owner,
    type: body.type,
    isPrimary: body.isPrimary ? 1 : 0,
    currentBalance: 0,
    balanceUpdatedAt: nowIso(),
  });
  return c.json((await db.select().from(account).where(eq(account.id, id)).limit(1))[0], 201);
});

// Supprime un compte et toutes ses données rattachées (transactions bancaires,
// dépenses/mouvements, charges récurrentes). Irréversible.
money.delete("/accounts/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const hid = c.get("household").id;
  const row = (
    await db
      .select()
      .from(account)
      .where(and(eq(account.id, id), eq(account.householdId, hid)))
      .limit(1)
  )[0];
  if (!row) return c.json({ error: "not_found" }, 404);

  await db
    .delete(bankTransaction)
    .where(and(eq(bankTransaction.accountId, id), eq(bankTransaction.householdId, hid)));
  await db
    .delete(transaction)
    .where(and(eq(transaction.accountId, id), eq(transaction.householdId, hid)));
  const recs = await db
    .select({ id: recurring.id })
    .from(recurring)
    .where(and(eq(recurring.accountId, id), eq(recurring.householdId, hid)));
  for (const r of recs) await db.delete(recurringDebit).where(eq(recurringDebit.recurringId, r.id));
  await db
    .delete(recurring)
    .where(and(eq(recurring.accountId, id), eq(recurring.householdId, hid)));
  await db.delete(account).where(eq(account.id, id));
  return c.json({ ok: true });
});

money.patch("/accounts/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const hid = c.get("household").id;
  const body = await parseBody(c, updateAccountSchema);
  if (body.isPrimary === true) {
    const row = (await db.select().from(account).where(eq(account.id, id)).limit(1))[0];
    if (row) await clearPrimaryForOwner(db, hid, row.owner);
  }
  await db
    .update(account)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.type !== undefined && { type: body.type }),
      ...(body.isPrimary !== undefined && { isPrimary: body.isPrimary ? 1 : 0 }),
      ...(body.forecast !== undefined && { forecast: body.forecast ? 1 : 0 }),
      ...(body.currentBalance !== undefined && { currentBalance: body.currentBalance }),
      ...((body.currentBalance !== undefined || body.balanceUpdatedAt !== undefined) && {
        balanceUpdatedAt: body.balanceUpdatedAt ?? nowIso(),
      }),
    })
    .where(eq(account.id, id));
  return c.json((await db.select().from(account).where(eq(account.id, id)).limit(1))[0]);
});

/* ---------------- Categories ---------------- */

money.get("/categories", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select()
    .from(category)
    .where(eq(category.householdId, c.get("household").id));
  return c.json(rows);
});

money.post("/categories", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, createCategorySchema);
  const id = newId();
  await db.insert(category).values({ id, householdId: c.get("household").id, ...body });
  return c.json((await db.select().from(category).where(eq(category.id, id)).limit(1))[0], 201);
});

money.delete("/categories/:id", async (c) => {
  await c.get("db").delete(category).where(eq(category.id, c.req.param("id")));
  return c.json({ ok: true });
});

/* ---------------- Transactions ---------------- */

money.get("/transactions", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const month = c.req.query("month"); // YYYY-MM
  const rows = await db
    .select()
    .from(transaction)
    .where(
      month
        ? and(eq(transaction.householdId, hid), like(transaction.date, `${month}-%`))
        : eq(transaction.householdId, hid),
    )
    .orderBy(asc(transaction.date));
  return c.json(rows.map((r) => ({ ...r, archived: Boolean(r.archived) })));
});

money.post("/transactions", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, createTransactionSchema);
  const id = newId();
  await db.insert(transaction).values({
    id,
    householdId: c.get("household").id,
    accountId: body.accountId,
    categoryId: body.categoryId ?? null,
    label: body.label,
    amount: body.amount,
    paidBy: body.paidBy ?? "joint",
    shareA: body.shareA,
    shareB: body.shareB,
    date: body.date,
    kind: body.kind ?? "actual",
    recurringId: null,
    createdBy: c.get("user").id,
  });
  return c.json((await db.select().from(transaction).where(eq(transaction.id, id)).limit(1))[0], 201);
});

money.patch("/transactions/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const body = await parseBody(c, createTransactionSchema.partial());
  await db
    .update(transaction)
    .set({
      ...(body.accountId !== undefined && { accountId: body.accountId }),
      ...(body.categoryId !== undefined && { categoryId: body.categoryId ?? null }),
      ...(body.label !== undefined && { label: body.label }),
      ...(body.amount !== undefined && { amount: body.amount }),
      ...(body.paidBy !== undefined && { paidBy: body.paidBy }),
      ...(body.shareA !== undefined && { shareA: body.shareA }),
      ...(body.shareB !== undefined && { shareB: body.shareB }),
      ...(body.date !== undefined && { date: body.date }),
      ...(body.archived !== undefined && { archived: body.archived ? 1 : 0 }),
    })
    .where(eq(transaction.id, id));
  return c.json({ ok: true });
});

// Archive toutes les dépenses partagées et remboursements actifs (équilibrage).
money.post("/equilibrage/archive-all", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  await db
    .update(transaction)
    .set({ archived: 1 })
    .where(and(eq(transaction.householdId, hid), eq(transaction.archived, 0)));
  await db
    .update(settlement)
    .set({ archived: 1 })
    .where(and(eq(settlement.householdId, hid), eq(settlement.archived, 0)));
  return c.json({ ok: true });
});

money.delete("/transactions/:id", async (c) => {
  await c.get("db").delete(transaction).where(eq(transaction.id, c.req.param("id")));
  return c.json({ ok: true });
});

/* ---------------- Recurring ---------------- */

money.get("/recurring", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const rows = await db
    .select()
    .from(recurring)
    .where(eq(recurring.householdId, hid))
    .orderBy(asc(recurring.position));
  const debits = await db
    .select()
    .from(recurringDebit)
    .where(eq(recurringDebit.householdId, hid))
    .orderBy(asc(recurringDebit.position));
  return c.json(
    rows.map((r) => ({
      ...r,
      active: Boolean(r.active),
      matchNames: parseMatchNames(r.matchNames),
      debits: debits
        .filter((d) => d.recurringId === r.id)
        .map((d) => ({ id: d.id, label: d.label, amount: d.amount, dayOfMonth: d.dayOfMonth })),
    })),
  );
});

money.post("/recurring", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, createRecurringSchema);
  const id = newId();
  const maxPos = (await db.select().from(recurring).where(eq(recurring.householdId, hid))).reduce(
    (m, r) => Math.max(m, r.position),
    0,
  );
  const sum = await replaceDebits(db, hid, id, body.debits);
  await db.insert(recurring).values({
    id,
    householdId: hid,
    categoryId: body.categoryId ?? null,
    accountId: body.accountId,
    label: body.label,
    amount: sum ?? body.amount,
    shareA: body.shareA,
    shareB: body.shareB,
    frequency: body.frequency ?? "monthly",
    dayOfMonth: body.dayOfMonth ?? null,
    startDate: body.startDate,
    endDate: body.endDate ?? null,
    active: body.active === false ? 0 : 1,
    position: maxPos + 1,
    matchNames: body.matchNames ? JSON.stringify(body.matchNames) : null,
  });
  return c.json((await db.select().from(recurring).where(eq(recurring.id, id)).limit(1))[0], 201);
});

money.patch("/recurring/reorder", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, reorderRecurringSchema);
  for (let i = 0; i < body.orderedIds.length; i++) {
    await db.update(recurring).set({ position: i }).where(eq(recurring.id, body.orderedIds[i]));
  }
  return c.json({ ok: true });
});

money.patch("/recurring/:id", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const id = c.req.param("id");
  const body = await parseBody(c, createRecurringSchema.partial());
  const sum = await replaceDebits(db, hid, id, body.debits);
  await db
    .update(recurring)
    .set({
      ...(body.categoryId !== undefined && { categoryId: body.categoryId ?? null }),
      ...(body.accountId !== undefined && { accountId: body.accountId }),
      ...(body.label !== undefined && { label: body.label }),
      ...(sum !== null ? { amount: sum } : body.amount !== undefined && { amount: body.amount }),
      ...(body.shareA !== undefined && { shareA: body.shareA }),
      ...(body.shareB !== undefined && { shareB: body.shareB }),
      ...(body.frequency !== undefined && { frequency: body.frequency }),
      ...(body.dayOfMonth !== undefined && { dayOfMonth: body.dayOfMonth ?? null }),
      ...(body.active !== undefined && { active: body.active ? 1 : 0 }),
      ...(body.matchNames !== undefined && { matchNames: JSON.stringify(body.matchNames) }),
    })
    .where(eq(recurring.id, id));
  return c.json((await db.select().from(recurring).where(eq(recurring.id, id)).limit(1))[0]);
});

// Ajoute un motif de nom à une charge (depuis une transaction bancaire). Idempotent
// (dédoublonnage insensible à la casse).
money.post("/recurring/:id/match", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const id = c.req.param("id");
  const body = await parseBody(c, addMatchNameSchema);
  const row = (
    await db
      .select()
      .from(recurring)
      .where(and(eq(recurring.id, id), eq(recurring.householdId, hid)))
      .limit(1)
  )[0];
  if (!row) return c.json({ error: "not found" }, 404);
  const names = parseMatchNames(row.matchNames);
  const name = body.name.trim();
  if (name && !names.some((n) => n.toLowerCase() === name.toLowerCase())) names.push(name);
  await db.update(recurring).set({ matchNames: JSON.stringify(names) }).where(eq(recurring.id, id));
  return c.json({ ok: true, matchNames: names });
});

money.delete("/recurring/:id", async (c) => {
  const id = c.req.param("id");
  await c.get("db").delete(recurringDebit).where(eq(recurringDebit.recurringId, id));
  await c.get("db").delete(recurring).where(eq(recurring.id, id));
  return c.json({ ok: true });
});

/* ---------------- Balance / settlements ---------------- */

money.get("/balance", async (c) => {
  const balance = await computeBalance(c.get("db"), c.get("household").id);
  return c.json(balance);
});

money.get("/settlements", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select()
    .from(settlement)
    .where(eq(settlement.householdId, c.get("household").id))
    .orderBy(asc(settlement.date));
  return c.json(rows.map((r) => ({ ...r, archived: Boolean(r.archived) })));
});

money.post("/settlements", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, createSettlementSchema);
  const id = newId();
  await db.insert(settlement).values({
    id,
    householdId: c.get("household").id,
    fromUser: body.fromUser,
    toUser: body.toUser,
    amount: body.amount,
    date: body.date,
    note: body.note ?? null,
    archived: body.archived ? 1 : 0,
  });
  return c.json({ ok: true, id }, 201);
});

money.patch("/settlements/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const body = await parseBody(c, createSettlementSchema.partial());
  await db
    .update(settlement)
    .set({
      ...(body.fromUser !== undefined && { fromUser: body.fromUser }),
      ...(body.toUser !== undefined && { toUser: body.toUser }),
      ...(body.amount !== undefined && { amount: body.amount }),
      ...(body.date !== undefined && { date: body.date }),
      ...(body.note !== undefined && { note: body.note ?? null }),
      ...(body.archived !== undefined && { archived: body.archived ? 1 : 0 }),
    })
    .where(eq(settlement.id, id));
  return c.json({ ok: true });
});

money.delete("/settlements/:id", async (c) => {
  await c.get("db").delete(settlement).where(eq(settlement.id, c.req.param("id")));
  return c.json({ ok: true });
});

export default money;
