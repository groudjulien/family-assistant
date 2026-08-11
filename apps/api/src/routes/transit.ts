import { Hono } from "hono";
import { eq, asc } from "drizzle-orm";
import { transitLine } from "../db/schema";
import { resolvePrimKey } from "../lib/apiKeys";
import type { AppContext } from "../lib/types";

const transit = new Hono<AppContext>();

// L'endpoint marketplace Navitia est déjà calé sur l'IDF (pas de coverage/fr-idf).
const BASE = "https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia";

interface LineCfg {
  lineCode: string;
  label: string;
  color: string;
  stationA: string;
  stationB: string;
  kind: string;
}

// Configuration par défaut si le foyer n'a rien personnalisé (grandes gares
// parisiennes — à personnaliser dans Réglages → Accueil → Transports).
const DEFAULT_LINES: LineCfg[] = [
  { lineCode: "A", label: "RER A", color: "#E2231A", stationA: "Châtelet les Halles", stationB: "La Défense", kind: "principal" },
  { lineCode: "B", label: "RER B", color: "#5291CE", stationA: "Châtelet les Halles", stationB: "Gare du Nord", kind: "principal" },
  { lineCode: "14", label: "Métro 14", color: "#662483", stationA: "Châtelet", stationB: "Gare de Lyon", kind: "secondary" },
];

interface NavDisruption {
  severity?: { effect?: string };
  messages?: { text?: string }[];
  impacted_objects?: { pt_object?: { embedded_type?: string; line?: { code?: string } } }[];
}
interface NavSection {
  type?: string;
  departure_date_time?: string;
  display_informations?: { code?: string; direction?: string };
  links?: { type?: string; id?: string }[];
}
interface NavJourney {
  departure_date_time?: string;
  sections?: NavSection[];
}
interface NavDeparture {
  display_informations?: { code?: string; direction?: string };
  stop_date_time?: { departure_date_time?: string };
}

const hhmm = (s?: string) => (s && s.length >= 13 ? `${s.slice(9, 11)}:${s.slice(11, 13)}` : null);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  eacute: "é", Eacute: "É", egrave: "è", Egrave: "È", ecirc: "ê", Ecirc: "Ê", euml: "ë",
  agrave: "à", Agrave: "À", acirc: "â", Acirc: "Â", ccedil: "ç", Ccedil: "Ç",
  ugrave: "ù", ucirc: "û", uuml: "ü", icirc: "î", iuml: "ï", ocirc: "ô", oelig: "œ",
  laquo: "«", raquo: "»", mdash: "—", ndash: "–", hellip: "…",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", deg: "°", euro: "€", middot: "·", times: "×",
};

/** Décode les entités HTML (Navitia renvoie « &#233; » plutôt que « é »). */
const decodeEntities = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    // Casse respectée si l'entité exacte est connue (&Eacute; → É), sinon repli.
    .replace(
      /&([a-zA-Z]+);/g,
      (m, name: string) => NAMED_ENTITIES[name] ?? NAMED_ENTITIES[name.toLowerCase()] ?? m,
    );

// Balises retirées d'abord, puis entités décodées : un « &lt; » décodé ne peut
// donc pas être confondu avec une balise.
const stripHtml = (s: string) =>
  decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Minutes depuis minuit pour un « HH:MM ». */
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Heure courante à Paris en « HH:MM » (le Worker tourne en UTC). */
const parisNow = () =>
  new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

/**
 * Dédoublonne et trie des « HH:MM » du plus proche au plus lointain, en gérant
 * le passage de minuit (23:50 avant 00:10).
 */
function sortUpcoming(times: string[]): string[] {
  const now = toMinutes(parisNow());
  const delay = (t: string) => (toMinutes(t) - now + 1440) % 1440;
  return [...new Set(times)].sort((a, b) => delay(a) - delay(b));
}

function disruptionInfo(disruptions: NavDisruption[], code: string) {
  const matching = disruptions.filter((dis) =>
    (dis.impacted_objects ?? []).some(
      (io) => io.pt_object?.embedded_type === "line" && io.pt_object?.line?.code === code,
    ),
  );
  const perturbe = matching.some(
    (d) => d.severity?.effect && d.severity.effect !== "UNKNOWN_EFFECT" && d.severity.effect !== "NO_IMPACT",
  );
  const messages = matching
    .flatMap((d) => (d.messages ?? []).map((m) => (m.text ? stripHtml(m.text) : "")))
    .filter((t) => t.length > 0)
    .slice(0, 2);
  return { perturbe, messages };
}

transit.get("/", async (c) => {
  const key = await resolvePrimKey(c.get("household"), c.env);
  if (!key) return c.json({ principal: [], secondary: [] });
  const headers = { apiKey: key, Accept: "application/json" };

  // Lignes configurées du foyer (sinon défaut)
  const rows = await c
    .get("db")
    .select()
    .from(transitLine)
    .where(eq(transitLine.householdId, c.get("household").id))
    .orderBy(asc(transitLine.position));
  const lines: LineCfg[] = rows.length > 0 ? rows : DEFAULT_LINES;

  if (lines.length === 0) return c.json({ principal: [], secondary: [] });

  // Résolution des stop_area par nom (uniques)
  const stationNames = [...new Set(lines.flatMap((l) => [l.stationA, l.stationB]))];
  const ids: Record<string, string> = {};
  await Promise.all(
    stationNames.map(async (name) => {
      try {
        const r = await fetch(
          `${BASE}/places?q=${encodeURIComponent(name)}&type%5B%5D=stop_area&count=1`,
          { headers },
        );
        if (!r.ok) return;
        const j = (await r.json()) as { places?: { id?: string }[] };
        if (j.places?.[0]?.id) ids[name] = j.places[0].id;
      } catch {
        /* ignore */
      }
    }),
  );

  const MAX_TIMES = 12; // nombre max d'horaires renvoyés par direction

  const nextTimes = async (fromName: string, toName: string, code: string) => {
    const fromId = ids[fromName];
    const toId = ids[toName];
    if (!fromId || !toId) return { next: [] as string[], perturbe: false, messages: [] as string[], ok: false };
    let responded = false;
    let perturbe = false;
    let messages: string[] = [];

    // 1) Itinéraire (journeys) : sert surtout à connaître la DIRECTION correcte
    //    (terminus / branche) et à avoir un premier horaire fiable. Ce endpoint ne
    //    renvoie que quelques itinéraires, pas une grille horaire complète.
    const journeyTimes: string[] = [];
    // Toutes les directions (terminus) qui desservent la destination : une même
    // ligne peut y aller par plusieurs branches (H : via Valmondois OU via
    // Montsoult). N'en garder qu'une écartait les trains de l'autre branche.
    const directions = new Set<string>();
    // Id Navitia de la ligne (ex. line:IDFM:C01737) : permet ensuite de demander
    // la grille horaire de CETTE ligne seulement (cf. plus bas).
    let lineId: string | undefined;
    try {
      const r = await fetch(
        `${BASE}/journeys?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}&count=10&data_freshness=realtime&max_nb_transfers=0`,
        { headers },
      );
      if (r.ok) {
        responded = true;
        const j = (await r.json()) as { journeys?: NavJourney[]; disruptions?: NavDisruption[] };
        for (const jr of j.journeys ?? []) {
          const sec = (jr.sections ?? []).find((s) => s.display_informations?.code === code);
          if (!sec) continue;
          const t = hhmm(sec.departure_date_time);
          if (t) journeyTimes.push(t);
          if (sec.display_informations?.direction) directions.add(sec.display_informations.direction);
          if (!lineId) lineId = (sec.links ?? []).find((l) => l.type === "line")?.id;
        }
        const info = disruptionInfo(j.disruptions ?? [], code);
        perturbe = info.perturbe;
        messages = info.messages;
      }
    } catch {
      /* on tente la grille ci-dessous */
    }

    // 2) Grille horaire (departures), filtrée par direction pour ne pas mélanger
    //    les deux sens.
    //    Grille filtrée par ligne quand on connaît son id : indispensable dans une
    // grande gare, où le quota de départs est sinon consommé par les autres
    // lignes (à Gare du Nord, 150 départs toutes lignes ne couvrent que ~45 min,
    // soit 2 trains H ; 30 départs de la ligne H couvrent plus de 4 h).
    const timetable: string[] = [];
    const departuresUrl = (path: string) =>
      `${BASE}${path}/departures?count=${lineId ? 40 : 150}&data_freshness=realtime`;
    const stopPath = `/stop_areas/${encodeURIComponent(fromId)}`;
    try {
      let dr = await fetch(
        departuresUrl(lineId ? `${stopPath}/lines/${encodeURIComponent(lineId)}` : stopPath),
        { headers },
      );
      // Repli sur la grille toutes lignes si le filtre par ligne est refusé.
      if (!dr.ok && lineId) dr = await fetch(departuresUrl(stopPath), { headers });
      if (dr.ok) {
        responded = true;
        const dj = (await dr.json()) as { departures?: NavDeparture[]; disruptions?: NavDisruption[] };
        for (const d of dj.departures ?? []) {
          if (d.display_informations?.code !== code) continue;
          const dir = d.display_informations?.direction;
          if (directions.size > 0 && dir && !directions.has(dir)) continue;
          const t = hhmm(d.stop_date_time?.departure_date_time);
          if (t) timetable.push(t);
        }
        if (messages.length === 0) {
          const info = disruptionInfo(dj.disruptions ?? [], code);
          perturbe = perturbe || info.perturbe;
          messages = info.messages;
        }
      }
    } catch {
      /* ignore : on gardera les horaires de journeys */
    }

    // Union des deux sources : la grille peut être filtrée trop finement (une
    // seule branche remonte), les itinéraires apportent alors les autres départs.
    const next = sortUpcoming([...journeyTimes, ...timetable]).slice(0, MAX_TIMES);
    return { next, perturbe, messages, ok: responded };
  };

  const built = await Promise.all(
    lines.map(async (l) => {
      const [ab, ba] = await Promise.all([
        nextTimes(l.stationA, l.stationB, l.lineCode),
        nextTimes(l.stationB, l.stationA, l.lineCode),
      ]);
      const okAny = ab.ok || ba.ok;
      const perturbe = ab.perturbe || ba.perturbe;
      const messages = [...new Set([...ab.messages, ...ba.messages])].slice(0, 2);
      return {
        key: l.lineCode,
        label: l.label,
        color: l.color,
        kind: l.kind,
        status: !okAny ? "unknown" : perturbe ? "perturbe" : "ok",
        messages,
        dirs: [
          { label: `${l.stationA} → ${l.stationB}`, next: ab.next },
          { label: `${l.stationB} → ${l.stationA}`, next: ba.next },
        ],
      };
    }),
  );

  return c.json({
    principal: built.filter((b) => b.kind !== "secondary"),
    secondary: built.filter((b) => b.kind === "secondary"),
  });
});

// Stations desservies par une ligne (pour le sélecteur de gares dans les réglages).
transit.get("/stations", async (c) => {
  const key = await resolvePrimKey(c.get("household"), c.env);
  const code = c.req.query("code");
  if (!key || !code) return c.json({ stations: [] });
  const headers = { apiKey: key, Accept: "application/json" };
  try {
    const lr = await fetch(
      `${BASE}/lines?filter=${encodeURIComponent(`line.code="${code}"`)}&count=25`,
      { headers },
    );
    if (!lr.ok) return c.json({ stations: [] });
    const lj = (await lr.json()) as { lines?: { id?: string }[] };
    const lineIds = (lj.lines ?? []).map((l) => l.id).filter((id): id is string => !!id).slice(0, 5);
    const names = new Set<string>();
    await Promise.all(
      lineIds.map(async (id) => {
        try {
          const sr = await fetch(
            `${BASE}/lines/${encodeURIComponent(id)}/stop_areas?count=400`,
            { headers },
          );
          if (!sr.ok) return;
          const sj = (await sr.json()) as { stop_areas?: { name?: string }[] };
          for (const s of sj.stop_areas ?? []) if (s.name) names.add(s.name);
        } catch {
          /* ignore */
        }
      }),
    );
    return c.json({ stations: [...names].sort((a, b) => a.localeCompare(b, "fr")) });
  } catch {
    return c.json({ stations: [] });
  }
});

export default transit;
