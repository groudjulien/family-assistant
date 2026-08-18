import { Hono } from "hono";
import { eq, and, asc, desc, inArray } from "drizzle-orm";
import {
  createTripSchema,
  updateTripSchema,
  createTripItemSchema,
  updateTripItemSchema,
  createTripExpenseSchema,
  updateTripExpenseSchema,
  createTripPackingItemSchema,
  updateTripPackingItemSchema,
  PACKING_CATEGORIES,

} from "@gfa/shared";
import type { DefaultPackingItem, PackingCategory, PackingPerson } from "@gfa/shared";
import {
  trip,
  tripItem,
  tripExpense,
  tripPackingItem,
  transaction,
  account,
  googleOauthToken,
} from "../db/schema";
import { parseBody } from "../lib/validate";
import { newId, nowIso } from "../lib/util";
import {
  refreshAccessToken,
  searchGmailIds,
  getGmailMessage,
  listCalendars,
  listEvents,
} from "../lib/google";
import { callClaude, resolveAnthropicKey } from "../lib/anthropic";
import type { AppContext, Db } from "../lib/types";

const trips = new Hono<AppContext>();

const TYPES = new Set(["transport", "lodging", "activity"]);
const MODES = new Set(["voiture", "train", "avion", "bateau", "bus"]);
function stripFences(s: string): string {
  const m = s.trim().match(/```(?:json)?\s*([\s\S]*?)```/);
  return (m ? m[1] : s).trim();
}

/* ---------------- Voyages ---------------- */

trips.get("/", async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(trip)
    .where(eq(trip.householdId, c.get("household").id))
    .orderBy(asc(trip.startDate));
  return c.json(
    rows.map((t) => ({
      id: t.id,
      name: t.name,
      emoji: t.emoji ?? null,
      startDate: t.startDate,
      endDate: t.endDate,
      budget: t.budget,
      archived: !!t.archived,
    })),
  );
});

/** Étapes de tous les voyages tombant dans la fenêtre [from, to] (widget accueil). */
trips.get("/upcoming", async (c) => {
  const db = c.get("db");
  const url = new URL(c.req.url);
  const from = url.searchParams.get("from") ?? new Date().toISOString().slice(0, 10);
  const to = url.searchParams.get("to") ?? new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

  const trs = await db.select().from(trip).where(eq(trip.householdId, c.get("household").id));
  if (trs.length === 0) return c.json([]);
  const nameById = new Map(trs.map((t) => [t.id, t.name]));

  const items = await db
    .select()
    .from(tripItem)
    .where(inArray(tripItem.tripId, trs.map((t) => t.id)))
    .orderBy(asc(tripItem.startAt));

  const day = (s: string | null) => (s ? s.slice(0, 10) : null);
  const inWindow = (it: (typeof items)[number]) => {
    const start = day(it.startAt);
    if (!start) return false;
    if (it.type === "lodging") {
      const end = day(it.endAt) ?? start;
      return start <= to && end >= from; // séjour qui chevauche la fenêtre
    }
    return start >= from && start <= to;
  };

  return c.json(
    items.filter(inWindow).map((it) => ({ ...it, tripName: nameById.get(it.tripId) ?? "" })),
  );
});

/**
 * Liste d'affaires par défaut du foyer, parsée défensivement. Accepte l'ancien
 * format (tableau de libellés) en plus du format { label, category, person }.
 */
function defaultPackingItems(raw: string | null): DefaultPackingItem[] {
  const asCategory = (v: unknown): PackingCategory =>
    PACKING_CATEGORIES.includes(v as PackingCategory) ? (v as PackingCategory) : "autre";
  const asPerson = (v: unknown): PackingPerson =>
    typeof v === "string" && v.trim() ? v : "famille";
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(v)) return [];
    return v.flatMap((e): DefaultPackingItem[] => {
      if (typeof e === "string")
        return e.trim() ? [{ label: e, category: "autre", person: "famille" }] : [];
      if (e && typeof e === "object" && typeof e.label === "string" && e.label.trim())
        return [{ label: e.label, category: asCategory(e.category), person: asPerson(e.person) }];
      return [];
    });
  } catch {
    return [];
  }
}

// D1 limite chaque requête à 100 variables liées. Une ligne d'affaire en consomme
// 9 (id, foyer, voyage, libellé, catégorie, personne, cochée, position, date) →
// 10 lignes max par requête, comme pour l'import de relevé bancaire. SQLite en
// local en accepte 999 : sans ce découpage, ça ne casse qu'en production.
const PACKING_ROWS_PER_STATEMENT = 10;

async function insertPackingRows(db: Db, rows: (typeof tripPackingItem.$inferInsert)[]) {
  if (rows.length === 0) return;
  const stmts = [];
  for (let i = 0; i < rows.length; i += PACKING_ROWS_PER_STATEMENT) {
    stmts.push(db.insert(tripPackingItem).values(rows.slice(i, i + PACKING_ROWS_PER_STATEMENT)));
  }
  await db.batch(stmts as unknown as Parameters<typeof db.batch>[0]);
}

trips.post("/", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, createTripSchema);
  const id = newId();
  const householdId = c.get("household").id;
  await db.insert(trip).values({
    id,
    householdId,
    name: body.name,
    emoji: body.emoji ?? null,
    startDate: body.startDate ?? null,
    endDate: body.endDate ?? null,
    budget: body.budget ?? null,
    createdAt: nowIso(),
  });
  // Injection de la liste d'affaires par défaut dans le nouveau voyage.
  // Isolée dans un try/catch : le voyage est déjà créé à ce stade, une erreur
  // ici (schéma en retard sur l'environnement…) renverrait un 500 alors que le
  // voyage existe — symptôme très déroutant côté client.
  const defaults = defaultPackingItems(c.get("household").defaultPacking);
  if (defaults.length > 0) {
    const now = nowIso();
    try {
      await insertPackingRows(
        db,
        defaults.map((d, i) => ({
          id: newId(),
          householdId,
          tripId: id,
          label: d.label,
          category: d.category,
          person: d.person,
          position: i,
          createdAt: now,
        })),
      );
    } catch (e) {
      // Visible via `wrangler tail` ; le voyage reste créé, la liste pourra être
      // ajoutée depuis l'onglet valise (« + Liste par défaut »).
      console.error("trips: injection de la liste d'affaires par défaut impossible", e);
    }
  }
  return c.json({ ok: true, id }, 201);
});

trips.patch("/:id", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, updateTripSchema);
  await db
    .update(trip)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.emoji !== undefined && { emoji: body.emoji || null }),
      ...(body.startDate !== undefined && { startDate: body.startDate ?? null }),
      ...(body.endDate !== undefined && { endDate: body.endDate ?? null }),
      ...(body.budget !== undefined && { budget: body.budget ?? null }),
      ...(body.archived !== undefined && { archived: body.archived ? 1 : 0 }),
    })
    .where(eq(trip.id, c.req.param("id")));
  return c.json({ ok: true });
});

trips.delete("/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  await db.delete(tripItem).where(eq(tripItem.tripId, id));
  await db.delete(tripPackingItem).where(eq(tripPackingItem.tripId, id));
  await db.delete(trip).where(eq(trip.id, id));
  return c.json({ ok: true });
});

/* ---------------- Affaires à prendre (valise) ---------------- */

const packingRow = (r: typeof tripPackingItem.$inferSelect) => ({
  id: r.id,
  tripId: r.tripId,
  label: r.label,
  category: (PACKING_CATEGORIES.includes(r.category as PackingCategory)
    ? r.category
    : "autre") as PackingCategory,
  person: (r.person?.trim() ? r.person : "famille") as PackingPerson,
  checked: !!r.checked,
  position: r.position,
});

trips.get("/:id/packing", async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(tripPackingItem)
    .where(
      and(
        eq(tripPackingItem.householdId, c.get("household").id),
        eq(tripPackingItem.tripId, c.req.param("id")),
      ),
    )
    .orderBy(asc(tripPackingItem.position));
  return c.json(rows.map(packingRow));
});

trips.post("/:id/packing", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, createTripPackingItemSchema);
  const tripId = c.req.param("id");
  const existing = await db
    .select()
    .from(tripPackingItem)
    .where(eq(tripPackingItem.tripId, tripId));
  const id = newId();
  await db.insert(tripPackingItem).values({
    id,
    householdId: c.get("household").id,
    tripId,
    label: body.label,
    category: body.category,
    person: body.person,
    position: existing.length,
    createdAt: nowIso(),
  });
  return c.json({ ok: true, id }, 201);
});

/** Ajoute la liste par défaut du foyer (utile pour un voyage créé avant sa définition). */
trips.post("/:id/packing/from-default", async (c) => {
  const db = c.get("db");
  const tripId = c.req.param("id");
  const householdId = c.get("household").id;
  const defaults = defaultPackingItems(c.get("household").defaultPacking);
  const existing = await db.select().from(tripPackingItem).where(eq(tripPackingItem.tripId, tripId));
  // Identité = libellé + personne : « T-shirt » pour a et pour b sont
  // deux affaires distinctes, seul le doublon exact est écarté.
  const key = (label: string, person: string) => `${label.toLowerCase()}|${person}`;
  const known = new Set(existing.map((r) => key(r.label, r.person)));
  const toAdd = defaults.filter((d) => !known.has(key(d.label, d.person)));
  if (toAdd.length > 0) {
    const now = nowIso();
    await insertPackingRows(
      db,
      toAdd.map((d, i) => ({
        id: newId(),
        householdId,
        tripId,
        label: d.label,
        category: d.category,
        person: d.person,
        position: existing.length + i,
        createdAt: now,
      })),
    );
  }
  return c.json({ added: toAdd.length });
});

trips.patch("/packing/:itemId", async (c) => {
  const body = await parseBody(c, updateTripPackingItemSchema);
  await c
    .get("db")
    .update(tripPackingItem)
    .set({
      ...(body.label !== undefined && { label: body.label }),
      ...(body.category !== undefined && { category: body.category }),
      ...(body.person !== undefined && { person: body.person }),
      ...(body.checked !== undefined && { checked: body.checked ? 1 : 0 }),
    })
    .where(
      and(
        eq(tripPackingItem.householdId, c.get("household").id),
        eq(tripPackingItem.id, c.req.param("itemId")),
      ),
    );
  return c.json({ ok: true });
});

trips.delete("/packing/:itemId", async (c) => {
  await c
    .get("db")
    .delete(tripPackingItem)
    .where(
      and(
        eq(tripPackingItem.householdId, c.get("household").id),
        eq(tripPackingItem.id, c.req.param("itemId")),
      ),
    );
  return c.json({ ok: true });
});

/* ---------------- Étapes ---------------- */

trips.get("/:id/items", async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(tripItem)
    .where(
      and(eq(tripItem.householdId, c.get("household").id), eq(tripItem.tripId, c.req.param("id"))),
    )
    .orderBy(asc(tripItem.startAt));
  return c.json(rows);
});

trips.post("/:id/items", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, createTripItemSchema);
  const id = newId();
  await db.insert(tripItem).values({
    id,
    householdId: c.get("household").id,
    tripId: c.req.param("id"),
    type: body.type,
    mode: body.mode ?? null,
    title: body.title ?? null,
    fromPlace: body.fromPlace ?? null,
    toPlace: body.toPlace ?? null,
    address: body.address ?? null,
    url: body.url ?? null,
    description: body.description ?? null,
    startAt: body.startAt ?? null,
    endAt: body.endAt ?? null,
    createdAt: nowIso(),
  });
  return c.json({ ok: true, id }, 201);
});

trips.patch("/items/:itemId", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, updateTripItemSchema);
  await db
    .update(tripItem)
    .set({
      ...(body.mode !== undefined && { mode: body.mode ?? null }),
      ...(body.title !== undefined && { title: body.title ?? null }),
      ...(body.fromPlace !== undefined && { fromPlace: body.fromPlace ?? null }),
      ...(body.toPlace !== undefined && { toPlace: body.toPlace ?? null }),
      ...(body.address !== undefined && { address: body.address ?? null }),
      ...(body.url !== undefined && { url: body.url ?? null }),
      ...(body.description !== undefined && { description: body.description ?? null }),
      ...(body.startAt !== undefined && { startAt: body.startAt ?? null }),
      ...(body.endAt !== undefined && { endAt: body.endAt ?? null }),
    })
    .where(eq(tripItem.id, c.req.param("itemId")));
  return c.json({ ok: true });
});

trips.delete("/items/:itemId", async (c) => {
  const db = c.get("db");
  const itemId = c.req.param("itemId");
  const rows = await db.select().from(tripItem).where(eq(tripItem.id, itemId)).limit(1);
  if (rows[0]?.fileKey) await c.env.FILES.delete(rows[0].fileKey);
  await db.delete(tripItem).where(eq(tripItem.id, itemId));
  return c.json({ ok: true });
});

/* ---------------- Fichier (billet) sur une étape ---------------- */

trips.put("/items/:itemId/file", async (c) => {
  const db = c.get("db");
  const itemId = c.req.param("itemId");
  const fileName = decodeURIComponent(c.req.query("name") ?? "fichier");
  const body = await c.req.arrayBuffer();
  if (!body || body.byteLength === 0) return c.json({ error: "empty" }, 400);
  const key = `trips/${itemId}/${Date.now()}-${fileName}`;
  await c.env.FILES.put(key, body, {
    httpMetadata: { contentType: c.req.header("content-type") || "application/octet-stream" },
  });
  // remplace l'éventuel fichier précédent
  const prev = await db.select().from(tripItem).where(eq(tripItem.id, itemId)).limit(1);
  if (prev[0]?.fileKey) await c.env.FILES.delete(prev[0].fileKey);
  await db.update(tripItem).set({ fileKey: key, fileName }).where(eq(tripItem.id, itemId));
  return c.json({ ok: true, fileName });
});

trips.get("/items/:itemId/file", async (c) => {
  const db = c.get("db");
  const rows = await db.select().from(tripItem).where(eq(tripItem.id, c.req.param("itemId"))).limit(1);
  const it = rows[0];
  if (!it?.fileKey) return c.json({ error: "not_found" }, 404);
  const obj = await c.env.FILES.get(it.fileKey);
  if (!obj) return c.json({ error: "not_found" }, 404);
  const headers = new Headers();
  headers.set("content-type", obj.httpMetadata?.contentType || "application/octet-stream");
  headers.set("content-disposition", `inline; filename="${encodeURIComponent(it.fileName ?? "fichier")}"`);
  return new Response(obj.body, { headers });
});

trips.delete("/items/:itemId/file", async (c) => {
  const db = c.get("db");
  const itemId = c.req.param("itemId");
  const rows = await db.select().from(tripItem).where(eq(tripItem.id, itemId)).limit(1);
  if (rows[0]?.fileKey) await c.env.FILES.delete(rows[0].fileKey);
  await db.update(tripItem).set({ fileKey: null, fileName: null }).where(eq(tripItem.id, itemId));
  return c.json({ ok: true });
});

/* ---------------- Dépenses sur place d'un voyage ---------------- */

trips.get("/:id/expenses", async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(tripExpense)
    .where(
      and(eq(tripExpense.tripId, c.req.param("id")), eq(tripExpense.householdId, c.get("household").id)),
    )
    .orderBy(desc(tripExpense.date), desc(tripExpense.createdAt));
  return c.json(rows);
});

trips.post("/:id/expenses", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, createTripExpenseSchema);
  const id = newId();
  await db.insert(tripExpense).values({
    id,
    householdId: c.get("household").id,
    tripId: c.req.param("id"),
    label: body.label,
    amount: body.amount,
    paidBy: body.paidBy,
    shareA: body.shareA,
    shareB: body.shareB,
    date: body.date,
    category: body.category ?? null,
    pushedAt: null,
    createdAt: nowIso(),
  });
  return c.json({ ok: true, id }, 201);
});

trips.patch("/expenses/:expenseId", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, updateTripExpenseSchema);
  await db
    .update(tripExpense)
    .set({
      ...(body.label !== undefined && { label: body.label }),
      ...(body.amount !== undefined && { amount: body.amount }),
      ...(body.paidBy !== undefined && { paidBy: body.paidBy }),
      ...(body.shareA !== undefined && { shareA: body.shareA }),
      ...(body.shareB !== undefined && { shareB: body.shareB }),
      ...(body.date !== undefined && { date: body.date }),
      ...(body.category !== undefined && { category: body.category ?? null }),
    })
    .where(
      and(
        eq(tripExpense.id, c.req.param("expenseId")),
        eq(tripExpense.householdId, c.get("household").id),
      ),
    );
  return c.json({ ok: true });
});

trips.delete("/expenses/:expenseId", async (c) => {
  await c
    .get("db")
    .delete(tripExpense)
    .where(
      and(
        eq(tripExpense.id, c.req.param("expenseId")),
        eq(tripExpense.householdId, c.get("household").id),
      ),
    );
  return c.json({ ok: true });
});

/**
 * Ajoute les dépenses non encore poussées à l'équilibrage sous forme de DEUX lignes
 * de synthèse par voyage : « Somme voyage "X" dépensé par <membre> » avec le
 * montant total et les parts agrégées (le solde net est identique à un push ligne à
 * ligne, mais l'équilibrage reste lisible).
 */
trips.post("/:id/expenses/push", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const tripId = c.req.param("id");
  const t = (
    await db.select().from(trip).where(and(eq(trip.id, tripId), eq(trip.householdId, hid))).limit(1)
  )[0];
  if (!t) return c.json({ error: "not_found" }, 404);

  const rows = await db
    .select()
    .from(tripExpense)
    .where(and(eq(tripExpense.tripId, tripId), eq(tripExpense.householdId, hid)));

  // Idempotent : on repart des lignes de synthèse existantes de CE voyage (supprimées
  // puis recréées depuis toutes les dépenses actuelles) — évite les doublons et gère
  // le cas où l'utilisateur a supprimé les lignes d'équilibrage entre-temps.
  await db
    .delete(transaction)
    .where(and(eq(transaction.householdId, hid), eq(transaction.tripId, tripId)));

  if (rows.length === 0) return c.json({ added: 0 });

  const accts = await db.select().from(account).where(eq(account.householdId, hid));
  const pickAccount = (payer: string) =>
    accts.find((a) => a.owner === payer)?.id ??
    accts.find((a) => a.owner === "joint")?.id ??
    accts[0]?.id;

  const h = c.get("household");
  const PAYERS = ["a", "b"] as const;
  const PAYER_LABEL: Record<(typeof PAYERS)[number], string> = { a: h.memberAName, b: h.memberBName };
  const now = nowIso();
  let added = 0;
  for (const payer of PAYERS) {
    const group = rows.filter((e) => e.paidBy === payer);
    if (group.length === 0) continue;
    const accountId = pickAccount(payer);
    if (!accountId) continue;
    const sum = (f: (e: (typeof group)[number]) => number) => group.reduce((s, e) => s + f(e), 0);
    const date = group.reduce((mx, e) => (e.date > mx ? e.date : mx), group[0].date);
    await db.insert(transaction).values({
      id: newId(),
      householdId: hid,
      accountId,
      categoryId: null,
      label: `Somme voyage « ${t.name} » dépensé par ${PAYER_LABEL[payer]}`,
      amount: sum((e) => e.amount),
      paidBy: payer,
      shareA: sum((e) => e.shareA),
      shareB: sum((e) => e.shareB),
      date,
      kind: "actual",
      recurringId: null,
      tripId,
      createdBy: c.get("user").id,
    });
    added += 1;
  }
  await db.update(tripExpense).set({ pushedAt: now }).where(inArray(tripExpense.id, rows.map((e) => e.id)));
  return c.json({ added });
});

/* ---------------- Remplissage auto depuis les emails ---------------- */

trips.post("/:id/autofill", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const tripId = c.req.param("id");
  const t = (await db.select().from(trip).where(eq(trip.id, tripId)).limit(1))[0];
  if (!t) return c.json({ error: "not_found" }, 404);

  const tok = (
    await db.select().from(googleOauthToken).where(eq(googleOauthToken.userId, c.get("user").id)).limit(1)
  )[0];
  if (!tok) return c.json({ error: "no_google_token" }, 400);

  let token: string;
  try {
    token = await refreshAccessToken(c.env, tok.refreshToken);
  } catch {
    return c.json({ error: "google_auth" }, 400);
  }

  // Recherche d'emails de voyage : expéditeurs connus + mots-clés + destination.
  // On n'exige PAS le nom du voyage (les billets Trainline/Ryanair/Airbnb ne le contiennent pas).
  const senders = [
    "trainline",
    "ryanair",
    "airbnb",
    "booking.com",
    "sncf",
    "easyjet",
    "transavia",
    "vueling",
    "expedia",
    "hotels.com",
    "agoda",
    "trenitalia",
    "italo",
    "kayak",
    "lastminute",
    "opodo",
  ];
  const keywords = [
    "réservation",
    "confirmation",
    "billet",
    "booking",
    "itinéraire",
    "e-ticket",
    "boarding",
    "embarquement",
    "vol",
    "check-in",
    t.name,
  ];
  const q =
    `newer_than:1y (` +
    `from:(${senders.join(" OR ")})` +
    ` OR subject:(${keywords.map((k) => `"${k}"`).join(" OR ")})` +
    `)`;
  let emails: { subject: string; from: string; date: string; text: string }[] = [];
  try {
    const ids = await searchGmailIds(token, q, 40);
    emails = await Promise.all(ids.map((id) => getGmailMessage(token, id)));
  } catch (e) {
    const detail = String(e);
    const scope = /scope/i.test(detail) || /insufficient/i.test(detail) || /403/.test(detail);
    return c.json({ error: scope ? "gmail_scope" : "gmail", detail }, 400);
  }
  // Événements de l'agenda Google sur la période du voyage (hôtels, vols, activités).
  const calTimeMin = t.startDate ? `${t.startDate}T00:00:00Z` : new Date().toISOString();
  const calTimeMax = t.endDate
    ? `${t.endDate}T23:59:59Z`
    : new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  let events: { summary: string; location: string | null; description: string | null; start: string; end: string }[] = [];
  try {
    const cals = await listCalendars(token);
    const lists = await Promise.all(
      cals.map((cl) => listEvents(token, cl.id, calTimeMin, calTimeMax).catch(() => [])),
    );
    events = lists.flat();
  } catch {
    /* agenda indisponible — on continue avec les emails seuls */
  }

  if (emails.length === 0 && events.length === 0) return c.json({ added: 0, items: [] });

  // On plafonne CHAQUE email (les infos clés d'une résa — dates, adresse, n° — sont en haut)
  // pour qu'AUCUN email long (Booking/Airbnb) ne consomme tout le budget et n'évince les suivants.
  const emailPart = emails
    .map(
      (e, i) =>
        `--- EMAIL ${i + 1} ---\nDe: ${e.from}\nObjet: ${e.subject}\nDate: ${e.date}\n${e.text.slice(0, 2500)}`,
    )
    .join("\n\n");

  const calendarPart = events
    .slice(0, 80)
    .map(
      (e, i) =>
        `--- AGENDA ${i + 1} ---\nTitre: ${e.summary}\nLieu: ${e.location ?? ""}\nDébut: ${e.start}\nFin: ${e.end}\n${(e.description ?? "").slice(0, 800)}`,
    )
    .join("\n\n");

  const corpus = [emailPart, calendarPart].filter(Boolean).join("\n\n").slice(0, 130000);

  const system = [
    `Tu extrais les étapes d'un voyage nommé "${t.name}"`,
    t.startDate ? `du ${t.startDate}` : "",
    t.endDate ? `au ${t.endDate}` : "",
    "à partir de DEUX sources : des emails (blocs '--- EMAIL n ---') ET les événements de l'agenda Google sur la période (blocs '--- AGENDA n ---').",
    "Croise les deux sources : un même hôtel/vol/activité peut apparaître dans l'email ET dans l'agenda — ne le compte qu'une fois. Un événement d'agenda 'Vol …', 'Hôtel …', 'Nuit à …', une visite ou réservation est une étape pertinente à extraire (le Lieu de l'agenda peut servir d'adresse).",
    "Renvoie UNIQUEMENT un objet JSON valide, sans texte ni balises markdown autour.",
    'Format : {"items":[{"type":"transport"|"lodging"|"activity","mode":"voiture"|"train"|"avion"|"bateau"|null,"title":string|null,"fromPlace":string|null,"toPlace":string|null,"address":string|null,"url":string|null,"description":string|null,"startAt":string|null,"endAt":string|null}]}.',
    "Pour transport: startAt=départ, endAt=arrivée, au format ISO 'YYYY-MM-DDTHH:mm'. mode obligatoire parmi voiture|train|avion|bateau|bus (train pour Trainline/SNCF/Trenitalia/Italo, avion pour Ryanair/easyJet/Transavia/Vueling, bus pour FlixBus/BlaBlaBus/autocar).",
    "Pour lodging: startAt=date d'arrivée, endAt=date de départ au format 'YYYY-MM-DD', address et url si dispo (ex. lien Airbnb/Booking).",
    "Pour activity: startAt='YYYY-MM-DDTHH:mm'.",
    "Analyse bien CHAQUE email (vols Ryanair, trains Trainline, logements Airbnb/Booking/hôtel, etc.) et déduis l'année à partir du contexte si besoin.",
    "Sois EXHAUSTIF sur les logements : il peut y en avoir plusieurs (Airbnb, Booking, hôtel) sur un même voyage — crée un item lodging pour CHACUN, ne t'arrête pas au premier. Deux logements aux dates différentes sont deux étapes distinctes.",
    "N'inclus QUE les étapes dont la date tombe dans la période du voyage indiquée. Ignore les réservations d'autres voyages/dates. Si rien ne correspond, renvoie items vide.",
  ]
    .filter(Boolean)
    .join(" ");

  const apiKey = await resolveAnthropicKey(c.get("household"), c.env);
  if (!apiKey) return c.json({ error: "no_api_key" }, 400);

  let parsed: { items?: Record<string, unknown>[] };
  try {
    const result = await callClaude(
      apiKey,
      "claude-sonnet-4-6",
      system,
      [{ role: "user", content: corpus }],
      2048,
    );
    parsed = JSON.parse(stripFences(result.text));
  } catch {
    return c.json({ error: "extract_failed" }, 502);
  }

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const norm = (s: string | null) =>
    (s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]/g, "");
  const day = (s: string | null) => (s ? s.slice(0, 10) : "");

  // Signature tolérante (insensible aux variations de libellé produites par l'IA) :
  // - logement : type + jour d'arrivée + jour de départ
  // - transport : type + jour + mode + trajet (ou heure si trajet inconnu)
  // - activité : type + jour + début de titre normalisé
  const sigOf = (it: {
    type: string;
    mode: string | null;
    title: string | null;
    fromPlace: string | null;
    toPlace: string | null;
    startAt: string | null;
    endAt: string | null;
  }): string => {
    const d = day(it.startAt);
    if (it.type === "lodging") return `lodging|${d}|${day(it.endAt)}`;
    if (it.type === "transport") {
      const route = norm(`${it.fromPlace ?? ""}>${it.toPlace ?? ""}`);
      return `transport|${d}|${it.mode ?? ""}|${route || (it.startAt ?? "").slice(11, 16)}`;
    }
    return `activity|${d}|${norm(it.title).slice(0, 24)}`;
  };

  const existing = await db.select().from(tripItem).where(eq(tripItem.tripId, tripId));
  const seen = new Set(existing.map((e) => sigOf(e)));

  let added = 0;
  for (const raw of parsed.items ?? []) {
    const type = str(raw.type);
    if (!type || !TYPES.has(type)) continue;
    const mode = str(raw.mode);
    const item = {
      id: newId(),
      householdId: hid,
      tripId,
      type,
      mode: type === "transport" && mode && MODES.has(mode) ? mode : null,
      title: str(raw.title),
      fromPlace: str(raw.fromPlace),
      toPlace: str(raw.toPlace),
      address: str(raw.address),
      url: str(raw.url),
      description: str(raw.description),
      startAt: str(raw.startAt),
      endAt: str(raw.endAt),
      createdAt: nowIso(),
    };
    const key = sigOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    await db.insert(tripItem).values(item);
    added++;
  }

  return c.json({ added });
});

export default trips;
