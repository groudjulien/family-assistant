import { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SubNav, PillToggle } from "../components/ui";
import { useLastView } from "../lib/lastView";
import { dateFr } from "../lib/format";
import { api } from "../lib/api";
import PageLoader from "../components/PageLoader";

/* ---------------- Films disponibles sur nos abonnements ---------------- */

type Audience = "enfants" | "adultes";
/** Sous-menus de /films (URL : /films/<vue>). */
type FilmView = "a-voir" | "propositions" | "historique";
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
type HistoryFilm = Film & { kind: "vue" | "masque"; at: string };

function ProviderLogos({ providers }: { providers: Provider[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {providers.map((p) =>
        p.logo ? (
          <img
            key={p.name}
            src={p.logo}
            alt={p.name}
            title={p.name}
            className="h-6 w-6 rounded-md object-cover"
          />
        ) : (
          <span
            key={p.name}
            className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-600/20 dark:text-brand-50"
          >
            {p.name}
          </span>
        ),
      )}
    </div>
  );
}

interface FilmDetails {
  id: string;
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
 * ordinateur, contenu scrollable dans l'overlay.
 */
function FilmDetailsModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["film-details", id],
    queryFn: () => api.get<FilmDetails>(`/api/films/details/${id}`),
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
        className="card w-full max-w-2xl overflow-hidden p-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Média d'en-tête : bande-annonce si dispo, sinon image large */}
        <div className="relative">
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

        <div className="space-y-3 p-4 sm:p-5">
          {isLoading && <div className="text-sm text-slate-400">Chargement de la fiche…</div>}
          {isError && (
            <div className="text-sm text-slate-400">Impossible de charger la fiche du film.</div>
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
                {data.runtime ? <span className="text-slate-500">{runtimeFr(data.runtime)}</span> : null}
                {data.directors.length > 0 && (
                  <span className="text-slate-500">De {data.directors.join(", ")}</span>
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
                        <div className="mt-1 line-clamp-2 text-[11px] font-medium leading-tight">
                          {a.name}
                        </div>
                        {a.character && (
                          <div className="line-clamp-2 text-[10px] leading-tight text-slate-400">
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
  // Filtre public, partagé par « À voir » et « Propositions ».
  const [audience, setAudience] = useState<Audience>("enfants");
  const [history, setHistory] = useState<HistoryFilter>("tous");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["films", audience],
    queryFn: () => api.get<{ films: Film[]; error?: string }>(`/api/films?audience=${audience}`),
    staleTime: 30 * 60 * 1000,
    retry: false,
    enabled: view === "propositions",
  });
  const { data: favData } = useQuery({
    queryKey: ["film-favorites", audience],
    queryFn: () => api.get<{ films: Film[] }>(`/api/films/favorites?audience=${audience}`),
    enabled: view !== "historique",
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
  const favIds = new Set(favorites.map((f) => f.id));

  const card = (f: Film) => {
    const fav = favIds.has(f.id);
    return (
      <div key={f.id} className="card flex flex-col overflow-hidden p-0">
        {f.imageUrl && (
          <img
            src={f.imageUrl}
            alt=""
            loading="lazy"
            onClick={() => setDetailId(f.id)}
            className="aspect-[2/3] w-full cursor-pointer object-cover"
          />
        )}
        {/* `.card` n'est pas dans un @layer : son `p-4` s'applique malgré `p-0`.
            On ne remet donc qu'un espacement vertical, sinon le texte serait plus
            resserré que l'affiche. */}
        <div className="flex flex-1 flex-col gap-1.5 pt-3">
          <div
            onClick={() => setDetailId(f.id)}
            className="cursor-pointer font-semibold leading-tight hover:text-brand-600"
          >
            {f.title}
            {f.year && <span className="ml-1 text-xs font-normal text-slate-400">({f.year})</span>}
          </div>
          <ProviderLogos providers={f.providers} />
          {f.description && (
            <p
              onClick={() => setDetailId(f.id)}
              className="mt-1 line-clamp-3 cursor-pointer text-xs text-slate-600 dark:text-slate-300"
            >
              {f.description}
            </p>
          )}
          {/* Actions en 3 colonnes : icône au-dessus, libellé en dessous */}
          <div className="mt-auto grid grid-cols-3 gap-1 pt-2">
            <button
              onClick={() => hideFilm.mutate(f)}
              title="Ne plus me proposer"
              className="flex flex-col items-center gap-0.5 text-slate-400 transition hover:text-red-500"
            >
              <span className="text-lg leading-none">🚫</span>
              <span className="text-[11px] font-medium leading-none">Masqué</span>
            </button>
            <button
              onClick={() => markSeen.mutate(f)}
              title="Marquer comme déjà vu"
              className="flex flex-col items-center gap-0.5 text-slate-400 transition hover:text-brand-600"
            >
              <span className="text-lg leading-none">👁</span>
              <span className="text-[11px] font-medium leading-none">Vue</span>
            </button>
            <button
              onClick={() => (fav ? removeFav.mutate(f.id) : addFav.mutate(f))}
              title={fav ? "Retirer des favoris" : "Ajouter aux favoris"}
              className="group flex flex-col items-center gap-0.5 transition"
            >
              {/* Cœur rouge + libellé vert quand le film est retenu. Au survol on
                  montre l'état inverse : aperçu de ce que fera le clic. */}
              <span
                className={`text-lg leading-none ${
                  fav ? "text-red-500 group-hover:text-slate-400" : "text-slate-400 group-hover:text-red-500"
                }`}
              >
                <span className="group-hover:hidden">{fav ? "♥" : "♡"}</span>
                <span className="hidden group-hover:inline">{fav ? "♡" : "♥"}</span>
              </span>
              <span
                className={`text-[11px] font-medium leading-none ${
                  fav
                    ? "text-brand-600 group-hover:text-slate-400"
                    : "text-slate-400 group-hover:text-brand-600"
                }`}
              >
                À voir
              </span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  const historyCard = (f: HistoryFilm) => (
    <div key={`${f.kind}-${f.id}`} className="card flex flex-col overflow-hidden p-0">
      {f.imageUrl && (
        <img
          src={f.imageUrl}
          alt=""
          loading="lazy"
          onClick={() => setDetailId(f.id)}
          className="aspect-[2/3] w-full cursor-pointer object-cover opacity-80"
        />
      )}
      <div className="flex flex-1 flex-col gap-1.5 pt-3">
        <div
          onClick={() => setDetailId(f.id)}
          className="cursor-pointer font-semibold leading-tight hover:text-brand-600"
        >
          {f.title}
          {f.year && <span className="ml-1 text-xs font-normal text-slate-400">({f.year})</span>}
        </div>
        <ProviderLogos providers={f.providers} />
        <div className="text-xs text-slate-400">
          <span
            className={`mr-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              f.kind === "vue"
                ? "bg-brand-50 text-brand-700 dark:bg-brand-600/20 dark:text-brand-50"
                : "bg-red-50 text-red-600 dark:bg-red-500/20 dark:text-red-200"
            }`}
          >
            {f.kind === "vue" ? "👁 Vue" : "🚫 Masqué"}
          </span>
          {f.at ? `le ${dateFr(f.at)}` : ""}
        </div>
        <button
          onClick={() => (f.kind === "vue" ? unsee.mutate(f.id) : unhide.mutate(f.id))}
          className="mt-auto pt-2 text-left text-xs font-medium text-brand-600 hover:underline"
        >
          ↩︎ Re-proposer
        </button>
      </div>
    </div>
  );

  const films = data?.films ?? [];
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
  const historyShown = historyFilms.filter(
    (f) =>
      history === "tous" ||
      (history === "vues" && f.kind === "vue") ||
      (history === "masques" && f.kind === "masque"),
  );

  const audienceToggle = (
    <PillToggle
      value={audience}
      onChange={(v) => setAudience(v as Audience)}
      items={[
        { value: "enfants", label: "Enfants", icon: "🧸" },
        { value: "adultes", label: "Adultes", icon: "🎞️" },
      ]}
    />
  );

  return (
    <div className="space-y-4">
      {/* Onglets de premier niveau (pleine largeur), comme les autres pages */}
      <SubNav
        value={view}
        onChange={(v) => navigate(`/films/${v}`)}
        items={[
          { value: "a-voir", label: "À voir", icon: "♥" },
          { value: "propositions", label: "Propositions", icon: "🎬" },
          { value: "historique", label: "Historique", icon: "🕓" },
        ]}
      />

      {view === "a-voir" ? (
        <>
          {audienceToggle}
          <p className="text-xs text-slate-400">
            Films mis de côté pour plus tard. Les marquer 👁 « Vue » ou 🚫 « Masqué » les retire de
            cette liste.
          </p>
          {favorites.length === 0 ? (
            <div className="card text-sm text-slate-400">
              Aucun film à voir pour l'instant — ajoutez-en depuis les propositions avec ♡.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
              {favorites.map(card)}
            </div>
          )}
        </>
      ) : view === "historique" ? (
        <>
          <PillToggle
            value={history}
            onChange={(v) => setHistory(v as HistoryFilter)}
            items={[
              { value: "tous", label: "Tous", icon: "🕓" },
              { value: "vues", label: "Vues", icon: "👁" },
              { value: "masques", label: "Masqués", icon: "🚫" },
            ]}
          />
          <p className="text-xs text-slate-400">
            Films vus ou masqués (exclus des propositions), du plus récent au plus ancien.
          </p>
          {historyShown.length === 0 ? (
            <div className="card text-sm text-slate-400">Aucun film dans l'historique.</div>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
              {historyShown.map(historyCard)}
            </div>
          )}
        </>
      ) : (
        <>
          {audienceToggle}

          {/* Recherche par titre parmi les plateformes activées du foyer */}
          <div className="relative">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un film par son nom…"
              className="input"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Effacer la recherche"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-brand-600"
              >
                ✕
              </button>
            )}
          </div>

          <p className="text-xs text-slate-400">
            {searching
              ? "Résultats disponibles avec vos abonnements. ♡ = à voir plus tard."
              : `${audience === "enfants" ? "Dessins animés" : "Films d'action / fantastique"} dispo avec vos abonnements. 👁 = déjà vu (ne sera plus proposé).`}
          </p>

          {isError && (
            <div className="card text-sm text-slate-400">Impossible de charger les films.</div>
          )}
          {data?.error === "no_key" && (
            <div className="card text-sm text-amber-600">
              Clé TMDB manquante : ajoute le secret <code>TMDB_API_KEY</code> côté serveur.
            </div>
          )}
          {data?.error === "no_provider" && (
            <div className="card text-sm text-amber-600">
              Aucune plateforme activée. Active-les dans les Réglages.
            </div>
          )}
          {searching ? (
            searchLoading ? (
              <div className="text-sm text-slate-400">Recherche…</div>
            ) : searchResults.length === 0 ? (
              <div className="card text-sm text-slate-400">
                Aucun film « {debounced} » disponible sur vos plateformes.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
                {searchResults.map(card)}
              </div>
            )
          ) : isLoading ? (
            <PageLoader variant="activites" />
          ) : films.length === 0 ? (
            <div className="card text-sm text-slate-400">Aucune proposition pour le moment.</div>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">{films.map(card)}</div>
          )}
        </>
      )}

      {detailId && <FilmDetailsModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

