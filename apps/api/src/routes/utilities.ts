import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { updateUtilityPriceSchema, upsertUtilityReadingSchema } from "@gfa/shared";
import { household, utilityReading } from "../db/schema";
import { parseBody } from "../lib/validate";
import { newId } from "../lib/util";
import type { AppContext } from "../lib/types";

const utilities = new Hono<AppContext>();

/**
 * Relevés d'un fluide + tarif du foyer.
 *
 * On renvoie les lignes brutes plutôt que des agrégats : la page en tire des
 * vues différentes (année en cours, historique, comparaison mois par mois) et
 * recalculer côté serveur n'éviterait aucun aller-retour.
 */
utilities.get("/", async (c) => {
  const db = c.get("db");
  const utility = c.req.query("utility") ?? "electricity";
  const rows = await db
    .select()
    .from(utilityReading)
    .where(
      and(eq(utilityReading.householdId, c.get("household").id), eq(utilityReading.utility, utility)),
    );

  rows.sort((a, b) => b.year - a.year || b.month - a.month);
  return c.json({
    utility,
    pricePerKwh: c.get("household").electricityPriceKwh ?? null,
    readings: rows.map((r) => ({
      id: r.id,
      utility: r.utility,
      year: r.year,
      month: r.month,
      kwh: r.kwh,
    })),
  });
});

// Un mois ne porte qu'un relevé : ré-enregistrer le même mois le remplace.
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

/**
 * Tarif du kWh — config de foyer, mais servie et modifiée ici : c'est la seule
 * page qui s'en sert, et `/me` est sur le chemin critique de toutes les autres.
 */
utilities.patch("/price", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, updateUtilityPriceSchema);
  await db
    .update(household)
    .set({ electricityPriceKwh: body.pricePerKwh })
    .where(eq(household.id, c.get("household").id));
  return c.json({ ok: true });
});

utilities.delete("/:id", async (c) => {
  const db = c.get("db");
  await db
    .delete(utilityReading)
    .where(
      and(
        eq(utilityReading.id, c.req.param("id")),
        eq(utilityReading.householdId, c.get("household").id),
      ),
    );
  return c.json({ ok: true });
});

export default utilities;
