import { Hono } from "hono";
import { eq, and, asc, desc } from "drizzle-orm";
import { createFilmFavoriteSchema, createFilmSeenSchema, type FilmAvailability } from "@gfa/shared";
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

/** Ce qu'une carte de film a besoin de dire au-delà du titre et de l'affiche. */
interface MovieMeta {
  providers: Provider[];
  /** Durée en minutes. */
  runtime: number | null;
  /** Certification FR (« U », « 10 », « 12 », « 16 », « 18 »). */
  ageLimit: string | null;
  /**
   * Le film est proposé en France hors abonnement du foyer : location, achat,
   * ou plateforme gratuite / financée par la pub. Faux = TMDB ne connaît
   * aucune offre FR (pas encore sorti, en salle, ou jamais distribué ici).
   */
  onDemand: boolean;
}

/** Ordre d'affichage d'une recherche : le plus facile à regarder en premier. */
function rank(a: FilmAvailability): number {
  return a === "subscription" ? 0 : a === "vod" ? 1 : 2;
}

/** Ce que la carte doit dire du film : plateforme du foyer, VOD, ou rien. */
function availabilityOf(meta: MovieMeta): FilmAvailability {
  if (meta.providers.length > 0) return "subscription";
  return meta.onDemand ? "vod" : "unknown";
}

/**
 * Plateformes, durée et limite d'âge d'un film — en **une** requête.
 *
 * `append_to_response` greffe `watch/providers` et `release_dates` sur la fiche :
 * on obtient la durée et la certification pour le même coût réseau qu'avant, où
 * l'on n'allait chercher que les plateformes.
 *
 * On filtre les plateformes par id (aligné sur le filtre `with_watch_providers`
 * de discover) et non par nom : les noms TMDB varient (« Disney+ » vs « Disney
 * Plus », variantes « with Ads »…) et faisaient rejeter des films dispo.
 */
async function movieMetaFor(id: number, key: string, allowedIds: Set<number>): Promise<MovieMeta> {
  const empty: MovieMeta = { providers: [], runtime: null, ageLimit: null, onDemand: false };
  try {
    const res = await fetch(
      `${TMDB}/movie/${id}?api_key=${key}&language=fr-FR&append_to_response=watch/providers,release_dates`,
    );
    if (!res.ok) return empty;
    const data = (await res.json()) as {
      runtime?: number | null;
      "watch/providers"?: {
        results?: {
          FR?: {
            flatrate?: { provider_id: number; provider_name: string; logo_path?: string | null }[];
            rent?: unknown[];
            buy?: unknown[];
            free?: unknown[];
            ads?: unknown[];
          };
        };
      };
      release_dates?: {
        results?: { iso_3166_1: string; release_dates?: { certification?: string }[] }[];
      };
    };
    const frOffers = data["watch/providers"]?.results?.FR;
    const flat = frOffers?.flatrate ?? [];
    const fr = data.release_dates?.results?.find((r) => r.iso_3166_1 === "FR");
    const cert = fr?.release_dates?.map((d) => d.certification).find((v) => v && v.trim());
    return {
      providers: flat
        .filter((p) => allowedIds.has(p.provider_id))
        .map((p) => ({
          name: p.provider_name,
          logo: p.logo_path ? `https://image.tmdb.org/t/p/w92${p.logo_path}` : null,
        })),
      runtime: data.runtime ?? null,
      ageLimit: cert?.trim() || null,
      // `flatrate` complet mais hors abonnement du foyer compte aussi : le film
      // est bien regardable en France, juste pas avec les abonnements d'ici.
      onDemand: [frOffers?.rent, frOffers?.buy, frOffers?.free, frOffers?.ads, frOffers?.flatrate].some(
        (list) => (list?.length ?? 0) > 0,
      ),
    };
  } catch {
    return empty;
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

    // « Proposer d'autres films » : on avance dans le vivier plutôt que de
    // renvoyer la même page. L'`offset` boucle sur la taille du vivier, donc il
    // y a toujours quelque chose à montrer, et le tri reste déterministe.
    const offset = Math.max(0, Number(c.req.query("offset") ?? 0) || 0);
    const start = collected.length > 0 ? offset % collected.length : 0;
    const pool = [...collected.slice(start), ...collected.slice(0, start)];

    const out: {
      id: string;
      title: string;
      description: string;
      imageUrl: string | null;
      providers: Provider[];
      year: string | null;
      runtime: number | null;
      ageLimit: string | null;
      availability: FilmAvailability;
    }[] = [];
    for (const m of pool) {
      if (out.length >= TARGET) break;
      const meta = await movieMetaFor(m.id, key, allowedIds);
      if (meta.providers.length === 0) continue;
      out.push({
        id: String(m.id),
        title: m.title,
        description: m.overview ?? "",
        imageUrl: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
        providers: meta.providers,
        year: m.release_date ? m.release_date.slice(0, 4) : null,
        runtime: meta.runtime,
        ageLimit: meta.ageLimit,
        availability: "subscription", // les propositions ne sortent que du catalogue abonné
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
 * Recherche TMDB par titre. Contrairement aux propositions (`GET /`), on ne
 * filtre pas par genre et on n'exclut pas les films déjà vus / masqués : la
 * recherche est explicite.
 *
 * On ne restreint pas non plus aux plateformes du foyer : un film cherché par
 * son nom doit être trouvé même s'il n'est sur aucun abonnement — il ressort
 * alors avec `providers: []`, que le front étiquette « VOD ». Les films
 * disponibles sur un abonnement du foyer restent en tête de liste.
 */
films.get("/search", async (c) => {
  const key = await resolveTmdbKey(c.get("household"), c.env);
  if (!key) return c.json({ films: [], error: "no_key" });
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ films: [] });

  // Sans plateforme activée la recherche fonctionne quand même : tout sort en VOD.
  const provRows = await c
    .get("db")
    .select()
    .from(streamingProvider)
    .where(
      and(eq(streamingProvider.householdId, c.get("household").id), eq(streamingProvider.enabled, 1)),
    )
    .orderBy(asc(streamingProvider.position));
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
    const candidates = (data.results ?? []).slice(0, 20);
    const withMeta = await Promise.all(
      candidates.map(async (m) => ({ m, meta: await movieMetaFor(m.id, key, allowedIds) })),
    );
    return c.json({
      films: withMeta
        // Regardable tout de suite d'abord (abonnement du foyer), puis à la
        // demande, puis introuvable. Le tri est stable, donc la pertinence TMDB
        // départage à l'intérieur d'un même groupe.
        .sort((a, b) => rank(availabilityOf(a.meta)) - rank(availabilityOf(b.meta)))
        .map(({ m, meta }) => ({
          id: String(m.id),
          title: m.title,
          description: m.overview ?? "",
          imageUrl: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
          providers: meta.providers,
          year: m.release_date ? m.release_date.slice(0, 4) : null,
          runtime: meta.runtime,
          ageLimit: meta.ageLimit,
          availability: availabilityOf(meta),
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
      runtime: r.runtime ?? null,
      ageLimit: r.ageLimit ?? null,
      availability: r.availability ?? null,
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
    runtime: body.runtime ?? null,
    ageLimit: body.ageLimit ?? null,
    availability: body.availability ?? null,
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

// Triés par date de masquage décroissante (les plus récents en premier).
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
      runtime: r.runtime ?? null,
      ageLimit: r.ageLimit ?? null,
      availability: r.availability ?? null,
      audience: r.audience,
      hiddenAt: r.createdAt,
    })),
  });
});

films.post("/hidden", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, createFilmSeenSchema);
  // Masquer un film le sort aussi de la liste « À voir » (favoris).
  await db
    .delete(filmFavorite)
    .where(and(eq(filmFavorite.householdId, hid), eq(filmFavorite.externalId, body.externalId)));
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
    runtime: body.runtime ?? null,
    ageLimit: body.ageLimit ?? null,
    availability: body.availability ?? null,
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

// Triés par date de visionnage décroissante (les plus récents en premier).
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
      runtime: r.runtime ?? null,
      ageLimit: r.ageLimit ?? null,
      availability: r.availability ?? null,
      audience: r.audience,
      seenAt: r.createdAt,
    })),
  });
});

films.post("/seen", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, createFilmSeenSchema);
  // Un film vu n'a plus rien à faire dans les favoris : on retire le cœur pour
  // qu'il disparaisse de la liste et ne vive plus que dans « Vues ».
  await db
    .delete(filmFavorite)
    .where(and(eq(filmFavorite.householdId, hid), eq(filmFavorite.externalId, body.externalId)));
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
    runtime: body.runtime ?? null,
    ageLimit: body.ageLimit ?? null,
    availability: body.availability ?? null,
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
