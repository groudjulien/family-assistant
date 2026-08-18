import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Cashflow } from "@gfa/shared";
import { account } from "../db/schema";
import { syncStaleLinkedAccounts } from "../lib/lunchflow";
import { projectCashflow } from "../lib/cashflow";
import type { AppContext } from "../lib/types";

const cashflow = new Hono<AppContext>();

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

  const { accounts, entries: allEntries } = await projectCashflow(db, hid, from, to);

  const entries = (accountFilter ? allEntries.filter((e) => e.accountId === accountFilter) : allEntries)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

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
