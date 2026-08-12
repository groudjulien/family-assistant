import { Hono } from "hono";
import { eq, and, asc, desc } from "drizzle-orm";
import { createActivityFavoriteSchema } from "@gfa/shared";
import { followedCity, activityFeed, activityFavorite, activityHidden } from "../db/schema";
import { parseBody } from "../lib/validate";
import { OUTBOUND_USER_AGENT } from "../lib/http";
import { newId, nowIso } from "../lib/util";
import type { AppContext } from "../lib/types";

const activities = new Hono<AppContext>();

/* ---------------- Favoris ---------------- */

activities.get("/favorites", async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(activityFavorite)
    .where(eq(activityFavorite.householdId, c.get("household").id))
    .orderBy(asc(activityFavorite.start));
  return c.json({
    activities: rows.map((r) => ({
      id: r.externalId,
      title: r.title,
      description: r.description ?? "",
      city: r.city ?? "",
      address: r.address ?? "",
      start: r.start,
      end: r.end,
      dateLabel: r.dateLabel,
      imageUrl: r.imageUrl,
      url: r.url,
    })),
  });
});

activities.post("/favorites", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, createActivityFavoriteSchema);
  const existing = await db
    .select()
    .from(activityFavorite)
    .where(and(eq(activityFavorite.householdId, hid), eq(activityFavorite.externalId, body.externalId)));
  if (existing.length > 0) return c.json({ ok: true, id: existing[0].id });
  const id = newId();
  await db.insert(activityFavorite).values({
    id,
    householdId: hid,
    externalId: body.externalId,
    title: body.title,
    description: body.description ?? null,
    city: body.city ?? null,
    address: body.address ?? null,
    start: body.start ?? null,
    end: body.end ?? null,
    dateLabel: body.dateLabel ?? null,
    imageUrl: body.imageUrl ?? null,
    url: body.url ?? null,
    createdAt: nowIso(),
  });
  return c.json({ ok: true, id }, 201);
});

activities.delete("/favorites/:externalId", async (c) => {
  const db = c.get("db");
  await db
    .delete(activityFavorite)
    .where(
      and(
        eq(activityFavorite.householdId, c.get("household").id),
        eq(activityFavorite.externalId, c.req.param("externalId")),
      ),
    );
  return c.json({ ok: true });
});

const DATASET =
  "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/evenements-publics-openagenda/records";

// Mots-clés excluant les événements "pro" et "séniors".
const BLOCKED = [
  "entrepreneur",
  "entreprenariat",
  "entreprise",
  "createur d entreprise",
  "porteurs de projet",
  "porteur de projet",
  "france travail",
  "pole emploi",
  "recrut",
  "webinaire",
  "auto-entrepreneur",
  "freelance",
  "senior",
  "retraite",
  "troisieme age",
  "3e age",
  "aines",
];

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

interface ActivityOut {
  id: string;
  title: string;
  description: string;
  city: string;
  address: string;
  start: string | null;
  end: string | null;
  dateLabel: string | null;
  imageUrl: string | null;
  url: string | null;
}

/* ---------------- Flux RSS (agendas municipaux, ex. WordPress) ---------------- */

// Décode les entités HTML courantes (dont les numériques : &#8211; etc.).
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

const stripHtml = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

// Extrait le contenu d'une balise (gère CDATA), sans parseur XML (indispo en Worker).
function rssTag(item: string, tag: string): string | null {
  const m = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return null;
  const inner = m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim();
  return inner || null;
}

function toIso(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Parse un flux RSS d'événements. Deux dialectes rencontrés sur les sites
 * municipaux :
 *  - module événement RSS `ev:startdate` / `ev:enddate` (sites WordPress) ;
 *  - variante Drupal où `pubDate` EST la date de l'événement, confirmée par la
 *    présence de `lmp:endDate`.
 * Un item sans date d'événement est ignoré (article de blog, pas un événement).
 */
function parseRssEvents(xml: string, feedName: string): ActivityOut[] {
  const out: ActivityOut[] = [];
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/g) ?? [];
  for (const item of items) {
    const evStart = toIso(rssTag(item, "ev:startdate"));
    const lmpEnd = toIso(rssTag(item, "lmp:endDate"));
    const start = evStart ?? (lmpEnd ? toIso(rssTag(item, "pubDate")) : null);
    if (!start) continue;
    const end = toIso(rssTag(item, "ev:enddate")) ?? lmpEnd;
    const link = rssTag(item, "link");
    const guid = stripHtml(rssTag(item, "guid") ?? "");
    const desc = rssTag(item, "description") ?? rssTag(item, "content:encoded") ?? "";
    const img =
      desc.match(/<img[^>]+src="([^"]+)"/i)?.[1] ??
      item.match(/<image>[\s\S]*?<url>\s*([^<\s][^<]*?)\s*<\/url>/i)?.[1] ??
      item.match(/<enclosure[^>]+url="([^"]+)"/i)?.[1] ??
      null;
    out.push({
      id: guid || link || `${feedName}-${start}`,
      title: stripHtml(rssTag(item, "title") ?? "Événement"),
      description: stripHtml(desc),
      city: feedName,
      address: "",
      start,
      end,
      dateLabel: null,
      imageUrl: img,
      url: link,
    });
  }
  return out;
}

interface OdsRecord {
  uid?: string;
  title_fr?: string | null;
  description_fr?: string | null;
  longdescription_fr?: string | null;
  keywords_fr?: string[] | null;
  image?: string | null;
  thumbnail?: string | null;
  originalimage?: string | null;
  canonicalurl?: string | null;
  firstdate_begin?: string | null;
  lastdate_end?: string | null;
  daterange_fr?: string | null;
  location_name?: string | null;
  location_address?: string | null;
  location_city?: string | null;
}

// Liste les événements à venir : villes suivies (OpenAgenda via OpenDataSoft)
// + flux RSS d'agendas configurés (Réglages → Activités), fusionnés et triés.
activities.get("/", async (c) => {
  const hid = c.get("household").id;
  const cities = await c
    .get("db")
    .select()
    .from(followedCity)
    .where(eq(followedCity.householdId, hid))
    .orderBy(asc(followedCity.name));
  const feeds = await c
    .get("db")
    .select()
    .from(activityFeed)
    .where(eq(activityFeed.householdId, hid))
    .orderBy(asc(activityFeed.name));
  if (cities.length === 0 && feeds.length === 0) return c.json({ activities: [] });

  // Une activité masquée ou déjà retenue (« À faire ») n'est plus proposée :
  // elle ne vit que dans son onglet.
  const hiddenRows = await c
    .get("db")
    .select()
    .from(activityHidden)
    .where(eq(activityHidden.householdId, hid));
  const favRows = await c
    .get("db")
    .select()
    .from(activityFavorite)
    .where(eq(activityFavorite.householdId, hid));
  const hidden = new Set([
    ...hiddenRows.map((h) => h.externalId),
    ...favRows.map((f) => f.externalId),
  ]);
  const blocked = (parts: (string | null | undefined)[]) => {
    const text = normalize(parts.filter(Boolean).join(" "));
    return BLOCKED.some((w) => text.includes(w));
  };

  // Fenêtre : événements à venir dans les 30 prochains jours.
  const now = new Date().toISOString();
  const until = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  // -- Source 1 : OpenAgenda (villes suivies) --
  const fromOpenAgenda = async (): Promise<ActivityOut[]> => {
    if (cities.length === 0) return [];
    const inList = cities.map((city) => `"${city.name.replace(/"/g, "")}"`).join(", ");
    const where = `location_city in (${inList}) and lastdate_end >= now() and firstdate_begin <= "${until}"`;
    const url =
      `${DATASET}?` +
      new URLSearchParams({ where, order_by: "firstdate_begin", limit: "100" }).toString();
    const res = await fetch(url, { headers: { "User-Agent": OUTBOUND_USER_AGENT } });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: OdsRecord[] };
    return (data.results ?? [])
      .filter(
        (r) =>
          !blocked([r.title_fr, r.description_fr, r.longdescription_fr, (r.keywords_fr ?? []).join(" ")]),
      )
      .map((r) => ({
        id: r.uid ?? r.canonicalurl ?? Math.random().toString(36),
        title: (r.title_fr ?? "Événement").trim(),
        description: (r.description_fr ?? r.longdescription_fr ?? "").trim(),
        city: r.location_city ?? "",
        address: [r.location_name, r.location_address].filter(Boolean).join(" — "),
        start: r.firstdate_begin ?? null,
        end: r.lastdate_end ?? null,
        dateLabel: r.daterange_fr ?? null,
        imageUrl: r.image ?? r.originalimage ?? r.thumbnail ?? null,
        url: r.canonicalurl ?? null,
      }));
  };

  // -- Source 2 : flux RSS d'agendas --
  const fromFeed = async (f: typeof feeds[number]): Promise<ActivityOut[]> => {
    const res = await fetch(f.url, {
      headers: { "User-Agent": OUTBOUND_USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    return parseRssEvents(await res.text(), f.name).filter(
      (a) =>
        a.start !== null &&
        a.start <= `${until}T23:59:59` &&
        (a.end ?? a.start)! >= now &&
        !blocked([a.title, a.description]),
    );
  };

  try {
    // Chaque source est isolée : un flux en panne ne vide pas la liste.
    const results = await Promise.allSettled([fromOpenAgenda(), ...feeds.map(fromFeed)]);
    const list = results
      .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
      .filter((a) => !hidden.has(a.id))
      .sort((a, b) => (a.start ?? "9999").localeCompare(b.start ?? "9999"));
    return c.json({ activities: list });
  } catch (e) {
    return c.json({ activities: [], error: String(e) });
  }
});

/* ---------------- Masquées (ne plus proposer) ---------------- */

activities.get("/hidden", async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(activityHidden)
    .where(eq(activityHidden.householdId, c.get("household").id))
    .orderBy(desc(activityHidden.createdAt));
  return c.json({
    activities: rows.map((r) => ({
      id: r.externalId,
      title: r.title,
      description: r.description ?? "",
      city: r.city ?? "",
      address: r.address ?? "",
      start: r.start,
      end: r.end,
      dateLabel: r.dateLabel,
      imageUrl: r.imageUrl,
      url: r.url,
    })),
  });
});

activities.post("/hidden", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, createActivityFavoriteSchema);
  // Masquer une activité la sort aussi de la liste « À faire » (favoris).
  await db
    .delete(activityFavorite)
    .where(
      and(
        eq(activityFavorite.householdId, hid),
        eq(activityFavorite.externalId, body.externalId),
      ),
    );
  const existing = await db
    .select()
    .from(activityHidden)
    .where(and(eq(activityHidden.householdId, hid), eq(activityHidden.externalId, body.externalId)));
  if (existing.length > 0) return c.json({ ok: true, id: existing[0].id });
  await db.insert(activityHidden).values({
    id: newId(),
    householdId: hid,
    externalId: body.externalId,
    title: body.title,
    description: body.description ?? null,
    city: body.city ?? null,
    address: body.address ?? null,
    start: body.start ?? null,
    end: body.end ?? null,
    dateLabel: body.dateLabel ?? null,
    imageUrl: body.imageUrl ?? null,
    url: body.url ?? null,
    createdAt: nowIso(),
  });
  return c.json({ ok: true }, 201);
});

activities.delete("/hidden/:externalId", async (c) => {
  await c
    .get("db")
    .delete(activityHidden)
    .where(
      and(
        eq(activityHidden.householdId, c.get("household").id),
        eq(activityHidden.externalId, c.req.param("externalId")),
      ),
    );
  return c.json({ ok: true });
});

export default activities;
