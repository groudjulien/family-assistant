import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SubNav } from "../components/ui";
import { api } from "../lib/api";
import PageLoader from "../components/PageLoader";

/**
 * Activités. Films, Vacances et WishList ont leur propre menu
 * ([`Films.tsx`](./Films.tsx), [`Vacances.tsx`](./Vacances.tsx),
 * [`Listes.tsx`](./Listes.tsx)).
 */
type Tab = "a-faire" | "propositions";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "a-faire", label: "À faire", icon: "♥" },
  { id: "propositions", label: "Propositions", icon: "🎲" },
];

export default function Tools() {
  const navigate = useNavigate();
  const { tab: tabParam } = useParams();
  const tab: Tab = TABS.some((t) => t.id === tabParam) ? (tabParam as Tab) : "propositions";

  return (
    <div className="space-y-4">
      <SubNav
        value={tab}
        onChange={(v) => navigate(`/tools/${v}`)}
        items={TABS.map((t) => ({ value: t.id, label: t.label, icon: t.icon }))}
      />
      <Activites view={tab} />
    </div>
  );
}

/* ---------------- Activités autour de chez nous ---------------- */

interface Activity {
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

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

function dateRange(a: Activity): string {
  if (!a.start) return a.dateLabel ?? "";
  const start = fmt(a.start);
  const end = a.end ? fmt(a.end) : null;
  if (!end || end === start) return `Le ${start}`;
  return `Du ${start} au ${end}`;
}

/**
 * Visuel d'une carte activité : image de l'événement, ou état vide (icône
 * calendrier sur fond neutre) si absente ou en erreur — les cartes gardent
 * ainsi toutes la même hauteur.
 */
function ActivityImage({ src, dim }: { src: string | null; dim?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="flex h-40 w-full items-center justify-center bg-slate-100 dark:bg-slate-800">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className="h-10 w-10 text-slate-300 dark:text-slate-600"
          aria-hidden="true"
        >
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className={`h-40 w-full object-cover${dim ? " opacity-80" : ""}`}
      onError={() => setFailed(true)}
    />
  );
}

function Activites({ view }: { view: Tab }) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["activities"],
    queryFn: () => api.get<{ activities: Activity[] }>("/api/activities"),
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  const { data: favData } = useQuery({
    queryKey: ["activity-favorites"],
    queryFn: () => api.get<{ activities: Activity[] }>("/api/activities/favorites"),
  });

  const invalidateFav = () => {
    qc.invalidateQueries({ queryKey: ["activity-favorites"] });
    // Une activité retenue quitte les propositions (filtrée côté API).
    qc.invalidateQueries({ queryKey: ["activities"] });
  };
  const addFav = useMutation({
    mutationFn: (a: Activity) =>
      api.post("/api/activities/favorites", {
        externalId: a.id,
        title: a.title,
        description: a.description || null,
        city: a.city || null,
        address: a.address || null,
        start: a.start,
        end: a.end,
        dateLabel: a.dateLabel,
        imageUrl: a.imageUrl,
        url: a.url,
      }),
    onSuccess: invalidateFav,
  });
  const removeFav = useMutation({
    mutationFn: (id: string) => api.del(`/api/activities/favorites/${encodeURIComponent(id)}`),
    onSuccess: invalidateFav,
  });

  const [showHidden, setShowHidden] = useState(false);
  const { data: hiddenData } = useQuery({
    queryKey: ["activity-hidden"],
    queryFn: () => api.get<{ activities: Activity[] }>("/api/activities/hidden"),
  });
  const invalidateHidden = () => {
    qc.invalidateQueries({ queryKey: ["activity-hidden"] });
    qc.invalidateQueries({ queryKey: ["activities"] });
    // Masquer retire aussi des favoris côté API.
    qc.invalidateQueries({ queryKey: ["activity-favorites"] });
  };
  const hide = useMutation({
    mutationFn: (a: Activity) =>
      api.post("/api/activities/hidden", {
        externalId: a.id,
        title: a.title,
        description: a.description || null,
        city: a.city || null,
        address: a.address || null,
        start: a.start,
        end: a.end,
        dateLabel: a.dateLabel,
        imageUrl: a.imageUrl,
        url: a.url,
      }),
    onSuccess: invalidateHidden,
  });
  const unhide = useMutation({
    mutationFn: (id: string) => api.del(`/api/activities/hidden/${encodeURIComponent(id)}`),
    onSuccess: invalidateHidden,
  });

  if (isLoading) return <PageLoader variant="activites" />;
  if (isError) return <div className="card text-sm text-slate-400">Impossible de charger les activités.</div>;

  const favorites = favData?.activities ?? [];
  const favIds = new Set(favorites.map((f) => f.id));
  const toggleFav = (a: Activity) => (favIds.has(a.id) ? removeFav.mutate(a.id) : addFav.mutate(a));

  // L'API exclut déjà les activités retenues, mais son rafraîchissement va
  // interroger OpenAgenda et les flux RSS : on filtre aussi ici pour que la
  // carte disparaisse dès le clic sur le cœur.
  const activities = (data?.activities ?? []).filter((a) => !favIds.has(a.id));

  const card = (a: Activity) => {
    const fav = favIds.has(a.id);
    return (
      <div key={a.id} className="card flex flex-col overflow-hidden p-0">
        <ActivityImage src={a.imageUrl} />
        {/* `.card` n'est pas dans un @layer : son `p-4` s'applique malgré `p-0`.
            On ne remet donc qu'un espacement vertical, sinon le texte serait plus
            resserré que l'image. */}
        <div className="flex flex-1 flex-col gap-1.5 pt-4">
          <div className="text-xs font-medium text-brand-600">{dateRange(a)}</div>
          <div className="font-semibold leading-tight">{a.title}</div>
          <div className="text-xs text-slate-400">
            📍 {a.city}
            {a.address && a.address !== a.city ? ` · ${a.address}` : ""}
          </div>
          {a.description && (
            <p className="mt-1 line-clamp-4 text-sm text-slate-600 dark:text-slate-300">
              {a.description}
            </p>
          )}
          {a.url && (
            <a
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 text-xs font-medium text-brand-600 hover:underline"
            >
              En savoir plus →
            </a>
          )}
          {/* Actions en 2 colonnes : icône au-dessus, libellé en dessous */}
          <div className="mt-auto grid grid-cols-2 gap-1 pt-3">
            <button
              onClick={() => hide.mutate(a)}
              title="Ne plus me proposer"
              className="flex flex-col items-center gap-0.5 text-slate-400 transition hover:text-red-500"
            >
              <span className="text-lg leading-none">🚫</span>
              <span className="text-[11px] font-medium leading-none">Masqué</span>
            </button>
            <button
              onClick={() => toggleFav(a)}
              title={fav ? "Retirer des favoris" : "Ajouter aux favoris"}
              className="group flex flex-col items-center gap-0.5 transition"
            >
              {/* Au survol, on montre l'état inverse : aperçu de ce que fera le clic. */}
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
                À faire
              </span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (view === "a-faire") {
    return (
      <div className="space-y-3">
        <p className="text-xs text-slate-400">
          Activités mises de côté. Les marquer 🚫 « Masqué » les retire de cette liste.
        </p>
        {favorites.length === 0 ? (
          <div className="card text-sm text-slate-400">
            Aucune activité à faire — ajoutez-en depuis les propositions avec ♡.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{favorites.map(card)}</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        Événements à venir (30 prochains jours) autour de chez vous. Sources : OpenAgenda + flux
        RSS des sites de villes. Gère les villes et flux suivis dans les Réglages.
      </p>
      {activities.length === 0 ? (
        <div className="card text-sm text-slate-400">Aucune activité à venir trouvée pour le moment.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{activities.map(card)}</div>
      )}

      {(hiddenData?.activities ?? []).length > 0 && (
        <div className="space-y-3 border-t-2 border-slate-200 pt-5 dark:border-slate-700">
          <button
            onClick={() => setShowHidden((v) => !v)}
            className="flex items-center gap-2 text-lg font-bold"
          >
            🚫 Masquées ({hiddenData!.activities.length})
            <span className="text-sm text-slate-400">{showHidden ? "▾" : "▸"}</span>
          </button>
          {showHidden && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {hiddenData!.activities.map((a) => (
                <div key={a.id} className="card flex flex-col overflow-hidden p-0">
                  <ActivityImage src={a.imageUrl} dim />
                  <div className="flex flex-1 flex-col gap-1.5 p-4">
                    <div className="text-xs font-medium text-brand-600">{dateRange(a)}</div>
                    <div className="font-semibold leading-tight">{a.title}</div>
                    <div className="text-xs text-slate-400">📍 {a.city}</div>
                    <button
                      onClick={() => unhide.mutate(a.id)}
                      className="mt-auto pt-2 text-left text-xs font-medium text-brand-600 hover:underline"
                    >
                      ↩︎ Re-proposer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

