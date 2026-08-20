import { Hono } from "hono";
import { eq, and, asc, desc } from "drizzle-orm";
import {
  createFilmFavoriteSchema,
  createFilmSeenSchema,
  FILM_GENRES,
  FR_CERTS,
  FILM_MEDIA_TYPES,
  DEFAULT_FILM_CONFIG,
  filmConfigSchema,
  filmMediaId,
  filmMediaType,
  filmTmdbId,
  type FilmAvailability,
  type FilmConfig,
  type FilmMediaType,
} from "@gfa/shared";
import { filmFavorite, filmSeen, filmHidden, streamingProvider } from "../db/schema";
import { parseBody } from "../lib/validate";
import { resolveTmdbKey } from "../lib/apiKeys";
import { newId, nowIso } from "../lib/util";
import type { AppContext } from "../lib/types";

const films = new Hono<AppContext>();

const TMDB = "https://api.themoviedb.org/3";
const TARGET = 15;

/**
 * Réglages Films du foyer (Réglages → Films), lus défensivement : les genres
 * interrogés par défaut, les publics proposés et le type de média de départ.
 */
function filmConfigOf(h: { filmConfig?: string | null }): FilmConfig {
  try {
    return h.filmConfig ? filmConfigSchema.parse(JSON.parse(h.filmConfig)) : DEFAULT_FILM_CONFIG;
  } catch {
    return DEFAULT_FILM_CONFIG;
  }
}

/**
 * Identifiants de genres à passer à `with_genres`, traduits pour le catalogue
 * visé. TMDB n'a pas la même liste pour les séries : un genre sans équivalent
 * est ignoré côté séries (mieux qu'une requête sans résultat).
 */
function genreParam(ids: number[], type: FilmMediaType): string {
  if (type === "movie") return ids.join("|");
  const tv = ids
    .map((id) => FILM_GENRES.find((g) => g.id === id)?.tvId)
    .filter((v): v is number => v != null);
  return [...new Set(tv)].join("|");
}

/**
 * Filtres de la vue « Propositions », lus dans la requête.
 *
 * Ils partent chez TMDB (`discover`) et non côté front : filtrer les 15 films
 * déjà choisis en renverrait deux. Ici, la sélection est faite dans le vivier
 * complet et l'onglet reste rempli.
 */
interface FilmFilters {
  genres: number[];
  runtimeMin: number | null;
  runtimeMax: number | null;
  yearMin: number | null;
  yearMax: number | null;
  noteMin: number | null;
  noteMax: number | null;
  /** Certification FR maximale demandée (« dès X ans » au plus). */
  certMax: string | null;
  /** Catalogues interrogés : films, séries, ou les deux. Jamais vide. */
  media: FilmMediaType[];
}

/** Nombre borné, ou `null` si le paramètre est absent ou illisible. */
function boundedNumber(raw: string | undefined, lo: number, hi: number): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, n));
}

function readFilters(
  q: (k: string) => string | undefined,
  defaultMedia: FilmMediaType[],
): FilmFilters {
  const certMax = q("certMax");
  const media = (q("media") ?? "")
    .split(",")
    .filter((v): v is FilmMediaType => (FILM_MEDIA_TYPES as readonly string[]).includes(v));
  return {
    // Sans paramètre lisible, on retombe sur le réglage du foyer.
    media: media.length > 0 ? media : defaultMedia,
    genres: (q("genres") ?? "")
      .split(",")
      .map((v) => Number(v))
      .filter((id) => FILM_GENRES.some((g) => g.id === id)),
    runtimeMin: boundedNumber(q("runtimeMin"), 0, 600),
    runtimeMax: boundedNumber(q("runtimeMax"), 0, 600),
    yearMin: boundedNumber(q("yearMin"), 1900, 2200),
    yearMax: boundedNumber(q("yearMax"), 1900, 2200),
    noteMin: boundedNumber(q("noteMin"), 0, 10),
    noteMax: boundedNumber(q("noteMax"), 0, 10),
    certMax: certMax && (FR_CERTS as readonly string[]).includes(certMax) ? certMax : null,
  };
}

/** Du plus permissif (« U ») au plus restreint (« 18 »). */
const certRank = (cert: string) => (FR_CERTS as readonly string[]).indexOf(cert);

interface TmdbMovie {
  id: number;
  title: string;
  overview?: string;
  poster_path?: string | null;
  release_date?: string;
}

/** Une série telle que la renvoient `/discover/tv` et `/search/tv`. */
interface TmdbShow {
  id: number;
  name: string;
  overview?: string;
  poster_path?: string | null;
  first_air_date?: string;
}

/**
 * Films et séries ramenés à la même forme : le reste du traitement (exclusions,
 * tri, instantané) n'a alors pas à savoir de quel catalogue vient la ligne.
 * `id` porte déjà le préfixe de type (cf. `filmMediaId`).
 */
interface Candidate {
  id: string;
  type: FilmMediaType;
  tmdbId: number;
  title: string;
  overview: string;
  posterPath: string | null;
  date: string | null;
}

const movieCandidate = (m: TmdbMovie): Candidate => ({
  id: filmMediaId("movie", m.id),
  type: "movie",
  tmdbId: m.id,
  title: m.title,
  overview: m.overview ?? "",
  posterPath: m.poster_path ?? null,
  date: m.release_date || null,
});

const showCandidate = (t: TmdbShow): Candidate => ({
  id: filmMediaId("tv", t.id),
  type: "tv",
  tmdbId: t.id,
  title: t.name,
  overview: t.overview ?? "",
  posterPath: t.poster_path ?? null,
  date: t.first_air_date || null,
});

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
 * Plateformes, durée et limite d'âge d'une œuvre (film ou série) — en **une**
 * requête.
 *
 * `append_to_response` greffe `watch/providers` et `release_dates` sur la fiche :
 * on obtient la durée et la certification pour le même coût réseau qu'avant, où
 * l'on n'allait chercher que les plateformes.
 *
 * On filtre les plateformes par id (aligné sur le filtre `with_watch_providers`
 * de discover) et non par nom : les noms TMDB varient (« Disney+ » vs « Disney
 * Plus », variantes « with Ads »…) et faisaient rejeter des films dispo.
 */
async function mediaMetaFor(
  type: FilmMediaType,
  id: number,
  key: string,
  allowedIds: Set<number>,
): Promise<MovieMeta> {
  const empty: MovieMeta = { providers: [], runtime: null, ageLimit: null, onDemand: false };
  try {
    // Les séries n'ont pas de `release_dates` : leur classification vit dans
    // `content_ratings`, et leur durée est celle d'un épisode.
    const extra = type === "movie" ? "release_dates" : "content_ratings";
    const res = await fetch(
      `${TMDB}/${type}/${id}?api_key=${key}&language=fr-FR&append_to_response=watch/providers,${extra}`,
    );
    if (!res.ok) return empty;
    const data = (await res.json()) as {
      runtime?: number | null;
      episode_run_time?: number[];
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
      content_ratings?: {
        results?: { iso_3166_1: string; rating?: string }[];
      };
    };
    const frOffers = data["watch/providers"]?.results?.FR;
    const flat = frOffers?.flatrate ?? [];
    const cert =
      type === "movie"
        ? data.release_dates?.results
            ?.find((r) => r.iso_3166_1 === "FR")
            ?.release_dates?.map((d) => d.certification)
            .find((v) => v && v.trim())
        : data.content_ratings?.results?.find((r) => r.iso_3166_1 === "FR")?.rating;
    return {
      providers: flat
        .filter((p) => allowedIds.has(p.provider_id))
        .map((p) => ({
          name: p.provider_name,
          logo: p.logo_path ? `https://image.tmdb.org/t/p/w92${p.logo_path}` : null,
        })),
      runtime: type === "movie" ? data.runtime ?? null : data.episode_run_time?.[0] ?? null,
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

  const cfg = filmConfigOf(c.get("household"));
  const filters = readFilters((k) => c.req.query(k), cfg.mediaTypes);
  // Genres du public, réglables dans Réglages → Films (`DEFAULT_FILM_CONFIG`
  // reproduit l'ancien comportement : animation / action + fantastique).
  const audienceGenres = cfg.genres[audience] ?? [];

  // Limite d'âge : le plafond parental du foyer (public « enfants ») et le
  // filtre de la vue se cumulent — on garde le plus strict des deux, sinon un
  // filtre pourrait desserrer le réglage des Réglages.
  let cert = audience === "enfants" ? (c.get("household").kidsMaxCert ?? "U") : null;
  if (filters.certMax && (cert == null || certRank(filters.certMax) < certRank(cert))) cert = filters.certMax;

  /** URL `discover` d'un catalogue, avec les filtres traduits pour lui. */
  const discoverUrl = (type: FilmMediaType): string => {
    // Les genres choisis remplacent ceux du public : demander « documentaire »
    // et recevoir de l'animation ne serait pas un filtre.
    const genres = genreParam(filters.genres.length > 0 ? filters.genres : audienceGenres, type);
    let url =
      `${TMDB}/discover/${type}?api_key=${key}&language=fr-FR&watch_region=FR` +
      `&with_watch_providers=${providerIds}&with_watch_monetization_types=flatrate` +
      `&sort_by=popularity.desc&include_adult=false&vote_count.gte=20`;
    if (genres) url += `&with_genres=${genres}`;
    // `certification.lte` n'existe que pour les films : la classification des
    // séries est vérifiée après coup, sur `content_ratings` (cf. plus bas).
    if (cert && type === "movie") {
      url += `&certification_country=FR&certification.lte=${encodeURIComponent(cert)}`;
    }
    if (filters.runtimeMin != null) url += `&with_runtime.gte=${filters.runtimeMin}`;
    if (filters.runtimeMax != null) url += `&with_runtime.lte=${filters.runtimeMax}`;
    const dateKey = type === "movie" ? "primary_release_date" : "first_air_date";
    if (filters.yearMin != null) url += `&${dateKey}.gte=${filters.yearMin}-01-01`;
    if (filters.yearMax != null) url += `&${dateKey}.lte=${filters.yearMax}-12-31`;
    if (filters.noteMin != null) url += `&vote_average.gte=${filters.noteMin}`;
    if (filters.noteMax != null) url += `&vote_average.lte=${filters.noteMax}`;
    return url;
  };

  /**
   * Curseur de pagination : le **nombre d'entrées du vivier déjà parcourues**.
   *
   * Il compte des entrées, pas des films rendus : l'API en écarte en chemin
   * (aucune plateforme du foyer, série trop classée), et compter les films
   * re-servirait les entrées sautées.
   *
   * Pour qu'un rang veuille dire quelque chose, le vivier doit s'**allonger**
   * et jamais se réordonner : on garde donc l'ordre de TMDB (popularité), qui
   * ne fait qu'ajouter à la fin quand on va chercher des pages plus lointaines.
   * Le tri par date, lui, s'applique à la page servie — sinon une entrée
   * ramenée d'une page lointaine viendrait s'insérer *avant* le rang atteint,
   * et le défilement sauterait des films (mesuré : 42 % du vivier perdu).
   */
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0) || 0);

  try {
    /**
     * Vivier : assez large pour ne pas être affamé par les exclusions
     * (déjà-vus, masqués, favoris), et qui s'approfondit avec le curseur — la
     * page 5 a besoin de candidats que les 60 premiers ne contiennent pas.
     * Plafonné (20 pages TMDB par catalogue) pour borner le coût d'une requête.
     */
    const need = offset + 60;
    /** Un catalogue à la fois, dans l'ordre de TMDB. */
    const perType: Candidate[][] = [];
    for (const type of filters.media) {
      const url = discoverUrl(type);
      const rows: Candidate[] = [];
      for (let page = 1; page <= 20 && rows.length < need; page++) {
        const res = await fetch(`${url}&page=${page}`);
        if (!res.ok) break;
        const data = (await res.json()) as { results?: (TmdbMovie & TmdbShow)[] };
        const results = data.results ?? [];
        for (const r of results) {
          const cand = type === "movie" ? movieCandidate(r) : showCandidate(r);
          if (!seen.has(cand.id) && cand.posterPath) rows.push(cand);
        }
        if (results.length === 0) break; // catalogue épuisé
      }
      perType.push(rows);
    }
    /**
     * Films et séries alternés plutôt que l'un après l'autre : demander les
     * deux et ne voir que des films pendant dix écrans ne serait pas « les
     * deux ». L'alternance est déterministe, donc le rang reste stable.
     */
    const collected: Candidate[] = [];
    for (let i = 0; perType.some((rows) => i < rows.length); i++) {
      for (const rows of perType) if (i < rows.length) collected.push(rows[i]);
    }

    const pool = collected.slice(offset);

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
    // Entrées réellement parcourues (rendues ou écartées) : le curseur suivant.
    let consumed = 0;
    for (const m of pool) {
      if (out.length >= TARGET) break;
      consumed++;
      const meta = await mediaMetaFor(m.type, m.tmdbId, key, allowedIds);
      if (meta.providers.length === 0) continue;
      // Séries : le plafond d'âge n'a pas pu partir dans la requête, on écarte
      // ici celles dont la classification FR connue le dépasse. Une série sans
      // classification FR chez TMDB (le cas courant) passe — le garde-fou
      // restant est le choix des genres du public.
      if (cert && m.type === "tv" && meta.ageLimit && certRank(meta.ageLimit) > certRank(cert)) {
        continue;
      }
      out.push({
        id: m.id,
        title: m.title,
        description: m.overview,
        imageUrl: m.posterPath ? `https://image.tmdb.org/t/p/w500${m.posterPath}` : null,
        providers: meta.providers,
        year: m.date ? m.date.slice(0, 4) : null,
        runtime: meta.runtime,
        ageLimit: meta.ageLimit,
        availability: "subscription", // les propositions ne sortent que du catalogue abonné
      });
    }
    // Nouveautés d'abord, *dans la page servie* : la grille se lit de la sortie
    // la plus récente à la plus ancienne (date manquante reléguée en fin).
    out.sort((a, b) => (b.year ?? "").localeCompare(a.year ?? ""));
    return c.json({
      films: out,
      nextOffset: offset + consumed,
      // Une page qui n'a pas pu se remplir a vidé le vivier : plus rien après.
      hasMore: out.length >= TARGET,
    });
  } catch (e) {
    return c.json({ films: [], error: String(e) });
  }
});

/* ---------------- Détails d'un film ou d'une série (modale) ---------------- */

/**
 * Fiche complète d'une œuvre TMDB : synopsis, note communautaire, casting,
 * réalisateur·s et bande-annonce YouTube (fr d'abord, sinon toute langue).
 *
 * L'identifiant porte son type (`tv:1234`) : la même route sert les deux
 * catalogues, et le front n'a pas à dire ce qu'il ouvre.
 */
films.get("/details/:id", async (c) => {
  const key = await resolveTmdbKey(c.get("household"), c.env);
  if (!key) return c.json({ error: "no_key" }, 404);
  const raw = c.req.param("id");
  const type = filmMediaType(raw);
  const id = filmTmdbId(raw);
  if (!/^\d+$/.test(id)) return c.json({ error: "bad_id" }, 400);

  try {
    const res = await fetch(
      `${TMDB}/${type}/${id}?api_key=${key}&language=fr-FR` +
        `&append_to_response=credits,videos&include_video_language=fr,en,null`,
    );
    if (!res.ok) return c.json({ error: `tmdb_${res.status}` }, 502);
    const data = (await res.json()) as {
      id: number;
      /** Films : `title` ; séries : `name`. Idem pour la date et la durée. */
      title?: string;
      name?: string;
      tagline?: string | null;
      overview?: string;
      poster_path?: string | null;
      backdrop_path?: string | null;
      release_date?: string;
      first_air_date?: string;
      runtime?: number | null;
      episode_run_time?: number[];
      number_of_seasons?: number | null;
      genres?: { name: string }[];
      vote_average?: number;
      vote_count?: number;
      created_by?: { name: string }[];
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

    const date = type === "movie" ? data.release_date : data.first_air_date;
    return c.json({
      id: raw,
      mediaType: type,
      title: (type === "movie" ? data.title : data.name) ?? "",
      tagline: data.tagline || null,
      overview: data.overview ?? "",
      posterUrl: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
      backdropUrl: data.backdrop_path ? `https://image.tmdb.org/t/p/w780${data.backdrop_path}` : null,
      year: date ? date.slice(0, 4) : null,
      releaseDate: date || null,
      runtime: (type === "movie" ? data.runtime : data.episode_run_time?.[0]) ?? null,
      /** Séries : nombre de saisons (null pour un film). */
      seasons: type === "tv" ? data.number_of_seasons ?? null : null,
      genres: (data.genres ?? []).map((g) => g.name),
      voteAverage: data.vote_average ?? null,
      voteCount: data.vote_count ?? 0,
      // Une série n'a pas de réalisateur au générique : ce sont ses créateurs.
      directors:
        type === "movie"
          ? (data.credits?.crew ?? []).filter((p) => p.job === "Director").map((p) => p.name)
          : (data.created_by ?? []).map((p) => p.name),
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
 * Recherche TMDB par titre, dans les catalogues demandés (films, séries, ou les
 * deux). Contrairement aux propositions (`GET /`), on ne filtre pas par genre et
 * on n'exclut pas les œuvres déjà vues / masquées : la recherche est explicite.
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
  // Le filtre Film / Série de la vue s'applique aussi à la recherche : chercher
  // « Fargo » en mode Séries ne doit pas ramener le film.
  const media = readFilters((k) => c.req.query(k), filmConfigOf(c.get("household")).mediaTypes).media;

  try {
    const found: Candidate[] = [];
    for (const type of media) {
      const res = await fetch(
        `${TMDB}/search/${type}?api_key=${key}&language=fr-FR&include_adult=false` +
          `&query=${encodeURIComponent(q)}&page=1`,
      );
      if (!res.ok) return c.json({ films: [], error: `tmdb_${res.status}` });
      const data = (await res.json()) as { results?: (TmdbMovie & TmdbShow)[] };
      // TMDB trie déjà par pertinence ; on borne les candidats pour tenir la
      // latence (un appel « watch/providers » par ligne).
      for (const r of (data.results ?? []).slice(0, 20)) {
        found.push(type === "movie" ? movieCandidate(r) : showCandidate(r));
      }
    }
    const withMeta = await Promise.all(
      found.map(async (m) => ({ m, meta: await mediaMetaFor(m.type, m.tmdbId, key, allowedIds) })),
    );
    return c.json({
      films: withMeta
        // Regardable tout de suite d'abord (abonnement du foyer), puis à la
        // demande, puis introuvable. Le tri est stable, donc la pertinence TMDB
        // départage à l'intérieur d'un même groupe.
        .sort((a, b) => rank(availabilityOf(a.meta)) - rank(availabilityOf(b.meta)))
        .map(({ m, meta }) => ({
          id: m.id,
          title: m.title,
          description: m.overview,
          imageUrl: m.posterPath ? `https://image.tmdb.org/t/p/w500${m.posterPath}` : null,
          providers: meta.providers,
          year: m.date ? m.date.slice(0, 4) : null,
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
