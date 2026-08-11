import { Hono } from "hono";
import { setupCompleteSchema } from "@gfa/shared";
import { household, account, allowedEmail } from "../db/schema";
import { parseBody } from "../lib/validate";
import { encryptSecret } from "../lib/crypto";
import { newId, nowIso } from "../lib/util";
import type { AppContext, Db } from "../lib/types";

/**
 * Wizard de premier lancement. Ces routes ne répondent que si :
 *  1. le secret SETUP_TOKEN est configuré (généré par scripts/setup.sh) ;
 *  2. le jeton fourni correspond (comparaison à temps constant) ;
 *  3. la base est vierge (aucun foyer) — 410 sinon, définitivement.
 */
const setup = new Hono<AppContext>();

/** Comparaison à temps constant : on compare les SHA-256 (longueur fixe). */
async function tokenMatches(provided: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(provided)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const va = new Uint8Array(a);
  const vb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

type Gate = "ok" | "not_available" | "invalid_token" | "already_configured";

async function gate(db: Db, env: { SETUP_TOKEN?: string }, token: string | undefined): Promise<Gate> {
  if (!env.SETUP_TOKEN) return "not_available";
  if (!token || !(await tokenMatches(token, env.SETUP_TOKEN))) return "invalid_token";
  const existing = await db.select().from(household).limit(1);
  if (existing.length > 0) return "already_configured";
  return "ok";
}

const gateStatus: Record<Exclude<Gate, "ok">, 403 | 404 | 410> = {
  not_available: 404,
  invalid_token: 403,
  already_configured: 410,
};

setup.get("/status", async (c) => {
  const g = await gate(c.get("db"), c.env, c.req.query("token"));
  if (g !== "ok") return c.json({ error: g }, gateStatus[g]);
  return c.json({ ok: true });
});

setup.post("/complete", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, setupCompleteSchema);
  const g = await gate(db, c.env, body.token);
  if (g !== "ok") return c.json({ error: g }, gateStatus[g]);

  const now = nowIso();
  const h = body.household;
  const householdId = newId();

  // Comptes créés d'abord en mémoire pour connaître l'id du compte par défaut.
  const accountRows = body.accounts.map((a) => ({
    id: newId(),
    householdId,
    name: a.name,
    owner: a.owner,
    type: a.type,
    isPrimary: a.isPrimary ? 1 : 0,
    forecast: a.type === "savings" ? 0 : 1,
    currentBalance: a.balance,
    balanceUpdatedAt: now,
  }));
  const defaultAccountId =
    body.defaultAccountIndex != null ? accountRows[body.defaultAccountIndex]?.id ?? null : null;

  const enc = (v: string | null | undefined) =>
    v ? encryptSecret(v, c.env.SESSION_SECRET) : Promise.resolve(null);
  const [anthropicKey, lunchflowKey, primKey, primJeton, tmdbKey] = await Promise.all([
    enc(body.apiKeys.anthropic),
    enc(body.apiKeys.lunchflow),
    enc(body.apiKeys.prim),
    enc(body.apiKeys.primJeton),
    enc(body.apiKeys.tmdb),
  ]);

  const emails: { email: string; memberSlot: string }[] = [
    { email: h.memberAEmail.toLowerCase(), memberSlot: "a" },
  ];
  if (h.memberBEmail && h.memberBEmail.toLowerCase() !== h.memberAEmail.toLowerCase()) {
    emails.push({ email: h.memberBEmail.toLowerCase(), memberSlot: "b" });
  }

  // Écriture atomique : foyer + allowlist + comptes dans un seul batch D1.
  const stmts = [
    db.insert(household).values({
      id: householdId,
      name: h.name,
      currency: h.currency,
      defaultSplitA: h.defaultSplitA,
      defaultSplitB: 100 - h.defaultSplitA,
      memberAName: h.members.a.name,
      memberBName: h.members.b.name,
      memberAColor: h.members.a.color,
      memberBColor: h.members.b.color,
      extraPersons: JSON.stringify(h.extraPersons),
      anthropicApiKey: anthropicKey,
      lunchflowApiKey: lunchflowKey,
      primApiKey: primKey,
      primJeton,
      tmdbApiKey: tmdbKey,
      expenseCategories: body.expenseCategories ? JSON.stringify(body.expenseCategories) : null,
      defaultAccountId,
      defaultMenuHidden: body.menuHidden.length > 0 ? JSON.stringify(body.menuHidden) : null,
      createdAt: now,
    }),
    ...emails.map((e) =>
      db.insert(allowedEmail).values({ email: e.email, memberSlot: e.memberSlot, createdAt: now }),
    ),
    ...(accountRows.length > 0 ? [db.insert(account).values(accountRows)] : []),
  ];
  await db.batch(stmts as unknown as Parameters<typeof db.batch>[0]);

  return c.json({ ok: true });
});

export default setup;
