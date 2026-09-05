import { Hono, type Context } from "hono";
import { eq, and, asc, inArray, isNull } from "drizzle-orm";
import {
  createCustomListSchema,
  updateCustomListSchema,
  createCustomListItemSchema,
  updateCustomListItemSchema,
  createListFolderSchema,
  updateListFolderSchema,
  reorderIdsSchema,
  type ListScope,
} from "@gfa/shared";
import { customList, customListItem, listFolder } from "../db/schema";
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

/**
 * Marque la liste comme modifiée par l'utilisateur courant. Appelé par **toute**
 * mutation, y compris celles qui portent sur un élément : le pied de la
 * sous-page annonce « Modifiée par X il y a … » pour la liste entière.
 */
async function touch(c: Context<AppContext>, listId: string) {
  await c
    .get("db")
    .update(customList)
    .set({ updatedAt: nowIso(), updatedBy: c.get("user").member })
    .where(eq(customList.id, listId));
}

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

/** Même contrôle d'accès, pour un dossier. */
async function ownedFolder(c: Context<AppContext>, folderId: string) {
  const row = (
    await c.get("db").select().from(listFolder).where(eq(listFolder.id, folderId)).limit(1)
  )[0];
  if (!row) return null;
  if (row.householdId !== c.get("household").id) return null;
  if (row.scope === "personal" && row.ownerId !== c.get("user").id) return null;
  return row;
}

/**
 * Une liste perso n'appartient qu'à son créateur, une liste partagée à personne :
 * la portée décide de la valeur d'`owner_id`, en lecture comme en écriture.
 */
const ownerFor = (c: Context<AppContext>, scope: ListScope) =>
  scope === "personal" ? c.get("user").id : null;

lists.get("/", async (c) => {
  const db = c.get("db");
  const scope: ListScope = c.req.query("scope") === "personal" ? "personal" : "shared";
  const hid = c.get("household").id;
  const owner = ownerFor(c, scope);

  const folders = await db
    .select()
    .from(listFolder)
    .where(
      and(
        eq(listFolder.householdId, hid),
        eq(listFolder.scope, scope),
        owner ? eq(listFolder.ownerId, owner) : isNull(listFolder.ownerId),
      ),
    )
    .orderBy(asc(listFolder.position), asc(listFolder.createdAt));

  const rows = await db
    .select()
    .from(customList)
    .where(
      and(
        eq(customList.householdId, hid),
        eq(customList.scope, scope),
        owner ? eq(customList.ownerId, owner) : isNull(customList.ownerId),
      ),
    )
    .orderBy(asc(customList.position), asc(customList.createdAt));

  // Un dossier supprimé ailleurs, ou hérité d'une bascule de portée, laisserait
  // des listes injoignables : on les considère à la racine.
  const folderIds = new Set(folders.map((f) => f.id));
  const folderOf = (r: (typeof rows)[number]) =>
    r.folderId && folderIds.has(r.folderId) ? r.folderId : null;

  const serializeFolders = folders.map((f) => ({
    id: f.id,
    scope: f.scope,
    name: f.name,
    emoji: f.emoji ?? null,
    listCount: rows.filter((r) => folderOf(r) === f.id).length,
  }));
  if (rows.length === 0) return c.json({ folders: serializeFolders, lists: [] });

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
    folders: serializeFolders,
    lists: rows.map((r) => ({
      id: r.id,
      scope: r.scope,
      folderId: folderOf(r),
      name: r.name,
      emoji: r.emoji ?? null,
      updatedAt: r.updatedAt ?? null,
      updatedBy: r.updatedBy ?? null,
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
  // Un dossier fourni doit exister, appartenir à l'utilisateur et à la même
  // portée : sinon la liste naîtrait dans un dossier qu'il ne voit pas.
  const folder = body.folderId ? await ownedFolder(c, body.folderId) : null;
  const id = newId();
  await db.insert(customList).values({
    id,
    householdId: hid,
    scope: body.scope,
    ownerId: ownerFor(c, body.scope),
    folderId: folder && folder.scope === body.scope ? folder.id : null,
    name: body.name,
    emoji: body.emoji || null,
    position: existing.reduce((max, r) => Math.max(max, r.position), 0) + 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    updatedBy: c.get("user").member,
  });
  return c.json({ ok: true, id }, 201);
});

/* ---------------- Dossiers ---------------- */

lists.post("/folders", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, createListFolderSchema);
  const hid = c.get("household").id;
  const owner = ownerFor(c, body.scope);
  const siblings = await db
    .select({ position: listFolder.position })
    .from(listFolder)
    .where(and(eq(listFolder.householdId, hid), eq(listFolder.scope, body.scope)));
  const id = newId();
  await db.insert(listFolder).values({
    id,
    householdId: hid,
    scope: body.scope,
    ownerId: owner,
    name: body.name,
    emoji: body.emoji || null,
    position: siblings.reduce((max, r) => Math.max(max, r.position), 0) + 1,
    createdAt: nowIso(),
  });
  return c.json({ ok: true, id }, 201);
});

/** Avant `/folders/:id`, sinon « reorder » passerait pour un id de dossier. */
lists.patch("/folders/reorder", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, reorderIdsSchema);
  let pos = 1;
  for (const id of body.orderedIds) {
    if (!(await ownedFolder(c, id))) continue;
    await db.update(listFolder).set({ position: pos }).where(eq(listFolder.id, id));
    pos += 1;
  }
  return c.json({ ok: true });
});

lists.patch("/folders/:id", async (c) => {
  const folder = await ownedFolder(c, c.req.param("id"));
  if (!folder) return c.json({ error: "not_found" }, 404);
  const body = await parseBody(c, updateListFolderSchema);
  await c
    .get("db")
    .update(listFolder)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.emoji !== undefined && { emoji: body.emoji || null }),
    })
    .where(eq(listFolder.id, folder.id));
  return c.json({ ok: true });
});

/**
 * Supprimer un dossier ne supprime pas les listes qu'il range : elles
 * remontent à la racine de l'onglet. Perdre un dossier d'un clic est
 * rattrapable, perdre son contenu ne l'est pas.
 */
lists.delete("/folders/:id", async (c) => {
  const folder = await ownedFolder(c, c.req.param("id"));
  if (!folder) return c.json({ error: "not_found" }, 404);
  const db = c.get("db");
  await db.update(customList).set({ folderId: null }).where(eq(customList.folderId, folder.id));
  await db.delete(listFolder).where(eq(listFolder.id, folder.id));
  return c.json({ ok: true });
});

/* ---------------- Listes ---------------- */

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
  const db = c.get("db");
  const body = await parseBody(c, updateCustomListSchema);

  // Bascule perso ↔ partagée : la portée décide du propriétaire, et la liste
  // repart en fin de l'onglet visé (ses voisines d'avant ne la suivent pas).
  const scope = (body.scope ?? list.scope) as ListScope;
  const scopeChanged = scope !== list.scope;
  let position = list.position;
  if (scopeChanged) {
    const siblings = await db
      .select({ position: customList.position })
      .from(customList)
      .where(and(eq(customList.householdId, list.householdId), eq(customList.scope, scope)));
    position = siblings.reduce((max, r) => Math.max(max, r.position), 0) + 1;
  }

  // Un dossier appartient à une portée : celui d'avant n'a plus de sens après
  // une bascule, et un dossier fourni doit être de la portée d'arrivée.
  let folderId = scopeChanged ? null : list.folderId;
  if (body.folderId !== undefined) {
    const target = body.folderId ? await ownedFolder(c, body.folderId) : null;
    folderId = target && target.scope === scope ? target.id : null;
  }

  await db
    .update(customList)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      // `emoji: null` retire l'emoji ; champ absent = on n'y touche pas.
      ...(body.emoji !== undefined && { emoji: body.emoji || null }),
      ...(scopeChanged && { scope, ownerId: ownerFor(c, scope), position }),
      folderId,
      updatedAt: nowIso(),
      updatedBy: c.get("user").member,
    })
    .where(eq(customList.id, list.id));
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
  await touch(c, list.id);
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
  await touch(c, list.id);
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
  await touch(c, list.id);
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
  await touch(c, list.id);
  return c.json({ ok: true });
});

export default lists;
