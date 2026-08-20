import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  PACKING_CATEGORIES,
  extraPersonSchema,
  parseWeddingDays,
  WEDDING_DAYS_DEFAULT,
  filmConfigSchema,
  DEFAULT_FILM_CONFIG,
  type Member,
} from "@gfa/shared";
import { z } from "zod";
import { user, household, googleOauthToken } from "../db/schema";
import {
  buildAuthUrl,
  exchangeCode,
  getUserInfo,
  type GoogleTokens,
} from "../lib/google";
import { createSession, setSessionCookie, clearSession } from "../lib/session";
import { requireAuth, ensureAllowlist, isEmailAllowed, allowedSlotFor } from "../middleware/auth";
import { newId, nowIso } from "../lib/util";
import type { AppContext } from "../lib/types";
import type { Db } from "../lib/types";

const auth = new Hono<AppContext>();

/** Le foyer de cette instance (single-tenant : le seul de la base, id libre). */
async function getHousehold(db: Db) {
  return (await db.select().from(household).limit(1))[0] ?? null;
}

/** Slot du nouvel utilisateur : celui réservé à son email, sinon premier libre (a puis b). */
function resolveMember(reserved: Member | null, existingMembers: string[]): Member {
  if (reserved) return reserved;
  return existingMembers.includes("a") ? "b" : "a";
}

/** JSON string[] parsé défensivement (colonnes de config). */
function parseStringArray(raw: string | null): string[] | null {
  try {
    const v = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

auth.get("/google", (c) => {
  const state = newId();
  return c.redirect(buildAuthUrl(c.env, state));
});

auth.get("/google/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.redirect(`${c.env.APP_URL}/login?error=missing_code`);

  let tokens: GoogleTokens;
  let info;
  try {
    tokens = await exchangeCode(c.env, code);
    info = await getUserInfo(tokens.access_token);
  } catch {
    return c.redirect(`${c.env.APP_URL}/login?error=oauth_failed`);
  }

  const db = c.get("db");
  await ensureAllowlist(db, c.env);
  if (!(await isEmailAllowed(db, c.env, info.email))) {
    return c.redirect(`${c.env.APP_URL}/login?error=not_allowed`);
  }

  // Pas encore de foyer = installation pas initialisée : passer par le wizard.
  const h = await getHousehold(db);
  if (!h) return c.redirect(`${c.env.APP_URL}/login?error=setup_required`);

  const existing = (await db.select().from(user).where(eq(user.email, info.email)).limit(1))[0];
  let userId: string;

  if (existing) {
    userId = existing.id;
    await db
      .update(user)
      .set({ displayName: info.name, avatarUrl: info.picture ?? null, googleSub: info.sub })
      .where(eq(user.id, userId));
  } else {
    const members = (await db.select().from(user).where(eq(user.householdId, h.id)))
      .map((u) => u.member);
    const member = resolveMember(await allowedSlotFor(db, c.env, info.email), members);
    userId = newId();
    await db.insert(user).values({
      id: userId,
      householdId: h.id,
      email: info.email,
      displayName: info.name,
      avatarUrl: info.picture ?? null,
      googleSub: info.sub,
      member,
      createdAt: nowIso(),
    });
  }

  if (tokens.refresh_token) {
    const existingToken = (
      await db.select().from(googleOauthToken).where(eq(googleOauthToken.userId, userId)).limit(1)
    )[0];
    if (existingToken) {
      await db
        .update(googleOauthToken)
        .set({ refreshToken: tokens.refresh_token, updatedAt: nowIso() })
        .where(eq(googleOauthToken.userId, userId));
    } else {
      await db.insert(googleOauthToken).values({
        userId,
        refreshToken: tokens.refresh_token,
        scope: "calendar",
        updatedAt: nowIso(),
      });
    }
  }

  const sessionId = await createSession(db, userId);
  setSessionCookie(c, sessionId, c.env.API_URL.startsWith("https"));
  return c.redirect(c.env.APP_URL);
});

auth.post("/logout", async (c) => {
  await clearSession(c, c.get("db"));
  return c.json({ ok: true });
});

/** Current session info. */
auth.get("/me", requireAuth, (c) => {
  const u = c.get("user");
  const h = c.get("household");
  return c.json({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    member: u.member,
    // Préférence utilisateur, sinon défaut du foyer (défini par le wizard).
    menuOrder: parseStringArray(u.menuOrder) ?? parseStringArray(h.defaultMenuOrder),
    menuHidden: parseStringArray(u.menuHidden) ?? parseStringArray(h.defaultMenuHidden),
    // { "sep:<id>": "Au quotidien" } — parsé défensivement (colonne TEXT libre).
    menuGroups: (() => {
      try {
        const v = u.menuGroups ? JSON.parse(u.menuGroups) : null;
        if (!v || typeof v !== "object" || Array.isArray(v)) return null;
        const out: Record<string, string> = {};
        for (const [k, name] of Object.entries(v)) if (typeof name === "string") out[k] = name;
        return out;
      } catch {
        return null;
      }
    })(),
    widgetPrefs: (() => {
      try {
        const v = u.widgetPrefs ? JSON.parse(u.widgetPrefs) : null;
        if (v && Array.isArray(v.order) && Array.isArray(v.hidden)) return v;
        return null;
      } catch {
        return null;
      }
    })(),
    hasAnthropicKey: !!h.anthropicApiKey || !!c.env.ANTHROPIC_API_KEY,
    hasLunchflowKey: !!h.lunchflowApiKey || !!c.env.LUNCHFLOW_API_KEY,
    hasPrimKey: !!h.primApiKey || !!c.env.PRIM_IDF_MOBILITE_API,
    hasPrimJeton: !!h.primJeton || !!c.env.PRIM_JETON,
    hasTmdbKey: !!h.tmdbApiKey || !!c.env.TMDB_API_KEY,
    expenseCategories: (() => {
      try {
        const v = h.expenseCategories ? JSON.parse(h.expenseCategories) : null;
        return Array.isArray(v) ? v : null;
      } catch {
        return null;
      }
    })(),
    // Rayons de la liste de courses ; null = DEFAULT_SHOPPING_CATEGORIES.
    shoppingCategories: (() => {
      try {
        const v = h.shoppingCategories ? JSON.parse(h.shoppingCategories) : null;
        return Array.isArray(v) && v.length > 0 ? v : null;
      } catch {
        return null;
      }
    })(),
    defaultPacking: (() => {
      // Accepte l'ancien format (libellés seuls) et le format { label, category, person }.
      try {
        const v = h.defaultPacking ? JSON.parse(h.defaultPacking) : null;
        if (!Array.isArray(v)) return null;
        const cat = (x: unknown) =>
          PACKING_CATEGORIES.includes(x as (typeof PACKING_CATEGORIES)[number]) ? x : "autre";
        const per = (x: unknown) => (typeof x === "string" && x.trim() ? x : "famille");
        return v.flatMap((e: unknown) => {
          if (typeof e === "string") return e.trim() ? [{ label: e, category: "autre", person: "famille" }] : [];
          if (e && typeof e === "object" && typeof (e as { label?: unknown }).label === "string") {
            const o = e as { label: string; category?: unknown; person?: unknown };
            return o.label.trim() ? [{ label: o.label, category: cat(o.category), person: per(o.person) }] : [];
          }
          return [];
        });
      } catch {
        return null;
      }
    })(),
    household: {
      id: h.id,
      name: h.name,
      currency: h.currency,
      defaultSplitA: h.defaultSplitA,
      defaultSplitB: h.defaultSplitB,
      defaultPayer: h.defaultPayer === "b" ? "b" : "a",
      defaultAccountId: h.defaultAccountId ?? null,
      members: {
        a: { name: h.memberAName, color: h.memberAColor },
        b: { name: h.memberBName, color: h.memberBColor },
      },
      extraPersons: (() => {
        try {
          const v = h.extraPersons ? JSON.parse(h.extraPersons) : [];
          return z.array(extraPersonSchema).parse(v);
        } catch {
          return [];
        }
      })(),
      weddingDays: (() => {
        try {
          return parseWeddingDays(h.weddingDays ? JSON.parse(h.weddingDays) : null);
        } catch {
          return WEDDING_DAYS_DEFAULT;
        }
      })(),
      weddingTargetDate: h.weddingTargetDate,
      // Réglages Films : parsés défensivement, comme les autres colonnes JSON —
      // une valeur illisible retombe sur le comportement d'origine.
      filmConfig: (() => {
        try {
          return h.filmConfig ? filmConfigSchema.parse(JSON.parse(h.filmConfig)) : DEFAULT_FILM_CONFIG;
        } catch {
          return DEFAULT_FILM_CONFIG;
        }
      })(),
    },
  });
});

export default auth;
