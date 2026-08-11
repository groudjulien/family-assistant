import { eq } from "drizzle-orm";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context } from "hono";
import { session } from "../db/schema";
import type { Db } from "./types";
import { newId } from "./util";

const COOKIE = "gfa_session";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function createSession(db: Db, userId: string): Promise<string> {
  const id = newId();
  const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS).toISOString();
  await db.insert(session).values({ id, userId, expiresAt });
  return id;
}

export function setSessionCookie(c: Context, sessionId: string, secure: boolean) {
  setCookie(c, COOKIE, sessionId, {
    httpOnly: true,
    secure,
    // In prod the web (pages.dev) and API (workers.dev) are cross-site → None+Secure.
    sameSite: secure ? "None" : "Lax",
    path: "/",
    maxAge: THIRTY_DAYS_MS / 1000,
  });
}

export async function readSession(c: Context, db: Db): Promise<string | null> {
  const id = getCookie(c, COOKIE);
  if (!id) return null;
  const rows = await db.select().from(session).where(eq(session.id, id)).limit(1);
  const s = rows[0];
  if (!s) return null;
  if (new Date(s.expiresAt).getTime() < Date.now()) {
    await db.delete(session).where(eq(session.id, id));
    return null;
  }
  return s.userId;
}

export async function clearSession(c: Context, db: Db) {
  const id = getCookie(c, COOKIE);
  if (id) await db.delete(session).where(eq(session.id, id));
  deleteCookie(c, COOKIE, { path: "/" });
}
