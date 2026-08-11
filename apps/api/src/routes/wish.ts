import { Hono } from "hono";
import { eq, and, asc } from "drizzle-orm";
import { createWishSchema, updateWishSchema } from "@gfa/shared";
import { wish } from "../db/schema";
import { parseBody } from "../lib/validate";
import { newId, nowIso } from "../lib/util";
import type { AppContext } from "../lib/types";

const wishes = new Hono<AppContext>();

/** Tous les souhaits du foyer (le front sépare « à faire » / « fait » et par personne). */
wishes.get("/", async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(wish)
    .where(eq(wish.householdId, c.get("household").id))
    .orderBy(asc(wish.createdAt));
  return c.json(
    rows.map((w) => ({
      id: w.id,
      owner: w.owner,
      name: w.name,
      icon: w.icon,
      description: w.description,
      url: w.url,
      address: w.address,
      date: w.date,
      feasibility: w.feasibility,
      starred: !!w.starred,
      doneAt: w.doneAt,
    })),
  );
});

wishes.post("/", async (c) => {
  const body = await parseBody(c, createWishSchema);
  const id = newId();
  await c.get("db").insert(wish).values({
    id,
    householdId: c.get("household").id,
    owner: body.owner,
    name: body.name,
    icon: body.icon ?? null,
    description: body.description ?? null,
    url: body.url ?? null,
    address: body.address ?? null,
    date: body.date ?? null,
    feasibility: body.feasibility ?? null,
    createdAt: nowIso(),
  });
  return c.json({ ok: true, id }, 201);
});

wishes.patch("/:id", async (c) => {
  const body = await parseBody(c, updateWishSchema);
  await c
    .get("db")
    .update(wish)
    .set({
      ...(body.owner !== undefined && { owner: body.owner }),
      ...(body.name !== undefined && { name: body.name }),
      ...(body.icon !== undefined && { icon: body.icon ?? null }),
      ...(body.description !== undefined && { description: body.description ?? null }),
      ...(body.url !== undefined && { url: body.url ?? null }),
      ...(body.address !== undefined && { address: body.address ?? null }),
      ...(body.date !== undefined && { date: body.date ?? null }),
      ...(body.feasibility !== undefined && { feasibility: body.feasibility ?? null }),
      ...(body.starred !== undefined && { starred: body.starred ? 1 : 0 }),
      ...(body.doneAt !== undefined && { doneAt: body.doneAt ?? null }),
    })
    .where(and(eq(wish.householdId, c.get("household").id), eq(wish.id, c.req.param("id"))));
  return c.json({ ok: true });
});

wishes.delete("/:id", async (c) => {
  await c
    .get("db")
    .delete(wish)
    .where(and(eq(wish.householdId, c.get("household").id), eq(wish.id, c.req.param("id"))));
  return c.json({ ok: true });
});

export default wishes;
