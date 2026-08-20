import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SheetItem } from "../components/ui";
import { SubNav, FilterChips, ActionSheet } from "../components/ui";
import {
  IconBan,
  IconExternal,
  IconHeart,
  IconMapPin,
  IconMore,
  IconUndo,
} from "../components/icons";
import { api } from "../lib/api";
import PageLoader from "../components/PageLoader";
import { usePageHeader, usePageTabs } from "../components/PageHeader";

/**
 * Activités. Films, Vacances et WishList ont leur propre menu
 * ([`Films.tsx`](./Films.tsx), [`Vacances.tsx`](./Vacances.tsx),
 * [`Listes.tsx`](./Listes.tsx)).
 */
type Tab = "a-faire" | "propositions" | "historique";
const TABS: { id: Tab; label: string }[] = [
  { id: "a-faire", label: "À faire" },
  { id: "propositions", label: "Propositions" },
  { id: "historique", label: "Historique" },
];

export default function Tools() {
  const navigate = useNavigate();
  const { tab: tabParam } = useParams();
  const tab: Tab = TABS.some((t) => t.id === tabParam) ? (tabParam as Tab) : "propositions";
  usePageTabs(tab, TABS.map((t) => ({ value: t.id, label: t.label })), (v) =>
    navigate(`/tools/${v}`),
  );

  return (
    <div className="flex flex-col gap-3 pb-28 md:pb-0">
      <SubNav
        value={tab}
        onChange={(v) => navigate(`/tools/${v}`)}
        items={TABS.map((t) => ({ value: t.id, label: t.label }))}
        className="hidden md:block"
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

const WEEKDAYS = ["DIM", "LUN", "MAR", "MER", "JEU", "VEN", "SAM"];

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

function dateRange(a: Activity): string {
  if (!a.start) return a.dateLabel ?? "";
  const start = fmt(a.start);
  const end = a.end ? fmt(a.end) : null;
  if (!end || end === start) return `Le ${start}`;
  return `Du ${start} au ${end}`;
}

/** Itinéraire vers le lieu : lien universel, ouvre l'app Plans si installée. */
function mapsHref(a: Activity): string | null {
  const dest = [a.address, a.city].filter(Boolean).join(", ");
  return dest ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}` : null;
}

/**
 * Combien de jours avant la fin, pour les sorties qui **durent** (une exposition,
 * un festival). Sur un événement d'une journée, le bloc de date le dit déjà :
 * y ajouter « se termine dans 3 j » serait redondant et un peu alarmiste.
 */
function daysLeft(a: Activity): number | null {
  if (!a.start || !a.end) return null;
  const start = new Date(a.start);
  const end = new Date(a.end);
  if (Number.isNaN(end.getTime()) || start.toDateString() === end.toDateString()) return null;
  return Math.ceil((end.getTime() - Date.now()) / 86_400_000);
}

/** « Jusqu'au 20 août » quand c'est déjà commencé, sinon la plage complète. */
function whenLabel(a: Activity): string {
  if (!a.start) return a.dateLabel ?? "";
  const short = (iso: string) =>
    new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  if (a.end && new Date(a.start) <= new Date() && new Date(a.end) >= new Date()) {
    return `Jusqu'au ${short(a.end)}`;
  }
  return dateRange(a);
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Le prochain samedi et dimanche (aujourd'hui compris si on y est déjà). */
function weekendRange(): [Date, Date] {
  const now = startOfDay(new Date());
  const dow = now.getDay(); // 0 = dimanche
  const toSat = dow === 0 ? -1 : 6 - dow;
  const sat = new Date(now);
  sat.setDate(now.getDate() + toSat);
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  sun.setHours(23, 59, 59);
  return [sat, sun];
}

/**
 * Bloc de date d'une sortie : jour de la semaine, quantième, mois ou heure.
 * Aligné à gauche de la ligne — c'est la première chose qu'on lit d'une sortie.
 */
function DateBlock({ iso }: { iso: string }) {
  const d = new Date(iso);
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  return (
    <span className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-surface-2 leading-none">
      <span className="text-2xs font-semibold uppercase tracking-wide text-ink-3">
        {WEEKDAYS[d.getDay()]}
      </span>
      <span className="mt-0.5 text-lg font-bold">{d.getDate()}</span>
      <span className="mt-0.5 text-2xs text-ink-3">
        {hasTime
          ? `${d.getHours()} h${d.getMinutes() ? String(d.getMinutes()).padStart(2, "0") : ""}`
          : d.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "")}
      </span>
    </span>
  );
}

/**
 * Visuel d'une carte activité : image de l'événement, ou état vide (icône
 * calendrier sur fond neutre) si absente ou en erreur — les cartes gardent
 * ainsi toutes la même hauteur.
 */
function ActivityImage({
  src,
  dim,
  className = "h-44 w-full rounded-t-2xl",
}: {
  src: string | null;
  dim?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={`${className} flex items-center justify-center bg-surface-2`}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className="h-10 w-10 text-ink-3"
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
      className={`${className} object-cover${dim ? " opacity-80" : ""}`}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Grille des cartes pleines : une colonne sur mobile, jusqu'à 4 par rangée sur
 * ordinateur (la zone de contenu plafonne à `max-w-5xl` → ~240 px par carte à
 * partir de `xl`, en dessous on retombe à 3 puis 2 pour garder l'affiche et le
 * titre lisibles).
 */
const heroGrid = "grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

type TimeFilter = "tout" | "week-end" | "semaine";

function Activites({ view }: { view: Tab }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sheet, setSheet] = useState<Activity | null>(null);
  const [when, setWhen] = useState<TimeFilter>("tout");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["activities"],
    queryFn: () => api.get<{ activities: Activity[] }>("/api/activities"),
    staleTime: 30 * 60 * 1000,
    retry: false,
    enabled: view === "propositions",
  });
  const { data: favData } = useQuery({
    queryKey: ["activity-favorites"],
    queryFn: () => api.get<{ activities: Activity[] }>("/api/activities/favorites"),
  });
  const { data: hiddenData } = useQuery({
    queryKey: ["activity-hidden"],
    queryFn: () => api.get<{ activities: Activity[] }>("/api/activities/hidden"),
    enabled: view === "historique",
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["activity-favorites"] });
    qc.invalidateQueries({ queryKey: ["activity-hidden"] });
    // Une activité retenue ou masquée quitte les propositions (filtré côté API).
    qc.invalidateQueries({ queryKey: ["activities"] });
  };
  const snapshot = (a: Activity) => ({
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
  });
  const addFav = useMutation({
    mutationFn: (a: Activity) => api.post("/api/activities/favorites", snapshot(a)),
    onSuccess: invalidate,
  });
  const removeFav = useMutation({
    mutationFn: (id: string) => api.del(`/api/activities/favorites/${encodeURIComponent(id)}`),
    onSuccess: invalidate,
  });
  const hide = useMutation({
    mutationFn: (a: Activity) => api.post("/api/activities/hidden", snapshot(a)),
    onSuccess: invalidate,
  });
  const unhide = useMutation({
    mutationFn: (id: string) => api.del(`/api/activities/hidden/${encodeURIComponent(id)}`),
    onSuccess: invalidate,
  });

  const favorites = favData?.activities ?? [];
  const favIds = new Set(favorites.map((f) => f.id));
  const hidden = hiddenData?.activities ?? [];
  // L'API exclut déjà les activités retenues, mais son rafraîchissement
  // interroge OpenAgenda et les flux RSS : on filtre aussi ici pour que la
  // carte disparaisse dès le clic sur le cœur.
  const all = (data?.activities ?? []).filter((a) => !favIds.has(a.id));

  const dated = favorites.filter((a) => a.start);
  usePageHeader(
    "Activités",
    view === "historique"
      ? `${hidden.length} masquée${hidden.length > 1 ? "s" : ""}`
      : view === "a-faire"
        ? `${favorites.length} retenue${favorites.length > 1 ? "s" : ""}${
            dated.length > 0 ? ` · ${dated.length} datée${dated.length > 1 ? "s" : ""}` : ""
          }`
        : `${all.length} sortie${all.length > 1 ? "s" : ""} dans les 30 jours`,
  );

  /** Le lieu et, s'il reste peu de temps, l'urgence. */
  const placeLine = (a: Activity) => {
    const left = daysLeft(a);
    return (
      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
        <span className="inline-flex items-center gap-1">
          <IconMapPin size={13} />
          {a.city || a.address || "Lieu non précisé"}
        </span>
        {left != null && left >= 0 && left <= 7 && (
          <span className="text-warning">
            {left === 0 ? "se termine aujourd'hui" : `se termine dans ${left} j`}
          </span>
        )}
      </span>
    );
  };

  const sheetItems = (a: Activity): SheetItem[] => {
    const maps = mapsHref(a);
    const fav = favIds.has(a.id);
    const isHidden = hidden.some((h) => h.id === a.id);
    return [
      ...(maps
        ? [
            {
              label: "Ouvrir l'itinéraire",
              hint: a.address || a.city,
              icon: <IconMapPin size={20} />,
              onClick: () => window.open(maps, "_blank", "noopener,noreferrer"),
            },
          ]
        : []),
      ...(a.url
        ? [
            {
              label: "Voir la page de l'événement",
              icon: <IconExternal size={20} />,
              onClick: () => window.open(a.url!, "_blank", "noopener,noreferrer"),
            },
          ]
        : []),
      ...(isHidden
        ? [
            {
              label: "Remettre dans les propositions",
              icon: <IconUndo size={20} />,
              onClick: () => unhide.mutate(a.id),
            },
          ]
        : [
            ...(fav
              ? [
                  {
                    label: "Retirer de À faire",
                    icon: <IconHeart size={20} />,
                    onClick: () => removeFav.mutate(a.id),
                  },
                ]
              : []),
            {
              label: "Ne plus proposer",
              hint: "retirée des propositions futures",
              icon: <IconBan size={20} />,
              danger: true,
              onClick: () => hide.mutate(a),
            },
          ]),
    ];
  };

  /** Carte pleine : l'affiche vend la sortie. Réservée à ce qui est imminent. */
  const heroCard = (a: Activity, primary: "fav" | "itineraire") => {
    const maps = mapsHref(a);
    return (
      <div key={a.id} className="card flex flex-col" style={{ padding: 0 }}>
        <div className="relative">
          <ActivityImage src={a.imageUrl} />
          {(a.start || a.dateLabel) && (
            <span className="absolute left-2 top-2 rounded-md bg-black/70 px-2 py-1 text-2xs font-semibold text-white backdrop-blur">
              {whenLabel(a) || a.dateLabel}
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1 px-4 pb-4 pt-3">
          <div className="text-base font-semibold leading-snug">{a.title}</div>
          {placeLine(a)}
          {a.description && (
            <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-slate-400">
              {a.description}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            {primary === "itineraire" && maps ? (
              <a
                href={maps}
                target="_blank"
                rel="noreferrer"
                className="flex h-[52px] min-w-0 flex-1 items-center justify-center gap-2 rounded-full border border-line bg-surface text-base font-semibold text-ink"
              >
                <IconMapPin size={18} />
                Itinéraire
              </a>
            ) : (
              <button
                type="button"
                onClick={() => (favIds.has(a.id) ? removeFav.mutate(a.id) : addFav.mutate(a))}
                className={`flex h-[52px] min-w-0 flex-1 items-center justify-center gap-2 rounded-full text-base font-semibold ${
                  favIds.has(a.id)
                    ? "border border-line bg-surface text-ink-2"
                    : "bg-brand-600 text-on-brand"
                }`}
              >
                <IconHeart size={18} />
                {favIds.has(a.id) ? "Retirer" : "À faire"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setSheet(a)}
              aria-label={`Autres actions sur ${a.title}`}
              className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border border-line text-ink-2"
            >
              <IconMore size={20} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  /** Rangée compacte : date à gauche, une action à droite. */
  const row = (a: Activity, last: boolean, action: "fav" | "sheet") => (
    <div key={a.id} className={last ? "" : "border-b border-hairline"}>
      <div className="flex items-center gap-3 py-2.5">
        {a.start ? (
          <DateBlock iso={a.start} />
        ) : (
          <ActivityImage src={a.imageUrl} className="h-14 w-14 rounded-xl" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold leading-snug">{a.title}</div>
          {placeLine(a)}
          {!a.start && a.dateLabel && (
            <div className="text-xs text-slate-400">{a.dateLabel}</div>
          )}
        </div>
        {action === "fav" ? (
          <button
            type="button"
            onClick={() => (favIds.has(a.id) ? removeFav.mutate(a.id) : addFav.mutate(a))}
            aria-label={favIds.has(a.id) ? "Retirer de À faire" : "Ajouter à À faire"}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
              favIds.has(a.id) ? "bg-brand-600 text-on-brand" : "bg-surface-2 text-ink-2"
            }`}
          >
            <IconHeart size={20} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setSheet(a)}
            aria-label={`Autres actions sur ${a.title}`}
            className="flex h-tap w-9 shrink-0 items-center justify-center rounded-lg text-ink-2"
          >
            <IconMore size={20} />
          </button>
        )}
      </div>
    </div>
  );

  const section = (title: string, rows: Activity[], render: (a: Activity, last: boolean) => JSX.Element) =>
    rows.length === 0 ? null : (
      <div key={title} className="flex flex-col gap-2">
        <div className="eyebrow">{title}</div>
        <div className="card">{rows.map((a, i) => render(a, i === rows.length - 1))}</div>
      </div>
    );

  if (view === "a-faire") {
    const undated = favorites.filter((a) => !a.start);
    return (
      <>
        {favorites.length === 0 ? (
          <div className="card flex flex-col items-start gap-3 text-sm text-slate-400">
            <p>Aucune activité retenue.</p>
            <button
              type="button"
              onClick={() => navigate("/tools/propositions")}
              className="btn-primary"
            >
              Voir les propositions
            </button>
          </div>
        ) : (
          <>
            {dated.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="eyebrow">Datées · {dated.length}</div>
                <div className={heroGrid}>{dated.map((a) => heroCard(a, "itineraire"))}</div>
              </div>
            )}
            {section(`Sans date · ${undated.length}`, undated, (a, last) => row(a, last, "sheet"))}
          </>
        )}

        {/* Où va quoi : les envies sans lieu ni période vivent ailleurs. */}
        <div className="card mt-1 text-center">
          <div className="text-base font-semibold">Envie de quelque chose qui n'est pas listé ?</div>
          <p className="mt-1 text-sm text-slate-400">
            Les idées sans date vivent dans la WishList ; ici on garde ce qui a un lieu et une
            période.
          </p>
          <button
            type="button"
            onClick={() => navigate("/listes/wishlist")}
            className="btn mt-3"
          >
            Ouvrir la WishList
          </button>
        </div>

        {sheet && (
          <ActionSheet
            title={sheet.title}
            subtitle={[dateRange(sheet), sheet.city].filter(Boolean).join(" · ")}
            thumbnail={<ActivityImage src={sheet.imageUrl} className="h-12 w-12 rounded-lg" />}
            items={sheetItems(sheet)}
            onClose={() => setSheet(null)}
          />
        )}
      </>
    );
  }

  if (view === "historique") {
    return (
      <>
        {hidden.length === 0 ? (
          <div className="card text-sm text-slate-400">Aucune activité masquée.</div>
        ) : (
          <div className="card">
            {hidden.map((a, i) => (
              <div key={a.id} className={i === hidden.length - 1 ? "" : "border-b border-hairline"}>
                <div className="flex items-center gap-3 py-2.5">
                  <ActivityImage src={a.imageUrl} dim className="h-14 w-14 rounded-xl" />
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-semibold leading-snug">{a.title}</div>
                    {placeLine(a)}
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-2xs font-semibold text-danger">
                      <IconBan size={12} /> Masquée
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => unhide.mutate(a.id)}
                    aria-label={`Re-proposer ${a.title}`}
                    title="Re-proposer"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-2"
                  >
                    <IconUndo size={20} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  if (isLoading) return <PageLoader variant="activites" />;
  if (isError)
    return <div className="card text-sm text-slate-400">Impossible de charger les activités.</div>;

  // Regroupement par période : ce qui a déjà commencé, le week-end qui vient,
  // le reste. C'est la question qu'on se pose devant une liste de sorties.
  const now = new Date();
  const [sat, sun] = weekendRange();
  const endOfWeek = new Date(sun);
  const startsIn = (a: Activity, from: Date, to: Date) => {
    if (!a.start) return false;
    const s = new Date(a.start).getTime();
    return s >= from.getTime() && s <= to.getTime();
  };
  const ongoing = all.filter(
    (a) => a.start && new Date(a.start) <= now && a.end && new Date(a.end) >= now,
  );
  const rest = all.filter((a) => !ongoing.includes(a));
  const thisWeekend = rest.filter((a) => startsIn(a, sat, sun));
  const later = rest.filter((a) => !thisWeekend.includes(a) && a.start);
  const undatedProps = rest.filter((a) => !a.start);

  const matches = (a: Activity) =>
    when === "tout" ||
    (when === "week-end" && (thisWeekend.includes(a) || ongoing.includes(a))) ||
    (when === "semaine" && (ongoing.includes(a) || startsIn(a, now, endOfWeek)));
  const shown = {
    ongoing: ongoing.filter(matches),
    weekend: thisWeekend.filter(matches),
    later: later.filter(matches),
    undated: undatedProps.filter(matches),
  };
  const nothing =
    shown.ongoing.length + shown.weekend.length + shown.later.length + shown.undated.length === 0;

  return (
    <>
      <FilterChips
        value={when}
        onChange={(v) => setWhen(v as TimeFilter)}
        items={[
          { value: "tout", label: "Tout" },
          { value: "week-end", label: "Ce week-end" },
          { value: "semaine", label: "Cette semaine" },
        ]}
      />

      {nothing ? (
        <div className="card text-sm text-slate-400">
          {all.length === 0
            ? "Aucune activité à venir trouvée pour le moment."
            : "Aucune sortie sur cette période."}
        </div>
      ) : (
        <>
          {shown.ongoing.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="eyebrow">En cours</div>
              <div className={heroGrid}>{shown.ongoing.map((a) => heroCard(a, "fav"))}</div>
            </div>
          )}
          {section("Ce week-end", shown.weekend, (a, last) => row(a, last, "fav"))}
          {section("Plus tard", shown.later, (a, last) => row(a, last, "fav"))}
          {section("Sans date précise", shown.undated, (a, last) => row(a, last, "fav"))}
        </>
      )}

      {sheet && (
        <ActionSheet
          title={sheet.title}
          subtitle={[dateRange(sheet), sheet.city].filter(Boolean).join(" · ")}
          thumbnail={<ActivityImage src={sheet.imageUrl} className="h-12 w-12 rounded-lg" />}
          items={sheetItems(sheet)}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  );
}
