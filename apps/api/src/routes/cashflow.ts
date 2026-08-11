import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Cashflow } from "@gfa/shared";
import { account, recurring, recurringDebit, weddingPayment, transaction, plannedExpense } from "../db/schema";
import { syncStaleLinkedAccounts } from "../lib/lunchflow";
import type { AppContext } from "../lib/types";

const cashflow = new Hono<AppContext>();

interface Entry {
  date: string;
  label: string;
  amount: number; // signed cents
  accountId: string;
  source: "recurring" | "wedding" | "planned";
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function generateRecurring(
  r: typeof recurring.$inferSelect,
  from: Date,
  to: Date,
): Entry[] {
  const out: Entry[] = [];
  const start = new Date(r.startDate);
  const end = r.endDate ? new Date(r.endDate) : null;

  if (r.frequency === "monthly") {
    const day = r.dayOfMonth ?? 1;
    let cursor = new Date(from.getFullYear(), from.getMonth(), day);
    if (cursor < from) cursor = new Date(from.getFullYear(), from.getMonth() + 1, day);
    while (cursor <= to) {
      if (cursor >= start && (!end || cursor <= end)) {
        out.push({ date: ymd(cursor), label: r.label, amount: r.amount, accountId: r.accountId, source: "recurring" });
      }
      cursor = addMonths(cursor, 1);
    }
  } else if (r.frequency === "weekly") {
    const cursor = new Date(Math.max(start.getTime(), from.getTime()));
    while (cursor <= to) {
      if (!end || cursor <= end) {
        out.push({ date: ymd(cursor), label: r.label, amount: r.amount, accountId: r.accountId, source: "recurring" });
      }
      cursor.setDate(cursor.getDate() + 7);
    }
  } else {
    // yearly : mois issu de startDate, jour issu de dayOfMonth si défini (permet
    // aux débits annuels de tomber chacun sur leur propre jour du mois).
    const day = r.dayOfMonth ?? start.getDate();
    let cursor = new Date(from.getFullYear(), start.getMonth(), day);
    if (cursor < from) cursor = new Date(from.getFullYear() + 1, start.getMonth(), day);
    while (cursor <= to) {
      if (!end || cursor <= end) {
        out.push({ date: ymd(cursor), label: r.label, amount: r.amount, accountId: r.accountId, source: "recurring" });
      }
      cursor = new Date(cursor.getFullYear() + 1, start.getMonth(), day);
    }
  }
  return out;
}

cashflow.get("/", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const days = Number(c.req.query("days") ?? 90);
  const accountFilter = c.req.query("accountId");

  const from = new Date();
  const to = new Date();
  to.setDate(to.getDate() + days);

  // La projection s'appuie sur le solde de référence : on synchronise d'abord les
  // comptes liés à LunchFlow dont la dernière synchro date de plus d'une heure
  // (cache 1/h partagé avec GET /accounts), puis on relit les soldes à jour.
  const linked = await db
    .select({
      id: account.id,
      lunchflowAccountId: account.lunchflowAccountId,
      lunchflowSyncedAt: account.lunchflowSyncedAt,
    })
    .from(account)
    .where(eq(account.householdId, hid));
  await syncStaleLinkedAccounts(db, c.get("household"), c.env, linked);

  const accounts = await db.select().from(account).where(eq(account.householdId, hid));
  const jointAccount = accounts.find((a) => a.owner === "joint") ?? accounts[0];
  // Comptes de rattachement des dépenses prévues : le compte PRINCIPAL du
  // propriétaire (flag is_primary, configurable). Une dépense « commune » est
  // portée par le compte principal du membre a.
  const primaryOf = (owner: string) => accounts.find((a) => a.owner === owner && a.isPrimary);
  const primaryA = primaryOf("a") ?? jointAccount;
  const primaryB = primaryOf("b") ?? jointAccount;
  const recs = (await db.select().from(recurring).where(eq(recurring.householdId, hid))).filter(
    (r) => r.active,
  );
  const allDebits = await db
    .select()
    .from(recurringDebit)
    .where(eq(recurringDebit.householdId, hid));
  const payments = await db.select().from(weddingPayment).where(eq(weddingPayment.householdId, hid));
  const plannedTx = (await db.select().from(transaction).where(eq(transaction.householdId, hid))).filter(
    (t) => t.kind === "planned",
  );
  // Dépenses prévues (onglet « Prévue ») : montant positif en base, débit sur le compte principal.
  // Les dépenses déjà achetées (purchasedAt renseignée) sortent de la projection.
  const plannedExpenses = (
    await db.select().from(plannedExpense).where(eq(plannedExpense.householdId, hid))
  ).filter((p) => !p.purchasedAt);

  let entries: Entry[] = [];
  for (const r of recs) {
    const debits = allDebits.filter((d) => d.recurringId === r.id);
    if (debits.length > 0) {
      // Chaque sous-débit = une occurrence sur son propre jour (même compte que le parent).
      for (const d of debits) {
        entries.push(
          ...generateRecurring(
            { ...r, amount: d.amount, dayOfMonth: d.dayOfMonth ?? r.dayOfMonth, label: d.label ? `${r.label} — ${d.label}` : r.label },
            from,
            to,
          ),
        );
      }
    } else {
      entries.push(...generateRecurring(r, from, to));
    }
  }

  for (const p of payments) {
    const remaining = p.amountDue - p.amountPaid;
    if (remaining <= 0) continue;
    const due = new Date(p.dueDate);
    if (due >= from && due <= to && jointAccount) {
      entries.push({
        date: p.dueDate,
        label: `Mariage — ${p.prestataire}${p.type ? ` (${p.type})` : ""}`,
        amount: -remaining,
        accountId: jointAccount.id,
        source: "wedding",
      });
    }
  }

  for (const p of plannedExpenses) {
    if (!p.date) continue;
    const d = new Date(p.date);
    // a / b → compte principal du membre ; joint (commun) → compte principal de a.
    const acct = p.owner === "b" ? primaryB : primaryA;
    if (d >= from && d <= to && acct) {
      entries.push({
        date: p.date,
        label: p.name,
        amount: -p.amount,
        accountId: acct.id,
        source: "planned",
      });
    }
  }

  for (const t of plannedTx) {
    const d = new Date(t.date);
    if (d >= from && d <= to) {
      entries.push({ date: t.date, label: t.label, amount: t.amount, accountId: t.accountId, source: "planned" });
    }
  }

  if (accountFilter) entries = entries.filter((e) => e.accountId === accountFilter);
  entries.sort((a, b) => a.date.localeCompare(b.date));

  const byAccount = accounts
    .filter((a) => !accountFilter || a.id === accountFilter)
    .map((a) => {
      const acctEntries = entries.filter((e) => e.accountId === a.id);
      const totalDebits = acctEntries.filter((e) => e.amount < 0).reduce((s, e) => s + e.amount, 0);
      const totalCredits = acctEntries.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
      return {
        accountId: a.id,
        accountName: a.name,
        currentBalance: a.currentBalance,
        totalDebits: Math.abs(totalDebits),
        totalCredits,
        projectedBalance: a.currentBalance + totalDebits + totalCredits,
      };
    });

  // consolidated running low point
  let running = byAccount.reduce((s, a) => s + a.currentBalance, 0);
  let lowPoint: { date: string; balance: number } | null = null;
  for (const e of entries) {
    running += e.amount;
    if (!lowPoint || running < lowPoint.balance) lowPoint = { date: e.date, balance: running };
  }

  const result: Cashflow = {
    horizonDays: days,
    byAccount,
    upcoming: entries.slice(0, 100),
    lowPoint,
  };
  return c.json(result);
});

export default cashflow;
