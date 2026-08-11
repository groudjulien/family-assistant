import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createPlannedExpenseSchema } from "@gfa/shared";
import { plannedExpense } from "../db/schema";
import { parseBody } from "../lib/validate";
import { newId, nowIso } from "../lib/util";
import type { AppContext } from "../lib/types";

const planned = new Hono<AppContext>();

planned.get("/", async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(plannedExpense)
    .where(eq(plannedExpense.householdId, c.get("household").id));
  return c.json(rows);
});

planned.post("/", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, createPlannedExpenseSchema);
  const id = newId();
  await db.insert(plannedExpense).values({
    id,
    householdId: c.get("household").id,
    name: body.name,
    description: body.description ?? null,
    amount: body.amount,
    date: body.date ?? null,
    owner: body.owner,
    purchasedAt: body.purchasedAt ?? null,
    createdAt: nowIso(),
  });
  return c.json({ ok: true, id }, 201);
});

planned.patch("/:id", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, createPlannedExpenseSchema.partial());
  await db
    .update(plannedExpense)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description ?? null }),
      ...(body.amount !== undefined && { amount: body.amount }),
      ...(body.date !== undefined && { date: body.date ?? null }),
      ...(body.owner !== undefined && { owner: body.owner }),
      ...(body.purchasedAt !== undefined && { purchasedAt: body.purchasedAt ?? null }),
    })
    .where(eq(plannedExpense.id, c.req.param("id")));
  return c.json({ ok: true });
});

planned.delete("/:id", async (c) => {
  await c.get("db").delete(plannedExpense).where(eq(plannedExpense.id, c.req.param("id")));
  return c.json({ ok: true });
});

export default planned;
