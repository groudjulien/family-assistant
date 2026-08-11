import { Hono } from "hono";
import { OUTBOUND_USER_AGENT } from "../lib/http";
import type { AppContext } from "../lib/types";

const f1 = new Hono<AppContext>();

interface Session {
  date: string;
  time?: string;
}
interface ErgastRace {
  raceName: string;
  round: string;
  Circuit: { circuitName: string; Location: { locality: string; country: string } };
  date: string;
  time?: string;
  Qualifying?: Session;
  Sprint?: Session;
  SprintQualifying?: Session;
  SprintShootout?: Session;
}

const iso = (s?: Session): string | null =>
  s ? (s.time ? `${s.date}T${s.time}` : `${s.date}T00:00:00Z`) : null;

f1.get("/next", async (c) => {
  try {
    const res = await fetch("https://api.jolpi.ca/ergast/f1/current/next.json", {
      headers: { "User-Agent": OUTBOUND_USER_AGENT },
    });
    if (!res.ok) return c.json({ error: "f1_fetch_failed" }, 502);
    const json = (await res.json()) as {
      MRData?: { RaceTable?: { Races?: ErgastRace[] } };
    };
    const race = json.MRData?.RaceTable?.Races?.[0];
    if (!race) return c.json({ race: null });

    const sprintQuali = race.SprintQualifying ?? race.SprintShootout;
    return c.json({
      race: {
        name: race.raceName,
        round: race.round,
        circuit: race.Circuit.circuitName,
        locality: race.Circuit.Location.locality,
        country: race.Circuit.Location.country,
        raceAt: iso({ date: race.date, time: race.time }),
        qualifyingAt: iso(race.Qualifying),
        sprintQualifyingAt: iso(sprintQuali),
        sprintAt: iso(race.Sprint),
      },
    });
  } catch (e) {
    return c.json({ error: "f1_error", detail: String(e) }, 502);
  }
});

/* ---------------- Actualités F1 (flux RSS) ---------------- */

const RSS_URL = "https://fr.motorsport.com/rss/f1/news/";

function rssField(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return "";
  let v = m[1].trim();
  const cd = v.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (cd) v = cd[1].trim();
  return v
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

f1.get("/news", async (c) => {
  try {
    const res = await fetch(RSS_URL, { headers: { "User-Agent": OUTBOUND_USER_AGENT } });
    if (!res.ok) return c.json({ items: [] });
    const xml = await res.text();
    const blocks = xml.split(/<item[ >]/i).slice(1, 8);
    const items = blocks
      .map((b) => ({
        title: rssField(b, "title"),
        link: rssField(b, "link"),
        date: rssField(b, "pubDate"),
      }))
      .filter((i) => i.title && i.link)
      .slice(0, 3);
    return c.json({ items });
  } catch (e) {
    return c.json({ items: [], error: String(e) });
  }
});

export default f1;
