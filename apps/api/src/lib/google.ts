import type { Env } from "../../worker-configuration";

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

export function buildAuthUrl(env: Env, state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  id_token: string;
  expires_in: number;
}

export async function exchangeCode(env: Env, code: string): Promise<GoogleTokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
  return res.json();
}

export async function refreshAccessToken(env: Env, refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

export async function getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Google userinfo failed: ${await res.text()}`);
  return res.json();
}

/* ---------------- Calendar ---------------- */

export interface GCalListEntry {
  id: string;
  summary: string;
  primary?: boolean;
  backgroundColor?: string;
}

export async function listCalendars(accessToken: string): Promise<GCalListEntry[]> {
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`calendarList failed: ${await res.text()}`);
  const json = (await res.json()) as { items?: GCalListEntry[] };
  return json.items ?? [];
}

interface GCalEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
}

export async function listEvents(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
) {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`events failed: ${await res.text()}`);
  const json = (await res.json()) as { items?: GCalEvent[] };
  return (json.items ?? []).map((e) => normalizeEvent(e, calendarId));
}

function normalizeEvent(e: GCalEvent, calendarId: string) {
  const allDay = Boolean(e.start?.date);
  return {
    id: e.id,
    calendarId,
    summary: e.summary ?? "(sans titre)",
    description: e.description ?? null,
    location: e.location ?? null,
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    allDay,
  };
}

interface EventInput {
  calendarId: string;
  summary: string;
  description?: string | null;
  start: string;
  end: string;
  allDay: boolean;
}

function eventBody(input: EventInput) {
  return {
    summary: input.summary,
    description: input.description ?? undefined,
    start: input.allDay ? { date: input.start } : { dateTime: input.start },
    end: input.allDay ? { date: input.end } : { dateTime: input.end },
  };
}

export async function createEvent(accessToken: string, input: EventInput) {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventBody(input)),
    },
  );
  if (!res.ok) throw new Error(`create event failed: ${await res.text()}`);
  return normalizeEvent((await res.json()) as GCalEvent, input.calendarId);
}

export async function updateEvent(accessToken: string, eventId: string, input: EventInput) {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventBody(input)),
    },
  );
  if (!res.ok) throw new Error(`update event failed: ${await res.text()}`);
  return normalizeEvent((await res.json()) as GCalEvent, input.calendarId);
}

export async function deleteEvent(accessToken: string, calendarId: string, eventId: string) {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok && res.status !== 410) throw new Error(`delete event failed: ${await res.text()}`);
}

/* ---------------- Gmail (lecture seule) ---------------- */

function b64urlDecode(data: string): string {
  try {
    const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

function extractText(part: GmailPart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return b64urlDecode(part.body.data);
  if (part.parts) {
    // plain d'abord, sinon html nettoyé
    const plain = part.parts.map((p) => extractText(p)).find((t) => t);
    if (plain) return plain;
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return b64urlDecode(part.body.data)
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ");
  }
  return "";
}

export async function searchGmailIds(
  accessToken: string,
  query: string,
  max = 25,
): Promise<string[]> {
  const params = new URLSearchParams({ q: query, maxResults: String(max) });
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`gmail search failed: ${await res.text()}`);
  const json = (await res.json()) as { messages?: { id: string }[] };
  return (json.messages ?? []).map((m) => m.id);
}

export interface GmailMessage {
  subject: string;
  from: string;
  date: string;
  text: string;
}

export async function getGmailMessage(accessToken: string, id: string): Promise<GmailMessage> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`gmail get failed: ${await res.text()}`);
  const json = (await res.json()) as {
    payload?: GmailPart & { headers?: { name: string; value: string }[] };
    snippet?: string;
  };
  const headers = json.payload?.headers ?? [];
  const h = (n: string) => headers.find((x) => x.name.toLowerCase() === n)?.value ?? "";
  let text = extractText(json.payload);
  if (!text) text = json.snippet ?? "";
  return { subject: h("subject"), from: h("from"), date: h("date"), text: text.slice(0, 6000) };
}
