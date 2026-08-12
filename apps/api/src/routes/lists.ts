import { Hono, type Context } from "hono";
import { eq, and, asc, inArray, isNull } from "drizzle-orm";
import {
  createCustomListSchema,
  updateCustomListSchema,
  createCustomListItemSchema,
  updateCustomListItemSchema,
  reorderIdsSchema,
} from "@gfa/shared";
import { customList, customListItem } from "../db/schema";
import { parseBody } from "../lib/validate";
import { newId, nowIso } from "../lib/util";
import type { AppContext } from "../lib/types";

const lists = new Hono<AppContext>();

/**
 * Listes libres. Deux portées :
 * - `shared`   : partagée, visible de tout le foyer ;
 * - `personal` : privée, filtrée sur `owner_id` = utilisateur connecté (personne
 *   d'autre ne peut la lire ni la modifier, même dans le même foyer).
 *
 * Toute route qui touche une liste (ou un de ses éléments) passe par
 * `ownedList` : c'est le seul point de contrôle d'accès.
 */

/** Charge une liste si — et seulement si — l'utilisateur courant y a droit. */
async function ownedList(c: Context<AppContext>, listId: string) {
  const row = (
    await c.get("db").select().from(customList).where(eq(customList.id, listId)).limit(1)
  )[0];
  if (!row) return null;
  if (row.householdId !== c.get("household").id) return null;
  if (row.scope === "personal" && row.ownerId !== c.get("user").id) return null;
  return row;
}

lists.get("/", async (c) => {
  const db = c.get("db");
  const scope = c.req.query("scope") === "personal" ? "personal" : "shared";
  const rows = await db
    .select()
    .from(customList)
    .where(
      and(
        eq(customList.householdId, c.get("household").id),
        eq(customList.scope, scope),
        scope === "personal" ? eq(customList.ownerId, c.get("user").id) : isNull(customList.ownerId),
      ),
    )
    .orderBy(asc(customList.position), asc(customList.createdAt));
  if (rows.length === 0) return c.json({ lists: [] });

  const items = await db
    .select()
    .from(customListItem)
    .where(
      inArray(
        customListItem.listId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(customListItem.position), asc(customListItem.createdAt));

  return c.json({
    lists: rows.map((r) => ({
      id: r.id,
      scope: r.scope,
      name: r.name,
      items: items
        .filter((i) => i.listId === r.id)
        .map((i) => ({ id: i.id, label: i.label, done: !!i.done })),
    })),
  });
});

lists.post("/", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, createCustomListSchema);
  const hid = c.get("household").id;
  const existing = await db
    .select({ position: customList.position })
    .from(customList)
    .where(and(eq(customList.householdId, hid), eq(customList.scope, body.scope)));
  const id = newId();
  await db.insert(customList).values({
    id,
    householdId: hid,
    scope: body.scope,
    ownerId: body.scope === "personal" ? c.get("user").id : null,
    name: body.name,
    position: existing.reduce((max, r) => Math.max(max, r.position), 0) + 1,
    createdAt: nowIso(),
  });
  return c.json({ ok: true, id }, 201);
});

/** Avant `/:id` : sinon « reorder » serait capté comme un id de liste. */
lists.patch("/reorder", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, reorderIdsSchema);
  let pos = 1;
  for (const id of body.orderedIds) {
    if (!(await ownedList(c, id))) continue;
    await db.update(customList).set({ position: pos }).where(eq(customList.id, id));
    pos += 1;
  }
  return c.json({ ok: true });
});

lists.patch("/:id", async (c) => {
  const list = await ownedList(c, c.req.param("id"));
  if (!list) return c.json({ error: "not_found" }, 404);
  const body = await parseBody(c, updateCustomListSchema);
  await c.get("db").update(customList).set({ name: body.name }).where(eq(customList.id, list.id));
  return c.json({ ok: true });
});

lists.delete("/:id", async (c) => {
  const list = await ownedList(c, c.req.param("id"));
  if (!list) return c.json({ error: "not_found" }, 404);
  await c.get("db").delete(customListItem).where(eq(customListItem.listId, list.id));
  await c.get("db").delete(customList).where(eq(customList.id, list.id));
  return c.json({ ok: true });
});

/* ---------------- Éléments d'une liste ---------------- */

lists.post("/:id/items", async (c) => {
  const list = await ownedList(c, c.req.param("id"));
  if (!list) return c.json({ error: "not_found" }, 404);
  const db = c.get("db");
  const body = await parseBody(c, createCustomListItemSchema);
  const siblings = await db
    .select({ position: customListItem.position })
    .from(customListItem)
    .where(eq(customListItem.listId, list.id));
  const id = newId();
  await db.insert(customListItem).values({
    id,
    listId: list.id,
    label: body.label,
    done: 0,
    position: siblings.reduce((max, r) => Math.max(max, r.position), 0) + 1,
    createdAt: nowIso(),
  });
  return c.json({ ok: true, id }, 201);
});

lists.patch("/:id/items/reorder", async (c) => {
  const list = await ownedList(c, c.req.param("id"));
  if (!list) return c.json({ error: "not_found" }, 404);
  const db = c.get("db");
  const body = await parseBody(c, reorderIdsSchema);
  let pos = 1;
  for (const id of body.orderedIds) {
    await db
      .update(customListItem)
      .set({ position: pos })
      .where(and(eq(customListItem.id, id), eq(customListItem.listId, list.id)));
    pos += 1;
  }
  return c.json({ ok: true });
});

lists.patch("/:id/items/:itemId", async (c) => {
  const list = await ownedList(c, c.req.param("id"));
  if (!list) return c.json({ error: "not_found" }, 404);
  const body = await parseBody(c, updateCustomListItemSchema);
  await c
    .get("db")
    .update(customListItem)
    .set({
      ...(body.label !== undefined && { label: body.label }),
      ...(body.done !== undefined && { done: body.done ? 1 : 0 }),
    })
    .where(
      and(eq(customListItem.id, c.req.param("itemId")), eq(customListItem.listId, list.id)),
    );
  return c.json({ ok: true });
});

lists.delete("/:id/items/:itemId", async (c) => {
  const list = await ownedList(c, c.req.param("id"));
  if (!list) return c.json({ error: "not_found" }, 404);
  await c
    .get("db")
    .delete(customListItem)
    .where(
      and(eq(customListItem.id, c.req.param("itemId")), eq(customListItem.listId, list.id)),
    );
  return c.json({ ok: true });
});

export default lists;
