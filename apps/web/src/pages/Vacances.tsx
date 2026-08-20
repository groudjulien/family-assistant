import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Trip,
  TripItem,
  TripItemType,
  TransportMode,
  TripExpense,
  TripPackingItem,
  PackingCategory,
  PackingPerson,
} from "@gfa/shared";
import {
  TRANSPORT_MODES,
  TRANSPORT_META,
  PACKING_CATEGORIES,
  PACKING_CATEGORY_META,
  comparePackingItems,
} from "@gfa/shared";
import {
  Select,
  Input,
  Checkbox,
  DateInput,
  DateTimeInput,
  DateRangeCalendar,
  SubNav,
  MobileActionBar,
  OverflowMenu,
  FilterChips,
  FilterButton,
  FilterField,
  FilterModal,
  FilterToggle,
  SearchField,
  ActionSheet,
} from "../components/ui";
import { useToast } from "../components/Toast";
import { MemberAvatar, PersonAvatar, PersonPicker, usePackingPersons } from "../components/MemberAvatar";
import { ExpenseFormModal, type ExpenseFormValues } from "../components/ExpenseForm";
import { useExpenseCategories, categoryMeta } from "../lib/categories";
import { useMe } from "../auth";
import { dateFr, eur, eur0, eurToCents, todayIso } from "../lib/format";
import { api, API_URL, ApiError } from "../lib/api";
import { usePageHeader, usePageTabs, usePageChrome } from "../components/PageHeader";

/* ---------------- Vacances / voyages ---------------- */

const FIELD =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

const mapsUrl = (addr: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;

function fmtDT(s: string | null): string {
  if (!s) return "";
  const hasTime = s.includes("T");
  const d = new Date(hasTime ? s : `${s}T00:00:00`);
  if (isNaN(d.getTime())) return s;
  const date = d.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "short" });
  return hasTime
    ? `${date} ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
    : date;
}

function fmtTime(s: string | null): string {
  if (!s || !s.includes("T")) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Affichage transport : "mar. 23 juin 09:14 → 11:14" si même jour, sinon dates complètes.
function transportWhen(start: string | null, end: string | null): string {
  if (!start) return "";
  if (!end) return fmtDT(start);
  const sameDay = start.slice(0, 10) === end.slice(0, 10);
  return sameDay ? `${fmtDT(start)} → ${fmtTime(end)}` : `${fmtDT(start)} → ${fmtDT(end)}`;
}

function itemIcon(it: TripItem): string {
  // Le mode vient d'une colonne texte : on ne suppose pas qu'il est connu.
  if (it.type === "transport") return (it.mode && TRANSPORT_META[it.mode]?.icon) || "🚗";
  if (it.type === "lodging") return "🏠";
  return "🎯";
}

// Sous-onglets d'un voyage : valise (affaires à prendre), planning, dépenses.
/** Types d'étape d'un planning, dans l'ordre où on les ajoute. */
const ITEM_TYPES: { type: TripItemType; icon: string; label: string }[] = [
  { type: "transport", icon: "🚆", label: "Transport" },
  { type: "lodging", icon: "🏠", label: "Logement" },
  { type: "activity", icon: "🎯", label: "Activité" },
];

/** Onglets de premier niveau de la page (mobile et ordinateur). */
const VACANCES_TABS = [
  { value: "prevu", label: "Prévu" },
  { value: "archive", label: "Archivé" },
];

/** Onglets d'un voyage ouvert (sous-page). */
const TRIP_TABS = [
  { value: "affaires", label: "Affaires" },
  { value: "planning", label: "Planning" },
  { value: "couts", label: "Coûts" },
];
type TripTab = "affaires" | "planning" | "couts";

/** « 29 juin → 16 juil. » — la période, sans jour de semaine ni heure. */
function tripPeriod(t: Trip): string {
  const short = (iso: string) =>
    new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }).replace(".", "");
  if (!t.startDate) return "";
  return t.endDate ? `${short(t.startDate)} → ${short(t.endDate)}` : short(t.startDate);
}

/** « J-16 », « Jour 2 sur 18 », « Terminé » — où en est un voyage. */
function tripCountdown(t: Trip): string | null {
  if (!t.startDate) return null;
  const day = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
  const today = day(todayIso());
  const start = day(t.startDate);
  const end = day(t.endDate ?? t.startDate);
  if (today < start) return `J-${Math.round((start - today) / 86_400_000)}`;
  if (today > end) return "Terminé";
  const total = Math.round((end - start) / 86_400_000) + 1;
  return `Jour ${Math.round((today - start) / 86_400_000) + 1} sur ${total}`;
}

/** Nombre de nuits/jours d'un voyage, pour la ligne de résumé. */
function tripLength(t: Trip): number | null {
  if (!t.startDate) return null;
  const day = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
  return Math.round((day(t.endDate ?? t.startDate) - day(t.startDate)) / 86_400_000) + 1;
}

/** Recherche insensible à la casse et aux accents (« gênes » trouve « Genes »). */
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/**
 * Texte cherchable d'un voyage. Un voyage n'a pas de champ « ville » ni
 * « pays » : ils vivent dans ses étapes (l'adresse d'un logement, les villes de
 * départ et d'arrivée d'un transport), au même endroit que les noms des
 * activités et des logements. On cherche donc dans tout ce texte à la fois.
 */
function tripHaystack(t: Trip, items: TripItem[]): string {
  return norm(
    [
      t.name,
      ...items.flatMap((i) => [i.title, i.address, i.fromPlace, i.toPlace, i.description]),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

export default function Vacances() {
  const navigate = useNavigate();
  const { view, tripId, tab } = useParams();
  const statut: "prevu" | "archive" = view === "archive" ? "archive" : "prevu";
  const { data: trips } = useQuery({ queryKey: ["trips"], queryFn: () => api.get<Trip[]>("/api/trips") });
  const trip = tripId ? (trips ?? []).find((t) => t.id === tripId) : undefined;
  const tripTab: TripTab = (TRIP_TABS.some((t) => t.value === tab) ? tab : "affaires") as TripTab;

  // Un voyage ouvert prend l'écran : ce sont ses onglets qui s'affichent, et la
  // barre du haut porte un retour vers l'index (cf. `TripDetail`).
  usePageTabs(
    tripId ? tripTab : statut,
    tripId ? TRIP_TABS : VACANCES_TABS,
    (v) => navigate(tripId ? `/vacances/${statut}/${tripId}/${v}` : `/vacances/${v}`),
  );

  return (
    <div className="flex flex-col gap-3 pb-28 md:pb-0">
      <SubNav
        value={tripId ? tripTab : statut}
        onChange={(v) => navigate(tripId ? `/vacances/${statut}/${tripId}/${v}` : `/vacances/${v}`)}
        items={tripId ? TRIP_TABS : VACANCES_TABS}
        className="hidden md:block"
      />
      {tripId ? (
        <TripDetail trip={trip} tab={tripTab} backTo={`/vacances/${statut}`} />
      ) : (
        <TripsIndex statut={statut} trips={trips} />
      )}
    </div>
  );
}

/* ---------------- Index : un voyage = une carte d'état ---------------- */

function TripsIndex({ statut, trips }: { statut: "prevu" | "archive"; trips?: Trip[] }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [modal, setModal] = useState<{ trip: Trip | null } | null>(null);
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Période : le voyage doit chevaucher la fenêtre (pas y être contenu — un
  // road trip de trois semaines répond bien à « et en août ? »).
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fDaysMin, setFDaysMin] = useState("");
  const [fDaysMax, setFDaysMax] = useState("");
  const [fBudgetMin, setFBudgetMin] = useState("");
  const [fBudgetMax, setFBudgetMax] = useState("");
  const [fModes, setFModes] = useState<TransportMode[]>([]);

  const list = (trips ?? []).filter((t) => (statut === "archive" ? t.archived : !t.archived));

  /**
   * Les étapes de chaque voyage de l'onglet : elles portent la ville, le pays,
   * les activités, les logements et les modes de transport — donc tout ce sur
   * quoi on cherche et on filtre. Même clé de cache que les cartes, qui les
   * demandent déjà toutes : rien de plus sur le réseau.
   */
  const itemQueries = useQueries({
    queries: list.map((t) => ({
      queryKey: ["trip-items", t.id],
      queryFn: () => api.get<TripItem[]>(`/api/trips/${t.id}/items`),
    })),
  });
  const itemsByTrip = new Map(list.map((t, i) => [t.id, itemQueries[i]?.data ?? []]));

  const hasFilters =
    !!fFrom || !!fTo || !!fDaysMin || !!fDaysMax || !!fBudgetMin || !!fBudgetMax || fModes.length > 0;
  const resetFilters = () => {
    setFFrom("");
    setFTo("");
    setFDaysMin("");
    setFDaysMax("");
    setFBudgetMin("");
    setFBudgetMax("");
    setFModes([]);
  };

  const q = norm(search.trim());
  const matches = (t: Trip) => {
    const items = itemsByTrip.get(t.id) ?? [];
    if (q && !tripHaystack(t, items).includes(q)) return false;
    const start = t.startDate?.slice(0, 10) ?? null;
    const end = (t.endDate ?? t.startDate)?.slice(0, 10) ?? null;
    if (fFrom && (!end || end < fFrom)) return false;
    if (fTo && (!start || start > fTo)) return false;
    const days = tripLength(t);
    if (fDaysMin && (days == null || days < Number(fDaysMin))) return false;
    if (fDaysMax && (days == null || days > Number(fDaysMax))) return false;
    // Un voyage sans budget saisi ne peut pas répondre à une borne de budget.
    if (fBudgetMin && (t.budget == null || t.budget < eurToCents(Number(fBudgetMin)))) return false;
    if (fBudgetMax && (t.budget == null || t.budget > eurToCents(Number(fBudgetMax)))) return false;
    if (
      fModes.length > 0 &&
      !items.some((i) => i.type === "transport" && i.mode && fModes.includes(i.mode))
    )
      return false;
    return true;
  };
  const shown = list.filter(matches);
  const narrowed = !!q || hasFilters;
  // Le prochain départ décide du sur-titre : c'est l'information qu'on vient
  // chercher en ouvrant la page.
  const today = todayIso();
  const dated = list.filter((t) => t.startDate).sort((a, b) => a.startDate!.localeCompare(b.startDate!));
  const ongoing = dated.find(
    (t) => t.startDate!.slice(0, 10) <= today && (t.endDate ?? t.startDate)!.slice(0, 10) >= today,
  );
  const next = dated.find((t) => t.startDate!.slice(0, 10) > today);
  const days = next
    ? Math.round(
        (Date.parse(`${next.startDate!.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
          86_400_000,
      )
    : null;
  usePageHeader(
    "Vacances",
    // Une recherche en cours répond à sa propre question : combien de voyages
    // elle laisse. Le prochain départ ne redevient le sur-titre qu'après.
    narrowed
      ? `${shown.length} voyage${shown.length > 1 ? "s" : ""} sur ${list.length}`
      : ongoing
        ? `${ongoing.name} · en cours`
        : days !== null
          ? `${next!.name} dans ${days} jour${days > 1 ? "s" : ""}`
          : statut === "archive"
            ? `${list.length} voyage${list.length > 1 ? "s" : ""} archivé${list.length > 1 ? "s" : ""}`
            : "0 voyage prévu",
  );

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/trips/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trips"] }),
  });

  return (
    <>
      {list.length > 0 && (
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Voyage, ville, pays, activité, logement…"
          trailing={<FilterButton active={hasFilters} onClick={() => setFiltersOpen(true)} />}
        />
      )}

      {list.length === 0 ? (
        <div className="card flex flex-col items-start gap-3 text-sm text-slate-400">
          <p>{statut === "archive" ? "Aucun voyage archivé." : "Aucun voyage prévu."}</p>
          {statut === "prevu" && (
            <button type="button" onClick={() => setModal({ trip: null })} className="btn-primary">
              Créer le premier
            </button>
          )}
        </div>
      ) : shown.length === 0 ? (
        <div className="card flex flex-col items-start gap-3 text-sm text-slate-400">
          <p>Aucun voyage ne correspond {q ? "à cette recherche" : "à ces filtres"}.</p>
          <button
            type="button"
            onClick={() => {
              setSearch("");
              resetFilters();
            }}
            className="btn"
          >
            Tout afficher
          </button>
        </div>
      ) : (
        shown.map((t) => (
          <TripStateCard
            key={t.id}
            trip={t}
            onOpen={() => navigate(`/vacances/${statut}/${t.id}/affaires`)}
            onEdit={() => setModal({ trip: t })}
          />
        ))
      )}

      {filtersOpen && (
        <FilterModal
          onClose={() => setFiltersOpen(false)}
          onReset={hasFilters ? resetFilters : undefined}
          summary={`${shown.length} / ${list.length} voyage${list.length > 1 ? "s" : ""}`}
        >
          <div className="grid grid-cols-2 gap-3">
            <FilterField label="Période — à partir du">
              <DateInput value={fFrom} onChange={setFFrom} placeholder="Peu importe" />
            </FilterField>
            <FilterField label="Jusqu'au">
              <DateInput value={fTo} onChange={setFTo} placeholder="Peu importe" />
            </FilterField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FilterField label="Durée min. (jours)">
              <Input
                type="number"
                min={1}
                inputMode="numeric"
                value={fDaysMin}
                onChange={(e) => setFDaysMin(e.target.value)}
                placeholder="—"
              />
            </FilterField>
            <FilterField label="Durée max. (jours)">
              <Input
                type="number"
                min={1}
                inputMode="numeric"
                value={fDaysMax}
                onChange={(e) => setFDaysMax(e.target.value)}
                placeholder="—"
              />
            </FilterField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FilterField label="Budget min. (€)">
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                value={fBudgetMin}
                onChange={(e) => setFBudgetMin(e.target.value)}
                placeholder="—"
              />
            </FilterField>
            <FilterField label="Budget max. (€)">
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                value={fBudgetMax}
                onChange={(e) => setFBudgetMax(e.target.value)}
                placeholder="—"
              />
            </FilterField>
          </div>
          <div>
            <div className="text-xs text-slate-400">Type de transport</div>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {TRANSPORT_MODES.map((m) => (
                <FilterToggle
                  key={m}
                  active={fModes.includes(m)}
                  onClick={() =>
                    setFModes(
                      fModes.includes(m) ? fModes.filter((x) => x !== m) : [...fModes, m],
                    )
                  }
                >
                  {TRANSPORT_META[m].icon} {TRANSPORT_META[m].label}
                </FilterToggle>
              ))}
            </div>
            {fModes.length > 0 && (
              <p className="mt-1.5 text-xs text-slate-400">
                Voyages dont le planning contient au moins un de ces transports.
              </p>
            )}
          </div>
        </FilterModal>
      )}

      <MobileActionBar label="Nouveau voyage" onClick={() => setModal({ trip: null })} />
      <div className="hidden justify-end md:flex">
        <button onClick={() => setModal({ trip: null })} className="btn-primary">
          + Créer un voyage
        </button>
      </div>

      {modal && (
        <TripModal
          trip={modal.trip}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            qc.invalidateQueries({ queryKey: ["trips"] });
          }}
          onDelete={
            modal.trip
              ? () => {
                  if (confirm(`Supprimer le voyage « ${modal.trip!.name} » ?`)) {
                    remove.mutate(modal.trip!.id);
                    setModal(null);
                  }
                }
              : undefined
          }
        />
      )}
    </>
  );
}

/**
 * Carte d'état d'un voyage : où il en est (préparatifs, budget, prochaine
 * étape) et une seule porte d'entrée — « Ouvrir ». Les compteurs sont
 * l'intérêt de la carte : sans eux elle ne dirait que ce que dit son titre.
 */
function TripStateCard({
  trip: t,
  onOpen,
  onEdit,
}: {
  trip: Trip;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const { data: packing } = useQuery({
    queryKey: ["trip-packing", t.id],
    queryFn: () => api.get<TripPackingItem[]>(`/api/trips/${t.id}/packing`),
  });
  const { data: expenses } = useQuery({
    queryKey: ["trip-expenses", t.id],
    queryFn: () => api.get<TripExpense[]>(`/api/trips/${t.id}/expenses`),
  });
  const { data: items } = useQuery({
    queryKey: ["trip-items", t.id],
    queryFn: () => api.get<TripItem[]>(`/api/trips/${t.id}/items`),
  });

  const packed = (packing ?? []).filter((i) => i.checked).length;
  const nPacking = (packing ?? []).length;
  // Une dépense est stockée en négatif (argent qui sort) : sur la carte on lit
  // « 511 € / 450 € », pas « -511 € » — le libellé « Budget » dit déjà le sens.
  const spent = (expenses ?? []).reduce((s, e) => s + Math.abs(e.amount), 0);
  const countdown = tripCountdown(t);
  const length = tripLength(t);
  // Première étape à venir : ce qu'on a besoin de savoir avant de partir.
  const nextItem = (items ?? [])
    .filter((i) => i.startAt)
    .sort((a, b) => a.startAt!.localeCompare(b.startAt!))[0];
  const nothingYet = nPacking === 0 && (items ?? []).length === 0 && (expenses ?? []).length === 0;

  const bar = (done: number, total: number, color: string) => (
    <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-2">
      <span
        className={`block h-full rounded-full ${color}`}
        style={{ width: `${total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0}%` }}
      />
    </span>
  );

  return (
    <div className="card">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-xl leading-none"
        >
          {t.emoji || "\u2708\ufe0f"}
        </span>
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-xl font-bold">{t.name}</span>
            {countdown && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-2xs font-semibold text-ink-2">
                {countdown}
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-sm text-slate-400">
            {[tripPeriod(t), length ? `${length} jours` : null].filter(Boolean).join(" · ")}
          </span>
        </button>
        <OverflowMenu
          label={`Actions sur ${t.name}`}
          items={[{ label: "Modifier le voyage", onClick: onEdit }]}
        />
      </div>

      {nothingYet ? (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-hairline pt-3">
          <span className="text-sm text-slate-400">Rien de préparé pour l'instant</span>
          <button type="button" onClick={onOpen} className="btn shrink-0">
            Commencer
          </button>
        </div>
      ) : (
        <>
          <div className="mt-3 border-t border-hairline pt-3">
            {nPacking > 0 && (
              <div className="mb-3">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span>Affaires à prendre</span>
                  <span className="font-semibold tabular-nums">
                    {packed} / {nPacking}
                  </span>
                </div>
                {bar(packed, nPacking, "bg-brand-600")}
              </div>
            )}
            {t.budget != null && t.budget > 0 && (
              <div>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span>Budget</span>
                  <span className="font-semibold tabular-nums">
                    {eur0(spent)} / {eur0(t.budget)}
                  </span>
                </div>
                {bar(spent, t.budget, spent > t.budget ? "bg-warning" : "bg-brand-600")}
              </div>
            )}
          </div>

          {nextItem && (
            <div className="mt-3 flex items-center gap-3 rounded-xl bg-surface-2 p-3">
              <span aria-hidden="true" className="text-xl leading-none">
                {itemIcon(nextItem)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{nextItem.title}</span>
                <span className="block truncate text-xs text-slate-400">
                  première étape · {fmtDT(nextItem.startAt)}
                </span>
              </span>
            </div>
          )}

          <button type="button" onClick={onOpen} className="btn-primary mt-3 w-full">
            Ouvrir
          </button>
        </>
      )}
    </div>
  );
}

/* ---------------- Affaires à prendre (onglet valise) ---------------- */

/**
 * Affaires à prendre. Une todo groupée par catégorie, filtrable par personne :
 * ce qu'on regarde en faisant les valises, c'est « qu'est-ce qu'il reste pour
 * Gaël », pas la liste entière.
 */
function TripPacking({ tripId }: { tripId: string }) {
  const qc = useQueryClient();
  const me = useMe();
  const [adding, setAdding] = useState(false);
  const [person, setPerson] = useState<PackingPerson>("famille");
  const packingPersons = usePackingPersons();
  const personIds = packingPersons.map((p) => p.id);

  const { data: items } = useQuery({
    queryKey: ["trip-packing", tripId],
    queryFn: () => api.get<TripPackingItem[]>(`/api/trips/${tripId}/packing`),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["trip-packing", tripId] });

  const add = useMutation({
    mutationFn: (v: { label: string; category: PackingCategory; person: PackingPerson }) =>
      api.post(`/api/trips/${tripId}/packing`, v),
    onSuccess: () => {
      setAdding(false);
      invalidate();
    },
  });
  const toggle = useMutation({
    mutationFn: (it: TripPackingItem) =>
      api.patch(`/api/trips/packing/${it.id}`, { checked: !it.checked }),
    onSuccess: invalidate,
  });
  const setPersonOf = useMutation({
    mutationFn: (v: { id: string; person: PackingPerson }) =>
      api.patch(`/api/trips/packing/${v.id}`, { person: v.person }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/trips/packing/${id}`),
    onSuccess: invalidate,
  });
  const fromDefault = useMutation({
    mutationFn: () => api.post<{ added: number }>(`/api/trips/${tripId}/packing/from-default`),
    onSuccess: invalidate,
  });

  const list = items ?? [];
  const done = list.filter((i) => i.checked).length;
  const hasDefault = (me.defaultPacking ?? []).length > 0;
  // Le filtre garde ce qui concerne la personne **et** ce qui concerne tout le
  // monde : une brosse à dents « Famille » est aussi l'affaire de Gaël.
  const shown = list.filter(
    (i) => person === "famille" || i.person === person || i.person === "famille",
  );
  const groups = PACKING_CATEGORIES.map((cat) => ({
    cat,
    items: shown
      .filter((i) => i.category === cat)
      .sort((a, b) => comparePackingItems(a, b, personIds)),
  })).filter((g) => g.items.length > 0);

  const labelOf = (id: string) => packingPersons.find((p) => p.id === id)?.label ?? id;

  if (list.length === 0) {
    return (
      <>
        <div className="card flex flex-col items-start gap-3 text-sm text-slate-400">
          <p>Rien à prendre pour l'instant.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setAdding(true)} className="btn-primary">
              Ajouter la première
            </button>
            {hasDefault && (
              <button
                type="button"
                onClick={() => fromDefault.mutate()}
                disabled={fromDefault.isPending}
                className="btn"
              >
                Partir de ma liste par défaut
              </button>
            )}
          </div>
        </div>
        {adding && (
          <PackingAddModal
            persons={packingPersons}
            onClose={() => setAdding(false)}
            onSubmit={(v) => add.mutate(v)}
          />
        )}
      </>
    );
  }

  return (
    <>
      {/* Où en sont les valises : un chiffre, ce qu'il reste, une jauge. */}
      <div className="card">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-base font-semibold">
            {done} affaire{done > 1 ? "s" : ""} sur {list.length} préparée
            {done > 1 ? "s" : ""}
          </span>
          <span className="shrink-0 text-sm text-slate-400">reste {list.length - done}</span>
        </div>
        <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-surface-2">
          <span
            className="block h-full rounded-full bg-brand-600"
            style={{ width: `${Math.round((done / list.length) * 100)}%` }}
          />
        </span>
      </div>

      <FilterChips
        value={person}
        onChange={setPerson}
        items={packingPersons.map((p) => ({
          value: p.id,
          label: p.id === "famille" ? "Tout" : p.label,
          icon: p.id === "famille" ? undefined : <PersonAvatar id={p.id} className="h-5 w-5 text-2xs" />,
        }))}
      />

      {groups.length === 0 ? (
        <div className="card text-sm text-slate-400">
          Rien à préparer pour {labelOf(person)}.
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.cat} className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <span className="eyebrow">{PACKING_CATEGORY_META[g.cat].label}</span>
              <span className="text-xs text-slate-400">
                {g.items.filter((i) => i.checked).length}/{g.items.length}
              </span>
            </div>
            <div className="card">
              {g.items.map((it, i) => (
                <div
                  key={it.id}
                  className={`flex min-h-[52px] items-center gap-3 ${
                    i === g.items.length - 1 ? "" : "border-b border-hairline"
                  }`}
                >
                  <Checkbox size="lg" checked={it.checked} onChange={() => toggle.mutate(it)} />
                  <button
                    type="button"
                    onClick={() => toggle.mutate(it)}
                    className={`min-w-0 flex-1 py-2 text-left text-base ${
                      it.checked ? "text-slate-400 line-through" : ""
                    }`}
                  >
                    {it.label}
                  </button>
                  {/* La pastille dit pour qui, et permet d'en changer. */}
                  <PersonPicker
                    value={it.person}
                    onChange={(p) => setPersonOf.mutate({ id: it.id, person: p })}
                    showName
                    className={`h-5 w-5 text-2xs ${it.checked ? "opacity-50" : ""}`}
                  />
                  <OverflowMenu
                    label={`Actions sur ${it.label}`}
                    items={[
                      { label: "Retirer de la liste", danger: true, onClick: () => remove.mutate(it.id) },
                    ]}
                  />
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {hasDefault && (
        <button
          type="button"
          onClick={() => fromDefault.mutate()}
          disabled={fromDefault.isPending}
          className="px-1 text-left text-xs text-slate-400 underline"
        >
          Ajouter les affaires de ma liste par défaut
        </button>
      )}

      <MobileActionBar label="Ajouter une affaire" onClick={() => setAdding(true)} />
      <div className="hidden justify-end md:flex">
        <button type="button" onClick={() => setAdding(true)} className="btn-primary">
          + Ajouter une affaire
        </button>
      </div>

      {adding && (
        <PackingAddModal
          persons={packingPersons}
          onClose={() => setAdding(false)}
          onSubmit={(v) => add.mutate(v)}
        />
      )}
    </>
  );
}

/** Ajout d'une affaire : le libellé, sa catégorie, pour qui. */
function PackingAddModal({
  persons,
  onClose,
  onSubmit,
}: {
  persons: { id: string; label: string }[];
  onClose: () => void;
  onSubmit: (v: { label: string; category: PackingCategory; person: PackingPerson }) => void;
}) {
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<PackingCategory>("vetements");
  const [person, setPerson] = useState<PackingPerson>("famille");
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          const v = label.trim();
          if (!v) return;
          onSubmit({ label: v, category, person });
        }}
        className="card w-full max-w-sm space-y-3"
      >
        <div className="font-semibold">Ajouter une affaire</div>
        <Input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Crème solaire, chargeur…"
        />
        <Select
          value={category}
          onChange={(v) => setCategory(v as PackingCategory)}
          options={PACKING_CATEGORIES.map((cat) => ({
            value: cat,
            label: `${PACKING_CATEGORY_META[cat].icon} ${PACKING_CATEGORY_META[cat].label}`,
          }))}
        />
        <Select
          value={person}
          onChange={(v) => setPerson(v as PackingPerson)}
          options={persons.map((p) => ({
            value: p.id,
            label: p.label,
            icon: <PersonAvatar id={p.id} className="h-5 w-5 text-2xs" />,
          }))}
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Annuler
          </button>
          <button type="submit" className="btn-primary" disabled={!label.trim()}>
            Ajouter
          </button>
        </div>
      </form>
    </div>
  );
}

// Ligne de dépense : crayon (ordinateur) + double-clic (mobile) pour éditer.
// Sous-onglet « Argent » d'un voyage : dépenses sur place, par jour, + totaux.
function TripExpenses({ trip }: { trip: Trip }) {
  const qc = useQueryClient();
  const me = useMe();
  const members = me.household.members;
  const cats = useExpenseCategories();
  const [modal, setModal] = useState<{ item: TripExpense | null } | null>(null);

  const { data } = useQuery({
    queryKey: ["trip-expenses", trip.id],
    queryFn: () => api.get<TripExpense[]>(`/api/trips/${trip.id}/expenses`),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["trip-expenses", trip.id] });

  const create = useMutation({
    mutationFn: (v: ExpenseFormValues) => api.post(`/api/trips/${trip.id}/expenses`, v),
    onSuccess: () => {
      setModal(null);
      invalidate();
    },
  });
  const update = useMutation({
    mutationFn: ({ id, v }: { id: string; v: ExpenseFormValues }) =>
      api.patch(`/api/trips/expenses/${id}`, v),
    onSuccess: () => {
      setModal(null);
      invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/trips/expenses/${id}`),
    onSuccess: invalidate,
  });

  const expenses = data ?? [];
  const sum = (rows: TripExpense[]) => rows.reduce((s, e) => s + Math.abs(e.amount), 0);

  const filtered = expenses;

  const byDate = new Map<string, TripExpense[]>();
  for (const e of filtered) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date)!.push(e);
  }
  const days = [...byDate.keys()].sort((a, b) => b.localeCompare(a)); // récent (aujourd'hui) en haut
  const totalA = sum(filtered.filter((e) => e.paidBy === "a"));
  const totalB = sum(filtered.filter((e) => e.paidBy === "b"));
  const total = totalA + totalB;
  const fullTotal = sum(expenses);
  const pct = (amt: number) => (total > 0 ? Math.round((amt / total) * 100) : 0);

  // Totaux par catégorie (sans catégorie = divers), du plus gros poste au plus petit.
  const categoryRows = (() => {
    const byCat = new Map<string, number>();
    for (const e of filtered) {
      const key = e.category ?? "divers";
      byCat.set(key, (byCat.get(key) ?? 0) + Math.abs(e.amount));
    }
    return [...byCat.entries()].filter(([, amt]) => amt > 0).sort((a, b) => b[1] - a[1]);
  })();

  // Budget : restant + par jour sur le reste du voyage (sur le total complet).
  const budget = trip.budget;
  const remaining = budget != null ? budget - fullTotal : null;
  const todayYmd = new Date().toLocaleDateString("sv-SE");
  const remainingStart = trip.startDate && trip.startDate > todayYmd ? trip.startDate : todayYmd;
  const remainingDays =
    trip.endDate && trip.endDate >= remainingStart
      ? Math.floor(
          (Date.parse(`${trip.endDate}T00:00:00`) - Date.parse(`${remainingStart}T00:00:00`)) /
            86_400_000,
        ) + 1
      : 0;
  const perDay = remaining != null && remainingDays > 0 ? Math.round(remaining / remainingDays) : null;

  // Moyenne journalière = total dépensé / jours passés depuis l'arrivée (borné à aujourd'hui).
  const avgStart = trip.startDate && trip.startDate <= todayYmd ? trip.startDate : null;
  const avgEnd = trip.endDate && trip.endDate < todayYmd ? trip.endDate : todayYmd;
  const daysElapsed = avgStart
    ? Math.floor((Date.parse(`${avgEnd}T00:00:00`) - Date.parse(`${avgStart}T00:00:00`)) / 86_400_000) + 1
    : new Set(expenses.map((e) => e.date)).size;
  const avgPerDay = daysElapsed > 0 ? Math.round(fullTotal / daysElapsed) : null;

  // Catégorie d'une dépense, avec un repli lisible quand elle n'en a pas.
  const catMeta = (key: string | null) =>
    categoryMeta(cats, key) ?? { name: "Divers", icon: "🏷️" };

  return (
    <>
      {/* Le chiffre qui décide : ce qu'il reste. Le reste du bloc l'explique. */}
      {budget != null && budget > 0 ? (
        <div className="card">
          <div className="text-sm text-ink-2">Restant sur {eur0(budget)}</div>
          <div
            className={`mt-1 text-3xl font-bold tabular-nums ${
              (remaining ?? 0) < 0 ? "text-danger" : ""
            }`}
          >
            {eur0(remaining ?? 0)}
          </div>
          <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-surface-2">
            <span
              className={`block h-full rounded-full ${fullTotal > budget ? "bg-danger" : "bg-brand-600"}`}
              style={{ width: `${Math.min(100, Math.round((fullTotal / budget) * 100))}%` }}
            />
          </span>
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-hairline pt-3 text-sm">
            <div>
              <div className="text-xs text-slate-400">Dépensé</div>
              <div className="mt-0.5 font-semibold tabular-nums">{eur0(fullTotal)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Par jour</div>
              <div className="mt-0.5 font-semibold tabular-nums">
                {avgPerDay != null ? eur0(avgPerDay) : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Reste / jour</div>
              <div
                className={`mt-0.5 font-semibold tabular-nums ${
                  perDay != null && perDay >= 0 ? "text-brand-600" : "text-danger"
                }`}
              >
                {perDay != null ? eur0(perDay) : "—"}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="text-sm text-ink-2">Dépensé</div>
          <div className="mt-1 text-3xl font-bold tabular-nums">{eur0(fullTotal)}</div>
          <p className="mt-2 text-xs text-slate-400">
            Aucun budget défini pour ce voyage — ajoute-le dans « Modifier le voyage » pour suivre
            ce qu'il reste.
          </p>
        </div>
      )}

      {expenses.length === 0 ? (
        <div className="card flex flex-col items-start gap-3 text-sm text-slate-400">
          <p>Aucune dépense enregistrée.</p>
          <button type="button" onClick={() => setModal({ item: null })} className="btn-primary">
            Ajouter la première
          </button>
        </div>
      ) : (
        <>
          {/* Une section par jour, du plus récent au plus ancien. */}
          {days.map((d) => {
            const rows = byDate.get(d)!;
            return (
              <div key={d} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="eyebrow">
                    {new Date(`${d}T00:00:00`).toLocaleDateString("fr-FR", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}
                  </span>
                  <span className="text-xs font-semibold tabular-nums text-slate-400">
                    {eur(sum(rows))}
                  </span>
                </div>
                <div className="card">
                  {rows.map((e, i) => {
                    const m = catMeta(e.category);
                    return (
                      <div
                        key={e.id}
                        className={`flex min-h-[56px] items-center gap-3 ${
                          i === rows.length - 1 ? "" : "border-b border-hairline"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-lg leading-none"
                        >
                          {m.icon}
                        </span>
                        <button
                          type="button"
                          onClick={() => setModal({ item: e })}
                          className="min-w-0 flex-1 py-2 text-left"
                        >
                          {/* Pas de `truncate` : un libellé de dépense est court
                              mais doit se lire en entier, quitte à passer sur
                              deux lignes. */}
                          <span className="block text-base font-semibold leading-snug">
                            {e.label}
                          </span>
                          <span className="block text-xs text-slate-400">
                            {m.name} · payé par {members[e.paidBy as "a" | "b"]?.name ?? e.paidBy}
                          </span>
                        </button>
                        <span className="shrink-0 text-base font-semibold tabular-nums">
                          {eur(Math.abs(e.amount))}
                        </span>
                        <OverflowMenu
                          label={`Actions sur ${e.label}`}
                          items={[
                            { label: "Modifier", onClick: () => setModal({ item: e }) },
                            {
                              label: "Supprimer",
                              danger: true,
                              onClick: () => {
                                if (confirm(`Supprimer « ${e.label} » ?`)) remove.mutate(e.id);
                              },
                            },
                          ]}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Qui a avancé quoi : l'équilibre du voyage, en une carte. */}
          <div className="card mt-1">
            <div className="eyebrow">Qui a payé quoi</div>
            <div className="mt-2 flex flex-col gap-2.5">
              {(["a", "b"] as const).map((m) => {
                const amt = m === "a" ? totalA : totalB;
                return (
                  <div key={m} className="flex items-center gap-3">
                    <MemberAvatar id={m} className="h-7 w-7 shrink-0 text-2xs" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span>{members[m].name}</span>
                        <span className="font-semibold tabular-nums">{eur(amt)}</span>
                      </div>
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <span
                          className="block h-full rounded-full bg-brand-600"
                          style={{ width: `${pct(amt)}%` }}
                        />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Où part l'argent : le poids de chaque poste, du plus gros au plus petit. */}
          {categoryRows.length > 0 && (
            <div className="card mt-1">
              <div className="eyebrow">Par catégorie</div>
              <div className="mt-2 flex flex-col gap-2.5">
                {categoryRows.map(([key, amt]) => {
                  const cm = catMeta(key === "divers" ? null : key);
                  return (
                    <div key={key} className="flex items-center gap-3">
                      <span aria-hidden="true" className="w-6 shrink-0 text-center text-lg">
                        {cm.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="truncate">{cm.name}</span>
                          <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                            <span className="font-semibold">{eur(amt)}</span>
                            <span className="w-9 text-right text-xs text-slate-400">
                              {pct(amt)} %
                            </span>
                          </span>
                        </div>
                        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-2">
                          <span
                            className="block h-full rounded-full bg-brand-600"
                            style={{ width: `${pct(amt)}%` }}
                          />
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      <MobileActionBar label="Nouvelle dépense" onClick={() => setModal({ item: null })} />
      <div className="hidden justify-end md:flex">
        <button type="button" onClick={() => setModal({ item: null })} className="btn-primary">
          + Nouvelle dépense
        </button>
      </div>

      {modal && (
        <ExpenseFormModal
          title={modal.item ? "Modifier la dépense" : "Nouvelle dépense"}
          initial={
            modal.item
              ? {
                  label: modal.item.label,
                  amount: Math.abs(modal.item.amount),
                  date: modal.item.date,
                  paidBy: modal.item.paidBy as "a" | "b",
                }
              : undefined
          }
          initialCategory={modal.item ? modal.item.category : undefined}
          categories={cats}
          splitA={me.household.defaultSplitA}
          splitB={me.household.defaultSplitB}
          pending={create.isPending || update.isPending}
          onClose={() => setModal(null)}
          onSave={(v: ExpenseFormValues) =>
            modal.item ? update.mutate({ id: modal.item.id, v }) : create.mutate(v)
          }
        />
      )}
    </>
  );
}

function TripTimeline({ trip }: { trip: Trip }) {
  const tripId = trip.id;
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const [modal, setModal] = useState<{ type: TripItemType; item: TripItem | null } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState<TripItemType | "tout">("tout");
  const { data: items } = useQuery({
    queryKey: ["trip-items", tripId],
    queryFn: () => api.get<TripItem[]>(`/api/trips/${tripId}/items`),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["trip-items", tripId] });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/trips/items/${id}`),
    onSuccess: invalidate,
  });
  const autofill = useMutation({
    mutationFn: () => api.post<{ added: number }>(`/api/trips/${tripId}/autofill`),
    onSuccess: (r) => {
      invalidate();
      toast.success(
        r.added > 0 ? `${r.added} étape(s) ajoutée(s) depuis tes emails` : "Aucune nouvelle étape trouvée",
      );
    },
    onError: (err) => {
      let code = "";
      let detail = "";
      if (err instanceof ApiError) {
        try {
          const j = JSON.parse(err.message);
          code = j.error ?? "";
          detail = j.detail ?? "";
        } catch {
          /* ignore */
        }
      }
      if (detail) console.error("autofill error:", detail);
      const msg =
        code === "gmail_scope"
          ? "Accès Gmail non autorisé : ajoute le scope Gmail dans la console Google puis reconnecte-toi."
          : code === "no_google_token"
            ? "Aucun compte Google lié — reconnecte-toi."
            : code === "extract_failed"
              ? "Emails trouvés mais analyse impossible. Réessaie."
              : code === "gmail"
                ? "Erreur d'accès à Gmail."
                : "Échec du remplissage automatique.";
      toast.error(msg);
    },
  });

  // tri par date croissante ; à jour égal, le logement passe après les transports/activités
  const day = (s: string | null) => (s ? s.slice(0, 10) : "");
  const time = (s: string | null) => (s && s.includes("T") ? s.slice(11) : "");
  const sorted = [...(items ?? [])].sort((a, b) => {
    if (!a.startAt) return 1;
    if (!b.startAt) return -1;
    const d = day(a.startAt).localeCompare(day(b.startAt));
    if (d !== 0) return d;
    // même jour : logement en dernier
    const aLodge = a.type === "lodging" ? 1 : 0;
    const bLodge = b.type === "lodging" ? 1 : 0;
    if (aLodge !== bLodge) return aLodge - bLodge;
    return time(a.startAt).localeCompare(time(b.startAt));
  });

  // Filtre par type d'étape, et jours du voyage (y compris ceux sans rien) :
  // une journée libre est une information, pas un trou dans la liste.
  const shown = filter === "tout" ? sorted : sorted.filter((it) => it.type === filter);
  const dayList: string[] = [];
  if (trip.startDate) {
    const d = new Date(`${trip.startDate.slice(0, 10)}T00:00:00`);
    const last = new Date(`${(trip.endDate ?? trip.startDate).slice(0, 10)}T00:00:00`);
    while (d <= last && dayList.length < 120) {
      dayList.push(d.toLocaleDateString("sv-SE"));
      d.setDate(d.getDate() + 1);
    }
  }
  // Étapes sans date, ou hors des bornes du voyage : elles ne doivent pas
  // disparaître parce que les dates du voyage ont changé.
  const loose = shown.filter((it) => !day(it.startAt) || !dayList.includes(day(it.startAt)));

  return (
    <>
      <div className="flex items-center gap-2">
        <FilterChips
          value={filter}
          onChange={(v) => setFilter(v as TripItemType | "tout")}
          className="min-w-0 flex-1"
          items={[
            { value: "tout", label: "Tout" },
            { value: "transport", label: "Transport" },
            { value: "lodging", label: "Logement" },
            { value: "activity", label: "Activités" },
          ]}
        />
        <span
          className="hidden shrink-0 md:inline-block"
          title={
            me.hasAnthropicKey
              ? "Analyse tes emails pour ajouter transports, logements et activités"
              : "Ajoute ta clé API Claude dans Réglages pour activer cette fonctionnalité"
          }
        >
          <button
            onClick={() => autofill.mutate()}
            disabled={autofill.isPending || !me.hasAnthropicKey}
            className="btn text-xs disabled:pointer-events-none disabled:opacity-40"
          >
            {autofill.isPending ? "Analyse…" : "Remplir depuis mes emails"}
          </button>
        </span>
      </div>

      {dayList.length === 0 && shown.length === 0 ? (
        <div className="card flex flex-col items-start gap-3 text-sm text-slate-400">
          <p>Aucune étape pour l'instant.</p>
          <button
            type="button"
            onClick={() => setModal({ type: "transport", item: null })}
            className="btn-primary"
          >
            Ajouter la première
          </button>
        </div>
      ) : (
        <ol className="relative ml-1 flex flex-col gap-4 border-l border-line pl-5">
          {dayList.map((ymd, i) => {
            const rows = shown.filter((it) =>
              it.type === "lodging"
                ? day(it.startAt) <= ymd && (!it.endAt || ymd <= day(it.endAt)) && day(it.startAt) === ymd
                : day(it.startAt) === ymd,
            );
            const d = new Date(`${ymd}T00:00:00`);
            const isToday = ymd === new Date().toLocaleDateString("sv-SE");
            return (
              <li key={ymd} className="relative list-none">
                <span
                  className={`absolute -left-[1.6rem] top-1.5 h-3 w-3 rounded-full border-2 border-[color:var(--paper)] ${
                    isToday ? "bg-brand-600" : rows.length > 0 ? "bg-ink-3" : "bg-line"
                  }`}
                  aria-hidden="true"
                />
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold capitalize">
                    {d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
                  </span>
                  <span className="text-xs text-slate-400">jour {i + 1}</span>
                </div>
                {rows.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => setModal({ type: "activity", item: null })}
                    className="mt-2 flex w-full items-center gap-3 rounded-2xl border border-dashed border-line px-4 py-3 text-left"
                  >
                    <span className="text-lg leading-none text-brand-600" aria-hidden="true">
                      +
                    </span>
                    <span>
                      <span className="block text-sm font-medium">Journée libre</span>
                      <span className="block text-xs text-slate-400">ajouter une activité</span>
                    </span>
                  </button>
                ) : (
                  <ol className="mt-2 flex flex-col gap-2">
                    {rows.map((it) => (
                      <TimelineRow
                        key={it.id}
                        item={it}
                        onEdit={() => setModal({ type: it.type, item: it })}
                        onRemove={() => {
                          if (confirm("Supprimer cette étape ?")) remove.mutate(it.id);
                        }}
                        onChanged={invalidate}
                      />
                    ))}
                  </ol>
                )}
              </li>
            );
          })}

          {loose.length > 0 && (
            <li className="relative list-none">
              <div className="eyebrow">Hors des dates du voyage</div>
              <ol className="mt-2 flex flex-col gap-2">
                {loose.map((it) => (
                  <TimelineRow
                    key={it.id}
                    item={it}
                    onEdit={() => setModal({ type: it.type, item: it })}
                    onRemove={() => {
                      if (confirm("Supprimer cette étape ?")) remove.mutate(it.id);
                    }}
                    onChanged={invalidate}
                  />
                ))}
              </ol>
            </li>
          )}
        </ol>
      )}

      <MobileActionBar label="Ajouter une étape" onClick={() => setAddOpen(true)} />
      <div className="hidden flex-wrap justify-end gap-2 md:flex">
        {ITEM_TYPES.map((o) => (
          <button
            key={o.type}
            type="button"
            onClick={() => setModal({ type: o.type, item: null })}
            className="btn"
          >
            + {o.label}
          </button>
        ))}
      </div>

      {/* Quel type d'étape : la question se pose avant le formulaire. */}
      {addOpen && (
        <ActionSheet
          title="Ajouter une étape"
          subtitle={trip.name}
          items={ITEM_TYPES.map((o) => ({
            label: o.label,
            icon: <span className="text-lg leading-none">{o.icon}</span>,
            onClick: () => setModal({ type: o.type, item: null }),
          }))}
          onClose={() => setAddOpen(false)}
        />
      )}

      {modal && (
        <ItemModal
          tripId={tripId}
          type={modal.type}
          item={modal.item}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            setAddOpen(false);
            invalidate();
          }}
        />
      )}
    </>
  );
}

function PaperclipIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

// Séparateur léger entre les jours de la timeline (petit repère + libellé + filet).
function TimelineRow({
  item,
  onEdit,
  onRemove,
  onChanged,
}: {
  item: TripItem;
  onEdit: () => void;
  onRemove: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  // Mise en évidence des étapes du jour (vert)
  const todayYmd = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD local
  const dayOf = (s: string | null) => (s ? s.slice(0, 10) : "");
  const isToday =
    item.type === "lodging"
      ? !!item.startAt && dayOf(item.startAt) <= todayYmd && (!item.endAt || todayYmd <= dayOf(item.endAt))
      : dayOf(item.startAt) === todayYmd;

  const uploadFile = async (file: File) => {
    setBusy(true);
    try {
      await fetch(`${API_URL}/api/trips/items/${item.id}/file?name=${encodeURIComponent(file.name)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const viewFile = async () => {
    const res = await fetch(`${API_URL}/api/trips/items/${item.id}/file`, { credentials: "include" });
    if (!res.ok) return;
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), "_blank");
  };
  return (
    <li className={`relative ${item.type === "activity" ? "ml-6" : ""}`}>
      <span
        className={`absolute -left-[1.65rem] flex h-7 w-7 items-center justify-center rounded-full border text-sm ${
          isToday
            ? "border-green-400 bg-green-100 dark:border-green-600 dark:bg-green-900"
            : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
        }`}
      >
        {itemIcon(item)}
      </span>
      <div
        onClick={onEdit}
        title="Modifier"
        className={`relative cursor-pointer rounded-xl p-3 text-sm transition hover:ring-1 hover:ring-brand-300 ${
          isToday
            ? "border border-green-400 bg-green-50 dark:border-green-600 dark:bg-green-900/30"
            : "bg-[color:var(--paper)] dark:bg-slate-800"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {item.type === "transport" && (
              <>
                <div className="font-medium">
                  {item.mode ? TRANSPORT_META[item.mode].label : "Transport"}
                  {(item.fromPlace || item.toPlace) && (
                    <span className="font-normal text-slate-500">
                      {" — "}
                      {item.fromPlace ?? "?"} → {item.toPlace ?? "?"}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-400">
                  {transportWhen(item.startAt, item.endAt)}
                </div>
              </>
            )}
            {item.type === "lodging" && (
              <>
                <div className="font-medium">{item.title || "Logement"}</div>
                {item.address && (
                  <a href={mapsUrl(item.address)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-brand-600 hover:underline">
                    📍 {item.address}
                  </a>
                )}
                <div className="text-xs text-slate-400">
                  {fmtDT(item.startAt)} → {fmtDT(item.endAt)}
                </div>
              </>
            )}
            {item.type === "activity" && (
              <>
                <div className="font-medium">{item.title || "Activité"}</div>
                <div className="text-xs text-slate-400">{fmtDT(item.startAt)}</div>
                {item.address && (
                  <a href={mapsUrl(item.address)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="block text-xs text-brand-600 hover:underline">
                    📍 {item.address}
                  </a>
                )}
                {item.description && (
                  <p className="mt-1 break-words [overflow-wrap:anywhere] text-slate-600 dark:text-slate-300">
                    {item.description}
                  </p>
                )}
              </>
            )}

          </div>
          <div
            className="flex shrink-0 items-center gap-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            {item.fileName ? (
              <button
                onClick={viewFile}
                title={`Voir : ${item.fileName}`}
                className="rounded-md p-1 text-brand-600 transition hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-slate-700"
              >
                <PaperclipIcon />
              </button>
            ) : (
              <label
                title="Joindre un billet"
                className={`cursor-pointer rounded-md p-1 transition hover:bg-slate-100 dark:hover:bg-slate-700 ${
                  busy ? "opacity-50" : "text-slate-300 hover:text-slate-500"
                }`}
              >
                <PaperclipIcon />
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadFile(f);
                  }}
                />
              </label>
            )}
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                title="Ouvrir le lien"
                className="rounded-md p-1 text-brand-600 transition hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-slate-700"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            )}
            <button
              onClick={onRemove}
              title="Supprimer l'étape"
              className="rounded-md px-1 text-slate-300 transition hover:text-red-500"
            >
              ✕
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

function TripModal({
  trip,
  onClose,
  onSaved,
  onDelete,
}: {
  trip: Trip | null;
  onClose: () => void;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const isEdit = !!trip;
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: trip?.name ?? "",
    startDate: trip?.startDate ?? "",
    endDate: trip?.endDate ?? "",
    budget: trip?.budget != null ? String(trip.budget / 100) : "",
  });
  // Nombre de dépenses du voyage : « Créer un équilibrage » reste désactivé tant qu'il n'y en a pas.
  const { data: expenses } = useQuery({
    queryKey: ["trip-expenses", trip?.id],
    queryFn: () => api.get<TripExpense[]>(`/api/trips/${trip!.id}/expenses`),
    enabled: isEdit,
  });
  const expenseCount = expenses?.length ?? 0;
  const pushEquilibrage = useMutation({
    mutationFn: () => api.post<{ added: number }>(`/api/trips/${trip!.id}/expenses/push`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["balance"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["trip-expenses", trip!.id] });
      toast.success(
        r.added > 0
          ? `Équilibrage mis à jour (${r.added} ligne${r.added > 1 ? "s" : ""})`
          : "Aucune dépense à synthétiser",
      );
      onClose();
      navigate("/money/equilibrage");
    },
  });
  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        budget: form.budget.trim() === "" ? null : eurToCents(Number(form.budget)),
      };
      return isEdit ? api.patch(`/api/trips/${trip!.id}`, payload) : api.post("/api/trips", payload);
    },
    onSuccess: onSaved,
  });
  const archive = useMutation({
    mutationFn: () => api.patch(`/api/trips/${trip!.id}`, { archived: !trip!.archived }),
    onSuccess: onSaved,
  });
  return (
    <ModalShell title={isEdit ? "Modifier le voyage" : "Nouveau voyage"} onClose={onClose} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (form.name.trim()) save.mutate();
        }}
        className="space-y-3"
      >
        <Input autoFocus placeholder="Nom du voyage" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <div>
          <div className="mb-1 text-xs text-slate-400">Dates du voyage (début → fin)</div>
          <DateRangeCalendar
            start={form.startDate}
            end={form.endDate}
            onChange={(s, e) => setForm((f) => ({ ...f, startDate: s, endDate: e }))}
          />
          {(form.startDate || form.endDate) && (
            <div className="mt-1.5 text-xs text-slate-500">
              {form.startDate ? dateFr(form.startDate) : "—"} → {form.endDate ? dateFr(form.endDate) : "—"}
            </div>
          )}
        </div>
        <label className="block text-xs text-slate-400">
          Budget (€, optionnel)
          <div className="mt-1">
            <Input
              type="number"
              step="0.01"
              placeholder="ex. 1500"
              value={form.budget}
              onChange={(e) => setForm({ ...form, budget: e.target.value })}
            />
          </div>
        </label>
        {isEdit && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <button
              type="button"
              onClick={() => pushEquilibrage.mutate()}
              disabled={pushEquilibrage.isPending || expenseCount === 0}
              title={
                expenseCount === 0
                  ? "Ajoute des dépenses au voyage (onglet Argent) avant de créer un équilibrage"
                  : undefined
              }
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-brand-400 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
            >
              {pushEquilibrage.isPending ? "Création…" : "Créer un équilibrage"}
            </button>
            <button
              type="button"
              onClick={() => archive.mutate()}
              disabled={archive.isPending}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-brand-400 hover:text-brand-600 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
            >
              {trip!.archived ? "Désarchiver" : "Archiver"}
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {isEdit && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="mr-auto text-sm font-medium text-red-500 hover:text-red-600"
            >
              Supprimer
            </button>
          )}
          <button type="button" onClick={onClose} className="btn-ghost">
            Annuler
          </button>
          <button className="btn-primary" disabled={save.isPending}>
            {save.isPending ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ItemModal({
  tripId,
  type,
  item,
  onClose,
  onSaved,
}: {
  tripId: string;
  type: TripItemType;
  item: TripItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!item;
  const [form, setForm] = useState({
    mode: (item?.mode ?? "voiture") as TransportMode,
    title: item?.title ?? "",
    fromPlace: item?.fromPlace ?? "",
    toPlace: item?.toPlace ?? "",
    address: item?.address ?? "",
    url: item?.url ?? "",
    description: item?.description ?? "",
    startAt: item?.startAt ?? "",
    endAt: item?.endAt ?? "",
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        type,
        mode: type === "transport" ? form.mode : null,
        title: form.title || null,
        fromPlace: type === "transport" ? form.fromPlace || null : null,
        toPlace: type === "transport" ? form.toPlace || null : null,
        address: type !== "transport" ? form.address || null : null,
        url: form.url || null,
        description: type === "activity" ? form.description || null : null,
        startAt: form.startAt || null,
        endAt: type !== "activity" ? form.endAt || null : null,
      };
      return isEdit
        ? api.patch(`/api/trips/items/${item!.id}`, payload)
        : api.post(`/api/trips/${tripId}/items`, payload);
    },
    onSuccess: onSaved,
  });

  const qc = useQueryClient();
  const [fileName, setFileName] = useState(item?.fileName ?? null);
  const [fileBusy, setFileBusy] = useState(false);
  const viewFile = async () => {
    if (!item) return;
    const res = await fetch(`${API_URL}/api/trips/items/${item.id}/file`, { credentials: "include" });
    if (!res.ok) return;
    window.open(URL.createObjectURL(await res.blob()), "_blank");
  };
  const removeFile = async () => {
    if (!item) return;
    setFileBusy(true);
    try {
      await fetch(`${API_URL}/api/trips/items/${item.id}/file`, {
        method: "DELETE",
        credentials: "include",
      });
      setFileName(null);
      qc.invalidateQueries({ queryKey: ["trip-items", tripId] });
    } finally {
      setFileBusy(false);
    }
  };

  const titleLabel =
    type === "transport" ? "Transport" : type === "lodging" ? "Logement" : "Activité";

  return (
    <ModalShell title={`${isEdit ? "Modifier" : "Ajouter"} — ${titleLabel}`} onClose={onClose} wide={type === "lodging"}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="space-y-3"
      >
        {type === "transport" && (
          <>
            <label className="text-xs text-slate-400">
              Moyen de transport
              <div className="mt-1">
                <Select
                  value={form.mode}
                  onChange={(v) => setForm({ ...form, mode: v as TransportMode })}
                  options={TRANSPORT_MODES.map((m) => ({
                    value: m,
                    label: `${TRANSPORT_META[m].icon} ${TRANSPORT_META[m].label}`,
                  }))}
                />
              </div>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="Départ (lieu)" value={form.fromPlace} onChange={(e) => setForm({ ...form, fromPlace: e.target.value })} />
              <Input placeholder="Arrivée (lieu)" value={form.toPlace} onChange={(e) => setForm({ ...form, toPlace: e.target.value })} />
            </div>
            <label className="block text-xs text-slate-400">
              Départ
              <div className="mt-1">
                <DateTimeInput
                  value={form.startAt}
                  onChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      startAt: v,
                      // pré-remplit le jour d'arrivée s'il est vide
                      endAt: f.endAt ? f.endAt : v ? v.slice(0, 10) : "",
                    }))
                  }
                />
              </div>
            </label>
            <label className="block text-xs text-slate-400">
              Arrivée
              <div className="mt-1">
                <DateTimeInput
                  value={form.endAt}
                  onChange={(v) => setForm({ ...form, endAt: v })}
                  min={form.startAt ? form.startAt.slice(0, 10) : undefined}
                />
              </div>
            </label>
            <Input placeholder="Lien (billet, itinéraire…)" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          </>
        )}

        {type === "lodging" && (
          <>
            <Input autoFocus placeholder="Nom du logement" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Input placeholder="Adresse" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <Input placeholder="Lien (Airbnb, Booking…)" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            <div>
              <div className="mb-1 text-xs text-slate-400">Dates du séjour (arrivée → départ)</div>
              <DateRangeCalendar
                start={form.startAt}
                end={form.endAt}
                onChange={(s, e) => setForm((f) => ({ ...f, startAt: s, endAt: e }))}
              />
              {(form.startAt || form.endAt) && (
                <div className="mt-1.5 text-xs text-slate-500">
                  {form.startAt ? fmtDT(form.startAt) : "—"} → {form.endAt ? fmtDT(form.endAt) : "—"}
                </div>
              )}
            </div>
          </>
        )}

        {type === "activity" && (
          <>
            <Input autoFocus placeholder="Nom de l'activité" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <label className="block text-xs text-slate-400">
              Date et heure
              <div className="mt-1">
                <DateTimeInput value={form.startAt} onChange={(v) => setForm({ ...form, startAt: v })} />
              </div>
            </label>
            <Input placeholder="Adresse (optionnel)" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <Input placeholder="Lien (optionnel)" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            <textarea
              placeholder="Description"
              className={FIELD}
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </>
        )}

        {isEdit && fileName && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
            <button
              type="button"
              onClick={viewFile}
              className="flex min-w-0 items-center gap-2 text-slate-800 hover:underline dark:text-white"
            >
              <PaperclipIcon />
              <span className="truncate">{fileName}</span>
            </button>
            <button
              type="button"
              onClick={removeFile}
              disabled={fileBusy}
              title="Supprimer le fichier"
              className="shrink-0 rounded-md px-1.5 text-red-500 transition hover:text-red-600 disabled:opacity-40"
            >
              ✕
            </button>
          </div>
        )}

        <ModalActions onClose={onClose} pending={save.isPending} />
      </form>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className={`card max-h-[85vh] w-full overflow-y-auto ${wide ? "max-w-2xl" : "max-w-md"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalActions({ onClose, pending }: { onClose: () => void; pending: boolean }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button type="button" onClick={onClose} className="btn-ghost">
        Annuler
      </button>
      <button className="btn-primary" disabled={pending}>
        {pending ? "Enregistrement…" : "Enregistrer"}
      </button>
    </div>
  );
}

/* ---------------- Sous-page : un voyage ---------------- */

/**
 * Un voyage ouvert. La barre du haut porte le retour vers l'index, la période
 * et le décompte ; les trois onglets (Affaires · Planning · Coûts) répondent
 * chacun à une question distincte du voyage.
 */
function TripDetail({
  trip: t,
  tab,
  backTo,
}: {
  trip?: Trip;
  tab: TripTab;
  backTo: string;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [modal, setModal] = useState(false);

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/trips/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trips"] });
      navigate(backTo, { replace: true });
    },
  });
  const archive = useMutation({
    mutationFn: (v: { id: string; archived: boolean }) =>
      api.patch(`/api/trips/${v.id}`, { archived: v.archived }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trips"] }),
  });

  const countdown = t ? tripCountdown(t) : null;
  const period = t ? tripPeriod(t) : "";
  // Hooks déclarés avant tout retour anticipé.
  usePageHeader(
    t?.name ?? "Voyage",
    [period, countdown].filter(Boolean).join(" · ") || undefined,
    t?.emoji ?? "✈️",
  );
  usePageChrome(backTo, [
    { label: "Modifier le voyage", onClick: () => setModal(true) },
    ...(t
      ? [
          {
            label: t.archived ? "Sortir des archives" : "Archiver le voyage",
            onClick: () => archive.mutate({ id: t.id, archived: !t.archived }),
          },
          {
            label: "Supprimer le voyage",
            danger: true,
            onClick: () => {
              if (confirm(`Supprimer le voyage « ${t.name} » ?`)) remove.mutate(t.id);
            },
          },
        ]
      : []),
  ]);

  if (!t) {
    return (
      <div className="card flex flex-col items-start gap-3 text-sm text-slate-400">
        <p>Ce voyage n'existe plus.</p>
        <Link to={backTo} className="btn-primary">
          Revenir aux voyages
        </Link>
      </div>
    );
  }

  return (
    <>
      {tab === "affaires" && <TripPacking tripId={t.id} />}
      {tab === "planning" && <TripTimeline trip={t} />}
      {tab === "couts" && <TripExpenses trip={t} />}

      {modal && (
        <TripModal
          trip={t}
          onClose={() => setModal(false)}
          onSaved={() => {
            setModal(false);
            qc.invalidateQueries({ queryKey: ["trips"] });
          }}
          onDelete={() => {
            if (confirm(`Supprimer le voyage « ${t.name} » ?`)) remove.mutate(t.id);
          }}
        />
      )}
    </>
  );
}
