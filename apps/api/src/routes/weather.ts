import { Hono } from "hono";
import { eq, asc } from "drizzle-orm";
import { weatherCity } from "../db/schema";
import type { AppContext } from "../lib/types";

const weather = new Hono<AppContext>();

// Villes par défaut si le foyer n'en a configuré aucune.
const DEFAULT_LOCATIONS = [{ name: "Paris", lat: 48.8566, lon: 2.3522 }];

interface DailyResp {
  daily?: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    weather_code: number[];
    precipitation_probability_max: number[];
  };
}

weather.get("/", async (c) => {
  try {
    const rows = await c
      .get("db")
      .select()
      .from(weatherCity)
      .where(eq(weatherCity.householdId, c.get("household").id))
      .orderBy(asc(weatherCity.position));
    const LOCATIONS =
      rows.length > 0 ? rows.map((r) => ({ name: r.name, lat: r.lat, lon: r.lon })) : DEFAULT_LOCATIONS;

    const locations = await Promise.all(
      LOCATIONS.map(async (loc) => {
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
          `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max` +
          `&timezone=auto&forecast_days=3`;
        try {
          const res = await fetch(url);
          if (!res.ok) return { name: loc.name, lat: loc.lat, lon: loc.lon, days: [] };
          const json = (await res.json()) as DailyResp;
          const d = json.daily;
          if (!d) return { name: loc.name, lat: loc.lat, lon: loc.lon, days: [] };
          const days = d.time.map((date, i) => ({
            date,
            tMax: Math.round(d.temperature_2m_max[i]),
            tMin: Math.round(d.temperature_2m_min[i]),
            code: d.weather_code[i],
            rain: d.precipitation_probability_max?.[i] ?? 0,
          }));
          return { name: loc.name, lat: loc.lat, lon: loc.lon, days };
        } catch {
          return { name: loc.name, lat: loc.lat, lon: loc.lon, days: [] };
        }
      }),
    );
    return c.json({ locations });
  } catch (e) {
    return c.json({ error: "weather_error", detail: String(e) }, 502);
  }
});

interface HourlyResp {
  hourly?: {
    time: string[];
    temperature_2m: number[];
    weather_code: number[];
    precipitation_probability: number[];
  };
}

// Météo heure par heure pour une ville (lat/lon) et un jour (YYYY-MM-DD).
weather.get("/hourly", async (c) => {
  const url = new URL(c.req.url);
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");
  const date = url.searchParams.get("date");
  if (!lat || !lon || !date) return c.json({ error: "missing_params" }, 400);
  try {
    const api =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,weather_code,precipitation_probability` +
      `&timezone=auto&start_date=${date}&end_date=${date}`;
    const res = await fetch(api);
    if (!res.ok) return c.json({ hours: [] });
    const json = (await res.json()) as HourlyResp;
    const h = json.hourly;
    if (!h) return c.json({ hours: [] });
    const hours = h.time.map((time, i) => ({
      time,
      temp: Math.round(h.temperature_2m[i]),
      code: h.weather_code[i],
      rain: h.precipitation_probability?.[i] ?? 0,
    }));
    return c.json({ hours });
  } catch (e) {
    return c.json({ error: "weather_error", detail: String(e) }, 502);
  }
});

export default weather;
