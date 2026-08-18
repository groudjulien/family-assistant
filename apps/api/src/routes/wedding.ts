import { Hono } from "hono";
import { eq, asc } from "drizzle-orm";
import {
  createWeddingBudgetItemSchema,
  createSavingsContributionSchema,
  createWeddingPaymentSchema,
  createWeddingTodoSchema,
  createWeddingGuestSchema,
  updateWeddingGuestSchema,
  reorderGuestsSchema,
  reorderWeddingBudgetSchema,
  isAllowedWeddingFile,
  WEDDING_FILE_MAX_BYTES,
  updateWeddingTargetSchema,
  initWeddingSavingsSchema,
  WEDDING_SAVINGS_MAX_MONTHS,
  WEDDING_BUDGET_TEMPLATE,
  setWeddingDaysSchema,
  parseWeddingDays,
  type WeddingSummary,
} from "@gfa/shared";
import {
  weddingBudgetItem,
  weddingBudgetFile,
  savingsContribution,
  weddingPayment,
  weddingTodo,
  weddingGuest,
  account,
  household,
} from "../db/schema";
import { parseBody } from "../lib/validate";
import { newId } from "../lib/util";
import type { AppContext } from "../lib/types";
import type { Db } from "../lib/types";
import type { DbHousehold } from "../db/schema";

const wedding = new Hono<AppContext>();

/* ---------------- Budget ---------------- */

wedding.get("/budget", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select()
    .from(weddingBudgetItem)
    .where(eq(weddingBudgetItem.householdId, c.get("household").id))
    .orderBy(asc(weddingBudgetItem.position));
  return c.json(rows.map((r) => ({ ...r, optional: Boolean(r.optional), done: Boolean(r.done) })));
});

wedding.post("/budget", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, createWeddingBudgetItemSchema);
  const id = newId();
  await db.insert(weddingBudgetItem).values({
    id,
    householdId: c.get("household").id,
    groupName: body.groupName,
    prestataire: body.prestataire ?? null,
    label: body.label,
    amount: body.amount,
    note: body.note ?? null,
    url: body.url ?? null,
    address: body.address ?? null,
    optional: body.optional ? 1 : 0,
    done: body.done ? 1 : 0,
    position: body.position ?? Date.now(),
  });
  return c.json({ ok: true, id }, 201);
});

/**
 * D1 plafonne une requête à 100 paramètres liés : un INSERT multi-lignes doit
 * être découpé en lots de `100 / nombre de colonnes` lignes.
 */
function chunkForD1<T>(rows: T[], columnsPerRow: number): T[][] {
  const size = Math.max(1, Math.floor(100 / columnsPerRow));
  const batches: T[][] = [];
  for (let i = 0; i < rows.length; i += size) batches.push(rows.slice(i, i + size));
  return batches;
}

/**
 * Crée le budget de départ à partir du modèle partagé, uniquement si aucune
 * dépense n'existe : postes classiques, sans prestataire assigné.
 */
wedding.post("/budget/init", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const existing = await db
    .select({ id: weddingBudgetItem.id })
    .from(weddingBudgetItem)
    .where(eq(weddingBudgetItem.householdId, hid))
    .limit(1);
  if (existing.length > 0) return c.json({ error: "already_initialized" }, 409);

  // Toutes les colonnes sont explicites : une colonne omise dans un INSERT
  // multi-lignes fait générer un mot-clé DEFAULT que SQLite refuse.
  const rows = WEDDING_BUDGET_TEMPLATE.map((t, i) => ({
    id: newId(),
    householdId: hid,
    groupName: t.group,
    prestataire: null,
    label: t.label,
    amount: t.amount,
    note: null,
    url: null,
    address: null,
    optional: 0,
    done: 0,
    position: i,
  }));
  for (const batch of chunkForD1(rows, 12)) {
    await db.insert(weddingBudgetItem).values(batch);
  }
  return c.json({ ok: true, items: rows.length }, 201);
});

/**
 * Jours du mariage : combien (1 à 3) et sous quels libellés. Les présences déjà
 * saisies sur un emplacement désactivé sont conservées en base — réactiver le
 * jour les fait réapparaître.
 */
wedding.put("/days", async (c) => {
  const body = await parseBody(c, setWeddingDaysSchema);
  const days = parseWeddingDays(body.days);
  await c
    .get("db")
    .update(household)
    .set({ weddingDays: JSON.stringify(days) })
    .where(eq(household.id, c.get("household").id));
  return c.json({ ok: true, days });
});

// Date cible du mariage (l'objectif financier = somme du plan d'épargne).
wedding.patch("/target", async (c) => {
  const body = await parseBody(c, updateWeddingTargetSchema);
  await c
    .get("db")
    .update(household)
    .set({ weddingTargetDate: body.targetDate })
    .where(eq(household.id, c.get("household").id));
  return c.json({ ok: true });
});

wedding.patch("/budget/reorder", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, reorderWeddingBudgetSchema);
  for (let i = 0; i < body.orderedIds.length; i++) {
    await db.update(weddingBudgetItem).set({ position: i }).where(eq(weddingBudgetItem.id, body.orderedIds[i]));
  }
  return c.json({ ok: true });
});

wedding.patch("/budget/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const body = await parseBody(c, createWeddingBudgetItemSchema.partial());
  await db
    .update(weddingBudgetItem)
    .set({
      ...(body.groupName !== undefined && { groupName: body.groupName }),
      ...(body.prestataire !== undefined && { prestataire: body.prestataire ?? null }),
      ...(body.label !== undefined && { label: body.label }),
      ...(body.amount !== undefined && { amount: body.amount }),
      ...(body.note !== undefined && { note: body.note ?? null }),
      ...(body.url !== undefined && { url: body.url ?? null }),
      ...(body.address !== undefined && { address: body.address ?? null }),
      ...(body.optional !== undefined && { optional: body.optional ? 1 : 0 }),
      ...(body.done !== undefined && { done: body.done ? 1 : 0 }),
    })
    .where(eq(weddingBudgetItem.id, id));
  return c.json({ ok: true });
});

wedding.delete("/budget/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  // Supprime aussi les fichiers joints (R2 + lignes) et les paiements rattachés.
  const files = await db.select().from(weddingBudgetFile).where(eq(weddingBudgetFile.budgetItemId, id));
  for (const f of files) await c.env.FILES.delete(f.fileKey);
  await db.delete(weddingBudgetFile).where(eq(weddingBudgetFile.budgetItemId, id));
  await db.delete(weddingPayment).where(eq(weddingPayment.budgetItemId, id));
  await db.delete(weddingBudgetItem).where(eq(weddingBudgetItem.id, id));
  return c.json({ ok: true });
});

/* ---------------- Fichiers joints d'une dépense (devis, factures…) ---------------- */

wedding.get("/budget/:id/files", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select()
    .from(weddingBudgetFile)
    .where(eq(weddingBudgetFile.budgetItemId, c.req.param("id")))
    .orderBy(asc(weddingBudgetFile.createdAt));
  return c.json(
    rows.map((r) => ({
      id: r.id,
      budgetItemId: r.budgetItemId,
      fileName: r.fileName,
      contentType: r.contentType,
      size: r.size,
      createdAt: r.createdAt,
    })),
  );
});

wedding.put("/budget/:id/files", async (c) => {
  const db = c.get("db");
  const itemId = c.req.param("id");
  const fileName = decodeURIComponent(c.req.query("name") ?? "fichier");
  if (!isAllowedWeddingFile(fileName)) return c.json({ error: "type" }, 415);
  const body = await c.req.arrayBuffer();
  if (!body || body.byteLength === 0) return c.json({ error: "empty" }, 400);
  if (body.byteLength > WEDDING_FILE_MAX_BYTES) return c.json({ error: "too_large" }, 413);
  const contentType = c.req.header("content-type") || "application/octet-stream";
  const id = newId();
  const key = `wedding/${itemId}/${Date.now()}-${fileName}`;
  await c.env.FILES.put(key, body, { httpMetadata: { contentType } });
  await db.insert(weddingBudgetFile).values({
    id,
    householdId: c.get("household").id,
    budgetItemId: itemId,
    fileKey: key,
    fileName,
    contentType,
    size: body.byteLength,
    createdAt: new Date().toISOString(),
  });
  return c.json({ ok: true, id }, 201);
});

wedding.get("/budget/files/:fileId", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select()
    .from(weddingBudgetFile)
    .where(eq(weddingBudgetFile.id, c.req.param("fileId")))
    .limit(1);
  const f = rows[0];
  if (!f) return c.json({ error: "not_found" }, 404);
  const obj = await c.env.FILES.get(f.fileKey);
  if (!obj) return c.json({ error: "not_found" }, 404);
  const headers = new Headers();
  headers.set("content-type", f.contentType || obj.httpMetadata?.contentType || "application/octet-stream");
  headers.set("content-disposition", `inline; filename="${encodeURIComponent(f.fileName)}"`);
  return new Response(obj.body, { headers });
});

wedding.delete("/budget/files/:fileId", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select()
    .from(weddingBudgetFile)
    .where(eq(weddingBudgetFile.id, c.req.param("fileId")))
    .limit(1);
  if (rows[0]?.fileKey) await c.env.FILES.delete(rows[0].fileKey);
  await db.delete(weddingBudgetFile).where(eq(weddingBudgetFile.id, c.req.param("fileId")));
  return c.json({ ok: true });
});

/* ---------------- Savings plan ---------------- */

wedding.get("/savings", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select()
    .from(savingsContribution)
    .where(eq(savingsContribution.householdId, c.get("household").id))
    .orderBy(asc(savingsContribution.month));
  return c.json(
    rows.map((r) => ({
      ...r,
      planned: Boolean(r.planned),
      realizedA: Boolean(r.realizedA),
      realizedB: Boolean(r.realizedB),
    })),
  );
});

/** Mois « YYYY-MM » de `from` à `to` inclus (toujours au moins un mois). */
function monthRange(from: string, to: string): string[] {
  const start = to < from ? to : from;
  const months: string[] = [];
  let [year, month] = start.split("-").map(Number);
  for (;;) {
    const cur = `${year}-${String(month).padStart(2, "0")}`;
    months.push(cur);
    if (cur >= to || months.length > WEDDING_SAVINGS_MAX_MONTHS) break;
    if (++month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/**
 * Initialise le plan d'épargne quand il est vide : enregistre la date du
 * mariage et crée une ligne par mois, du mois courant à celui du mariage, au
 * même montant pour chaque membre. Les montants restent modifiables ensuite.
 */
wedding.post("/savings/init", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, initWeddingSavingsSchema);

  const existing = await db
    .select({ id: savingsContribution.id })
    .from(savingsContribution)
    .where(eq(savingsContribution.householdId, hid))
    .limit(1);
  if (existing.length > 0) return c.json({ error: "already_initialized" }, 409);

  const months = monthRange(new Date().toISOString().slice(0, 7), body.targetDate.slice(0, 7));
  if (months.length > WEDDING_SAVINGS_MAX_MONTHS) return c.json({ error: "range_too_long" }, 400);

  await db
    .update(household)
    .set({ weddingTargetDate: body.targetDate })
    .where(eq(household.id, hid));
  const rows = months.map((month) => ({
    id: newId(),
    householdId: hid,
    month,
    amountA: body.monthlyPerPerson,
    amountB: body.monthlyPerPerson,
    planned: 1,
    realizedA: 0,
    realizedB: 0,
  }));
  for (const batch of chunkForD1(rows, 8)) {
    await db.insert(savingsContribution).values(batch);
  }
  return c.json({ ok: true, months: months.length }, 201);
});

wedding.post("/savings", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, createSavingsContributionSchema);
  const id = newId();
  await db.insert(savingsContribution).values({
    id,
    householdId: c.get("household").id,
    month: body.month,
    amountA: body.amountA,
    amountB: body.amountB,
    planned: body.planned ? 1 : 0,
    realizedA: body.realizedA ? 1 : 0,
    realizedB: body.realizedB ? 1 : 0,
  });
  return c.json({ ok: true, id }, 201);
});

wedding.patch("/savings/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const body = await parseBody(c, createSavingsContributionSchema.partial());
  await db
    .update(savingsContribution)
    .set({
      ...(body.month !== undefined && { month: body.month }),
      ...(body.amountA !== undefined && { amountA: body.amountA }),
      ...(body.amountB !== undefined && { amountB: body.amountB }),
      ...(body.planned !== undefined && { planned: body.planned ? 1 : 0 }),
      ...(body.realizedA !== undefined && { realizedA: body.realizedA ? 1 : 0 }),
      ...(body.realizedB !== undefined && { realizedB: body.realizedB ? 1 : 0 }),
    })
    .where(eq(savingsContribution.id, id));
  return c.json({ ok: true });
});

/* ---------------- Payments schedule ---------------- */

wedding.get("/payments", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select()
    .from(weddingPayment)
    .where(eq(weddingPayment.householdId, c.get("household").id))
    .orderBy(asc(weddingPayment.dueDate));
  return c.json(rows);
});

wedding.post("/payments", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, createWeddingPaymentSchema);
  const id = newId();
  await db.insert(weddingPayment).values({
    id,
    householdId: c.get("household").id,
    budgetItemId: body.budgetItemId ?? null,
    prestataire: body.prestataire,
    type: body.type ?? null,
    dueDate: body.dueDate,
    amountDue: body.amountDue,
    amountPaid: body.amountPaid ?? 0,
  });
  return c.json({ ok: true, id }, 201);
});

wedding.patch("/payments/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const body = await parseBody(c, createWeddingPaymentSchema.partial());
  await db
    .update(weddingPayment)
    .set({
      ...(body.budgetItemId !== undefined && { budgetItemId: body.budgetItemId ?? null }),
      ...(body.prestataire !== undefined && { prestataire: body.prestataire }),
      ...(body.type !== undefined && { type: body.type ?? null }),
      ...(body.dueDate !== undefined && { dueDate: body.dueDate }),
      ...(body.amountDue !== undefined && { amountDue: body.amountDue }),
      ...(body.amountPaid !== undefined && { amountPaid: body.amountPaid }),
    })
    .where(eq(weddingPayment.id, id));
  return c.json({ ok: true });
});

wedding.delete("/payments/:id", async (c) => {
  await c.get("db").delete(weddingPayment).where(eq(weddingPayment.id, c.req.param("id")));
  return c.json({ ok: true });
});

/* ---------------- Todos ---------------- */

wedding.get("/todos", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select()
    .from(weddingTodo)
    .where(eq(weddingTodo.householdId, c.get("household").id));
  return c.json(rows.map((r) => ({ ...r, done: Boolean(r.done) })));
});

wedding.post("/todos", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, createWeddingTodoSchema);
  const id = newId();
  await db.insert(weddingTodo).values({
    id,
    householdId: c.get("household").id,
    description: body.description,
    dueDate: body.dueDate ?? null,
    owner: body.owner ?? null,
    done: body.done ? 1 : 0,
    createdAt: new Date().toISOString(),
  });
  return c.json({ ok: true, id }, 201);
});

wedding.patch("/todos/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const body = await parseBody(c, createWeddingTodoSchema.partial());
  await db
    .update(weddingTodo)
    .set({
      ...(body.description !== undefined && { description: body.description }),
      ...(body.dueDate !== undefined && { dueDate: body.dueDate ?? null }),
      ...(body.owner !== undefined && { owner: body.owner ?? null }),
      ...(body.done !== undefined && { done: body.done ? 1 : 0 }),
    })
    .where(eq(weddingTodo.id, id));
  return c.json({ ok: true });
});

wedding.delete("/todos/:id", async (c) => {
  await c.get("db").delete(weddingTodo).where(eq(weddingTodo.id, c.req.param("id")));
  return c.json({ ok: true });
});

/* ---------------- Invités ---------------- */

wedding.get("/guests", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select()
    .from(weddingGuest)
    .where(eq(weddingGuest.householdId, c.get("household").id))
    .orderBy(asc(weddingGuest.position), asc(weddingGuest.createdAt));
  return c.json(
    rows.map((r) => ({
      ...r,
      vendredi: Boolean(r.vendredi),
      samedi: Boolean(r.samedi),
      dimanche: Boolean(r.dimanche),
      archived: Boolean(r.archived),
    })),
  );
});

wedding.post("/guests", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, createWeddingGuestSchema);
  const id = newId();
  await db.insert(weddingGuest).values({
    id,
    householdId: c.get("household").id,
    name: body.name,
    type: body.type,
    ageGroup: body.ageGroup,
    invitationStatus: body.invitationStatus,
    guestGroup: body.guestGroup,
    vendredi: body.vendredi ? 1 : 0,
    samedi: body.samedi ? 1 : 0,
    dimanche: body.dimanche ? 1 : 0,
    archived: body.archived ? 1 : 0,
    parentId: body.parentId ?? null,
    address: body.address ?? null,
    postalCode: body.postalCode ?? null,
    city: body.city ?? null,
    position: body.position ?? Date.now(),
    createdAt: new Date().toISOString(),
  });
  return c.json({ ok: true, id }, 201);
});

wedding.patch("/guests/reorder", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, reorderGuestsSchema);
  for (let i = 0; i < body.orderedIds.length; i++) {
    await db.update(weddingGuest).set({ position: i }).where(eq(weddingGuest.id, body.orderedIds[i]));
  }
  return c.json({ ok: true });
});

wedding.patch("/guests/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const body = await parseBody(c, updateWeddingGuestSchema);
  await db
    .update(weddingGuest)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.type !== undefined && { type: body.type }),
      ...(body.ageGroup !== undefined && { ageGroup: body.ageGroup }),
      ...(body.invitationStatus !== undefined && { invitationStatus: body.invitationStatus }),
      ...(body.guestGroup !== undefined && { guestGroup: body.guestGroup }),
      ...(body.vendredi !== undefined && { vendredi: body.vendredi ? 1 : 0 }),
      ...(body.samedi !== undefined && { samedi: body.samedi ? 1 : 0 }),
      ...(body.dimanche !== undefined && { dimanche: body.dimanche ? 1 : 0 }),
      ...(body.archived !== undefined && { archived: body.archived ? 1 : 0 }),
      ...(body.parentId !== undefined && { parentId: body.parentId ?? null }),
      ...(body.address !== undefined && { address: body.address ?? null }),
      ...(body.postalCode !== undefined && { postalCode: body.postalCode ?? null }),
      ...(body.city !== undefined && { city: body.city ?? null }),
      ...(body.position !== undefined && { position: body.position }),
    })
    .where(eq(weddingGuest.id, id));
  return c.json({ ok: true });
});

wedding.delete("/guests/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  // Les sous-invités deviennent principaux
  await db.update(weddingGuest).set({ parentId: null }).where(eq(weddingGuest.parentId, id));
  await db.delete(weddingGuest).where(eq(weddingGuest.id, id));
  return c.json({ ok: true });
});

/* ---------------- Summary ---------------- */

export async function computeWeddingSummary(db: Db, h: DbHousehold): Promise<WeddingSummary> {
  const hid = h.id;
  const contribs = await db
    .select()
    .from(savingsContribution)
    .where(eq(savingsContribution.householdId, hid));
  const payments = await db.select().from(weddingPayment).where(eq(weddingPayment.householdId, hid));
  const accounts = await db.select().from(account).where(eq(account.householdId, hid));

  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

  // Ce qu'on devrait avoir épargné à date, d'après le plan d'épargne (cumul jusqu'au mois courant)
  let shouldHaveByNow = 0;
  for (const ct of contribs) {
    if (ct.month <= currentMonth) shouldHaveByNow += ct.amountA + ct.amountB;
  }

  const totalDue = payments.reduce((s, p) => s + p.amountDue, 0);
  const totalPaid = payments.reduce((s, p) => s + p.amountPaid, 0);

  // Argent réellement mobilisé pour le mariage :
  //   soldes des comptes d'épargne (type « savings » de chaque membre)
  // + tout ce qui a déjà été payé (échéancier)
  // Les comptes d'épargne sont identifiés par leur type (plus de convention de nom).
  const savingsAccountsBalance = accounts
    .filter((a) => a.type === "savings")
    .reduce((s, a) => s + a.currentBalance, 0);
  const savedToDate = savingsAccountsBalance + totalPaid;

  // Objectif final = somme de TOUTES les épargnes mensuelles planifiées (source unique de vérité).
  const targetAmount = contribs.reduce((s, ct) => s + ct.amountA + ct.amountB, 0);
  const now = new Date();
  const target = new Date(h.weddingTargetDate);
  const monthsLeft = Math.max(
    0,
    (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth()),
  );
  const monthlyRequired = monthsLeft > 0 ? Math.max(0, Math.round((targetAmount - savedToDate) / monthsLeft)) : 0;

  return {
    targetAmount,
    targetDate: h.weddingTargetDate,
    savedToDate,
    shouldHaveByNow,
    surplus: savedToDate - shouldHaveByNow,
    monthsLeft,
    monthlyRequired,
    percentFunded: targetAmount > 0 ? Math.round((savedToDate / targetAmount) * 1000) / 10 : 0,
    totalDue,
    totalPaid,
  };
}

wedding.get("/summary", async (c) => {
  return c.json(await computeWeddingSummary(c.get("db"), c.get("household")));
});

export default wedding;
