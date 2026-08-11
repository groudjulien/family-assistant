import { Hono } from "hono";
import { eq, and, asc, sql } from "drizzle-orm";
import { z } from "zod";
import {
  createFollowedCitySchema,
  createActivityFeedSchema,
  createWeatherCitySchema,
  createTransitLineSchema,
  updateTransitLineSchema,
  updateStreamingProviderSchema,
  updateMenuOrderSchema,
  updateWidgetPrefsSchema,
  updateAnthropicKeySchema,
  updateLunchflowKeySchema,
  updateMobiliteKeysSchema,
  updateTmdbKeySchema,
  updateExpenseCategoriesSchema,
  updateDefaultPackingSchema,
  updateDefaultAccountSchema,
  updateMembersConfigSchema,
  setPersonEmailsSchema,
  FR_CERTS,
} from "@gfa/shared";
import {
  household,
  user,
  followedCity,
  activityFeed,
  weatherCity,
  transitLine,
  streamingProvider,
  account as accountTable,
  allowedEmail,
} from "../db/schema";
import { ensureAllowlist } from "../middleware/auth";
import { parseBody } from "../lib/validate";
import { encryptSecret } from "../lib/crypto";
import { resolveTmdbKey } from "../lib/apiKeys";
import { newId, nowIso } from "../lib/util";
import type { AppContext } from "../lib/types";

const router = new Hono<AppContext>();

/* ---------------- Villes suivies (activités) ---------------- */

router.get("/cities", async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(followedCity)
    .where(eq(followedCity.householdId, c.get("household").id))
    .orderBy(asc(followedCity.name));
  return c.json(rows.map((r) => ({ id: r.id, name: r.name })));
});

router.post("/cities", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, createFollowedCitySchema);
  const name = body.name.trim();
  const existing = await db
    .select()
    .from(followedCity)
    .where(
      and(eq(followedCity.householdId, hid), sql`lower(${followedCity.name}) = ${name.toLowerCase()}`),
    );
  if (existing.length > 0) return c.json({ ok: true, id: existing[0].id });
  const id = newId();
  await db.insert(followedCity).values({ id, householdId: hid, name, createdAt: nowIso() });
  return c.json({ ok: true, id }, 201);
});

router.delete("/cities/:id", async (c) => {
  await c.get("db").delete(followedCity).where(eq(followedCity.id, c.req.param("id")));
  return c.json({ ok: true });
});

/* ---------------- Flux RSS d'agendas (activités) ---------------- */

router.get("/activity-feeds", async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(activityFeed)
    .where(eq(activityFeed.householdId, c.get("household").id))
    .orderBy(asc(activityFeed.name));
  return c.json(rows.map((r) => ({ id: r.id, name: r.name, url: r.url })));
});

router.post("/activity-feeds", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, createActivityFeedSchema);
  const url = body.url.trim();
  const existing = await db
    .select()
    .from(activityFeed)
    .where(and(eq(activityFeed.householdId, hid), eq(activityFeed.url, url)));
  if (existing.length > 0) return c.json({ ok: true, id: existing[0].id });
  const id = newId();
  await db
    .insert(activityFeed)
    .values({ id, householdId: hid, name: body.name.trim(), url, createdAt: nowIso() });
  return c.json({ ok: true, id }, 201);
});

router.delete("/activity-feeds/:id", async (c) => {
  await c
    .get("db")
    .delete(activityFeed)
    .where(
      and(
        eq(activityFeed.id, c.req.param("id")),
        eq(activityFeed.householdId, c.get("household").id),
      ),
    );
  return c.json({ ok: true });
});

/* ---------------- Compte par défaut (transactions) ---------------- */

router.patch("/default-account", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, updateDefaultAccountSchema);
  if (body.accountId !== null) {
    const rows = await db
      .select({ id: accountTable.id })
      .from(accountTable)
      .where(and(eq(accountTable.id, body.accountId), eq(accountTable.householdId, hid)))
      .limit(1);
    if (!rows[0]) return c.json({ error: "account_not_found" }, 404);
  }
  await db
    .update(household)
    .set({ defaultAccountId: body.accountId })
    .where(eq(household.id, hid));
  return c.json({ ok: true });
});

/* ---------------- Villes météo (widget accueil) ---------------- */

router.get("/weather-cities", async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(weatherCity)
    .where(eq(weatherCity.householdId, c.get("household").id))
    .orderBy(asc(weatherCity.position));
  return c.json(rows.map((r) => ({ id: r.id, name: r.name })));
});

router.post("/weather-cities", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, createWeatherCitySchema);
  const query = body.name.trim();

  // Géocodage via Open-Meteo (sans clé)
  let geo: { name: string; lat: number; lon: number } | null = null;
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=fr&format=json`,
    );
    if (res.ok) {
      const d = (await res.json()) as {
        results?: {
          name: string;
          latitude: number;
          longitude: number;
          admin1?: string;
          postcodes?: string[];
        }[];
      };
      const r = d.results?.[0];
      if (r) {
        const suffix = r.postcodes?.[0] ?? r.admin1;
        geo = {
          name: suffix ? `${r.name} (${suffix})` : r.name,
          lat: r.latitude,
          lon: r.longitude,
        };
      }
    }
  } catch {
    /* ignore */
  }
  if (!geo) return c.json({ error: "not_found" }, 404);

  const id = newId();
  const existing = await db
    .select()
    .from(weatherCity)
    .where(eq(weatherCity.householdId, hid));
  // Nouvelle ville toujours en dernière position (robuste aux suppressions).
  const maxPos = existing.reduce((m, r) => Math.max(m, r.position), -1);
  await db.insert(weatherCity).values({
    id,
    householdId: hid,
    name: geo.name,
    lat: geo.lat,
    lon: geo.lon,
    position: maxPos + 1,
    createdAt: nowIso(),
  });
  return c.json({ ok: true, id, name: geo.name }, 201);
});

router.post("/weather-cities/reorder", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, updateMenuOrderSchema); // { order: string[] }
  await Promise.all(
    body.order.map((id, i) =>
      db
        .update(weatherCity)
        .set({ position: i })
        .where(and(eq(weatherCity.id, id), eq(weatherCity.householdId, hid))),
    ),
  );
  return c.json({ ok: true });
});

router.delete("/weather-cities/:id", async (c) => {
  await c.get("db").delete(weatherCity).where(eq(weatherCity.id, c.req.param("id")));
  return c.json({ ok: true });
});

/* ---------------- Lignes de transport (widget accueil) ---------------- */

router.get("/transit-lines", async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(transitLine)
    .where(eq(transitLine.householdId, c.get("household").id))
    .orderBy(asc(transitLine.position));
  return c.json(
    rows.map((r) => ({
      id: r.id,
      lineCode: r.lineCode,
      label: r.label,
      color: r.color,
      stationA: r.stationA,
      stationB: r.stationB,
      kind: r.kind,
    })),
  );
});

router.post("/transit-lines", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, createTransitLineSchema);
  const existing = await db.select().from(transitLine).where(eq(transitLine.householdId, hid));
  const id = newId();
  await db.insert(transitLine).values({
    id,
    householdId: hid,
    lineCode: body.lineCode,
    label: body.label,
    color: body.color,
    stationA: body.stationA.trim(),
    stationB: body.stationB.trim(),
    kind: body.kind,
    position: existing.length,
    createdAt: nowIso(),
  });
  return c.json({ ok: true, id }, 201);
});

router.post("/transit-lines/reorder", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, updateMenuOrderSchema); // { order: string[] }
  await Promise.all(
    body.order.map((id, i) =>
      db
        .update(transitLine)
        .set({ position: i })
        .where(and(eq(transitLine.id, id), eq(transitLine.householdId, hid))),
    ),
  );
  return c.json({ ok: true });
});

router.patch("/transit-lines/:id", async (c) => {
  const hid = c.get("household").id;
  const body = await parseBody(c, updateTransitLineSchema);
  const set: Record<string, unknown> = {};
  if (body.lineCode !== undefined) set.lineCode = body.lineCode;
  if (body.label !== undefined) set.label = body.label;
  if (body.color !== undefined) set.color = body.color;
  if (body.stationA !== undefined) set.stationA = body.stationA.trim();
  if (body.stationB !== undefined) set.stationB = body.stationB.trim();
  if (body.kind !== undefined) set.kind = body.kind;
  if (Object.keys(set).length > 0) {
    await c
      .get("db")
      .update(transitLine)
      .set(set)
      .where(and(eq(transitLine.id, c.req.param("id")), eq(transitLine.householdId, hid)));
  }
  return c.json({ ok: true });
});

router.delete("/transit-lines/:id", async (c) => {
  await c.get("db").delete(transitLine).where(eq(transitLine.id, c.req.param("id")));
  return c.json({ ok: true });
});

router.get("/members", async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(user)
    .where(eq(user.householdId, c.get("household").id))
    .orderBy(asc(user.displayName));
  return c.json(
    rows.map((u) => ({
      id: u.id,
      displayName: u.displayName,
      member: u.member,
      avatarUrl: u.avatarUrl,
      email: u.email,
    })),
  );
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  defaultSplitA: z.number().int().min(0).max(100).optional(),
  defaultSplitB: z.number().int().min(0).max(100).optional(),
  kidsMaxCert: z.enum(FR_CERTS).optional(),
});

router.patch("/", async (c) => {
  const body = await parseBody(c, updateSchema);
  await c
    .get("db")
    .update(household)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.defaultSplitA !== undefined && { defaultSplitA: body.defaultSplitA }),
      ...(body.defaultSplitB !== undefined && { defaultSplitB: body.defaultSplitB }),
      ...(body.kidsMaxCert !== undefined && { kidsMaxCert: body.kidsMaxCert }),
    })
    .where(eq(household.id, c.get("household").id));
  return c.json({ ok: true });
});

/* ---------------- Noms/couleurs des membres + personnes supplémentaires ---------------- */

router.patch("/members-config", async (c) => {
  const body = await parseBody(c, updateMembersConfigSchema);
  await c
    .get("db")
    .update(household)
    .set({
      memberAName: body.members.a.name,
      memberBName: body.members.b.name,
      memberAColor: body.members.a.color,
      memberBColor: body.members.b.color,
      extraPersons: JSON.stringify(body.extraPersons),
    })
    .where(eq(household.id, c.get("household").id));
  return c.json({ ok: true });
});

/* ---------------- Ordre des menus (par utilisateur) ---------------- */

router.patch("/menu-order", async (c) => {
  const body = await parseBody(c, updateMenuOrderSchema);
  await c
    .get("db")
    .update(user)
    .set({
      menuOrder: JSON.stringify(body.order),
      ...(body.hidden !== undefined && { menuHidden: JSON.stringify(body.hidden) }),
    })
    .where(eq(user.id, c.get("user").id));
  return c.json({ ok: true });
});

/* ---------------- Catégories de dépenses (par foyer) ---------------- */

/** Liste d'affaires par défaut, injectée à la création d'un voyage. */
router.patch("/default-packing", async (c) => {
  const body = await parseBody(c, updateDefaultPackingSchema);
  await c
    .get("db")
    .update(household)
    .set({ defaultPacking: JSON.stringify(body.items) })
    .where(eq(household.id, c.get("household").id));
  return c.json({ ok: true });
});

router.patch("/expense-categories", async (c) => {
  const body = await parseBody(c, updateExpenseCategoriesSchema);
  await c
    .get("db")
    .update(household)
    .set({ expenseCategories: JSON.stringify(body.categories) })
    .where(eq(household.id, c.get("household").id));
  return c.json({ ok: true });
});

/* ---------------- Widgets accueil (ordre + visibilité, par utilisateur) ---------------- */

router.patch("/widget-prefs", async (c) => {
  const body = await parseBody(c, updateWidgetPrefsSchema);
  await c
    .get("db")
    .update(user)
    .set({ widgetPrefs: JSON.stringify({ order: body.order, hidden: body.hidden }) })
    .where(eq(user.id, c.get("user").id));
  return c.json({ ok: true });
});

/* ---------------- Clé API Claude (chiffrée, par foyer) ---------------- */

router.put("/anthropic-key", async (c) => {
  const body = await parseBody(c, updateAnthropicKeySchema);
  const encrypted = await encryptSecret(body.apiKey, c.env.SESSION_SECRET);
  await c
    .get("db")
    .update(household)
    .set({ anthropicApiKey: encrypted })
    .where(eq(household.id, c.get("household").id));
  return c.json({ ok: true });
});

router.delete("/anthropic-key", async (c) => {
  await c
    .get("db")
    .update(household)
    .set({ anthropicApiKey: null })
    .where(eq(household.id, c.get("household").id));
  return c.json({ ok: true });
});

/* ---------------- Clé API LunchFlow (chiffrée, par foyer) ---------------- */

router.put("/lunchflow-key", async (c) => {
  const body = await parseBody(c, updateLunchflowKeySchema);
  const encrypted = await encryptSecret(body.apiKey, c.env.SESSION_SECRET);
  await c
    .get("db")
    .update(household)
    .set({ lunchflowApiKey: encrypted })
    .where(eq(household.id, c.get("household").id));
  return c.json({ ok: true });
});

router.delete("/lunchflow-key", async (c) => {
  await c
    .get("db")
    .update(household)
    .set({ lunchflowApiKey: null })
    .where(eq(household.id, c.get("household").id));
  return c.json({ ok: true });
});

/* ---------------- Clés Mobilité (PRIM IDF, chiffrées, par foyer) ---------------- */

router.put("/mobilite-keys", async (c) => {
  const body = await parseBody(c, updateMobiliteKeysSchema);
  const primApiKey = await encryptSecret(body.apiKey, c.env.SESSION_SECRET);
  const primJeton = body.jeton ? await encryptSecret(body.jeton, c.env.SESSION_SECRET) : null;
  await c
    .get("db")
    .update(household)
    .set({ primApiKey, primJeton })
    .where(eq(household.id, c.get("household").id));
  return c.json({ ok: true });
});

router.delete("/mobilite-keys", async (c) => {
  await c
    .get("db")
    .update(household)
    .set({ primApiKey: null, primJeton: null })
    .where(eq(household.id, c.get("household").id));
  return c.json({ ok: true });
});

/* ---------------- Clé API TMDB (chiffrée, par foyer) ---------------- */

router.put("/tmdb-key", async (c) => {
  const body = await parseBody(c, updateTmdbKeySchema);
  const encrypted = await encryptSecret(body.apiKey, c.env.SESSION_SECRET);
  await c
    .get("db")
    .update(household)
    .set({ tmdbApiKey: encrypted })
    .where(eq(household.id, c.get("household").id));
  return c.json({ ok: true });
});

router.delete("/tmdb-key", async (c) => {
  await c
    .get("db")
    .update(household)
    .set({ tmdbApiKey: null })
    .where(eq(household.id, c.get("household").id));
  return c.json({ ok: true });
});

/* ---------------- Config (films) ---------------- */

router.get("/config", async (c) => {
  return c.json({ kidsMaxCert: c.get("household").kidsMaxCert ?? "U" });
});

/* ---------------- Allowlist (emails rattachés aux personnes) ---------------- */

router.get("/access", async (c) => {
  const db = c.get("db");
  await ensureAllowlist(db, c.env);
  const rows = await db.select().from(allowedEmail).orderBy(asc(allowedEmail.createdAt));
  // member_slot porte l'id de la personne : "a" | "b" | id d'une personne
  // supplémentaire | null (hérité du secret env sans slot).
  return c.json({
    emails: rows.map((r) => ({ email: r.email, personId: r.memberSlot ?? null })),
  });
});

/** Remplace la liste d'emails d'une personne (fiche personne des Réglages). */
router.put("/access/person", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, setPersonEmailsSchema);
  await ensureAllowlist(db, c.env);

  const next = new Set(body.emails.map((e) => e.toLowerCase()));
  const current = await db
    .select()
    .from(allowedEmail)
    .where(eq(allowedEmail.memberSlot, body.personId));

  // Garde-fou : on ne retire pas son propre email (on ne s'enferme pas dehors).
  const own = c.get("user").email.toLowerCase();
  if (current.some((r) => r.email === own) && !next.has(own)) {
    return c.json({ error: "cannot_remove_self" }, 400);
  }

  for (const r of current) {
    if (!next.has(r.email)) {
      await db.delete(allowedEmail).where(eq(allowedEmail.email, r.email));
    }
  }
  for (const email of next) {
    const existing = (
      await db.select().from(allowedEmail).where(eq(allowedEmail.email, email)).limit(1)
    )[0];
    if (existing) {
      // Email déjà connu (autre personne ou hérité) → réattribué à cette personne.
      await db
        .update(allowedEmail)
        .set({ memberSlot: body.personId })
        .where(eq(allowedEmail.email, email));
    } else {
      await db
        .insert(allowedEmail)
        .values({ email, memberSlot: body.personId, createdAt: nowIso() });
    }
  }
  return c.json({ ok: true });
});

router.delete("/access/:email", async (c) => {
  const db = c.get("db");
  const email = decodeURIComponent(c.req.param("email")).toLowerCase();
  // Garde-fou : impossible de retirer son propre email (on ne s'enferme pas dehors).
  if (email === c.get("user").email.toLowerCase()) {
    return c.json({ error: "cannot_remove_self" }, 400);
  }
  await ensureAllowlist(db, c.env);
  await db.delete(allowedEmail).where(eq(allowedEmail.email, email));
  return c.json({ ok: true });
});

router.get("/providers", async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(streamingProvider)
    .where(eq(streamingProvider.householdId, c.get("household").id))
    .orderBy(asc(streamingProvider.position));

  // Logos des plateformes via TMDB (si clé configurée)
  const logos: Record<number, string> = {};
  const key = await resolveTmdbKey(c.get("household"), c.env);
  if (key) {
    try {
      const res = await fetch(
        `https://api.themoviedb.org/3/watch/providers/movie?api_key=${key}&watch_region=FR&language=fr-FR`,
      );
      if (res.ok) {
        const d = (await res.json()) as { results?: { provider_id: number; logo_path?: string | null }[] };
        for (const p of d.results ?? []) {
          if (p.logo_path) logos[p.provider_id] = `https://image.tmdb.org/t/p/w92${p.logo_path}`;
        }
      }
    } catch {
      /* ignore */
    }
  }

  return c.json(
    rows.map((r) => ({
      id: r.id,
      tmdbId: r.tmdbId,
      name: r.name,
      enabled: Boolean(r.enabled),
      logo: logos[r.tmdbId] ?? null,
    })),
  );
});

router.patch("/providers/:id", async (c) => {
  const body = await parseBody(c, updateStreamingProviderSchema);
  await c
    .get("db")
    .update(streamingProvider)
    .set({ enabled: body.enabled ? 1 : 0 })
    .where(eq(streamingProvider.id, c.req.param("id")));
  return c.json({ ok: true });
});

export default router;
