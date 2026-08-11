import { Hono } from "hono";
import { eq, and, asc, desc } from "drizzle-orm";
import { createFilmFavoriteSchema, createFilmSeenSchema } from "@gfa/shared";
import { filmFavorite, filmSeen, filmHidden, streamingProvider } from "../db/schema";
import { parseBody } from "../lib/validate";
import { resolveTmdbKey } from "../lib/apiKeys";
import { newId, nowIso } from "../lib/util";
import type { AppContext } from "../lib/types";

const films = new Hono<AppContext>();

const TMDB = "https://api.themoviedb.org/3";
// Genres : Animation (16) pour enfants ; Action (28) ou Fantastique (14) pour adultes
const GENRES: Record<string, string> = { enfants: "16", adultes: "28|14" };
const TARGET = 15;

interface TmdbMovie {
  id: number;
  title: string;
  overview?: string;
  poster_path?: string | null;
  release_date?: string;
}

interface Provider {
  name: string;
  logo: string | null;
}

// On filtre par id de plateforme (aligné sur le filtre `with_watch_providers` de
// discover, lui aussi par id) et non par nom : les noms TMDB varient (« Disney+ »
// vs « Disney Plus », variantes « with Ads »…) et faisaient rejeter des films dispo.
async function providersFor(id: number, key: string, allowedIds: Set<number>): Promise<Provider[]> {
  try {
    const res = await fetch(`${TMDB}/movie/${id}/watch/providers?api_key=${key}`);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results?: {
        FR?: { flatrate?: { provider_id: number; provider_name: string; logo_path?: string | null }[] };
      };
    };
    const flat = data.results?.FR?.flatrate ?? [];
    return flat
      .filter((p) => allowedIds.has(p.provider_id))
      .map((p) => ({
        name: p.provider_name,
        logo: p.logo_path ? `https://image.tmdb.org/t/p/w92${p.logo_path}` : null,
      }));
  } catch {
    return [];
  }
}

function parseProviders(s: string | null): Provider[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) return v as Provider[];
  } catch {
    // ancien format CSV de noms
    return s
      .split(",")
      .filter(Boolean)
      .map((name) => ({ name, logo: null }));
  }
  return [];
}

films.get("/", async (c) => {
  const key = await resolveTmdbKey(c.get("household"), c.env);
  if (!key) return c.json({ films: [], error: "no_key" });
  const audience = c.req.query("audience") === "adultes" ? "adultes" : "enfants";
  const hid = c.get("household").id;

  // Plateformes activées par le foyer
  const provRows = await c
    .get("db")
    .select()
    .from(streamingProvider)
    .where(and(eq(streamingProvider.householdId, hid), eq(streamingProvider.enabled, 1)))
    .orderBy(asc(streamingProvider.position));
  if (provRows.length === 0) return c.json({ films: [], error: "no_provider" });
  const providerIds = provRows.map((p) => p.tmdbId).join("|");
  const allowedIds = new Set(provRows.map((p) => p.tmdbId));

  const seenRows = await c.get("db").select().from(filmSeen).where(eq(filmSeen.householdId, hid));
  const hiddenRows = await c.get("db").select().from(filmHidden).where(eq(filmHidden.householdId, hid));
  const favRows = await c
    .get("db")
    .select()
    .from(filmFavorite)
    .where(and(eq(filmFavorite.householdId, hid), eq(filmFavorite.audience, audience)));
  const seen = new Set([
    ...seenRows.map((s) => s.externalId),
    ...hiddenRows.map((h) => h.externalId),
    ...favRows.map((f) => f.externalId),
  ]);

  let base =
    `${TMDB}/discover/movie?api_key=${key}&language=fr-FR&watch_region=FR` +
    `&with_watch_providers=${providerIds}&with_watch_monetization_types=flatrate` +
    `&with_genres=${GENRES[audience]}&sort_by=popularity.desc&include_adult=false&vote_count.gte=20`;
  // Limite d'âge pour les enfants (certification FR)
  if (audience === "enfants") {
    const maxCert = c.get("household").kidsMaxCert ?? "U";
    base += `&certification_country=FR&certification.lte=${encodeURIComponent(maxCert)}`;
  }

  try {
    // Pool élargi (jusqu'à 10 pages / 60 candidats) pour ne pas être affamé par les
    // exclusions (déjà-vus, masqués, favoris) une fois beaucoup de films marqués.
    const collected: TmdbMovie[] = [];
    for (let page = 1; page <= 10 && collected.length < 60; page++) {
      const res = await fetch(`${base}&page=${page}`);
      if (!res.ok) break;
      const data = (await res.json()) as { results?: TmdbMovie[] };
      for (const m of data.results ?? []) {
        if (!seen.has(String(m.id)) && m.poster_path) collected.push(m);
      }
    }
    // Nouveautés d'abord : on propose les films les plus récents en tête (date de
    // sortie décroissante ; date manquante reléguée en fin).
    collected.sort((a, b) => (b.release_date ?? "").localeCompare(a.release_date ?? ""));
    const out: {
      id: string;
      title: string;
      description: string;
      imageUrl: string | null;
      providers: Provider[];
      year: string | null;
    }[] = [];
    for (const m of collected) {
      if (out.length >= TARGET) break;
      const provs = await providersFor(m.id, key, allowedIds);
      if (provs.length === 0) continue;
      out.push({
        id: String(m.id),
        title: m.title,
        description: m.overview ?? "",
        imageUrl: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
        providers: provs,
        year: m.release_date ? m.release_date.slice(0, 4) : null,
      });
    }
    return c.json({ films: out });
  } catch (e) {
    return c.json({ films: [], error: String(e) });
  }
});

/* ---------------- Détails d'un film (modale) ---------------- */

/**
 * Fiche complète d'un film TMDB : synopsis, note communautaire, casting,
 * réalisateur·s et bande-annonce YouTube (fr d'abord, sinon toute langue).
 */
films.get("/details/:id", async (c) => {
  const key = await resolveTmdbKey(c.get("household"), c.env);
  if (!key) return c.json({ error: "no_key" }, 404);
  const id = c.req.param("id");
  if (!/^\d+$/.test(id)) return c.json({ error: "bad_id" }, 400);

  try {
    const res = await fetch(
      `${TMDB}/movie/${id}?api_key=${key}&language=fr-FR` +
        `&append_to_response=credits,videos&include_video_language=fr,en,null`,
    );
    if (!res.ok) return c.json({ error: `tmdb_${res.status}` }, 502);
    const data = (await res.json()) as {
      id: number;
      title: string;
      tagline?: string | null;
      overview?: string;
      poster_path?: string | null;
      backdrop_path?: string | null;
      release_date?: string;
      runtime?: number | null;
      genres?: { name: string }[];
      vote_average?: number;
      vote_count?: number;
      credits?: {
        cast?: { name: string; character?: string; profile_path?: string | null }[];
        crew?: { name: string; job?: string }[];
      };
      videos?: {
        results?: { key: string; site: string; type: string; iso_639_1?: string; official?: boolean }[];
      };
    };

    const vids = (data.videos?.results ?? []).filter(
      (v) => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser"),
    );
    const trailer =
      vids.find((v) => v.type === "Trailer" && v.iso_639_1 === "fr") ??
      vids.find((v) => v.type === "Trailer" && v.official) ??
      vids.find((v) => v.type === "Trailer") ??
      vids[0];

    return c.json({
      id: String(data.id),
      title: data.title,
      tagline: data.tagline || null,
      overview: data.overview ?? "",
      posterUrl: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
      backdropUrl: data.backdrop_path ? `https://image.tmdb.org/t/p/w780${data.backdrop_path}` : null,
      year: data.release_date ? data.release_date.slice(0, 4) : null,
      releaseDate: data.release_date || null,
      runtime: data.runtime ?? null,
      genres: (data.genres ?? []).map((g) => g.name),
      voteAverage: data.vote_average ?? null,
      voteCount: data.vote_count ?? 0,
      directors: (data.credits?.crew ?? []).filter((p) => p.job === "Director").map((p) => p.name),
      cast: (data.credits?.cast ?? []).slice(0, 12).map((a) => ({
        name: a.name,
        character: a.character ?? null,
        photo: a.profile_path ? `https://image.tmdb.org/t/p/w185${a.profile_path}` : null,
      })),
      trailerKey: trailer?.key ?? null,
    });
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

/* ---------------- Recherche par nom ---------------- */

/**
 * Recherche TMDB par titre, restreinte aux plateformes activées du foyer.
 * Contrairement aux propositions (`GET /`), on ne filtre pas par genre et on
 * n'exclut pas les films déjà vus / masqués : la recherche est explicite.
 */
films.get("/search", async (c) => {
  const key = await resolveTmdbKey(c.get("household"), c.env);
  if (!key) return c.json({ films: [], error: "no_key" });
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ films: [] });

  const provRows = await c
    .get("db")
    .select()
    .from(streamingProvider)
    .where(
      and(eq(streamingProvider.householdId, c.get("household").id), eq(streamingProvider.enabled, 1)),
    )
    .orderBy(asc(streamingProvider.position));
  if (provRows.length === 0) return c.json({ films: [], error: "no_provider" });
  const allowedIds = new Set(provRows.map((p) => p.tmdbId));

  try {
    const res = await fetch(
      `${TMDB}/search/movie?api_key=${key}&language=fr-FR&include_adult=false` +
        `&query=${encodeURIComponent(q)}&page=1`,
    );
    if (!res.ok) return c.json({ films: [], error: `tmdb_${res.status}` });
    const data = (await res.json()) as { results?: TmdbMovie[] };
    // TMDB trie déjà par pertinence ; on borne les candidats pour tenir la latence
    // (un appel « watch/providers » par film).
    const candidates = (data.results ?? []).filter((m) => m.poster_path).slice(0, 20);
    const withProviders = await Promise.all(
      candidates.map(async (m) => ({ m, provs: await providersFor(m.id, key, allowedIds) })),
    );
    return c.json({
      films: withProviders
        .filter(({ provs }) => provs.length > 0) // dispo sur au moins une plateforme du foyer
        .map(({ m, provs }) => ({
          id: String(m.id),
          title: m.title,
          description: m.overview ?? "",
          imageUrl: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
          providers: provs,
          year: m.release_date ? m.release_date.slice(0, 4) : null,
        })),
    });
  } catch (e) {
    return c.json({ films: [], error: String(e) });
  }
});

/* ---------------- Favoris ---------------- */

films.get("/favorites", async (c) => {
  const audience = c.req.query("audience") === "adultes" ? "adultes" : "enfants";
  const rows = await c
    .get("db")
    .select()
    .from(filmFavorite)
    .where(
      and(eq(filmFavorite.householdId, c.get("household").id), eq(filmFavorite.audience, audience)),
    )
    .orderBy(desc(filmFavorite.createdAt));
  return c.json({
    films: rows.map((r) => ({
      id: r.externalId,
      title: r.title,
      description: r.description ?? "",
      imageUrl: r.imageUrl,
      providers: parseProviders(r.providers),
      year: r.year,
    })),
  });
});

films.post("/favorites", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, createFilmFavoriteSchema);
  const existing = await db
    .select()
    .from(filmFavorite)
    .where(
      and(
        eq(filmFavorite.householdId, hid),
        eq(filmFavorite.externalId, body.externalId),
        eq(filmFavorite.audience, body.audience),
      ),
    );
  if (existing.length > 0) return c.json({ ok: true, id: existing[0].id });
  const id = newId();
  await db.insert(filmFavorite).values({
    id,
    householdId: hid,
    externalId: body.externalId,
    audience: body.audience,
    title: body.title,
    description: body.description ?? null,
    imageUrl: body.imageUrl ?? null,
    providers: body.providers ?? null,
    year: body.year ?? null,
    createdAt: nowIso(),
  });
  return c.json({ ok: true, id }, 201);
});

films.delete("/favorites/:externalId", async (c) => {
  await c
    .get("db")
    .delete(filmFavorite)
    .where(
      and(
        eq(filmFavorite.householdId, c.get("household").id),
        eq(filmFavorite.externalId, c.req.param("externalId")),
      ),
    );
  return c.json({ ok: true });
});

/* ---------------- Masqués (ne plus proposer) ---------------- */

films.get("/hidden", async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(filmHidden)
    .where(eq(filmHidden.householdId, c.get("household").id))
    .orderBy(desc(filmHidden.createdAt));
  return c.json({
    films: rows.map((r) => ({
      id: r.externalId,
      title: r.title ?? "",
      description: "",
      imageUrl: r.imageUrl,
      providers: parseProviders(r.providers),
      year: r.year,
      audience: r.audience,
    })),
  });
});

films.post("/hidden", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, createFilmSeenSchema);
  const existing = await db
    .select()
    .from(filmHidden)
    .where(and(eq(filmHidden.householdId, hid), eq(filmHidden.externalId, body.externalId)));
  if (existing.length > 0) return c.json({ ok: true, id: existing[0].id });
  const id = newId();
  await db.insert(filmHidden).values({
    id,
    householdId: hid,
    externalId: body.externalId,
    title: body.title ?? null,
    audience: body.audience ?? null,
    imageUrl: body.imageUrl ?? null,
    providers: body.providers ?? null,
    year: body.year ?? null,
    createdAt: nowIso(),
  });
  return c.json({ ok: true, id }, 201);
});

films.delete("/hidden/:externalId", async (c) => {
  await c
    .get("db")
    .delete(filmHidden)
    .where(
      and(
        eq(filmHidden.householdId, c.get("household").id),
        eq(filmHidden.externalId, c.req.param("externalId")),
      ),
    );
  return c.json({ ok: true });
});

/* ---------------- Déjà vus ---------------- */

films.get("/seen", async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(filmSeen)
    .where(eq(filmSeen.householdId, c.get("household").id))
    .orderBy(desc(filmSeen.createdAt));
  return c.json({
    films: rows.map((r) => ({
      id: r.externalId,
      title: r.title ?? "",
      description: "",
      imageUrl: r.imageUrl,
      providers: parseProviders(r.providers),
      year: r.year,
      audience: r.audience,
    })),
  });
});

films.post("/seen", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, createFilmSeenSchema);
  const existing = await db
    .select()
    .from(filmSeen)
    .where(and(eq(filmSeen.householdId, hid), eq(filmSeen.externalId, body.externalId)));
  if (existing.length > 0) return c.json({ ok: true, id: existing[0].id });
  const id = newId();
  await db.insert(filmSeen).values({
    id,
    householdId: hid,
    externalId: body.externalId,
    title: body.title ?? null,
    audience: body.audience ?? null,
    imageUrl: body.imageUrl ?? null,
    providers: body.providers ?? null,
    year: body.year ?? null,
    createdAt: nowIso(),
  });
  return c.json({ ok: true, id }, 201);
});

films.delete("/seen/:externalId", async (c) => {
  await c
    .get("db")
    .delete(filmSeen)
    .where(
      and(
        eq(filmSeen.householdId, c.get("household").id),
        eq(filmSeen.externalId, c.req.param("externalId")),
      ),
    );
  return c.json({ ok: true });
});

export default films;
