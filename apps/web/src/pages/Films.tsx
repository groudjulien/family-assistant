import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SheetItem } from "../components/ui";
import {
  SubNav,
  FilterChips,
  FilterButton,
  FilterField,
  FilterModal,
  FilterToggle,
  SearchField,
  Select,
  Input,
  InlineLoader,
  ActionSheet,
} from "../components/ui";
import {
  IconBan,
  IconCheck,
  IconEye,
  IconHeart,
  IconMore,
  IconPlay,
  IconUndo,
} from "../components/icons";
import type { FilmAvailability } from "@gfa/shared";
import {
  FILM_GENRES,
  FR_CERTS,
  FILM_MEDIA_TYPES,
  FILM_MEDIA_LABEL,
  filmGenreLabel,
  filmMediaType,
  type FilmMediaType,
} from "@gfa/shared";
import { Link } from "react-router-dom";
import { useMe } from "../auth";
import { useLastView } from "../lib/lastView";
import { dateFrShort, monthFr } from "../lib/format";
import { api } from "../lib/api";
import PageLoader from "../components/PageLoader";
import { usePageHeader, usePageTabs } from "../components/PageHeader";

/* ---------------- Films disponibles sur nos abonnements ---------------- */

type Audience = "enfants" | "adultes";
/**
 * Une page de propositions. `nextOffset` est le curseur à repasser pour la
 * suite, `hasMore` dit si le vivier a encore du neuf (cf. `GET /api/films`).
 */
interface FilmsPage {
  films: Film[];
  /** Entrées du vivier déjà parcourues, à repasser pour obtenir la suite. */
  nextOffset?: number;
  hasMore?: boolean;
  error?: string;
}

/** Sous-menus de /films (URL : /films/<vue>). */
type FilmView = "a-voir" | "propositions" | "historique";
/** Onglets de la page (partagés entre la barre mobile et le SubNav ordinateur). */
const FILM_TABS = [
  { value: "a-voir", label: "À voir" },
  { value: "propositions", label: "Propositions" },
  { value: "historique", label: "Historique" },
];

const FILM_VIEWS = ["a-voir", "propositions", "historique"] as const;
/** Filtre de l'historique : tout, seulement les vus, seulement les masqués. */
type HistoryFilter = "tous" | "vues" | "masques";

interface Provider {
  name: string;
  logo: string | null;
}
interface Film {
  id: string;
  title: string;
  description: string;
  imageUrl: string | null;
  providers: Provider[];
  year: string | null;
  /** Durée en minutes (null si TMDB ne la donne pas). */
  runtime?: number | null;
  /** Certification FR brute : « U », « 10 », « 12 », « 16 », « 18 ». */
  ageLimit?: string | null;
  /**
   * Où le film se regarde. `null` sur les lignes enregistrées avant la
   * recherche hors plateforme — elles portent toutes une plateforme.
   */
  availability?: FilmAvailability | null;
}

/**
 * Lien de recherche des plateformes courantes. Sur mobile ce sont des liens
 * universels : le système ouvre l'application si elle est installée, la page
 * web sinon. On ne peut pas viser la fiche du film directement (les
 * identifiants sont propres à chaque service), donc on ouvre sa recherche.
 */
const PROVIDER_LINKS: { match: string; label: string; url: (q: string) => string }[] = [
  { match: "netflix", label: "Netflix", url: (q) => `https://www.netflix.com/search?q=${q}` },
  { match: "disney", label: "Disney+", url: (q) => `https://www.disneyplus.com/fr-fr/search?q=${q}` },
  { match: "prime", label: "Prime Video", url: (q) => `https://www.primevideo.com/search/?phrase=${q}` },
  { match: "canal", label: "Canal+", url: (q) => `https://www.canalplus.com/recherche/?q=${q}` },
  { match: "apple", label: "Apple TV", url: (q) => `https://tv.apple.com/fr/search?term=${q}` },
  { match: "max", label: "Max", url: (q) => `https://play.max.com/search?q=${q}` },
  { match: "paramount", label: "Paramount+", url: (q) => `https://www.paramountplus.com/fr/search/${q}/` },
  { match: "ocs", label: "OCS", url: (q) => `https://www.ocs.fr/recherche?q=${q}` },
  { match: "crunchyroll", label: "Crunchyroll", url: (q) => `https://www.crunchyroll.com/fr/search?q=${q}` },
  { match: "arte", label: "arte.tv", url: (q) => `https://www.arte.tv/fr/search/?q=${q}` },
];

/** Où lancer le film : la première plateforme reconnue parmi les siennes. */
function launchTarget(f: Film): { label: string; href: string } | null {
  for (const p of f.providers) {
    const known = PROVIDER_LINKS.find((l) => p.name.toLowerCase().includes(l.match));
    if (known) return { label: known.label, href: known.url(encodeURIComponent(f.title)) };
  }
  return null;
}

/**
 * Étiquette de disponibilité : la plateforme du foyer si le film y est, sinon
 * ce que TMDB sait des offres françaises. Un film hors abonnement reste
 * retenable dans « À voir » — l'étiquette dit juste ce qu'il faudra faire pour
 * le regarder, au lieu de laisser un vide.
 */
function providerLabel(f: Film): string {
  if (f.providers[0]) return f.providers[0].name;
  return f.availability === "unknown" ? "Non trouvé" : "VOD";
}

/** Où trouver un film hors abonnement : le comparateur d'offres, pas une plateforme. */
function vodSearchUrl(title: string): string {
  return `https://www.justwatch.com/fr/recherche?q=${encodeURIComponent(title)}`;
}

/** « 2025 · 1 h 43 · dès 10 ans » — seulement ce qu'on connaît. */
function filmMeta(f: Film): string {
  const bits: string[] = [];
  // « Série » d'abord : la durée affichée est celle d'un épisode, pas de l'œuvre.
  if (filmMediaType(f.id) === "tv") bits.push("Série");
  if (f.year) bits.push(f.year);
  if (f.runtime) {
    const h = Math.floor(f.runtime / 60);
    const m = f.runtime % 60;
    bits.push(h > 0 ? (m > 0 ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`) : `${m} min`);
  }
  // TMDB renvoie « TP » ou « U » pour « tous publics » selon les fiches, et un
  // âge en clair sinon. Sans ce cas, on affichait « dès TP ans ».
  if (f.ageLimit) {
    const all = /^(tp|u|tous)/i.test(f.ageLimit);
    bits.push(all ? "tous publics" : `dès ${f.ageLimit} ans`);
  }
  return bits.join(" · ");
}
/** Film déjà vu : `seenAt` = date ISO du marquage « vue ». */
interface SeenFilm extends Film {
  audience?: string;
  seenAt?: string;
}
/** Film masqué : `hiddenAt` = date ISO du masquage. */
interface HiddenFilm extends Film {
  audience?: string;
  hiddenAt?: string;
}
/** Entrée d'historique : un film vu ou masqué, avec la date de l'action. */
type HistoryFilm = Film & { kind: "vue" | "masque"; at: string; audience?: string };

interface FilmDetails {
  id: string;
  /** Film ou série : la fiche ne dit pas les mêmes choses. */
  mediaType: FilmMediaType;
  /** Séries : nombre de saisons (null pour un film). */
  seasons: number | null;
  title: string;
  tagline: string | null;
  overview: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  year: string | null;
  releaseDate: string | null;
  runtime: number | null;
  genres: string[];
  voteAverage: number | null;
  voteCount: number;
  directors: string[];
  cast: { name: string; character: string | null; photo: string | null }[];
  trailerKey: string | null;
}

/**
 * Modale de fiche film : synopsis complet, note, casting et bande-annonce.
 * Alignée en haut sur mobile (place du clavier / grands contenus), centrée sur
 * ordinateur.
 *
 * Hauteur bornée à l'écran : la bande-annonce et sa croix de fermeture restent
 * en place, seul le texte défile. Sans ça, la fiche poussait la modale au-delà
 * de l'écran (une longue distribution suffit) et la croix partait avec.
 */
function FilmDetailsModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["film-details", id],
    // `encodeURIComponent` : l'identifiant d'une série porte un « : » (`tv:1234`).
    queryFn: () => api.get<FilmDetails>(`/api/films/details/${encodeURIComponent(id)}`),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  // Fermeture au clavier (Échap) pour l'usage ordinateur.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const runtimeFr = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="card flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden p-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Média d'en-tête : bande-annonce si dispo, sinon image large */}
        <div className="relative shrink-0">
          {data?.trailerKey ? (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${data.trailerKey}`}
              title={`Bande-annonce — ${data.title}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="aspect-video w-full"
            />
          ) : data?.backdropUrl || data?.posterUrl ? (
            <img
              src={data.backdropUrl ?? data.posterUrl ?? undefined}
              alt=""
              className="aspect-video w-full object-cover"
            />
          ) : (
            <div className="aspect-video w-full bg-slate-200 dark:bg-slate-800" />
          )}
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
          {isLoading && <div className="text-sm text-slate-400">Chargement de la fiche…</div>}
          {isError && (
            <div className="text-sm text-slate-400">Impossible de charger la fiche.</div>
          )}
          {data && (
            <>
              <div>
                <h2 className="text-xl font-bold leading-tight">
                  {data.title}
                  {data.year && (
                    <span className="ml-2 text-sm font-normal text-slate-400">({data.year})</span>
                  )}
                </h2>
                {data.tagline && (
                  <p className="mt-0.5 text-sm italic text-slate-500">{data.tagline}</p>
                )}
              </div>

              {/* Note communautaire + infos clés */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
                {data.voteAverage != null && data.voteCount > 0 && (
                  <span className="inline-flex items-center gap-1 font-semibold">
                    <span className="text-amber-500">★</span>
                    {data.voteAverage.toFixed(1)}
                    <span className="font-normal text-slate-400">
                      /10 · {data.voteCount.toLocaleString("fr-FR")} votes
                    </span>
                  </span>
                )}
                {/* Une série se lit par saisons, et sa durée est celle d'un
                    épisode : l'écrire « 0 h 45 » induirait en erreur. */}
                {data.mediaType === "tv" && (
                  <span className="text-slate-500">
                    {data.seasons
                      ? `Série · ${data.seasons} saison${data.seasons > 1 ? "s" : ""}`
                      : "Série"}
                  </span>
                )}
                {data.runtime ? (
                  <span className="text-slate-500">
                    {data.mediaType === "tv"
                      ? `${data.runtime} min / épisode`
                      : runtimeFr(data.runtime)}
                  </span>
                ) : null}
                {data.directors.length > 0 && (
                  <span className="text-slate-500">
                    {data.mediaType === "tv" ? "Créée par " : "De "}
                    {data.directors.join(", ")}
                  </span>
                )}
              </div>

              {data.genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {data.genres.map((g) => (
                    <span
                      key={g}
                      className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-600/20 dark:text-brand-50"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              )}

              {data.overview && (
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {data.overview}
                </p>
              )}

              {data.cast.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Acteurs</h3>
                  <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
                    {data.cast.map((a) => (
                      <div key={a.name} className="w-16 shrink-0 text-center">
                        {a.photo ? (
                          <img
                            src={a.photo}
                            alt={a.name}
                            loading="lazy"
                            className="mx-auto h-16 w-16 rounded-full object-cover"
                          />
                        ) : (
                          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-200 text-lg font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                            {a.name.charAt(0)}
                          </div>
                        )}
                        <div className="mt-1 line-clamp-2 text-2xs font-medium leading-tight">
                          {a.name}
                        </div>
                        {a.character && (
                          <div className="line-clamp-2 text-2xs leading-tight text-slate-400">
                            {a.character}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Clé de l'option « hors abonnement » du filtre « Où le voir » de À voir. */
const VOD_KEY = "\u0000vod";

/**
 * Âge de la certification, en années. TMDB écrit « tous publics » de plusieurs
 * façons selon les fiches (« TP », « U »), et sort parfois un âge absent de
 * `FR_CERTS` (« 14 ») : on compare des nombres, pas des étiquettes.
 * `null` = certification illisible.
 */
function certYears(cert: string): number | null {
  if (/^(tp|u|tous)/i.test(cert)) return 0;
  const n = Number(cert);
  return Number.isFinite(n) ? n : null;
}

/**
 * Un film de « À voir » passe-t-il les filtres ? Les bornes (durée, année,
 * âge) laissent passer les valeurs **inconnues** : un film qu'on a retenu ne
 * doit pas disparaître de sa propre liste parce que TMDB ignore sa durée.
 */
function matchesFavFilters(
  f: Film,
  q: string,
  runtimeMin: string,
  runtimeMax: string,
  yearMin: string,
  yearMax: string,
  certMax: string,
  where: string[],
  media: FilmMediaType[],
): boolean {
  if (q && !f.title.toLowerCase().includes(q)) return false;
  // Le type est porté par l'identifiant (`tv:1234`) : rien à stocker en plus.
  if (!media.includes(filmMediaType(f.id))) return false;
  // `f.runtime` à 0 = durée inconnue côté TMDB (comme dans `filmMeta`).
  if (runtimeMin && f.runtime && f.runtime < Number(runtimeMin)) return false;
  if (runtimeMax && f.runtime && f.runtime > Number(runtimeMax)) return false;
  const year = f.year ? Number(f.year.slice(0, 4)) : null;
  if (yearMin && year && year < Number(yearMin)) return false;
  if (yearMax && year && year > Number(yearMax)) return false;
  if (certMax && f.ageLimit) {
    const own = certYears(f.ageLimit);
    const max = certYears(certMax);
    if (own != null && max != null && own > max) return false;
  }
  if (where.length > 0) {
    const own = f.providers.map((p) => p.name);
    const hit = own.length === 0 ? where.includes(VOD_KEY) : own.some((n) => where.includes(n));
    if (!hit) return false;
  }
  return true;
}

export default function Films() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { view: viewParam } = useParams();
  // Sous-menu en URL + mémoire du dernier visité (cf. CLAUDE.md).
  const view = useLastView(
    "films",
    FILM_VIEWS,
    "propositions",
    viewParam,
    "/films",
  ) as FilmView;
  // Fiche film ouverte (modale de détails), quel que soit le sous-onglet.
  const [detailId, setDetailId] = useState<string | null>(null);
  // Film dont la feuille d'actions est ouverte.
  const [sheet, setSheet] = useState<Film | HistoryFilm | null>(null);
  // Réglages du foyer (Réglages → Films) : publics proposés, genres par défaut
  // et sélection de départ du filtre Film / Série.
  const filmConfig = useMe().household.filmConfig;
  const audiences = filmConfig.audiences;
  /**
   * Filtre public, partagé par « À voir » et « Propositions ». Il part sur le
   * premier public proposé : avec un seul public réglé, la rangée de choix
   * disparaît et l'état ne doit pas rester sur celui qui n'est plus proposé.
   */
  const [audienceState, setAudience] = useState<Audience>(audiences[0]);
  const audience: Audience = audiences.includes(audienceState) ? audienceState : audiences[0];
  const [history, setHistory] = useState<HistoryFilter>("tous");
  const [historySearch, setHistorySearch] = useState("");

  /**
   * Filtres des propositions. Ils partent avec la requête : c'est TMDB qui
   * choisit dans tout le vivier, sinon filtrer les 15 films déjà tirés en
   * laisserait deux à l'écran.
   */
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [fRuntimeMin, setFRuntimeMin] = useState("");
  const [fRuntimeMax, setFRuntimeMax] = useState("");
  const [fYearMin, setFYearMin] = useState("");
  const [fYearMax, setFYearMax] = useState("");
  const [fNoteMin, setFNoteMin] = useState("");
  const [fNoteMax, setFNoteMax] = useState("");
  const [fCert, setFCert] = useState("");
  const [fGenres, setFGenres] = useState<number[]>([]);
  // Catalogues interrogés. Part sur le réglage du foyer ; jamais vide, sinon la
  // requête n'aurait rien à interroger.
  const [fMedia, setFMedia] = useState<FilmMediaType[]>(filmConfig.mediaTypes);

  const filterQs = useMemo(() => {
    const p = new URLSearchParams();
    // Toujours envoyé : l'API doit interroger ce que la vue affiche, pas le
    // réglage du foyer, dès que l'utilisateur a touché au filtre.
    p.set("media", fMedia.join(","));
    if (fRuntimeMin) p.set("runtimeMin", fRuntimeMin);
    if (fRuntimeMax) p.set("runtimeMax", fRuntimeMax);
    if (fYearMin) p.set("yearMin", fYearMin);
    if (fYearMax) p.set("yearMax", fYearMax);
    if (fNoteMin) p.set("noteMin", fNoteMin);
    if (fNoteMax) p.set("noteMax", fNoteMax);
    if (fCert) p.set("certMax", fCert);
    if (fGenres.length > 0) p.set("genres", fGenres.join(","));
    return p.toString();
  }, [fRuntimeMin, fRuntimeMax, fYearMin, fYearMax, fNoteMin, fNoteMax, fCert, fGenres, fMedia]);
  // `media` part toujours : il ne compte comme filtre que s'il s'écarte du réglage.
  const hasFilters =
    !!fRuntimeMin ||
    !!fRuntimeMax ||
    !!fYearMin ||
    !!fYearMax ||
    !!fNoteMin ||
    !!fNoteMax ||
    !!fCert ||
    fGenres.length > 0 ||
    fMedia.length !== filmConfig.mediaTypes.length ||
    fMedia.some((m) => !filmConfig.mediaTypes.includes(m));
  const resetFilters = () => {
    setFRuntimeMin("");
    setFRuntimeMax("");
    setFYearMin("");
    setFYearMax("");
    setFNoteMin("");
    setFNoteMax("");
    setFCert("");
    setFGenres([]);
    setFMedia(filmConfig.mediaTypes);
  };

  /**
   * Filtres de « À voir ». Contrairement à ceux des propositions, ils ne
   * partent JAMAIS avec une requête : la liste est déjà en main et complète,
   * on la réduit sur place. Chercher ici ne doit pas proposer de films hors de
   * la liste — c'est le rôle de l'onglet Propositions.
   */
  const [favSearch, setFavSearch] = useState("");
  const [favFiltersOpen, setFavFiltersOpen] = useState(false);
  const [favRuntimeMin, setFavRuntimeMin] = useState("");
  const [favRuntimeMax, setFavRuntimeMax] = useState("");
  const [favYearMin, setFavYearMin] = useState("");
  const [favYearMax, setFavYearMax] = useState("");
  const [favCert, setFavCert] = useState("");
  const [favWhere, setFavWhere] = useState<string[]>([]);
  const [favMedia, setFavMedia] = useState<FilmMediaType[]>(filmConfig.mediaTypes);
  const favHasFilters =
    !!favRuntimeMin ||
    !!favRuntimeMax ||
    !!favYearMin ||
    !!favYearMax ||
    !!favCert ||
    favWhere.length > 0 ||
    // Ne compte que si la liste est bel et bien restreinte : avec les deux
    // catalogues cochés, rien n'est filtré.
    favMedia.length < FILM_MEDIA_TYPES.length;
  const resetFavFilters = () => {
    setFavRuntimeMin("");
    setFavRuntimeMax("");
    setFavYearMin("");
    setFavYearMax("");
    setFavCert("");
    setFavWhere([]);
    setFavMedia(filmConfig.mediaTypes);
  };

  /**
   * Propositions en défilement infini : chaque page repart du curseur renvoyé
   * par l'API (`nextOffset`, les entrées de vivier qu'elle a parcourues) et
   * s'arrête quand elle dit qu'il n'y a plus rien (`hasMore`). Compter les
   * films affichés ne suffirait pas : l'API en écarte en chemin.
   *
   * Changer un filtre change le vivier : la clé de requête le porte, donc
   * TanStack Query repart naturellement de la première page.
   */
  const {
    data,
    isLoading,
    isFetching,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["films", audience, filterQs],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.get<FilmsPage>(
        `/api/films?audience=${audience}&offset=${pageParam}${filterQs ? `&${filterQs}` : ""}`,
      ),
    getNextPageParam: (last) => (last.hasMore ? last.nextOffset ?? null : null),
    staleTime: 30 * 60 * 1000,
    retry: false,
    enabled: view === "propositions",
  });
  const { data: favData } = useQuery({
    queryKey: ["film-favorites", audience],
    queryFn: () => api.get<{ films: Film[] }>(`/api/films/favorites?audience=${audience}`),
    // Toujours activée : l'en-tête affiche le nombre de films à voir, y compris
    // depuis l'historique.
  });
  const { data: seenData } = useQuery({
    queryKey: ["films-seen"],
    queryFn: () => api.get<{ films: SeenFilm[] }>("/api/films/seen"),
    enabled: view === "historique",
  });
  const { data: hiddenData } = useQuery({
    queryKey: ["films-hidden"],
    queryFn: () => api.get<{ films: HiddenFilm[] }>("/api/films/hidden"),
    enabled: view === "historique",
  });

  // Recherche par titre (vue Propositions) : debounce pour ne pas appeler
  // TMDB à chaque frappe.
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);
  const searching = debounced.length >= 2;
  const { data: searchData, isFetching: searchLoading } = useQuery({
    queryKey: ["films-search", audience, debounced],
    queryFn: () =>
      api.get<{ films: Film[]; error?: string }>(
        `/api/films/search?audience=${audience}&q=${encodeURIComponent(debounced)}`,
      ),
    enabled: searching && view === "propositions",
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["films"] });
    qc.invalidateQueries({ queryKey: ["film-favorites"] });
    qc.invalidateQueries({ queryKey: ["films-seen"] });
    qc.invalidateQueries({ queryKey: ["films-hidden"] });
  };
  const addFav = useMutation({
    mutationFn: (f: Film) =>
      api.post("/api/films/favorites", {
        externalId: f.id,
        audience,
        title: f.title,
        description: f.description || null,
        imageUrl: f.imageUrl,
        providers: JSON.stringify(f.providers),
        year: f.year,
        runtime: f.runtime ?? null,
        ageLimit: f.ageLimit ?? null,
        availability: f.availability ?? null,
      }),
    onSuccess: invalidate,
  });
  const removeFav = useMutation({
    mutationFn: (id: string) => api.del(`/api/films/favorites/${encodeURIComponent(id)}`),
    onSuccess: invalidate,
  });
  const snapshot = (f: Film) => ({
    externalId: f.id,
    title: f.title,
    audience,
    imageUrl: f.imageUrl,
    providers: JSON.stringify(f.providers),
    year: f.year,
    runtime: f.runtime ?? null,
    ageLimit: f.ageLimit ?? null,
    availability: f.availability ?? null,
  });
  const markSeen = useMutation({
    mutationFn: (f: Film) => api.post("/api/films/seen", snapshot(f)),
    onSuccess: invalidate,
  });
  const unsee = useMutation({
    mutationFn: (id: string) => api.del(`/api/films/seen/${encodeURIComponent(id)}`),
    onSuccess: invalidate,
  });
  const hideFilm = useMutation({
    mutationFn: (f: Film) => api.post("/api/films/hidden", snapshot(f)),
    onSuccess: invalidate,
  });
  const unhide = useMutation({
    mutationFn: (id: string) => api.del(`/api/films/hidden/${encodeURIComponent(id)}`),
    onSuccess: invalidate,
  });

  const favorites = favData?.films ?? [];
  // Options du filtre « Où le voir » : uniquement ce que la liste contient
  // vraiment — un filtre qui ne peut rien donner n'a pas à être proposé.
  const favWhereOptions = useMemo(() => {
    const names = new Set<string>();
    let hasVod = false;
    for (const f of favorites) {
      if (f.providers.length === 0) hasVod = true;
      for (const p of f.providers) names.add(p.name);
    }
    const opts = [...names].sort((a, b) => a.localeCompare(b, "fr")).map((n) => ({ value: n, label: n }));
    return hasVod ? [...opts, { value: VOD_KEY, label: "Hors abonnement" }] : opts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favData]);
  const favQuery = favSearch.trim().toLowerCase();
  const favoritesShown = useMemo(
    () =>
      favorites.filter((f) =>
        matchesFavFilters(
          f,
          favQuery,
          favRuntimeMin,
          favRuntimeMax,
          favYearMin,
          favYearMax,
          favCert,
          favWhere,
          favMedia,
        ),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      favData,
      favQuery,
      favRuntimeMin,
      favRuntimeMax,
      favYearMin,
      favYearMax,
      favCert,
      favWhere,
      favMedia,
    ],
  );
  const historySeen = seenData?.films.length ?? 0;
  const historyHidden = hiddenData?.films.length ?? 0;
  // Le sur-titre dit ce que porte l'onglet ouvert, pas toujours la même chose.
  usePageHeader(
    "Films",
    view === "historique"
      ? `${historySeen} vus · ${historyHidden} masqués`
      : `${favorites.length} à voir`,
  );
  usePageTabs(view, FILM_TABS, (v) => navigate(`/films/${v}`));
  const favIds = new Set(favorites.map((f) => f.id));

  /**
   * Les actions secondaires d'un film, dans une feuille : lancer sur la
   * plateforme, marquer vu, ne plus proposer. La carte, elle, ne montre que
   * son action principale.
   */
  const sheetItems = (f: Film | HistoryFilm): SheetItem[] => {
    const target = launchTarget(f);
    // Un film déjà vu (historique) n'a plus à être marqué vu ni masqué : ce qui
    // reste utile, c'est de le relancer ou de le remettre dans le tirage.
    const alreadySeen = "kind" in f && f.kind === "vue";
    return [
      {
        ...(target
          ? {
              label: `Lancer dans ${target.label}`,
              hint: "ouvre l'application si elle est installée",
              onClick: () => window.open(target.href, "_blank", "noopener,noreferrer"),
            }
          : {
              label: "Chercher où le voir",
              hint:
                f.availability === "unknown"
                  ? "aucune offre française connue"
                  : "location, achat ou autre plateforme",
              onClick: () =>
                window.open(vodSearchUrl(f.title), "_blank", "noopener,noreferrer"),
            }),
        icon: <IconPlay size={20} />,
      },
      ...(alreadySeen
        ? [
            {
              label: "Remettre dans les propositions",
              hint: "il pourra être reproposé",
              icon: <IconUndo size={20} />,
              onClick: () => unsee.mutate(f.id),
            },
          ]
        : [
            ...(favIds.has(f.id)
              ? [
                  {
                    label: "Retirer de À voir",
                    icon: <IconHeart size={20} />,
                    onClick: () => removeFav.mutate(f.id),
                  },
                ]
              : []),
            {
              label: "Marquer comme vu",
              icon: <IconEye size={20} />,
              onClick: () => markSeen.mutate(f),
            },
            {
              label: "Ne plus proposer",
              hint: "retiré des propositions futures",
              icon: <IconBan size={20} />,
              danger: true,
              onClick: () => hideFilm.mutate(f),
            },
          ]),
    ];
  };

  /** Étiquette de plateforme (ou « VOD »), posée sur l'affiche. */
  const providerTag = (f: Film) => (
    <span className="rounded-md bg-black/70 px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-white backdrop-blur">
      {providerLabel(f)}
    </span>
  );

  /**
   * Carte de film : l'affiche décide, une seule action visible.
   *
   * L'action change selon l'onglet — dans les propositions on retient le film
   * (« À voir »), dans sa liste à voir on le sort une fois regardé (« Vue »).
   */
  const card = (f: Film, primary: "fav" | "seen" = "fav") => {
    const fav = favIds.has(f.id);
    return (
      <div key={f.id} className="card flex flex-col" style={{ padding: 0 }}>
        <div className="relative">
          <button
            type="button"
            onClick={() => setDetailId(f.id)}
            aria-label={`Fiche de ${f.title}`}
            className="block w-full"
          >
            {f.imageUrl ? (
              <img
                src={f.imageUrl}
                alt=""
                loading="lazy"
                className="aspect-[2/3] w-full rounded-t-2xl object-cover"
              />
            ) : (
              <div className="flex aspect-[2/3] w-full items-center justify-center rounded-t-2xl bg-surface-2 text-3xl">
                🎬
              </div>
            )}
          </button>
          <span className="pointer-events-none absolute left-2 top-2">{providerTag(f)}</span>
          {fav && primary === "fav" && (
            <span
              className="pointer-events-none absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-on-brand"
              aria-label="Dans ta liste à voir"
            >
              <IconCheck size={16} />
            </span>
          )}
        </div>
        {/* `.card` est hors `@layer` : son `p-4` gagne sur `p-0`. Le retrait est
            donc posé ici, sur le bloc de texte seulement. */}
        <div className="flex flex-1 flex-col gap-1 px-3 pb-3 pt-2.5">
          <button
            type="button"
            onClick={() => setDetailId(f.id)}
            className="line-clamp-3 text-left text-base font-semibold leading-snug"
          >
            {f.title}
          </button>
          <div className="text-xs text-slate-400">{filmMeta(f)}</div>
          <div className="mt-auto flex items-center gap-2 pt-2.5">
            {primary === "seen" ? (
              <button
                type="button"
                onClick={() => markSeen.mutate(f)}
                className="flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full bg-brand-600 text-sm font-semibold text-on-brand"
              >
                <IconCheck size={16} />
                <span className="truncate">Vue</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => (fav ? removeFav.mutate(f.id) : addFav.mutate(f))}
                className={`flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full text-sm font-semibold ${
                  fav ? "border border-line bg-surface text-ink-2" : "bg-brand-600 text-on-brand"
                }`}
              >
                <IconHeart size={16} />
                <span className="truncate">{fav ? "Retirer" : "À voir"}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setSheet(f)}
              aria-label={`Autres actions sur ${f.title}`}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line text-ink-2"
            >
              <IconMore size={20} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  /**
   * Rangée d'historique. L'affiche ne sert plus à choisir — elle sert à
   * reconnaître : petite vignette, et la place va au statut et à sa date.
   *
   * Un film masqué n'a qu'une action utile (le re-proposer) : elle est posée
   * directement dans la ligne. Un film vu en a plusieurs, elles passent par
   * la feuille.
   */
  const historyRow = (f: HistoryFilm, last: boolean) => {
    const seen = f.kind === "vue";
    return (
      <div key={`${f.kind}-${f.id}`} className={last ? "" : "border-b border-hairline"}>
        <div className="flex items-center gap-3 py-2.5">
          <button type="button" onClick={() => setDetailId(f.id)} className="shrink-0">
            {f.imageUrl ? (
              <img
                src={f.imageUrl}
                alt=""
                loading="lazy"
                className="h-16 w-11 rounded-lg object-cover opacity-80"
              />
            ) : (
              <span className="flex h-16 w-11 items-center justify-center rounded-lg bg-surface-2">
                🎬
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setDetailId(f.id)}
            className="min-w-0 flex-1 text-left"
          >
            <span className="block truncate text-base font-semibold">{f.title}</span>
            <span className="block truncate text-xs text-slate-400">
              {[f.year, providerLabel(f)].filter(Boolean).join(" · ")}
            </span>
            <span className="mt-1.5 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold ${
                  seen ? "bg-brand-600/20 text-brand-600" : "bg-danger-soft text-danger"
                }`}
              >
                {seen ? <IconCheck size={12} /> : <IconBan size={12} />}
                {seen ? "Vu" : "Masqué"}
              </span>
              <span className="text-xs text-slate-400">
                {[f.at ? dateFrShort(f.at) : null, f.audience === "enfants" ? "en famille" : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </button>
          {seen ? (
            <button
              type="button"
              onClick={() => setSheet(f)}
              aria-label={`Autres actions sur ${f.title}`}
              className="flex h-tap w-9 shrink-0 items-center justify-center rounded-lg text-ink-2"
            >
              <IconMore size={20} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => unhide.mutate(f.id)}
              aria-label={`Re-proposer ${f.title}`}
              title="Re-proposer"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-2"
            >
              <IconUndo size={20} />
            </button>
          )}
        </div>
      </div>
    );
  };

  /**
   * Toutes les pages chargées, à plat. Dédoublonné par identifiant : TMDB
   * répète parfois une œuvre d'une page de `discover` à l'autre, et en
   * défilement infini le doublon se verrait dans la même grille.
   */
  const films = useMemo(() => {
    const seenIds = new Set<string>();
    const rows: Film[] = [];
    for (const page of data?.pages ?? []) {
      for (const f of page.films) {
        if (seenIds.has(f.id)) continue;
        seenIds.add(f.id);
        rows.push(f);
      }
    }
    return rows;
  }, [data]);
  // L'erreur éventuelle (clé TMDB, plateformes) vient de la première page.
  const filmsError = data?.pages[0]?.error;
  const searchResults = searchData?.films ?? [];

  // Historique = vus + masqués fusionnés, du plus récent au plus ancien.
  const seenFilms = seenData?.films;
  const hiddenFilms = hiddenData?.films;
  const historyFilms = useMemo<HistoryFilm[]>(() => {
    const rows: HistoryFilm[] = [
      ...(seenFilms ?? []).map((f) => ({ ...f, kind: "vue" as const, at: f.seenAt ?? "" })),
      ...(hiddenFilms ?? []).map((f) => ({ ...f, kind: "masque" as const, at: f.hiddenAt ?? "" })),
    ];
    return rows.sort((a, b) => b.at.localeCompare(a.at));
  }, [seenFilms, hiddenFilms]);
  const hq = historySearch.trim().toLowerCase();
  const historyShown = historyFilms.filter(
    (f) =>
      (history === "tous" ||
        (history === "vues" && f.kind === "vue") ||
        (history === "masques" && f.kind === "masque")) &&
      (!hq || f.title.toLowerCase().includes(hq)),
  );
  // Regroupé par mois : l'historique se parcourt par période, pas à plat.
  const historyMonths: { key: string; label: string; rows: HistoryFilm[] }[] = [];
  for (const f of historyShown) {
    const key = f.at.slice(0, 7) || "?";
    const last = historyMonths[historyMonths.length - 1];
    if (last?.key === key) last.rows.push(f);
    else
      historyMonths.push({
        key,
        label: f.at ? monthFr(key) : "Sans date",
        rows: [f],
      });
  }

  /**
   * Défilement infini : dès que la sentinelle posée sous la grille approche de
   * l'écran (400 px avant), on demande la page suivante. Un seul appel à la
   * fois — `isFetchingNextPage` garde la porte.
   */
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || view !== "propositions" || searching || !hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [view, searching, hasNextPage, isFetchingNextPage, fetchNextPage, films.length]);

  /**
   * Rangée Film / Série d'une modale de filtres. Refuse de tout décocher : un
   * filtre vide ne montrerait rien et ne dirait pas pourquoi.
   */
  const mediaToggles = (
    value: FilmMediaType[],
    onChange: (v: FilmMediaType[]) => void,
    /** Sélection d'âge posée à droite, sur la même ligne (une rangée de gagnée). */
    trailing?: ReactNode,
  ) => (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <div className="text-xs text-slate-400">Média</div>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {FILM_MEDIA_TYPES.map((t) => (
            <FilterToggle
              key={t}
              active={value.includes(t)}
              onClick={() =>
                onChange(
                  value.includes(t)
                    ? value.length > 1
                      ? value.filter((x) => x !== t)
                      : value
                    : [...value, t],
                )
              }
            >
              {FILM_MEDIA_LABEL[t]}
            </FilterToggle>
          ))}
        </div>
      </div>
      {/* `flex-1` : la sélection prend la place qui reste et ne passe à la ligne
          que si l'écran ne peut vraiment pas les tenir côte à côte. */}
      {trailing && <div className="ml-auto min-w-[10rem] flex-1 sm:max-w-xs">{trailing}</div>}
    </div>
  );

  /** Plafond d'âge — partagé par les deux modales de filtres. */
  const certField = (value: string, onChange: (v: string) => void) => (
    <FilterField label="Âge minimum du film (au plus)">
      <Select
        value={value}
        onChange={onChange}
        placeholder="Peu importe"
        options={[
          { value: "", label: "Peu importe" },
          ...FR_CERTS.map((cert) => ({
            value: cert,
            label: cert === "U" ? "Tous publics" : `Dès ${cert} ans`,
          })),
        ]}
      />
    </FilterField>
  );

  /**
   * Rangée Enfants / Adultes — absente quand le foyer n'en propose qu'un
   * (Réglages → Films) : un filtre à une seule valeur ne filtre rien et prend
   * une rangée à l'écran.
   */
  /**
   * Ce que « sans choix » interroge vraiment : les genres réglés dans
   * Réglages → Films, pour chaque public proposé. Écrit noir sur blanc plutôt
   * que codé en dur — le réglage existe, la phrase doit le refléter.
   */
  const defaultGenresText = (() => {
    const part = (a: Audience) => {
      const labels = filmConfig.genres[a].map(filmGenreLabel).filter(Boolean);
      return labels.length > 0 ? labels.join(", ").toLowerCase() : "tout le catalogue";
    };
    return audiences.length > 1
      ? audiences.map((a) => `${part(a)} pour ${a === "enfants" ? "Enfants" : "Adultes"}`).join(" ; ")
      : part(audiences[0]);
  })();

  const audienceChips =
    audiences.length > 1 ? (
      <FilterChips
        value={audience}
        onChange={(v) => setAudience(v as Audience)}
        items={audiences.map((a) => ({
          value: a,
          label: a === "enfants" ? "Enfants" : "Adultes",
        }))}
      />
    ) : null;

  return (
    // Plus de barre d'action ancrée sur cette page : la marge basse n'a plus à
    // lui réserver la place, juste à ne pas coller la dernière ligne au bord.
    <div className="flex flex-col gap-3 pb-6 md:pb-0">
      {/* Onglets de premier niveau (pleine largeur), comme les autres pages */}
      <SubNav
        value={view}
        onChange={(v) => navigate(`/films/${v}`)}
        items={FILM_TABS}
        className="hidden md:block"
      />

      {view === "a-voir" ? (
        <>
          {/* Recherche et filtres portent sur la liste déjà retenue, rien
              d'autre : aucun appel à TMDB depuis cet onglet. */}
          {favorites.length > 0 && (
            <SearchField
              value={favSearch}
              onChange={setFavSearch}
              placeholder="Chercher dans À voir…"
              trailing={
                <FilterButton active={favHasFilters} onClick={() => setFavFiltersOpen(true)} />
              }
            />
          )}
          {audienceChips}
          {favorites.length === 0 ? (
            <div className="card flex flex-col items-start gap-3 text-sm text-slate-400">
              <p>Aucun film à voir pour l'instant.</p>
              <button
                type="button"
                onClick={() => navigate("/films/propositions")}
                className="btn-primary"
              >
                Voir les propositions
              </button>
            </div>
          ) : favoritesShown.length === 0 ? (
            /* La liste n'est pas vide, ce sont les filtres qui ne laissent
               rien passer : on le dit, et on donne de quoi les retirer. */
            <div className="card flex flex-col items-start gap-3 text-sm text-slate-400">
              <p>
                {favQuery
                  ? `Aucun film « ${favSearch.trim()} » dans À voir.`
                  : "Aucun film de À voir ne correspond à ces filtres."}
              </p>
              {/* Un état vide donne toujours de quoi en sortir : selon ce qui
                  exclut tout, on retire les filtres ou on vide la recherche. */}
              {favHasFilters ? (
                <button type="button" onClick={resetFavFilters} className="btn">
                  Retirer les filtres
                </button>
              ) : (
                <button type="button" onClick={() => setFavSearch("")} className="btn">
                  Vider la recherche
                </button>
              )}
            </div>
          ) : (
            /* Même grille que les propositions : l'affiche reste ce qui fait
               choisir. Seule l'action change — ici on marque le film vu. */
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
              {favoritesShown.map((f) => card(f, "seen"))}
            </div>
          )}

          {favFiltersOpen && (
            <FilterModal
              onClose={() => setFavFiltersOpen(false)}
              onReset={favHasFilters ? resetFavFilters : undefined}
              summary={`${favoritesShown.length} / ${favorites.length} film${favorites.length > 1 ? "s" : ""}`}
              size="lg"
            >
              {mediaToggles(favMedia, setFavMedia, certField(favCert, setFavCert))}
              <div className="grid grid-cols-2 gap-3">
                <FilterField label="Durée min. (min)">
                  <Input
                    type="number"
                    min={0}
                    step={5}
                    inputMode="numeric"
                    value={favRuntimeMin}
                    onChange={(e) => setFavRuntimeMin(e.target.value)}
                    placeholder="—"
                  />
                </FilterField>
                <FilterField label="Durée max. (min)">
                  <Input
                    type="number"
                    min={0}
                    step={5}
                    inputMode="numeric"
                    value={favRuntimeMax}
                    onChange={(e) => setFavRuntimeMax(e.target.value)}
                    placeholder="—"
                  />
                </FilterField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FilterField label="Sortie après">
                  <Input
                    type="number"
                    min={1900}
                    max={2100}
                    inputMode="numeric"
                    value={favYearMin}
                    onChange={(e) => setFavYearMin(e.target.value)}
                    placeholder="1900"
                  />
                </FilterField>
                <FilterField label="Sortie avant">
                  <Input
                    type="number"
                    min={1900}
                    max={2100}
                    inputMode="numeric"
                    value={favYearMax}
                    onChange={(e) => setFavYearMax(e.target.value)}
                    placeholder="2100"
                  />
                </FilterField>
              </div>
              {favWhereOptions.length > 1 && (
                <div>
                  <div className="text-xs text-slate-400">Où le voir</div>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {favWhereOptions.map((o) => (
                      <FilterToggle
                        key={o.value}
                        active={favWhere.includes(o.value)}
                        onClick={() =>
                          setFavWhere(
                            favWhere.includes(o.value)
                              ? favWhere.filter((x) => x !== o.value)
                              : [...favWhere, o.value],
                          )
                        }
                      >
                        {o.label}
                      </FilterToggle>
                    ))}
                  </div>
                </div>
              )}
              {/* Pas de note ni de type ici : l'instantané enregistré quand on
                  retient un film ne les porte pas — un filtre qui ne filtre
                  rien vaut moins que son absence. */}
            </FilterModal>
          )}
        </>
      ) : view === "historique" ? (
        <>
          <SearchField
            value={historySearch}
            onChange={setHistorySearch}
            placeholder="Chercher dans l'historique…"
          />
          <FilterChips
            value={history}
            onChange={(v) => setHistory(v as HistoryFilter)}
            items={[
              { value: "tous", label: "Tous" },
              { value: "vues", label: "Vus" },
              { value: "masques", label: "Masqués" },
            ]}
          />
          {historyShown.length === 0 ? (
            <div className="card text-sm text-slate-400">
              {hq ? `Aucun film « ${historySearch} » dans l'historique.` : "Aucun film dans l'historique."}
            </div>
          ) : (
            historyMonths.map((m) => (
              <div key={m.key} className="flex flex-col gap-2">
                <div className="eyebrow">{m.label}</div>
                <div className="card">
                  {m.rows.map((f, i) => historyRow(f, i === m.rows.length - 1))}
                </div>
              </div>
            ))
          )}
        </>
      ) : (
        <>
          {/* Recherche par titre parmi les plateformes activées du foyer. Les
              filtres portent sur les propositions : chercher un titre précis,
              c'est déjà choisir, donc l'entonnoir s'efface pendant la
              recherche plutôt que de restreindre ses résultats en silence. */}
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Chercher un film…"
            trailing={
              searching ? undefined : (
                <FilterButton active={hasFilters} onClick={() => setFiltersOpen(true)} />
              )
            }
          />
          {audienceChips}

          {/* Ces avertissements portent sur les propositions : la recherche, elle,
              fonctionne sans plateforme activée (tout ressort en VOD). */}
          {isError && !searching && (
            <div className="card text-sm text-slate-400">Impossible de charger les films.</div>
          )}
          {filmsError === "no_key" && (
            <div className="card text-sm text-amber-600">
              Clé TMDB manquante : ajoute le secret <code>TMDB_API_KEY</code> côté serveur.
            </div>
          )}
          {filmsError === "no_provider" && !searching && (
            <div className="card text-sm text-amber-600">
              Aucune plateforme activée. Active-les dans les Réglages.
            </div>
          )}
          {searching ? (
            searchLoading ? (
              <div className="text-sm text-slate-400">Recherche…</div>
            ) : searchResults.length === 0 ? (
              <div className="card text-sm text-slate-400">
                Aucun film « {debounced} » trouvé.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
                {searchResults.map((f) => card(f))}
              </div>
            )
          ) : isLoading ? (
            <PageLoader variant="activites" />
          ) : films.length === 0 ? (
            <div className="card flex flex-col items-start gap-3 text-sm text-slate-400">
              <p>
                {hasFilters
                  ? "Aucun film de vos plateformes ne correspond à ces filtres."
                  : "Aucune proposition pour le moment."}
              </p>
              {hasFilters && (
                <button type="button" onClick={resetFilters} className="btn">
                  Retirer les filtres
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
                {films.map((f) => card(f))}
              </div>
              {/* Sentinelle : charge la suite avant d'atteindre le bas (cf.
                  `rootMargin` de l'observateur), pour que le défilement ne
                  s'arrête pas sur un vide. */}
              <div ref={loadMoreRef} aria-hidden="true" className="h-px" />
              {isFetchingNextPage ? (
                <InlineLoader label="Encore des films…" className="justify-center py-2" />
              ) : hasNextPage ? (
                // Repli si l'observateur ne se déclenche pas (défilement dans un
                // conteneur, navigateur récalcitrant) : l'action reste possible.
                <button
                  type="button"
                  onClick={() => fetchNextPage()}
                  className="btn mx-auto mt-1"
                >
                  Charger plus de films
                </button>
              ) : (
                <p className="py-2 text-center text-xs text-slate-400">
                  Fin des propositions pour ces filtres.
                </p>
              )}
            </>
          )}

          {filtersOpen && (
            <FilterModal
              onClose={() => setFiltersOpen(false)}
              onReset={hasFilters ? resetFilters : undefined}
              summary={isFetching ? "Recherche…" : `${films.length} film${films.length > 1 ? "s" : ""}`}
              size="lg"
            >
              {mediaToggles(fMedia, setFMedia, certField(fCert, setFCert))}
              <div className="grid grid-cols-2 gap-3">
                <FilterField label="Durée min. (min)">
                  <Input
                    type="number"
                    min={0}
                    step={5}
                    inputMode="numeric"
                    value={fRuntimeMin}
                    onChange={(e) => setFRuntimeMin(e.target.value)}
                    placeholder="—"
                  />
                </FilterField>
                <FilterField label="Durée max. (min)">
                  <Input
                    type="number"
                    min={0}
                    step={5}
                    inputMode="numeric"
                    value={fRuntimeMax}
                    onChange={(e) => setFRuntimeMax(e.target.value)}
                    placeholder="—"
                  />
                </FilterField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FilterField label="Sortie après">
                  <Input
                    type="number"
                    min={1900}
                    max={2100}
                    inputMode="numeric"
                    value={fYearMin}
                    onChange={(e) => setFYearMin(e.target.value)}
                    placeholder="1900"
                  />
                </FilterField>
                <FilterField label="Sortie avant">
                  <Input
                    type="number"
                    min={1900}
                    max={2100}
                    inputMode="numeric"
                    value={fYearMax}
                    onChange={(e) => setFYearMax(e.target.value)}
                    placeholder="2100"
                  />
                </FilterField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FilterField label="Note min. / 10">
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    step={0.5}
                    inputMode="decimal"
                    value={fNoteMin}
                    onChange={(e) => setFNoteMin(e.target.value)}
                    placeholder="—"
                  />
                </FilterField>
                <FilterField label="Note max. / 10">
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    step={0.5}
                    inputMode="decimal"
                    value={fNoteMax}
                    onChange={(e) => setFNoteMax(e.target.value)}
                    placeholder="—"
                  />
                </FilterField>
              </div>
              <div>
                <div className="text-xs text-slate-400">Type</div>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {FILM_GENRES.map((g) => (
                    <FilterToggle
                      key={g.id}
                      active={fGenres.includes(g.id)}
                      onClick={() =>
                        setFGenres(
                          fGenres.includes(g.id)
                            ? fGenres.filter((x) => x !== g.id)
                            : [...fGenres, g.id],
                        )
                      }
                    >
                      {g.label}
                    </FilterToggle>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-slate-400">
                  {fGenres.length > 0 ? (
                    "Les types choisis remplacent ceux réglés par défaut."
                  ) : (
                    <>
                      Sans choix : {defaultGenresText}.{" "}
                      <Link to="/settings/films" className="underline hover:text-ink">
                        Modifier dans les Réglages
                      </Link>
                    </>
                  )}
                </p>
              </div>
            </FilterModal>
          )}
        </>
      )}

      {sheet && (
        <ActionSheet
          title={sheet.title}
          subtitle={[providerLabel(sheet), filmMeta(sheet)].filter(Boolean).join(" · ")}
          thumbnail={
            sheet.imageUrl ? (
              <img src={sheet.imageUrl} alt="" className="h-12 w-8 shrink-0 rounded-md object-cover" />
            ) : undefined
          }
          items={sheetItems(sheet)}
          onClose={() => setSheet(null)}
        />
      )}

      {detailId && <FilmDetailsModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

