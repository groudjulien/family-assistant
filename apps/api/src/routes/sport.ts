import { Hono } from "hono";
import type { Context } from "hono";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  reorderWellnessSchema,
  upsertWellnessActivitySchema,
  upsertWellnessGoalSchema,
  upsertWellnessLogSchema,
  upsertWellnessSessionSchema,
  type WellnessConfig,
  type WellnessLog,
} from "@gfa/shared";
import { wellnessActivity, wellnessGoal, wellnessLog, wellnessSession } from "../db/schema";
import { parseBody } from "../lib/validate";
import { newId } from "../lib/util";
import type { AppContext } from "../lib/types";

/**
 * Bien-être : objectifs personnalisables par membre.
 *
 * Trois briques de configuration (activités → séances → objectifs) et une table
 * de saisie (`wellness_log`, une ligne par jour et par objectif ; l'absence de
 * ligne signifie « non saisi »).
 */
const sport = new Hono<AppContext>();

const slot = (raw: string) => (raw === "b" ? "b" : "a");

/** Chacun ne lit, ne saisit et ne configure que ses propres objectifs. */
function assertSelf(c: Context<AppContext>, member: string) {
  if (c.get("user").member !== member) return c.json({ error: "forbidden_member" }, 403);
  return null;
}

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ */
/* Configuration (activités + séances + objectifs) en un appel         */
/* ------------------------------------------------------------------ */

sport.get("/:member/config", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const member = slot(c.req.param("member"));
  const denied = assertSelf(c, member);
  if (denied) return denied;

  const [activities, sessions, goals] = await Promise.all([
    db
      .select()
      .from(wellnessActivity)
      .where(and(eq(wellnessActivity.householdId, hid), eq(wellnessActivity.member, member)))
      .orderBy(asc(wellnessActivity.position)),
    db
      .select()
      .from(wellnessSession)
      .where(and(eq(wellnessSession.householdId, hid), eq(wellnessSession.member, member)))
      .orderBy(asc(wellnessSession.position)),
    db
      .select()
      .from(wellnessGoal)
      .where(and(eq(wellnessGoal.householdId, hid), eq(wellnessGoal.member, member)))
      .orderBy(asc(wellnessGoal.position)),
  ]);

  const payload: WellnessConfig = {
    activities: activities.map((a) => ({
      id: a.id,
      name: a.name,
      icon: a.icon,
      unit: a.unit as WellnessConfig["activities"][number]["unit"],
      position: a.position,
    })),
    sessions: sessions.map((s) => ({
      id: s.id,
      name: s.name,
      emoji: s.emoji,
      series: s.series,
      items: safeJson(s.items, [] as WellnessConfig["sessions"][number]["items"]),
      position: s.position,
    })),
    goals: goals.map((g) => ({
      id: g.id,
      name: g.name,
      emoji: g.emoji,
      period: g.period as WellnessConfig["goals"][number]["period"],
      kind: g.kind as WellnessConfig["goals"][number]["kind"],
      target: g.target ?? null,
      goalType: g.goalType as WellnessConfig["goals"][number]["goalType"],
      sessionId: g.sessionId ?? null,
      days: safeJson<number[] | null>(g.days, null),
      position: g.position,
    })),
  };
  return c.json(payload);
});

/* ------------------------------------------------------------------ */
/* Activités                                                           */
/* ------------------------------------------------------------------ */

sport.post("/:member/activities", async (c) => {
  const member = slot(c.req.param("member"));
  const denied = assertSelf(c, member);
  if (denied) return denied;
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, upsertWellnessActivitySchema);
  const rows = await db
    .select({ position: wellnessActivity.position })
    .from(wellnessActivity)
    .where(and(eq(wellnessActivity.householdId, hid), eq(wellnessActivity.member, member)));
  const id = newId();
  await db.insert(wellnessActivity).values({
    id,
    householdId: hid,
    member,
    name: body.name,
    icon: body.icon,
    unit: body.unit,
    position: rows.length ? Math.max(...rows.map((r) => r.position)) + 1 : 0,
  });
  return c.json({ ok: true, id }, 201);
});

sport.patch("/:member/activities/:id", async (c) => {
  const member = slot(c.req.param("member"));
  const denied = assertSelf(c, member);
  if (denied) return denied;
  const body = await parseBody(c, upsertWellnessActivitySchema);
  await c
    .get("db")
    .update(wellnessActivity)
    .set({ name: body.name, icon: body.icon, unit: body.unit })
    .where(
      and(
        eq(wellnessActivity.householdId, c.get("household").id),
        eq(wellnessActivity.member, member),
        eq(wellnessActivity.id, c.req.param("id")),
      ),
    );
  return c.json({ ok: true });
});

sport.delete("/:member/activities/:id", async (c) => {
  const member = slot(c.req.param("member"));
  const denied = assertSelf(c, member);
  if (denied) return denied;
  const db = c.get("db");
  const hid = c.get("household").id;
  const id = c.req.param("id");
  await db
    .delete(wellnessActivity)
    .where(
      and(
        eq(wellnessActivity.householdId, hid),
        eq(wellnessActivity.member, member),
        eq(wellnessActivity.id, id),
      ),
    );
  // L'activité disparaît aussi des séances qui l'utilisaient.
  const sessions = await db
    .select()
    .from(wellnessSession)
    .where(and(eq(wellnessSession.householdId, hid), eq(wellnessSession.member, member)));
  for (const s of sessions) {
    const items = safeJson<{ activityId: string; amount: number }[]>(s.items, []);
    const next = items.filter((it) => it.activityId !== id);
    if (next.length !== items.length) {
      await db
        .update(wellnessSession)
        .set({ items: JSON.stringify(next) })
        .where(eq(wellnessSession.id, s.id));
    }
  }
  return c.json({ ok: true });
});

sport.put("/:member/activities/reorder", async (c) => {
  const member = slot(c.req.param("member"));
  const denied = assertSelf(c, member);
  if (denied) return denied;
  const { orderedIds } = await parseBody(c, reorderWellnessSchema);
  const db = c.get("db");
  const hid = c.get("household").id;
  for (const [i, id] of orderedIds.entries()) {
    await db
      .update(wellnessActivity)
      .set({ position: i })
      .where(
        and(
          eq(wellnessActivity.householdId, hid),
          eq(wellnessActivity.member, member),
          eq(wellnessActivity.id, id),
        ),
      );
  }
  return c.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Séances                                                             */
/* ------------------------------------------------------------------ */

sport.post("/:member/sessions", async (c) => {
  const member = slot(c.req.param("member"));
  const denied = assertSelf(c, member);
  if (denied) return denied;
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, upsertWellnessSessionSchema);
  const rows = await db
    .select({ position: wellnessSession.position })
    .from(wellnessSession)
    .where(and(eq(wellnessSession.householdId, hid), eq(wellnessSession.member, member)));
  const id = newId();
  await db.insert(wellnessSession).values({
    id,
    householdId: hid,
    member,
    name: body.name,
    emoji: body.emoji,
    series: body.series,
    items: JSON.stringify(body.items),
    position: rows.length ? Math.max(...rows.map((r) => r.position)) + 1 : 0,
  });
  return c.json({ ok: true, id }, 201);
});

sport.patch("/:member/sessions/:id", async (c) => {
  const member = slot(c.req.param("member"));
  const denied = assertSelf(c, member);
  if (denied) return denied;
  const body = await parseBody(c, upsertWellnessSessionSchema);
  await c
    .get("db")
    .update(wellnessSession)
    .set({
      name: body.name,
      emoji: body.emoji,
      series: body.series,
      items: JSON.stringify(body.items),
    })
    .where(
      and(
        eq(wellnessSession.householdId, c.get("household").id),
        eq(wellnessSession.member, member),
        eq(wellnessSession.id, c.req.param("id")),
      ),
    );
  return c.json({ ok: true });
});

sport.delete("/:member/sessions/:id", async (c) => {
  const member = slot(c.req.param("member"));
  const denied = assertSelf(c, member);
  if (denied) return denied;
  const db = c.get("db");
  const hid = c.get("household").id;
  const id = c.req.param("id");
  await db
    .delete(wellnessSession)
    .where(
      and(
        eq(wellnessSession.householdId, hid),
        eq(wellnessSession.member, member),
        eq(wellnessSession.id, id),
      ),
    );
  // Les objectifs sport qui la visaient repassent sans séance.
  await db
    .update(wellnessGoal)
    .set({ sessionId: null })
    .where(
      and(
        eq(wellnessGoal.householdId, hid),
        eq(wellnessGoal.member, member),
        eq(wellnessGoal.sessionId, id),
      ),
    );
  return c.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Objectifs                                                           */
/* ------------------------------------------------------------------ */

/** Une cible chiffrée n'a de sens que pour max/min ; une séance que pour le sport. */
function normalizeGoal(body: {
  kind: string;
  target?: number | null;
  goalType: string;
  sessionId?: string | null;
  days?: number[] | null;
}) {
  const counter = body.kind === "max" || body.kind === "min";
  return {
    target: counter ? (body.target ?? 0) : null,
    sessionId: body.goalType === "sport" ? (body.sessionId ?? null) : null,
    days: body.days && body.days.length > 0 && body.days.length < 7 ? JSON.stringify(body.days) : null,
  };
}

sport.post("/:member/goals", async (c) => {
  const member = slot(c.req.param("member"));
  const denied = assertSelf(c, member);
  if (denied) return denied;
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, upsertWellnessGoalSchema);
  const rows = await db
    .select({ position: wellnessGoal.position })
    .from(wellnessGoal)
    .where(and(eq(wellnessGoal.householdId, hid), eq(wellnessGoal.member, member)));
  const id = newId();
  await db.insert(wellnessGoal).values({
    id,
    householdId: hid,
    member,
    name: body.name,
    emoji: body.emoji,
    period: body.period,
    kind: body.kind,
    goalType: body.goalType,
    ...normalizeGoal(body),
    position: rows.length ? Math.max(...rows.map((r) => r.position)) + 1 : 0,
  });
  return c.json({ ok: true, id }, 201);
});

sport.patch("/:member/goals/:id", async (c) => {
  const member = slot(c.req.param("member"));
  const denied = assertSelf(c, member);
  if (denied) return denied;
  const body = await parseBody(c, upsertWellnessGoalSchema);
  await c
    .get("db")
    .update(wellnessGoal)
    .set({
      name: body.name,
      emoji: body.emoji,
      period: body.period,
      kind: body.kind,
      goalType: body.goalType,
      ...normalizeGoal(body),
    })
    .where(
      and(
        eq(wellnessGoal.householdId, c.get("household").id),
        eq(wellnessGoal.member, member),
        eq(wellnessGoal.id, c.req.param("id")),
      ),
    );
  return c.json({ ok: true });
});

sport.delete("/:member/goals/:id", async (c) => {
  const member = slot(c.req.param("member"));
  const denied = assertSelf(c, member);
  if (denied) return denied;
  const db = c.get("db");
  const hid = c.get("household").id;
  const id = c.req.param("id");
  await db
    .delete(wellnessGoal)
    .where(
      and(eq(wellnessGoal.householdId, hid), eq(wellnessGoal.member, member), eq(wellnessGoal.id, id)),
    );
  // Supprime l'historique de saisie de cet objectif (plus rien ne l'affiche).
  await db
    .delete(wellnessLog)
    .where(
      and(eq(wellnessLog.householdId, hid), eq(wellnessLog.member, member), eq(wellnessLog.goalId, id)),
    );
  return c.json({ ok: true });
});

sport.put("/:member/goals/reorder", async (c) => {
  const member = slot(c.req.param("member"));
  const denied = assertSelf(c, member);
  if (denied) return denied;
  const { orderedIds } = await parseBody(c, reorderWellnessSchema);
  const db = c.get("db");
  const hid = c.get("household").id;
  for (const [i, id] of orderedIds.entries()) {
    await db
      .update(wellnessGoal)
      .set({ position: i })
      .where(
        and(
          eq(wellnessGoal.householdId, hid),
          eq(wellnessGoal.member, member),
          eq(wellnessGoal.id, id),
        ),
      );
  }
  return c.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Saisie quotidienne                                                  */
/* ------------------------------------------------------------------ */

sport.get("/:member/logs", async (c) => {
  const db = c.get("db");
  const member = slot(c.req.param("member"));
  const denied = assertSelf(c, member);
  if (denied) return denied;
  const rows = await db
    .select()
    .from(wellnessLog)
    .where(and(eq(wellnessLog.householdId, c.get("household").id), eq(wellnessLog.member, member)));
  const logs: WellnessLog[] = rows.map((r) => ({
    date: r.date,
    goalId: r.goalId,
    value: r.value,
    sessions: safeJson(r.sessions, [] as WellnessLog["sessions"]),
  }));
  return c.json(logs);
});

/**
 * Saisie d'un objectif pour un jour. Une valeur nulle sans séance supprime la
 * ligne : « non saisi » et « zéro » restent ainsi distincts (calendrier, stats).
 */
sport.put("/:member/logs/:date/:goalId", async (c) => {
  const member = slot(c.req.param("member"));
  const denied = assertSelf(c, member);
  if (denied) return denied;
  const db = c.get("db");
  const hid = c.get("household").id;
  const date = c.req.param("date");
  const goalId = c.req.param("goalId");
  const body = await parseBody(c, upsertWellnessLogSchema);

  const owned = (
    await db
      .select({ id: wellnessGoal.id })
      .from(wellnessGoal)
      .where(
        and(
          eq(wellnessGoal.householdId, hid),
          eq(wellnessGoal.member, member),
          eq(wellnessGoal.id, goalId),
        ),
      )
      .limit(1)
  )[0];
  if (!owned) return c.json({ error: "unknown_goal" }, 404);

  const where = and(
    eq(wellnessLog.householdId, hid),
    eq(wellnessLog.member, member),
    eq(wellnessLog.date, date),
    eq(wellnessLog.goalId, goalId),
  );
  const existing = (await db.select().from(wellnessLog).where(where).limit(1))[0];
  const empty = body.value === 0 && body.sessions.length === 0;

  if (empty) {
    if (existing) await db.delete(wellnessLog).where(eq(wellnessLog.id, existing.id));
    return c.json({ ok: true });
  }
  const values = { value: body.value, sessions: JSON.stringify(body.sessions) };
  if (existing) {
    await db.update(wellnessLog).set(values).where(eq(wellnessLog.id, existing.id));
  } else {
    await db
      .insert(wellnessLog)
      .values({ id: newId(), householdId: hid, member, date, goalId, ...values });
  }
  return c.json({ ok: true });
});

/** Efface toute la saisie d'un jour (remise à « non saisi »). */
sport.delete("/:member/logs/:date", async (c) => {
  const member = slot(c.req.param("member"));
  const denied = assertSelf(c, member);
  if (denied) return denied;
  const db = c.get("db");
  const hid = c.get("household").id;
  const goals = await db
    .select({ id: wellnessGoal.id })
    .from(wellnessGoal)
    .where(and(eq(wellnessGoal.householdId, hid), eq(wellnessGoal.member, member)));
  if (goals.length === 0) return c.json({ ok: true });
  await db
    .delete(wellnessLog)
    .where(
      and(
        eq(wellnessLog.householdId, hid),
        eq(wellnessLog.member, member),
        eq(wellnessLog.date, c.req.param("date")),
        inArray(
          wellnessLog.goalId,
          goals.map((g) => g.id),
        ),
      ),
    );
  return c.json({ ok: true });
});

export default sport;
