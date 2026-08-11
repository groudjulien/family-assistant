import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import { createCalendarEventSchema } from "@gfa/shared";
import { googleOauthToken } from "../db/schema";
import {
  refreshAccessToken,
  listCalendars,
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
} from "../lib/google";
import { parseBody } from "../lib/validate";
import type { AppContext } from "../lib/types";

const calendar = new Hono<AppContext>();

async function accessTokenFor(c: Context<AppContext>): Promise<string | null> {
  const db = c.get("db");
  const userId = c.get("user").id;
  const tok = (
    await db.select().from(googleOauthToken).where(eq(googleOauthToken.userId, userId)).limit(1)
  )[0];
  if (!tok) return null;
  return refreshAccessToken(c.env, tok.refreshToken);
}

calendar.get("/list", async (c) => {
  const token = await accessTokenFor(c);
  if (!token) return c.json({ error: "no_google_token" }, 400);
  return c.json(await listCalendars(token));
});

calendar.get("/", async (c) => {
  const token = await accessTokenFor(c);
  if (!token) return c.json({ error: "no_google_token" }, 400);

  const now = new Date();
  const from = c.req.query("from") ?? now.toISOString();
  const toDefault = new Date(now);
  toDefault.setMonth(toDefault.getMonth() + 2);
  const to = c.req.query("to") ?? toDefault.toISOString();

  // The user only sees the calendars Google exposes to *them*
  // (their own + the shared family calendar they're a member of).
  const cals = await listCalendars(token);
  const all = (
    await Promise.all(
      cals.map(async (cal) => {
        try {
          const evs = await listEvents(token, cal.id, from, to);
          return evs.map((e) => ({ ...e, calendarName: cal.summary }));
        } catch {
          return [];
        }
      }),
    )
  ).flat();
  all.sort((a, b) => a.start.localeCompare(b.start));
  return c.json(all);
});

calendar.post("/events", async (c) => {
  const token = await accessTokenFor(c);
  if (!token) return c.json({ error: "no_google_token" }, 400);
  const body = await parseBody(c, createCalendarEventSchema);
  const ev = await createEvent(token, {
    calendarId: body.calendarId,
    summary: body.summary,
    description: body.description ?? null,
    start: body.start,
    end: body.end,
    allDay: body.allDay,
  });
  return c.json(ev, 201);
});

calendar.patch("/events/:id", async (c) => {
  const token = await accessTokenFor(c);
  if (!token) return c.json({ error: "no_google_token" }, 400);
  const body = await parseBody(c, createCalendarEventSchema);
  const ev = await updateEvent(token, c.req.param("id"), {
    calendarId: body.calendarId,
    summary: body.summary,
    description: body.description ?? null,
    start: body.start,
    end: body.end,
    allDay: body.allDay,
  });
  return c.json(ev);
});

calendar.delete("/events/:id", async (c) => {
  const token = await accessTokenFor(c);
  if (!token) return c.json({ error: "no_google_token" }, 400);
  const calendarId = c.req.query("calendarId") ?? "primary";
  await deleteEvent(token, calendarId, c.req.param("id"));
  return c.json({ ok: true });
});

export default calendar;
