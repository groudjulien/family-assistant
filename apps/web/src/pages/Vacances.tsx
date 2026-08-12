import { useState, useEffect, useMemo, useRef, Fragment, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Select, Input, Checkbox, DateTimeInput, DateRangeCalendar, SubNav } from "../components/ui";
import { useToast } from "../components/Toast";
import { MemberAvatar, PersonAvatar, PersonPicker, usePackingPersons } from "../components/MemberAvatar";
import { Indicator } from "../components/Indicator";
import { ExpenseFormModal, type ExpenseFormValues } from "../components/ExpenseForm";
import { useExpenseCategories, categoryMeta } from "../lib/categories";
import { useMe } from "../auth";
import { dateFr, eur, eur0, eurToCents, todayIso } from "../lib/format";
import { api, API_URL, ApiError } from "../lib/api";

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
  if (it.type === "transport") return it.mode ? TRANSPORT_META[it.mode].icon : "🚗";
  if (it.type === "lodging") return "🏠";
  return "🎯";
}

// Sous-onglets d'un voyage : valise (affaires à prendre), planning, dépenses.
type TripSubTab = "valise" | "agenda" | "argent";

// Types d'étape proposés par le bouton flottant (même ordre que dans la timeline).
const ITEM_TYPES: { type: TripItemType; icon: string; label: string }[] = [
  { type: "transport", icon: "🚆", label: "Transport" },
  { type: "lodging", icon: "🏠", label: "Logement" },
  { type: "activity", icon: "🎯", label: "Activité" },
];

// Option du menu du bouton flottant (mobile) : pastille arrondie au-dessus du « + ».
function FabOption({
  icon,
  label,
  hint,
  disabled = false,
  onClick,
}: {
  icon: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className="flex items-center gap-2 rounded-full border border-slate-200 bg-white py-2 pl-3 pr-4 text-sm font-medium text-slate-700 shadow-lg disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
    >
      <span aria-hidden="true">{icon}</span>
      <span className="flex flex-col items-start leading-tight">
        {label}
        {hint && <span className="text-[10px] font-normal text-slate-400">{hint}</span>}
      </span>
    </button>
  );
}

export default function Vacances() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { view } = useParams();
  const statut: "prevu" | "archive" = view === "archive" ? "archive" : "prevu";
  const [openId, setOpenId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ trip: Trip | null } | null>(null);
  const [itemModal, setItemModal] = useState<{ type: TripItemType } | null>(null);
  const [fabOpen, setFabOpen] = useState(false);
  const autoOpenedFor = useRef<string | null>(null); // statut déjà auto-ouvert (une fois par vue)
  const [searchParams] = useSearchParams();
  const tripParam = searchParams.get("trip");

  // Recherche (nom / budget global) + filtre de période (dates début-fin).
  const [search, setSearch] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [filtersModalOpen, setFiltersModalOpen] = useState(false);

  // Sous-onglet par voyage (valise | agenda | argent), mémorisé entre les visites.
  const [subTabs, setSubTabs] = useState<Record<string, TripSubTab>>(() => {
    try {
      return JSON.parse(localStorage.getItem("trip-subtabs") || "{}");
    } catch {
      return {};
    }
  });
  // Clic simple sur l'entête = ouvrir/fermer ; double clic = éditer le voyage.
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleHeaderClick = (t: Trip) => {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
      setModal({ trip: t });
      return;
    }
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      setOpenId((cur) => (cur === t.id ? null : t.id));
    }, 250);
  };

  const subTabOf = (id: string): TripSubTab => {
    const v = subTabs[id];
    return v === "valise" || v === "argent" ? v : "agenda";
  };
  const setSubTab = (id: string, v: TripSubTab) =>
    setSubTabs((prev) => {
      const next = { ...prev, [id]: v };
      localStorage.setItem("trip-subtabs", JSON.stringify(next));
      return next;
    });

  const { data: trips } = useQuery({ queryKey: ["trips"], queryFn: () => api.get<Trip[]>("/api/trips") });

  // Ouverture auto : voyage ciblé via ?trip=, sinon l'unique voyage de la vue courante
  // (prévu / archivé). On ne compte que les voyages de la vue → l'ajout d'archives
  // ne casse plus l'ouverture auto. Une seule fois par vue.
  useEffect(() => {
    if (!trips) return;
    // Priorité : voyage ciblé explicitement via ?trip= (au premier passage seulement).
    if (autoOpenedFor.current === null && tripParam && trips.some((t) => t.id === tripParam)) {
      setOpenId(tripParam);
      autoOpenedFor.current = statut;
      return;
    }
    if (autoOpenedFor.current === statut) return;
    const inView = trips.filter((t) => (statut === "archive" ? t.archived : !t.archived));
    if (inView.length === 1) setOpenId(inView[0].id);
    autoOpenedFor.current = statut;
  }, [trips, tripParam, statut]);
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/trips/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trips"] }),
  });

  const period = (t: Trip) =>
    t.startDate ? `${fmtDT(t.startDate)}${t.endDate ? ` → ${fmtDT(t.endDate)}` : ""}` : "";

  const byStatut = (trips ?? []).filter((t) => (statut === "archive" ? t.archived : !t.archived));

  // Recherche : nom du voyage OU budget global (montant en euros).
  const q = search.trim().toLowerCase();
  const qDigits = q.replace(/[^\d]/g, "");
  const matchesSearch = (t: Trip) => {
    if (!q) return true;
    if (t.name.toLowerCase().includes(q)) return true;
    return qDigits !== "" && t.budget != null && String(Math.round(t.budget / 100)).includes(qDigits);
  };
  // Période : le voyage doit chevaucher la plage choisie (dates requises si filtre actif).
  const matchesPeriod = (t: Trip) => {
    if (!fFrom && !fTo) return true;
    if (!t.startDate) return false;
    const end = t.endDate ?? t.startDate;
    if (fFrom && end < fFrom) return false;
    if (fTo && t.startDate > fTo) return false;
    return true;
  };
  const visibleTrips = byStatut.filter((t) => matchesSearch(t) && matchesPeriod(t));
  const hasFilters = q !== "" || fFrom !== "" || fTo !== "";

  // Voyage cible d'une étape créée depuis le bouton flottant :
  // le voyage en cours, sinon l'unique voyage, sinon le prochain à venir.
  const targetTrip = useMemo(() => {
    const list = (trips ?? []).filter((t) => !t.archived);
    const today = todayIso();
    const dayOf = (d: string) => d.slice(0, 10);
    const current = list.find(
      (t) => t.startDate && dayOf(t.startDate) <= today && dayOf(t.endDate ?? t.startDate) >= today,
    );
    if (current) return current;
    if (list.length === 1) return list[0];
    return (
      list
        .filter((t) => t.startDate && dayOf(t.startDate) > today)
        .sort((a, b) => a.startDate!.localeCompare(b.startDate!))[0] ?? null
    );
  }, [trips]);

  return (
    <div className="space-y-4 pb-24 md:pb-0">
      {/* Onglets de premier niveau Prévu / Archivé — une URL par vue. */}
      <SubNav
        value={statut}
        onChange={(v) => navigate(`/vacances/${v}`)}
        items={[
          { value: "prevu", label: "Prévu", icon: "📅" },
          { value: "archive", label: "Archivé", icon: "📦" },
        ]}
      />
      {/* Actions : « Filtres » (modale) sur mobile, création de voyage sur ordinateur. */}
      <div className="flex items-center justify-end gap-2">
          {byStatut.length > 0 && (
            <button
              onClick={() => setFiltersModalOpen(true)}
              className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm sm:hidden ${
                hasFilters
                  ? "border-brand-500 text-brand-600 ring-1 ring-brand-500"
                  : "border-slate-300 text-slate-500 dark:border-slate-700"
              }`}
              aria-label="Filtres"
            >
              <FunnelIcon />
              Filtres
            </button>
          )}
          {/* Ordinateur : bouton en haut. Mobile : bouton flottant en bas à droite. */}
        <button onClick={() => setModal({ trip: null })} className="btn-primary hidden md:inline-flex">
          + Créer un voyage
        </button>
      </div>

      {/* Ordinateur : recherche + période inline */}
      {byStatut.length > 0 && (
        <div className="hidden gap-2 sm:flex sm:items-center">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher (nom, budget…)"
            className="input min-w-0 flex-1"
          />
          <DateRangeField
            from={fFrom}
            to={fTo}
            onChange={(a, b) => {
              setFFrom(a);
              setFTo(b);
            }}
            className="sm:w-56"
          />
        </div>
      )}

      {/* Mobile : modale Filtres (recherche + période) */}
      {filtersModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:hidden"
          onClick={() => setFiltersModalOpen(false)}
        >
          <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Filtres</h2>
              <button onClick={() => setFiltersModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher (nom, budget…)"
                className="input"
              />
              <div>
                <label className="mb-1 block text-xs text-slate-400">Période</label>
                <DateRangeField
                  from={fFrom}
                  to={fTo}
                  onChange={(a, b) => {
                    setFFrom(a);
                    setFTo(b);
                  }}
                />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={() => {
                  setSearch("");
                  setFFrom("");
                  setFTo("");
                }}
                className="btn-ghost text-sm"
              >
                Réinitialiser
              </button>
              <button onClick={() => setFiltersModalOpen(false)} className="btn-primary">
                Voir les résultats
              </button>
            </div>
          </div>
        </div>
      )}

      {visibleTrips.length === 0 ? (
        <div className="card text-sm text-slate-400">
          {hasFilters
            ? "Aucun voyage ne correspond à la recherche."
            : statut === "archive"
              ? "Aucun voyage archivé."
              : "Aucun voyage. Crée ton premier voyage ✈️"}
        </div>
      ) : (
        visibleTrips.map((t) => {
          const open = openId === t.id;
          const sub = subTabOf(t.id);
          return (
            <div key={t.id} className="card">
              <div className="flex items-center gap-3">
                <div
                  onClick={() => handleHeaderClick(t)}
                  title="Double-clic pour modifier"
                  className="group/trip min-w-0 flex-1 cursor-pointer"
                >
                  <div className="flex items-center gap-1">
                    <span className="truncate font-semibold">✈️ {t.name}</span>
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setModal({ trip: t });
                      }}
                      title="Modifier"
                      className="hidden shrink-0 text-slate-400 opacity-0 transition hover:text-brand-600 group-hover/trip:opacity-100 md:inline-block"
                    >
                      ✎
                    </button>
                  </div>
                  {(period(t) || t.budget != null) && (
                    <div className="text-xs text-slate-400">
                      {period(t)}
                      {period(t) && t.budget != null ? " · " : ""}
                      {t.budget != null && `Budget ${eur0(t.budget)}`}
                    </div>
                  )}
                </div>
                {open && (
                  <>
                    <button
                      onClick={() => setSubTab(t.id, "valise")}
                      title="Affaires à prendre"
                      aria-label="Affaires à prendre"
                      className={sub === "valise" ? "text-brand-600" : "text-slate-400 hover:text-brand-600"}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                        <rect x="3" y="7" width="18" height="14" rx="2" />
                        <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
                        <path d="M3 13h18" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setSubTab(t.id, "agenda")}
                      title="Planning"
                      aria-label="Planning"
                      className={sub === "agenda" ? "text-brand-600" : "text-slate-400 hover:text-brand-600"}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                        <rect x="3" y="4" width="18" height="18" rx="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setSubTab(t.id, "argent")}
                      title="Dépenses"
                      aria-label="Dépenses"
                      className={sub === "argent" ? "text-brand-600" : "text-slate-400 hover:text-brand-600"}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                        <rect x="2" y="6" width="20" height="12" rx="2" />
                        <circle cx="12" cy="12" r="2.5" />
                        <path d="M6 12h.01M18 12h.01" />
                      </svg>
                    </button>
                  </>
                )}
                <button onClick={() => setOpenId(open ? null : t.id)} className="text-slate-400">
                  {open ? "▾" : "▸"}
                </button>
              </div>
              {open &&
                (sub === "argent" ? (
                  <TripExpenses trip={t} />
                ) : sub === "valise" ? (
                  <TripPacking tripId={t.id} />
                ) : (
                  <TripTimeline tripId={t.id} />
                ))}
            </div>
          );
        })
      )}

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

      {/* Étape (transport / logement / activité) créée depuis le bouton flottant :
          elle est rattachée au voyage cible, pas à une timeline ouverte. */}
      {itemModal && targetTrip && (
        <ItemModal
          tripId={targetTrip.id}
          type={itemModal.type}
          item={null}
          onClose={() => setItemModal(null)}
          onSaved={() => {
            setItemModal(null);
            qc.invalidateQueries({ queryKey: ["trip-items", targetTrip.id] });
            // On montre le résultat : voyage déplié sur son planning (et vue « Prévu »).
            if (statut === "archive") navigate("/vacances/prevu");
            setSubTab(targetTrip.id, "agenda");
            setOpenId(targetTrip.id);
          }}
        />
      )}

      {/* Bouton flottant de création (mobile uniquement) : déplie les types à créer. */}
      {fabOpen && <div className="fixed inset-0 z-20 md:hidden" onClick={() => setFabOpen(false)} />}
      <div className="fixed bottom-6 right-6 z-30 flex flex-col items-end gap-2 md:hidden">
        {fabOpen && (
          <>
            <FabOption
              icon="✈️"
              label="Voyage"
              onClick={() => {
                setFabOpen(false);
                setModal({ trip: null });
              }}
            />
            {ITEM_TYPES.map((o) => (
              <FabOption
                key={o.type}
                icon={o.icon}
                label={o.label}
                hint={targetTrip ? `Dans « ${targetTrip.name} »` : "Aucun voyage en cours ou à venir"}
                disabled={!targetTrip}
                onClick={() => {
                  setFabOpen(false);
                  setItemModal({ type: o.type });
                }}
              />
            ))}
          </>
        )}
        <button
          type="button"
          onClick={() => setFabOpen((o) => !o)}
          aria-expanded={fabOpen}
          aria-label={fabOpen ? "Fermer" : "Créer"}
          className="btn-primary flex h-14 w-14 items-center justify-center rounded-full p-0 shadow-lg"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            className={`h-6 w-6 transition-transform ${fabOpen ? "rotate-45" : ""}`}
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/* ---------------- Affaires à prendre (onglet valise) ---------------- */

function TripPacking({ tripId }: { tripId: string }) {
  const qc = useQueryClient();
  const me = useMe();
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<PackingCategory>("vetements");
  const [person, setPerson] = useState<PackingPerson>("famille");
  const packingPersons = usePackingPersons();
  const personIds = packingPersons.map((p) => p.id);
  const { data: items } = useQuery({
    queryKey: ["trip-packing", tripId],
    queryFn: () => api.get<TripPackingItem[]>(`/api/trips/${tripId}/packing`),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["trip-packing", tripId] });

  const add = useMutation({
    mutationFn: (v: string) =>
      api.post(`/api/trips/${tripId}/packing`, { label: v, category, person }),
    onSuccess: () => {
      setLabel("");
      invalidate();
    },
  });
  const toggle = useMutation({
    mutationFn: (it: TripPackingItem) =>
      api.patch(`/api/trips/packing/${it.id}`, { checked: !it.checked }),
    onSuccess: invalidate,
  });
  const setPerson_ = useMutation({
    mutationFn: ({ id, person }: { id: string; person: PackingPerson }) =>
      api.patch(`/api/trips/packing/${id}`, { person }),
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
  // Tri catégorie → personne → ordre d'ajout, puis regroupement par catégorie.
  const groups = PACKING_CATEGORIES.map((cat) => ({
    cat,
    items: list.filter((i) => i.category === cat).sort((a, b) => comparePackingItems(a, b, personIds)),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold">🧳 Affaires à prendre</div>
        {list.length > 0 && (
          <span className="text-xs text-slate-400">
            {done}/{list.length}
          </span>
        )}
        {hasDefault && (
          <button
            onClick={() => fromDefault.mutate()}
            disabled={fromDefault.isPending}
            title="Ajouter les affaires de la liste par défaut (Réglages → Activités)"
            className="ml-auto text-xs text-slate-400 transition hover:text-brand-600 disabled:opacity-50"
          >
            + Liste par défaut
          </button>
        )}
      </div>

      {list.length === 0 ? (
        <div className="text-sm text-slate-400">
          Rien à prendre pour l'instant.
          {hasDefault
            ? " Ajoute une affaire, ou pars de ta liste par défaut."
            : " Tu peux définir une liste par défaut dans Réglages → Activités."}
        </div>
      ) : (
        // Une catégorie par colonne : 3 colonnes sur grand écran, 2 en tablette, 1 sur mobile.
        <div className="grid gap-x-6 gap-y-5 md:grid-cols-2 md:gap-y-7 lg:grid-cols-3">
          {groups.map((g) => (
            <div key={g.cat}>
              <div className="mb-1.5 flex items-center gap-1.5 text-base font-semibold text-slate-600 dark:text-slate-300">
                <span aria-hidden="true">{PACKING_CATEGORY_META[g.cat].icon}</span>
                {PACKING_CATEGORY_META[g.cat].label}
                <span className="text-xs font-normal text-slate-400">
                  {g.items.filter((i) => i.checked).length}/{g.items.length}
                </span>
              </div>
              <ul className="space-y-1">
                {g.items.map((it) => (
                  <li key={it.id} className="group flex items-center gap-2">
                    <Checkbox checked={it.checked} onChange={() => toggle.mutate(it)} />
                    <PersonPicker
                      value={it.person}
                      onChange={(person) => setPerson_.mutate({ id: it.id, person })}
                      className={`h-5 w-5 text-[10px] ${it.checked ? "opacity-50" : ""}`}
                    />
                    <span
                      className={`min-w-0 flex-1 truncate text-sm ${
                        it.checked ? "text-slate-400 line-through" : ""
                      }`}
                    >
                      {it.label}
                    </span>
                    <button
                      onClick={() => remove.mutate(it.id)}
                      title="Retirer"
                      aria-label={`Retirer ${it.label}`}
                      className="shrink-0 px-1 text-slate-300 transition hover:text-red-500 md:opacity-0 md:group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (label.trim()) add.mutate(label.trim());
        }}
        className="mt-3 flex flex-wrap items-center gap-2"
      >
        <Input
          placeholder="Ajouter une affaire…"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="min-w-[10rem] flex-1"
        />
        <Select
          value={category}
          onChange={(v) => setCategory(v as PackingCategory)}
          className="w-[10.5rem]"
          options={PACKING_CATEGORIES.map((cat) => ({
            value: cat,
            label: `${PACKING_CATEGORY_META[cat].icon} ${PACKING_CATEGORY_META[cat].label}`,
          }))}
        />
        <Select
          value={person}
          onChange={(v) => setPerson(v as PackingPerson)}
          className="w-[8.5rem]"
          options={packingPersons.map((p) => ({
            value: p.id,
            label: p.label,
            icon: <PersonAvatar id={p.id} className="h-5 w-5 text-[10px]" />,
          }))}
        />
        <button className="btn-primary shrink-0" disabled={add.isPending || !label.trim()}>
          Ajouter
        </button>
      </form>
    </div>
  );
}

// Ligne de dépense : crayon (ordinateur) + double-clic (mobile) pour éditer.
function TripExpenseRow({
  e,
  onEdit,
  onRemove,
}: {
  e: TripExpense;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const cats = useExpenseCategories();
  const cm = categoryMeta(cats, e.category);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onClick = () => {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
      onEdit(); // double-clic
      return;
    }
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
    }, 250);
  };
  return (
    <div
      onClick={onClick}
      className="group/exp flex cursor-pointer items-center gap-2 rounded-lg bg-[color:var(--paper)] px-2 py-1.5 text-sm dark:bg-slate-800"
    >
      <MemberAvatar id={e.paidBy} className="h-6 w-6 text-xs" />
      {cm && (
        <span title={cm.name} aria-hidden="true">
          {cm.icon}
        </span>
      )}
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <span className="truncate">{e.label}</span>
        <button
          type="button"
          onClick={(ev) => {
            ev.stopPropagation();
            onEdit();
          }}
          title="Modifier"
          className="hidden shrink-0 text-slate-400 opacity-0 transition hover:text-brand-600 group-hover/exp:opacity-100 md:inline-block"
        >
          ✎
        </button>
      </span>
      <span className="shrink-0 font-medium tabular-nums">{eur(Math.abs(e.amount))}</span>
      <button
        type="button"
        onClick={(ev) => {
          ev.stopPropagation();
          onRemove();
        }}
        title="Supprimer"
        className="shrink-0 text-slate-300 opacity-100 transition hover:text-red-500 md:opacity-0 md:group-hover/exp:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}

// Icône entonnoir (bouton « Filtres » mobile).
function FunnelIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M3 4h18l-7 8v6l-4 2v-8L3 4z" />
    </svg>
  );
}

// Icône calendrier (déclencheur du filtre de dates).
function CalendarIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

// Champ « plage de dates » : bouton qui ouvre un popover avec un calendrier de
// sélection début → fin (react-day-picker via DateRangeCalendar).
function DateRangeField({
  from,
  to,
  onChange,
  className = "",
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const label =
    from && to
      ? `${dateFr(from)} → ${dateFr(to)}`
      : from
        ? `Depuis ${dateFr(from)}`
        : to
          ? `Jusqu'au ${dateFr(to)}`
          : "Dates";
  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-900 outline-none transition hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        <span className={`truncate ${from || to ? "" : "text-slate-400"}`}>{label}</span>
        <CalendarIcon className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-[70] mt-1 w-[min(92vw,320px)] rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex justify-center">
              <DateRangeCalendar months={1} bare start={from} end={to} onChange={onChange} />
            </div>
            <div className="mt-2 flex justify-between">
              <button type="button" onClick={() => onChange("", "")} className="btn-ghost text-xs">
                Effacer
              </button>
              <button type="button" onClick={() => setOpen(false)} className="btn-primary text-sm">
                Appliquer
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Sous-onglet « Argent » d'un voyage : dépenses sur place, par jour, + totaux.
function TripExpenses({ trip }: { trip: Trip }) {
  const qc = useQueryClient();
  const me = useMe();
  const members = me.household.members;
  const cats = useExpenseCategories();
  const [modal, setModal] = useState<{ item: TripExpense | null } | null>(null);

  // Filtres (personne / catégorie / montant / plage de dates). Repliés sur mobile.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [fPerson, setFPerson] = useState("");
  const [fCategory, setFCategory] = useState("");
  const [fMin, setFMin] = useState("");
  const [fMax, setFMax] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const resetFilters = () => {
    setFPerson("");
    setFCategory("");
    setFMin("");
    setFMax("");
    setFFrom("");
    setFTo("");
  };

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

  // Application des filtres. La liste et la répartition (par personne / catégorie,
  // avec %) portent sur le jeu FILTRÉ ; les KPIs de budget sur le jeu COMPLET.
  const min = fMin.trim() ? Math.round(parseFloat(fMin) * 100) : null;
  const max = fMax.trim() ? Math.round(parseFloat(fMax) * 100) : null;
  const filtered = expenses.filter((e) => {
    if (fPerson && e.paidBy !== fPerson) return false;
    if (fCategory && (e.category ?? "divers") !== fCategory) return false;
    const abs = Math.abs(e.amount);
    if (min != null && !isNaN(min) && abs < min) return false;
    if (max != null && !isNaN(max) && abs > max) return false;
    if (fFrom && e.date < fFrom) return false;
    if (fTo && e.date > fTo) return false;
    return true;
  });
  const hasFilters =
    fPerson !== "" ||
    fCategory !== "" ||
    fMin.trim() !== "" ||
    fMax.trim() !== "" ||
    fFrom !== "" ||
    fTo !== "";

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

  // Totaux par catégorie (sans catégorie = divers), triés par montant décroissant.
  const byCategory = new Map<string, number>();
  for (const e of filtered) {
    const key = e.category ?? "divers";
    byCategory.set(key, (byCategory.get(key) ?? 0) + Math.abs(e.amount));
  }
  const categoryRows = [...byCategory.entries()]
    .filter(([, amt]) => amt > 0)
    .sort((a, b) => b[1] - a[1]);

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

  return (
    <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">Dépenses sur place</div>
        <div className="flex items-center gap-2">
          <button onClick={() => setModal({ item: null })} className="btn-primary text-xs">
            + Dépense
          </button>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <Indicator label="Total dépensé" value={fullTotal} money />
        <Indicator
          label="Dépensé / jour"
          value={avgPerDay != null ? avgPerDay : "—"}
          money={avgPerDay != null}
        />
        <Indicator
          label="Restant"
          value={remaining != null ? remaining : "—"}
          money={remaining != null}
          tone={remaining == null ? "default" : remaining < 0 ? "red" : "green"}
        />
        <Indicator
          label={perDay != null ? `Restant / jour (${remainingDays} j)` : "Restant / jour"}
          value={perDay != null ? perDay : "—"}
          money={perDay != null}
          tone={perDay != null && perDay < 0 ? "red" : "default"}
        />
      </div>
      {budget == null && (
        <p className="mb-3 text-xs text-slate-400">
          Définis un budget dans l'édition du voyage (✎) pour suivre le restant.
        </p>
      )}

      {/* Filtres : inline sur ordinateur, repliés derrière un bouton sur mobile */}
      {expenses.length > 0 && (
        <div className="mb-3 flex flex-col gap-2">
          <button
            onClick={() => setFiltersOpen((o) => !o)}
            className={`flex w-max items-center gap-1.5 rounded-xl border px-3 py-2 text-sm md:hidden ${
              hasFilters
                ? "border-brand-500 text-brand-600 ring-1 ring-brand-500"
                : "border-slate-300 text-slate-500 dark:border-slate-700"
            }`}
            aria-label="Filtres"
          >
            <FunnelIcon />
            Filtres{hasFilters ? ` (${filtered.length})` : ""}
          </button>

          <div
            className={`${filtersOpen ? "grid" : "hidden"} grid-cols-2 gap-2 sm:grid-cols-3 md:flex md:flex-nowrap md:items-center`}
          >
            <Select
              value={fPerson}
              onChange={setFPerson}
              className="md:w-40"
              options={[
                { value: "", label: "Toutes personnes" },
                { value: "a", label: members.a.name, icon: <MemberAvatar id="a" className="h-5 w-5 text-[10px]" /> },
                { value: "b", label: members.b.name, icon: <MemberAvatar id="b" className="h-5 w-5 text-[10px]" /> },
              ]}
            />
            <Select
              value={fCategory}
              onChange={setFCategory}
              className="md:w-48"
              options={[
                { value: "", label: "Toutes catégories" },
                ...cats
                  .filter((c) => !c.hidden)
                  .map((c) => ({ value: c.key, label: `${c.icon} ${c.name}` })),
                { value: "divers", label: "Sans catégorie" },
              ]}
            />
            <input
              type="number"
              step="0.01"
              min="0"
              value={fMin}
              onChange={(e) => setFMin(e.target.value)}
              placeholder="Min €"
              className="input tabular-nums md:w-24"
            />
            <input
              type="number"
              step="0.01"
              min="0"
              value={fMax}
              onChange={(e) => setFMax(e.target.value)}
              placeholder="Max €"
              className="input tabular-nums md:w-24"
            />
            <DateRangeField
              from={fFrom}
              to={fTo}
              onChange={(a, b) => {
                setFFrom(a);
                setFTo(b);
              }}
              className="col-span-2 sm:col-span-1 md:w-56"
            />
          </div>

          {hasFilters && (
            <button onClick={resetFilters} className="btn-ghost w-max text-xs">
              Réinitialiser
            </button>
          )}
        </div>
      )}

      {expenses.length === 0 ? (
        <div className="text-sm text-slate-400">Aucune dépense pour l'instant.</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-slate-400">Aucune dépense ne correspond aux filtres.</div>
      ) : (
        <div className="space-y-4">
          {days.map((d) => {
            const items = byDate.get(d)!;
            return (
              <div key={d}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold capitalize text-slate-500">{dateFr(d)}</span>
                  <span className="text-lg font-bold tabular-nums">{eur(sum(items))}</span>
                </div>
                <div className="space-y-1">
                  {items.map((e) => (
                    <TripExpenseRow
                      key={e.id}
                      e={e}
                      onEdit={() => setModal({ item: e })}
                      onRemove={() => remove.mutate(e.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Total global (du jeu filtré si un filtre est actif) */}
      <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
        <div className="flex items-center justify-between text-xl font-bold">
          <span>{hasFilters ? "Total (filtré)" : "Total"}</span>
          <span className="tabular-nums">{eur(total)}</span>
        </div>
      </div>

      {/* Par personne (montant + % du total) */}
      <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
        <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
          <span>Par personne</span>
          <span className="w-12 text-right">%</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <MemberAvatar id="a" className="h-5 w-5 text-[10px]" /> {members.a.name}
          </span>
          <span className="flex items-center gap-3 tabular-nums">
            <span>{eur(totalA)}</span>
            <span className="w-12 text-right text-slate-400">{pct(totalA)} %</span>
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <MemberAvatar id="b" className="h-5 w-5 text-[10px]" /> {members.b.name}
          </span>
          <span className="flex items-center gap-3 tabular-nums">
            <span>{eur(totalB)}</span>
            <span className="w-12 text-right text-slate-400">{pct(totalB)} %</span>
          </span>
        </div>
      </div>

      {categoryRows.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
          <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
            <span>Par catégorie</span>
            <span className="w-12 text-right">%</span>
          </div>
          {categoryRows.map(([k, amt]) => {
            const cm = categoryMeta(cats, k);
            return (
              <div key={k} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span aria-hidden="true">{cm?.icon}</span>
                  {cm?.name}
                </span>
                <span className="flex items-center gap-3 tabular-nums">
                  <span>{eur(amt)}</span>
                  <span className="w-12 text-right text-slate-400">{pct(amt)} %</span>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <ExpenseFormModal
          title={modal.item ? "Modifier la dépense" : "Nouvelle dépense"}
          initial={
            modal.item
              ? {
                  paidBy: modal.item.paidBy,
                  label: modal.item.label,
                  amount: Math.abs(modal.item.amount) / 100,
                  date: modal.item.date,
                }
              : undefined
          }
          splitA={me.household.defaultSplitA}
          splitB={me.household.defaultSplitB}
          categories={cats.filter((c) => !c.hidden)}
          initialCategory={modal.item ? modal.item.category : undefined}
          pending={create.isPending || update.isPending}
          onClose={() => setModal(null)}
          onSave={(v) => (modal.item ? update.mutate({ id: modal.item.id, v }) : create.mutate(v))}
        />
      )}
    </div>
  );
}

function TripTimeline({ tripId }: { tripId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const [modal, setModal] = useState<{ type: TripItemType; item: TripItem | null } | null>(null);
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

  return (
    <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={() => setModal({ type: "transport", item: null })} className="btn-ghost text-xs">
          🚆<span className="hidden md:inline"> Transport</span>
        </button>
        <button onClick={() => setModal({ type: "lodging", item: null })} className="btn-ghost text-xs">
          🏠<span className="hidden md:inline"> Logement</span>
        </button>
        <button onClick={() => setModal({ type: "activity", item: null })} className="btn-ghost text-xs">
          🎯<span className="hidden md:inline"> Activité</span>
        </button>
        {/* span porteuse du tooltip : un bouton désactivé ne déclenche pas le title natif. */}
        <span
          className="ml-auto hidden md:inline-block"
          title={
            me.hasAnthropicKey
              ? "Analyse tes emails pour ajouter transports, logements et activités"
              : "Ajoute ta clé API Claude dans Réglages pour activer cette fonctionnalité"
          }
        >
          <button
            onClick={() => autofill.mutate()}
            disabled={autofill.isPending || !me.hasAnthropicKey}
            className="btn-primary text-xs disabled:pointer-events-none disabled:opacity-40"
          >
            {autofill.isPending ? "Analyse des emails…" : "✨ Remplir depuis mes emails"}
          </button>
        </span>
      </div>

      {sorted.length === 0 ? (
        <div className="text-sm text-slate-400">Timeline vide — ajoute une étape.</div>
      ) : (
        <ol className="relative space-y-3 border-l-2 border-slate-200 pl-5 dark:border-slate-700">
          {sorted.map((it, i) => {
            const curDay = day(it.startAt);
            const prevDay = i > 0 ? day(sorted[i - 1].startAt) : null;
            const newDay = curDay !== "" && curDay !== prevDay;
            return (
              <Fragment key={it.id}>
                {newDay && <DaySeparator day={curDay} />}
                <TimelineRow
                  item={it}
                  onEdit={() => setModal({ type: it.type, item: it })}
                  onRemove={() => {
                    if (confirm("Supprimer cette étape ?")) remove.mutate(it.id);
                  }}
                  onChanged={invalidate}
                />
              </Fragment>
            );
          })}
        </ol>
      )}

      {modal && (
        <ItemModal
          tripId={tripId}
          type={modal.type}
          item={modal.item}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            invalidate();
          }}
        />
      )}
    </div>
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
function DaySeparator({ day }: { day: string }) {
  const d = new Date(`${day}T00:00:00`);
  const label = isNaN(d.getTime())
    ? day
    : d.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long" });
  return (
    <li className="relative list-none select-none">
      <span className="absolute -left-[1.5rem] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-slate-300 dark:bg-slate-600" />
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium capitalize tracking-wide text-slate-400 dark:text-slate-500">
          {label}
        </span>
        <span className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
      </div>
    </li>
  );
}

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
