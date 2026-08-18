import { eq } from "drizzle-orm";
import {
  account,
  recurring,
  recurringDebit,
  weddingPayment,
  transaction,
  plannedExpense,
} from "../db/schema";
import type { Db } from "./types";

/**
 * Projection de trésorerie — extraite de `routes/cashflow.ts` pour être partagée
 * avec l'indicateur « Argent » du menu (`routes/badges.ts`), qui affiche le reste
 * à vivre du compte principal. Même précédent que `lib/balance.ts`.
 *
 * La synchro LunchFlow des soldes n'est **pas** faite ici : c'est à l'appelant de
 * décider (la route /cashflow la fait, le menu ne peut pas se le permettre).
 */

export interface CashflowEntry {
  date: string;
  amount: number; // centimes signés
  label: string;
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

export function generateRecurring(
  r: typeof recurring.$inferSelect,
  from: Date,
  to: Date,
): CashflowEntry[] {
  const out: CashflowEntry[] = [];
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

/** Nombre de jours entre maintenant et la fin du mois courant (horizon « reste à vivre »). */
export function daysUntilEndOfMonth(now = new Date()): number {
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return Math.max(0, Math.floor((end.getTime() - now.getTime()) / 86_400_000));
}

/**
 * Toutes les écritances attendues entre `from` et `to`, et les comptes du foyer.
 * Les soldes sont lus tels quels : synchroniser en amont si besoin.
 */
export async function projectCashflow(db: Db, householdId: string, from: Date, to: Date) {
  const hid = householdId;
  const [accounts, allRecs, allDebits, payments, allTx, allPlanned] = await Promise.all([
    db.select().from(account).where(eq(account.householdId, hid)),
    db.select().from(recurring).where(eq(recurring.householdId, hid)),
    db.select().from(recurringDebit).where(eq(recurringDebit.householdId, hid)),
    db.select().from(weddingPayment).where(eq(weddingPayment.householdId, hid)),
    db.select().from(transaction).where(eq(transaction.householdId, hid)),
    db.select().from(plannedExpense).where(eq(plannedExpense.householdId, hid)),
  ]);

  const jointAccount = accounts.find((a) => a.owner === "joint") ?? accounts[0];
  // Comptes de rattachement des dépenses prévues : le compte PRINCIPAL du
  // propriétaire (flag is_primary, configurable). Une dépense « commune » est
  // portée par le compte principal du membre a.
  const primaryOf = (owner: string) => accounts.find((a) => a.owner === owner && a.isPrimary);
  const primaryA = primaryOf("a") ?? jointAccount;
  const primaryB = primaryOf("b") ?? jointAccount;

  const recs = allRecs.filter((r) => r.active);
  const plannedTx = allTx.filter((t) => t.kind === "planned");
  // Dépenses prévues (onglet « Prévue ») : montant positif en base, débit sur le
  // compte principal. Celles déjà achetées sortent de la projection.
  const plannedExpenses = allPlanned.filter((p) => !p.purchasedAt);

  const entries: CashflowEntry[] = [];
  for (const r of recs) {
    const debits = allDebits.filter((d) => d.recurringId === r.id);
    if (debits.length > 0) {
      // Chaque sous-débit = une occurrence sur son propre jour (même compte que le parent).
      for (const d of debits) {
        entries.push(
          ...generateRecurring(
            {
              ...r,
              amount: d.amount,
              dayOfMonth: d.dayOfMonth ?? r.dayOfMonth,
              label: d.label ? `${r.label} — ${d.label}` : r.label,
            },
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
      entries.push({ date: p.date, label: p.name, amount: -p.amount, accountId: acct.id, source: "planned" });
    }
  }

  for (const t of plannedTx) {
    const d = new Date(t.date);
    if (d >= from && d <= to) {
      entries.push({ date: t.date, label: t.label, amount: t.amount, accountId: t.accountId, source: "planned" });
    }
  }

  return { accounts, entries };
}

/** Solde d'un compte en fin d'horizon : solde actuel + écritures attendues. */
export function projectedBalanceOf(
  acct: typeof account.$inferSelect,
  entries: CashflowEntry[],
): number {
  return entries
    .filter((e) => e.accountId === acct.id)
    .reduce((s, e) => s + e.amount, acct.currentBalance);
}
