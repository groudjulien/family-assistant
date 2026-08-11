import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { upsertUtilityReadingSchema } from "@gfa/shared";
import { utilityReading } from "../db/schema";
import { parseBody } from "../lib/validate";
import { newId } from "../lib/util";
import type { AppContext } from "../lib/types";

const utilities = new Hono<AppContext>();

utilities.get("/", async (c) => {
  const db = c.get("db");
  const utility = c.req.query("utility") ?? "electricity";
  const rows = await db
    .select()
    .from(utilityReading)
    .where(
      and(eq(utilityReading.householdId, c.get("household").id), eq(utilityReading.utility, utility)),
    );

  const years = [...new Set(rows.map((r) => r.year))].sort();
  const byYear: Record<number, Record<number, number>> = {};
  const yearTotals: Record<number, number> = {};
  for (const r of rows) {
    byYear[r.year] ??= {};
    byYear[r.year][r.month] = r.kwh;
    yearTotals[r.year] = (yearTotals[r.year] ?? 0) + r.kwh;
  }
  return c.json({ utility, years, byYear, yearTotals, rows });
});

utilities.post("/", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, upsertUtilityReadingSchema);
  const existing = (
    await db
      .select()
      .from(utilityReading)
      .where(
        and(
          eq(utilityReading.householdId, hid),
          eq(utilityReading.utility, body.utility),
          eq(utilityReading.year, body.year),
          eq(utilityReading.month, body.month),
        ),
      )
      .limit(1)
  )[0];
  if (existing) {
    await db.update(utilityReading).set({ kwh: body.kwh }).where(eq(utilityReading.id, existing.id));
  } else {
    await db.insert(utilityReading).values({
      id: newId(),
      householdId: hid,
      utility: body.utility,
      year: body.year,
      month: body.month,
      kwh: body.kwh,
    });
  }
  return c.json({ ok: true });
});

export default utilities;
