import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Dashboard } from "@gfa/shared";
import { task, account, recurring, weddingPayment, utilityReading } from "../db/schema";
import { computeWeddingSummary } from "./wedding";
import { computeBalance } from "../lib/balance";
import { syncStaleLinkedAccounts } from "../lib/lunchflow";
import type { AppContext } from "../lib/types";

const dashboard = new Hono<AppContext>();

dashboard.get("/", async (c) => {
  const db = c.get("db");
  const h = c.get("household");
  const hid = h.id;
  const today = new Date().toISOString().slice(0, 10);

  const tasks = await db.select().from(task).where(eq(task.householdId, hid));
  const rootOpen = tasks.filter((t) => !t.parentTaskId && t.status !== "done");
  const tasksToday = rootOpen.filter((t) => t.dueDate && t.dueDate <= today);
  const overdue = rootOpen.filter((t) => t.dueDate && t.dueDate < today).length;

  // Le total de trésorerie s'appuie sur les soldes : synchro LunchFlow (cache 1/h).
  const linkedAccts = await db
    .select({
      id: account.id,
      lunchflowAccountId: account.lunchflowAccountId,
      lunchflowSyncedAt: account.lunchflowSyncedAt,
    })
    .from(account)
    .where(eq(account.householdId, hid));
  await syncStaleLinkedAccounts(db, h, c.env, linkedAccts);

  const accounts = await db.select().from(account).where(eq(account.householdId, hid));
  const treasuryTotal = accounts.reduce((s, a) => s + a.currentBalance, 0);

  // upcoming debits next 30 days (recurring + wedding)
  const from = new Date();
  const to = new Date();
  to.setDate(to.getDate() + 30);
  const recs = (await db.select().from(recurring).where(eq(recurring.householdId, hid))).filter((r) => r.active);
  let upcomingDebits = 0;
  for (const r of recs) {
    if (r.amount < 0 && r.frequency === "monthly") upcomingDebits += -r.amount;
  }
  const payments = await db.select().from(weddingPayment).where(eq(weddingPayment.householdId, hid));
  for (const p of payments) {
    const due = new Date(p.dueDate);
    const remaining = p.amountDue - p.amountPaid;
    if (remaining > 0 && due >= from && due <= to) upcomingDebits += remaining;
  }

  const wedding = await computeWeddingSummary(db, h);

  const balance = await computeBalance(db, hid);

  const elec = await db.select().from(utilityReading).where(eq(utilityReading.householdId, hid));
  const year = new Date().getFullYear();
  const electricityYearTotal = elec.filter((e) => e.year === year).reduce((s, e) => s + e.kwh, 0);

  const result: Dashboard = {
    tasksToday: tasksToday.map((t) => ({ ...t, status: t.status as "todo" | "doing" | "done" })),
    overdueTasks: overdue,
    wedding,
    treasuryTotal,
    upcomingDebits30d: upcomingDebits,
    balance,
    electricityYearTotal,
  };
  return c.json(result);
});

export default dashboard;
