import { createMiddleware } from "hono/factory";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import type { Member } from "@gfa/shared";
import * as schema from "../db/schema";
import { user, household, allowedEmail } from "../db/schema";
import { readSession } from "../lib/session";
import { nowIso } from "../lib/util";
import type { AppContext, Db } from "../lib/types";

/** Attaches a Drizzle db instance to the context. */
export const withDb = createMiddleware<AppContext>(async (c, next) => {
  c.set("db", drizzle(c.env.DB, { schema }));
  await next();
});

/** Requires a valid session; loads the user + household. */
export const requireAuth = createMiddleware<AppContext>(async (c, next) => {
  const db = c.get("db");
  const userId = await readSession(c, db);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const u = (await db.select().from(user).where(eq(user.id, userId)).limit(1))[0];
  if (!u) return c.json({ error: "unauthorized" }, 401);

  const h = (await db.select().from(household).where(eq(household.id, u.householdId)).limit(1))[0];
  // Base sans foyer = installation pas encore initialisée (wizard /setup).
  if (!h) return c.json({ error: "setup_required" }, 401);

  c.set("user", u);
  c.set("household", h);
  await next();
});

/**
 * Protection CSRF : pour toute requête qui modifie des données, on exige que
 * l'en-tête Origin (envoyé par les navigateurs) corresponde à l'app autorisée.
 * Bloque les requêtes cross-site malveillantes même si le cookie de session est
 * envoyé (SameSite=None en prod).
 */
export const requireSameOrigin = createMiddleware<AppContext>(async (c, next) => {
  const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method);
  if (mutating) {
    const origin = c.req.header("Origin");
    if (origin && origin !== c.env.APP_URL) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
  }
  await next();
});

/* ------------------------------------------------------------------ */
/* Allowlist — source de vérité en base, secret ALLOWED_EMAILS en repli */
/* ------------------------------------------------------------------ */

/** Entrée d'ALLOWED_EMAILS : "email" ou "slot:email" (slot = a|b). */
function parseAllowedEntry(raw: string): { email: string; memberSlot: Member | null } | null {
  const parts = raw.split(":").map((s) => s.trim());
  const asSlot = (s: string): Member | null => (s === "a" ? "a" : s === "b" ? "b" : null);
  const email = (parts.length > 1 ? parts[1] : parts[0]).toLowerCase();
  if (!email || !email.includes("@")) return null;
  return { email, memberSlot: parts.length > 1 ? asSlot(parts[0]) : null };
}

function envEntries(env: { ALLOWED_EMAILS?: string }) {
  return (env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map(parseAllowedEntry)
    .filter((e): e is NonNullable<typeof e> => e !== null);
}

/** Import paresseux : si la table est vide, la remplit depuis ALLOWED_EMAILS. */
export async function ensureAllowlist(db: Db, env: { ALLOWED_EMAILS?: string }): Promise<void> {
  const existing = await db.select().from(allowedEmail).limit(1);
  if (existing.length > 0) return;
  const entries = envEntries(env);
  const seen = new Set<string>();
  const rows = entries.filter((e) => (seen.has(e.email) ? false : (seen.add(e.email), true)));
  if (rows.length === 0) return;
  await db
    .insert(allowedEmail)
    .values(rows.map((e) => ({ email: e.email, memberSlot: e.memberSlot, createdAt: nowIso() })));
}

/** L'email peut-il se connecter ? Table en base d'abord, secret env en repli.
 *  Seuls les emails des membres a/b (ou hérités sans slot) ouvrent une session ;
 *  ceux des personnes supplémentaires sont informatifs. */
export async function isEmailAllowed(
  db: Db,
  env: { ALLOWED_EMAILS?: string },
  email: string,
): Promise<boolean> {
  const norm = email.trim().toLowerCase();
  const row = (await db.select().from(allowedEmail).where(eq(allowedEmail.email, norm)).limit(1))[0];
  if (row) return row.memberSlot === null || row.memberSlot === "a" || row.memberSlot === "b";
  return envEntries(env).some((e) => e.email === norm);
}

/** Slot (a|b) réservé à cet email, si configuré (base d'abord, env en repli). */
export async function allowedSlotFor(
  db: Db,
  env: { ALLOWED_EMAILS?: string },
  email: string,
): Promise<Member | null> {
  const norm = email.trim().toLowerCase();
  const row = (await db.select().from(allowedEmail).where(eq(allowedEmail.email, norm)).limit(1))[0];
  if (row?.memberSlot === "a" || row?.memberSlot === "b") return row.memberSlot;
  return envEntries(env).find((e) => e.email === norm)?.memberSlot ?? null;
}
