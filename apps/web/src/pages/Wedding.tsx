import { useState, useRef, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  WeddingBudgetItem,
  WeddingBudgetFile,
  SavingsContribution,
  WeddingPayment,
  WeddingSummary,
  WeddingTodo,
  WeddingGuest,
  GuestType,
  GuestAge,
  GuestGroup,
  InvitationStatus,
  Member,
  WeddingDay,
  WeddingDayKey,
} from "@gfa/shared";
import {
  GUEST_GROUP,
  WEDDING_DAY_KEYS,
  WEDDING_DAYS_DEFAULT,
  GUEST_TYPE,
  GUEST_TYPE_META,
  GUEST_AGE_META,
  INVITATION_STATUS,
  INVITATION_STATUS_META,
  WEDDING_FILE_MAX_BYTES,
  WEDDING_DATE_PLACEHOLDER,
  WEDDING_SAVINGS_DEFAULT_PER_PERSON,
  WEDDING_SAVINGS_MAX_MONTHS,
  WEDDING_BUDGET_TEMPLATE,
  isAllowedWeddingFile,
} from "@gfa/shared";
import { useMe } from "../auth";
import { api, API_URL } from "../lib/api";
import PageLoader from "../components/PageLoader";
import { eur, eur0, eurToCents, dateFr, dateFrShort, monthFr, todayIso, currentMonth } from "../lib/format";
import { downloadXlsx } from "../lib/xlsx";
import {
  Checkbox,
  DateInput,
  FilterChips,
  Input,
  MobileActionBar,
  SearchField,
  Select,
  Sheet,
  SheetRow,
  SubNav,
  Switch,
  type OverflowItem,
} from "../components/ui";
import { MemberAvatar } from "../components/MemberAvatar";
import { Indicator } from "../components/Indicator";
import { usePageHeader, usePageTabs } from "../components/PageHeader";
import { useNavBadges } from "../lib/badges";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconFilter,
  IconInbox,
  IconMail,
  IconMapPin,
} from "../components/icons";

const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];
const monthName = (ym: string) => MONTHS_FR[Number(ym.slice(5, 7)) - 1] ?? ym;

// Icône affichée pour un invité : enfant → icône enfant, sinon icône de type.
const guestIcon = (g: WeddingGuest) =>
  g.ageGroup === "child" ? GUEST_AGE_META.child : GUEST_TYPE_META[g.type];

// Faire-part : seuls les chefs de famille (sans parent) ont une valeur ; les
// membres rattachés affichent « - ». Chef → menu déroulant compact.
function InvitationCell({
  g,
  onChange,
}: {
  g: WeddingGuest;
  onChange: (s: InvitationStatus) => void;
}) {
  if (g.parentId) return <span className="text-slate-300">-</span>;
  return (
    <select
      value={g.invitationStatus}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value as InvitationStatus)}
      className="w-full rounded-lg border border-slate-300 bg-white px-1.5 py-1 text-xs outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900"
    >
      {INVITATION_STATUS.map((s) => (
        <option key={s} value={s}>
          {INVITATION_STATUS_META[s].label}
        </option>
      ))}
    </select>
  );
}

type Tab = "invites" | "todo" | "budget" | "epargne";

/**
 * Une seule rangée d'onglets pour les quatre écrans de la section. Avant, deux
 * barres empilées (Organisation / Financier, puis des pilules) menaient aux
 * mêmes quatre destinations : une ligne de plus pour un niveau qui n'apportait
 * rien.
 */
const WEDDING_TABS: { id: Tab; label: string }[] = [
  { id: "invites", label: "Invités" },
  { id: "todo", label: "Todo" },
  { id: "budget", label: "Prestataires" },
  { id: "epargne", label: "Épargne" },
];

/** « J−290 · 4 juin 2027 » — le compte à rebours passe en sur-titre. */
function useWeddingEyebrow(): string {
  const { data: badges } = useNavBadges();
  const targetDate = useMe().household.weddingTargetDate;
  const days = badges?.weddingDays;
  const dated =
    targetDate && targetDate !== WEDDING_DATE_PLACEHOLDER
      ? new Date(`${targetDate}T00:00:00`).toLocaleDateString("fr-FR", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : null;
  const countdown = days == null ? null : days === 0 ? "Jour J" : `J−${days}`;
  return [countdown, dated].filter(Boolean).join(" · ") || "Date à définir";
}

export default function Wedding() {
  const navigate = useNavigate();
  const { tab: tabParam } = useParams();
  const tab: Tab = WEDDING_TABS.some((t) => t.id === tabParam) ? (tabParam as Tab) : "invites";

  usePageHeader("Mariage", useWeddingEyebrow());

  // Pastille de l'onglet Todo : ce qui est en retard. La requête est partagée
  // avec l'onglet lui-même (même clé de cache) — pas d'appel supplémentaire, et
  // rien n'est ajouté à `/api/badges`, qui est sur le chemin de toutes les pages.
  const { data: todos } = useQuery({
    queryKey: ["wedding-todos"],
    queryFn: () => api.get<WeddingTodo[]>("/api/wedding/todos"),
  });
  const overdue = (todos ?? []).filter((t) => !t.done && !!t.dueDate && t.dueDate < todayIso()).length;

  const items = WEDDING_TABS.map((t) => ({
    value: t.id,
    label: t.label,
    badge: t.id === "todo" ? overdue : undefined,
  }));
  usePageTabs(tab, items, (v) => navigate(`/wedding/${v}`));

  return (
    <div className="flex flex-col gap-4 pb-28 md:pb-0">
      {/* Sur mobile les onglets vivent dans la barre du haut (`usePageTabs`). */}
      <SubNav
        value={tab}
        onChange={(v) => navigate(`/wedding/${v}`)}
        items={items}
        className="hidden md:block"
      />
      {tab === "invites" && <Invites />}
      {tab === "todo" && <WeddingTodos />}
      {tab === "budget" && <Budget />}
      {tab === "epargne" && <Epargne />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Blocs mobiles partagés par les quatre onglets                       */
/* ------------------------------------------------------------------ */

const pctOf = (part: number, whole: number) =>
  whole > 0 ? Math.max(0, Math.min(100, Math.round((part / whole) * 100))) : 0;

/**
 * Carte-héros : le chiffre qui décide de l'écran, sa jauge, et deux repères en
 * pied. Remplace le mur de quatre tuiles d'égale importance — on ne savait pas
 * laquelle lire en premier.
 */
function HeroStat({
  label,
  value,
  of,
  pct,
  left,
  right,
  leftTone = "muted",
}: {
  label: string;
  value: string;
  of?: string;
  pct: number;
  left?: string;
  right?: string;
  leftTone?: "muted" | "brand";
}) {
  return (
    <div className="card">
      <div className="eyebrow">{label}</div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-4xl font-bold">{value}</span>
        {of && <span className="text-sm text-ink-2">sur {of}</span>}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
        <span
          className="block h-full rounded-full bg-brand-600"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
      {(left || right) && (
        <div className="mt-2 flex items-baseline justify-between gap-3 text-xs">
          <span className={leftTone === "brand" ? "font-medium text-brand-600" : "text-slate-400"}>
            {left}
          </span>
          <span className="text-right text-slate-400">{right}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Encart d'alerte : ce qui coince, en une phrase, avec l'action qui le règle.
 * Ambre = attention, vert = tout va bien (règle des couleurs de données).
 */
function Callout({
  tone = "warning",
  icon,
  title,
  sub,
  action,
}: {
  tone?: "warning" | "brand";
  icon: ReactNode;
  title: string;
  sub?: string;
  action?: { label: string; onClick: () => void };
}) {
  const warn = tone === "warning";
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border p-3.5 ${
        warn ? "border-warning/40 bg-warning-soft" : "border-brand-600/30 bg-brand-50"
      }`}
    >
      <span className={`shrink-0 ${warn ? "text-warning" : "text-brand-600"}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-semibold ${warn ? "text-warning" : "text-brand-700"}`}>
          {title}
        </div>
        {sub && <div className="mt-0.5 text-xs text-ink-2">{sub}</div>}
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className={`min-h-tap shrink-0 rounded-full border px-4 text-sm font-semibold ${
            warn ? "border-warning/50 text-warning" : "border-brand-600/40 text-brand-600"
          }`}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/** Étiquette de section au-dessus d'une carte : « À TRAITER · 6 ». */
function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="eyebrow">{children}</div>
      {right}
    </div>
  );
}

/** Ligne d'un tableau chiffré, sous une `SectionLabel`. */
const rowCls = (last: boolean, minH = "min-h-[60px]") =>
  `flex ${minH} items-center gap-3 ${last ? "" : "border-b border-hairline"}`;

/** Bouton de filtres à côté de la recherche (48 px, actif = liseré vert). */
function FilterButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Filtres"
      aria-pressed={active}
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border ${
        active ? "border-brand-600 text-brand-600" : "border-line bg-surface text-ink-2"
      }`}
    >
      <IconFilter size={20} />
    </button>
  );
}


/* ------------------------------------------------------------------ */
/* Onglets — rendu mobile et rendu ordinateur séparés                  */
/*                                                                     */
/* Les deux branches lisent les mêmes clés TanStack : monter les deux  */
/* ne déclenche aucune requête supplémentaire.                         */
/* ------------------------------------------------------------------ */

function Invites() {
  return (
    <>
      <div className="md:hidden">
        <InvitesMobile />
      </div>
      <div className="hidden md:block">
        <InvitesDesktop />
      </div>
    </>
  );
}

function WeddingTodos() {
  return (
    <>
      <div className="md:hidden">
        <TodosMobile />
      </div>
      <div className="hidden md:block">
        <TodosDesktop />
      </div>
    </>
  );
}

function Budget() {
  return (
    <>
      <div className="md:hidden">
        <BudgetMobile />
      </div>
      <div className="hidden md:block">
        <BudgetDesktop />
      </div>
    </>
  );
}

function Epargne() {
  return (
    <>
      <div className="md:hidden">
        <EpargneMobile />
      </div>
      <div className="hidden md:block">
        <EpargneDesktop />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Invités — mobile                                                    */
/* ------------------------------------------------------------------ */

/**
 * Un **foyer** : l'invité principal et les personnes qui lui sont rattachées.
 * C'est l'unité qu'on relance, à qui on envoie un faire-part et dont on cherche
 * l'adresse — pas la personne. 63 lignes de personnes redeviennent 24 lignes.
 */
interface Foyer {
  principal: WeddingGuest;
  members: WeddingGuest[];
  adults: WeddingGuest[];
  children: WeddingGuest[];
  /** « Marion & Max » — les adultes du foyer. */
  name: string;
  address: string;
  city: string;
}

const foyerAddress = (g: WeddingGuest) =>
  [g.address, [g.postalCode, g.city].filter(Boolean).join(" ")].filter(Boolean).join(", ").trim();

function buildFoyers(guests: WeddingGuest[]): Foyer[] {
  const childrenOf = (pid: string) =>
    guests.filter((g) => g.parentId === pid).sort((a, b) => a.position - b.position);
  return guests
    .filter((g) => !g.parentId)
    .sort((a, b) => a.position - b.position)
    .map((principal) => {
      const members = [principal, ...childrenOf(principal.id)];
      const adults = members.filter((m) => m.ageGroup === "adult");
      const names = (adults.length > 0 ? adults : members).map((m) => m.name);
      const name =
        names.length <= 2 ? names.join(" & ") : `${names[0]} & ${names[1]} +${names.length - 2}`;
      return {
        principal,
        members,
        adults,
        children: members.filter((m) => m.ageGroup === "child"),
        name: name || principal.name,
        address: foyerAddress(principal),
        city: principal.city ?? "",
      };
    });
}

/** Faire-part encore à envoyer, ou adresse manquante : le foyer est « à traiter ». */
const foyerNeedsWork = (f: Foyer) => !f.address || f.principal.invitationStatus === "to_send";

/** Pastille d'initiales — le foyer n'a pas de photo, ses initiales le distinguent. */
function FoyerInitials({ name, className = "h-10 w-10 text-sm" }: { name: string; className?: string }) {
  const initials =
    name
      .split(/[\s&]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join("") || "?";
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-surface-2 font-semibold text-ink-2 ${className}`}
    >
      {initials}
    </span>
  );
}

/**
 * Présence du foyer, un carré par jour. Vert = quelqu'un du foyer est là ; le
 * détail personne par personne vit dans la feuille du foyer, pas dans la liste
 * (189 cases à cocher en enfilade ne se lisent pas).
 */
function DayPills({ foyer, days }: { foyer: Foyer; days: WeddingDay[] }) {
  return (
    <span className="flex shrink-0 gap-1" aria-hidden="true">
      {days.map((d) => {
        const on = foyer.members.some((m) => m[d.key]);
        return (
          <span
            key={d.key}
            title={d.label}
            className={`flex h-6 w-6 items-center justify-center rounded-md text-2xs font-bold ${
              on ? "bg-brand-600 text-on-brand" : "border border-line text-ink-3"
            }`}
          >
            {d.label.charAt(0).toUpperCase()}
          </span>
        );
      })}
    </span>
  );
}

/** Tuile chiffrée du récapitulatif (un jour, ou l'avancement des faire-part). */
function CountTile({ label, value, tone }: { label: string; value: string; tone?: "warning" }) {
  return (
    <div className="rounded-xl bg-surface-2 px-1.5 py-2 text-center">
      <div className="eyebrow" style={{ lineHeight: 1.25 }}>
        {label}
      </div>
      <div className={`mt-1 text-lg font-bold ${tone === "warning" ? "text-warning" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function FoyerRow({
  foyer,
  days,
  onOpen,
  last,
}: {
  foyer: Foyer;
  days: WeddingDay[];
  onOpen: () => void;
  last: boolean;
}) {
  const persons = `${foyer.members.length} pers.`;
  // L'anomalie en clair prime sur le lieu : c'est elle qui appelle une action.
  const [Icon, detail] = !foyer.address
    ? [IconMapPin, "adresse manquante"]
    : foyer.principal.invitationStatus === "to_send"
      ? [IconMail, "à envoyer"]
      : [
          IconCheck,
          [foyer.city, INVITATION_STATUS_META[foyer.principal.invitationStatus].label.toLowerCase()]
            .filter((v) => v && v !== "-")
            .join(" · "),
        ];
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full text-left ${rowCls(last)}`}
      aria-label={`Ouvrir le foyer ${foyer.name}`}
    >
      <FoyerInitials name={foyer.name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold">{foyer.name}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-2">
          <Icon size={14} className="shrink-0" />
          <span className="truncate">{[persons, detail].filter(Boolean).join(" · ")}</span>
        </span>
      </span>
      <DayPills foyer={foyer} days={days} />
      <IconChevronRight size={20} className="shrink-0 text-slate-400" />
    </button>
  );
}

/** Nombre de foyers montrés dans « À traiter » avant le dépliage. */
const TRIAGE_PREVIEW = 2;

function InvitesMobile() {
  const qc = useQueryClient();
  const weddingDays = useWeddingDays();
  const { data } = useQuery({
    queryKey: ["wedding-guests"],
    queryFn: () => api.get<WeddingGuest[]>("/api/wedding/guests"),
  });

  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [addressFilter, setAddressFilter] = useState<"all" | "with" | "without">("all");
  const [invitFilter, setInvitFilter] = useState<"all" | "to_send" | "done">("all");
  const [showArchived, setShowArchived] = useState(false);
  const [triageOpen, setTriageOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ open: boolean; item: WeddingGuest | null }>({
    open: false,
    item: null,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["wedding-guests"] });

  if (!data) return <PageLoader variant="mariage" />;

  const active = data.filter((g) => !g.archived);
  const foyers = buildFoyers(active);
  const archivedFoyers = buildFoyers(data.filter((g) => g.archived));

  // Récapitulatif : toujours sur l'ensemble des invités, jamais sur le filtre —
  // un chiffre-héros qui bouge avec une recherche ne veut plus rien dire.
  const persons = active.length;
  const adults = active.filter((g) => g.ageGroup === "adult").length;
  const children = persons - adults;
  const invitSent = foyers.filter((f) => f.principal.invitationStatus !== "to_send" && f.principal.invitationStatus !== "none").length;

  const q = search.trim().toLowerCase();
  const passes = (f: Foyer) => {
    if (addressFilter === "with" && !f.address) return false;
    if (addressFilter === "without" && f.address) return false;
    if (invitFilter === "to_send" && f.principal.invitationStatus !== "to_send") return false;
    if (invitFilter === "done" && f.principal.invitationStatus === "to_send") return false;
    if (q) {
      const hay = `${f.name} ${f.members.map((m) => m.name).join(" ")} ${f.address}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };

  const source = showArchived ? archivedFoyers : foyers;
  const shown = source.filter(passes);
  const triage = showArchived ? [] : shown.filter(foyerNeedsWork);
  const triageShown = triageOpen ? triage : triage.slice(0, TRIAGE_PREVIEW);
  const filterCount =
    (addressFilter !== "all" ? 1 : 0) + (invitFilter !== "all" ? 1 : 0) + (showArchived ? 1 : 0);

  const openFoyer = shown.find((f) => f.principal.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="card">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-4xl font-bold">{persons}</span>
          <span className="text-sm text-ink-2">
            invités · {adults} adultes, {children} enfants · {foyers.length} foyers
          </span>
        </div>
        <div
          className="mt-3 grid gap-2"
          style={{ gridTemplateColumns: `repeat(${weddingDays.length + 1}, minmax(0, 1fr))` }}
        >
          {weddingDays.map((d) => (
            <CountTile
              key={d.key}
              label={d.label.slice(0, 3)}
              value={String(active.filter((g) => g[d.key]).length)}
            />
          ))}
          <CountTile
            label="Faire-part"
            value={`${invitSent} / ${foyers.length}`}
            tone={invitSent < foyers.length ? "warning" : undefined}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Nom, foyer, ville…"
          className="min-w-0 flex-1"
        />
        <FilterButton active={filterCount > 0} onClick={() => setFiltersOpen(true)} />
      </div>

      {triage.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionLabel>À traiter · {triage.length}</SectionLabel>
          <div className="card">
            {triageShown.map((f, i) => (
              <FoyerRow
                key={f.principal.id}
                foyer={f}
                days={weddingDays}
                onOpen={() => setOpenId(f.principal.id)}
                last={i === triageShown.length - 1 && triage.length <= TRIAGE_PREVIEW}
              />
            ))}
            {triage.length > TRIAGE_PREVIEW && (
              <button
                type="button"
                onClick={() => setTriageOpen((v) => !v)}
                aria-expanded={triageOpen}
                className="flex min-h-tap w-full items-center justify-between text-sm font-medium text-brand-600"
              >
                {triageOpen ? "Réduire" : `Voir les ${triage.length - TRIAGE_PREVIEW} autres`}
                <IconChevronDown size={18} className={triageOpen ? "rotate-180" : ""} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <SectionLabel>
          {showArchived ? "Non invités" : "Tous les foyers"} · {shown.length}
        </SectionLabel>
        {shown.length === 0 ? (
          <div className="card text-center">
            <div className="font-semibold">
              {source.length === 0 ? "Aucun foyer pour l'instant." : "Aucun foyer dans ce filtre."}
            </div>
            {source.length === 0 && (
              <button
                onClick={() => setModal({ open: true, item: null })}
                className="btn-primary mt-3"
              >
                Ajouter le premier
              </button>
            )}
          </div>
        ) : (
          <div className="card">
            {shown.map((f, i) => (
              <FoyerRow
                key={f.principal.id}
                foyer={f}
                days={weddingDays}
                onOpen={() => setOpenId(f.principal.id)}
                last={i === shown.length - 1}
              />
            ))}
          </div>
        )}
      </div>

      <MobileActionBar label="Ajouter un foyer" onClick={() => setModal({ open: true, item: null })} />

      {openFoyer && (
        <FoyerSheet
          key={openFoyer.principal.id}
          foyer={openFoyer}
          days={weddingDays}
          onClose={() => setOpenId(null)}
          onEdit={(g) => {
            setOpenId(null);
            setModal({ open: true, item: g });
          }}
        />
      )}

      {filtersOpen && (
        <Sheet
          title="Filtres"
          subtitle={`${shown.length} foyer${shown.length > 1 ? "s" : ""} affiché${shown.length > 1 ? "s" : ""}`}
          onClose={() => setFiltersOpen(false)}
          footer={
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setAddressFilter("all");
                  setInvitFilter("all");
                  setShowArchived(false);
                }}
                className="btn-ghost min-h-tap shrink-0 rounded-full px-5"
              >
                Réinitialiser
              </button>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="btn-primary h-[52px] flex-1 rounded-full text-base"
              >
                Voir les résultats
              </button>
            </div>
          }
        >
          <div className="flex flex-col gap-5 p-4">
            <div>
              <div className="eyebrow mb-2">Adresse</div>
              <FilterChips
                value={addressFilter}
                onChange={(v) => setAddressFilter(v as typeof addressFilter)}
                items={[
                  { value: "all", label: "Toutes" },
                  { value: "with", label: "Avec adresse" },
                  { value: "without", label: "Sans adresse" },
                ]}
              />
            </div>
            <div>
              <div className="eyebrow mb-2">Faire-part</div>
              <FilterChips
                value={invitFilter}
                onChange={(v) => setInvitFilter(v as typeof invitFilter)}
                items={[
                  { value: "all", label: "Tous" },
                  { value: "to_send", label: "À envoyer" },
                  { value: "done", label: "Envoyé" },
                ]}
              />
            </div>
            <SheetRow
              label="Non invités"
              hint="Les foyers écartés, hors des totaux."
              trailing={<Switch checked={showArchived} onChange={() => setShowArchived((v) => !v)} />}
            />
          </div>
        </Sheet>
      )}

      {modal.open && (
        <GuestModal
          key={modal.item?.id ?? "new"}
          item={modal.item}
          defaultGroup={modal.item?.guestGroup ?? "vendredi"}
          onClose={() => setModal({ open: false, item: null })}
          onSaved={() => {
            setModal({ open: false, item: null });
            invalidate();
          }}
        />
      )}
    </div>
  );
}

/**
 * Faire-part : trois états qui comptent. « Ouvert » (statut hérité) se lit
 * comme « Envoyé » — c'en est un — et reste modifiable depuis l'ordinateur.
 */
const INVIT_SEGMENTS: { value: InvitationStatus; label: string }[] = [
  { value: "to_send", label: "À envoyer" },
  { value: "sent", label: "Envoyé" },
  { value: "filled", label: "Répondu" },
];

/**
 * Feuille d'un foyer : l'adresse, la présence personne par personne et le
 * faire-part au même endroit. Les modifications sont mises de côté et
 * enregistrées d'un coup — on coche six cases avant de valider, pas six
 * requêtes.
 */
function FoyerSheet({
  foyer,
  days,
  onClose,
  onEdit,
}: {
  foyer: Foyer;
  days: WeddingDay[];
  onClose: () => void;
  onEdit: (g: WeddingGuest) => void;
}) {
  const qc = useQueryClient();
  type Presence = Record<WeddingDayKey, boolean>;
  const [presence, setPresence] = useState<Record<string, Presence>>(() =>
    Object.fromEntries(
      foyer.members.map((m) => [m.id, { vendredi: m.vendredi, samedi: m.samedi, dimanche: m.dimanche }]),
    ),
  );
  const [status, setStatus] = useState<InvitationStatus>(foyer.principal.invitationStatus);
  const [addr, setAddr] = useState({
    address: foyer.principal.address ?? "",
    postalCode: foyer.principal.postalCode ?? "",
    city: foyer.principal.city ?? "",
  });
  const [editAddr, setEditAddr] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["wedding-guests"] });
  // Un invité rattaché au tableau « à partir du samedi » n'a pas de vendredi :
  // la case existe mais reste inerte, comme sur l'ordinateur.
  const dayActive = (m: WeddingGuest, key: WeddingDayKey) =>
    m.guestGroup === "vendredi" || key !== "vendredi";

  const save = useMutation({
    mutationFn: async () => {
      for (const m of foyer.members) {
        const next = presence[m.id];
        const body: Partial<WeddingGuest> = {};
        for (const d of days) {
          if (dayActive(m, d.key) && next[d.key] !== m[d.key]) body[d.key] = next[d.key];
        }
        if (Object.keys(body).length > 0) await api.patch(`/api/wedding/guests/${m.id}`, body);
      }
      const p = foyer.principal;
      const head: Partial<WeddingGuest> = {};
      if (status !== p.invitationStatus) head.invitationStatus = status;
      if (addr.address !== (p.address ?? "")) head.address = addr.address || null;
      if (addr.postalCode !== (p.postalCode ?? "")) head.postalCode = addr.postalCode || null;
      if (addr.city !== (p.city ?? "")) head.city = addr.city || null;
      if (Object.keys(head).length > 0) await api.patch(`/api/wedding/guests/${p.id}`, head);
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const archiveAll = useMutation({
    mutationFn: async () => {
      for (const m of foyer.members) {
        await api.patch(`/api/wedding/guests/${m.id}`, { archived: !foyer.principal.archived });
      }
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });
  const removeAll = useMutation({
    mutationFn: async () => {
      // Les rattachés d'abord : supprimer le principal les détacherait au lieu
      // de les supprimer, et le foyer réapparaîtrait en morceaux.
      for (const m of foyer.members.slice(1)) await api.del(`/api/wedding/guests/${m.id}`);
      await api.del(`/api/wedding/guests/${foyer.principal.id}`);
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const setDay = (id: string, key: WeddingDayKey, v: boolean) =>
    setPresence((prev) => ({ ...prev, [id]: { ...prev[id], [key]: v } }));
  const checkAll = () =>
    setPresence(
      Object.fromEntries(
        foyer.members.map((m) => [
          m.id,
          {
            vendredi: dayActive(m, "vendredi") || m.vendredi,
            samedi: true,
            dimanche: true,
          } as Presence,
        ]),
      ),
    );

  const actions: OverflowItem[] = [
    { label: `Modifier ${foyer.principal.name}`, onClick: () => onEdit(foyer.principal) },
    {
      label: foyer.principal.archived ? "Remettre dans les invités" : "Retirer des invités",
      onClick: () => archiveAll.mutate(),
    },
    {
      label: "Supprimer le foyer",
      danger: true,
      onClick: () => {
        if (confirm(`Supprimer le foyer « ${foyer.name} » et ses ${foyer.members.length} personnes ?`))
          removeAll.mutate();
      },
    },
  ];

  const subtitle = [
    `${foyer.members.length} personne${foyer.members.length > 1 ? "s" : ""}`,
    foyer.children.length > 0
      ? `${foyer.children.length} enfant${foyer.children.length > 1 ? "s" : ""}`
      : null,
    GUEST_TYPE_META[foyer.principal.type].label,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Sheet
      title={foyer.name}
      subtitle={subtitle}
      thumbnail={<FoyerInitials name={foyer.name} />}
      actions={actions}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="btn-primary h-[52px] w-full rounded-full text-base"
        >
          {save.isPending ? "Enregistrement…" : "Enregistrer"}
        </button>
      }
    >
      <div className="flex flex-col gap-5 p-4">
        {editAddr ? (
          <div className="flex flex-col gap-2">
            <Input
              autoFocus
              placeholder="Adresse — n° et rue"
              value={addr.address}
              onChange={(e) => setAddr({ ...addr, address: e.target.value })}
            />
            <div className="grid grid-cols-3 gap-2">
              <Input
                placeholder="Code postal"
                value={addr.postalCode}
                onChange={(e) => setAddr({ ...addr, postalCode: e.target.value })}
              />
              <Input
                className="col-span-2"
                placeholder="Ville"
                value={addr.city}
                onChange={(e) => setAddr({ ...addr, city: e.target.value })}
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 rounded-xl border border-line p-3">
            <IconMapPin
              size={18}
              className={`shrink-0 ${addr.address || addr.city ? "text-ink-2" : "text-warning"}`}
            />
            <span
              className={`min-w-0 flex-1 truncate text-sm ${addr.address || addr.city ? "" : "text-warning"}`}
            >
              {[addr.address, [addr.postalCode, addr.city].filter(Boolean).join(" ")]
                .filter(Boolean)
                .join(", ") || "Adresse manquante"}
            </span>
            <button
              type="button"
              onClick={() => setEditAddr(true)}
              className="shrink-0 text-sm font-medium text-brand-600"
            >
              Modifier
            </button>
          </div>
        )}

        <div>
          <SectionLabel
            right={
              <button type="button" onClick={checkAll} className="text-sm font-medium text-brand-600">
                Tout cocher
              </button>
            }
          >
            Présence
          </SectionLabel>
          <div className="mt-2 rounded-xl border border-line">
            <div className="flex items-center gap-2 border-b border-hairline px-3 py-1.5">
              <span className="min-w-0 flex-1" />
              {days.map((d) => (
                <span key={d.key} className="eyebrow w-10 text-center" style={{ lineHeight: 1.25 }}>
                  {d.label.slice(0, 3)}
                </span>
              ))}
            </div>
            {foyer.members.map((m, i) => (
              <div
                key={m.id}
                className={`flex min-h-tap items-center gap-2 px-3 py-2 ${i > 0 ? "border-t border-hairline" : ""}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base">{m.name}</span>
                  {m.ageGroup === "child" && (
                    <span className="block text-xs text-slate-400">enfant</span>
                  )}
                </span>
                {days.map((d) => (
                  <span key={d.key} className="flex w-10 justify-center">
                    {dayActive(m, d.key) ? (
                      <span aria-label={`${m.name} — ${d.label}`}>
                        <Checkbox
                          checked={presence[m.id][d.key]}
                          onChange={() => setDay(m.id, d.key, !presence[m.id][d.key])}
                        />
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="eyebrow mb-2">Faire-part</div>
          <div className="grid grid-cols-3 gap-2">
            {INVIT_SEGMENTS.map((seg) => {
              const on = status === seg.value || (seg.value === "sent" && status === "opened");
              const warn = seg.value === "to_send";
              return (
                <button
                  key={seg.value}
                  type="button"
                  onClick={() => setStatus(seg.value)}
                  aria-pressed={on}
                  className={`min-h-tap rounded-xl border px-2 text-sm font-medium transition ${
                    on
                      ? warn
                        ? "border-warning bg-warning-soft text-warning"
                        : "border-brand-600 bg-brand-50 text-brand-700"
                      : "border-line text-ink-2"
                  }`}
                >
                  {seg.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Le statut retire le foyer de « À traiter » sur la liste.
          </p>
        </div>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Todo — mobile                                                       */
/* ------------------------------------------------------------------ */

/** Nombre de jours entiers entre deux dates ISO (positif si `to` est après). */
const daysBetween = (from: string, to: string) =>
  Math.round(
    (new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000,
  );

function TodoRow({
  todo,
  onToggle,
  onOpen,
  pending,
  last,
}: {
  todo: WeddingTodo;
  onToggle: () => void;
  onOpen: () => void;
  pending: boolean;
  last: boolean;
}) {
  const today = todayIso();
  const late = !todo.done && !!todo.dueDate && todo.dueDate < today;
  const lateBy = late ? daysBetween(todo.dueDate!, today) : 0;
  const meta = [
    todo.dueDate ? dateFr(todo.dueDate) : "sans échéance",
    late ? `${lateBy} jour${lateBy > 1 ? "s" : ""} de retard` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className={`${rowCls(last)} ${pending ? "opacity-50" : ""}`}>
      <span className="-ml-2 flex h-tap w-tap shrink-0 items-center justify-center">
        <Checkbox
          size="lg"
          checked={todo.done}
          onChange={onToggle}
          label={todo.done ? "Marquer à faire" : "Marquer faite"}
        />
      </span>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 py-2 text-left">
        <span className={`block text-base font-medium ${todo.done ? "text-ink-3 line-through" : ""}`}>
          {todo.description}
        </span>
        <span className={`mt-0.5 block truncate text-xs ${late ? "text-danger" : "text-ink-2"}`}>
          {meta}
        </span>
      </button>
      {todo.owner && <MemberAvatar id={todo.owner} className="h-7 w-7 shrink-0 text-2xs" />}
    </div>
  );
}

function TodosMobile() {
  const qc = useQueryClient();
  const members = useMe().household.members;
  const [filter, setFilter] = useState<"all" | Member | "none">("all");
  const [modal, setModal] = useState<{ open: boolean; item: WeddingTodo | null }>({
    open: false,
    item: null,
  });

  const { data } = useQuery({
    queryKey: ["wedding-todos"],
    queryFn: () => api.get<WeddingTodo[]>("/api/wedding/todos"),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["wedding-todos"] });
  const toggle = useMutation({
    mutationFn: (t: WeddingTodo) => api.patch(`/api/wedding/todos/${t.id}`, { done: !t.done }),
    onSuccess: invalidate,
  });

  if (!data) return <PageLoader variant="mariage" />;

  const today = todayIso();
  const endOfMonth = `${today.slice(0, 7)}-31`;
  const matches = (t: WeddingTodo) =>
    filter === "all" || (filter === "none" ? !t.owner : t.owner === filter);
  const rows = data.filter(matches);
  const open = rows.filter((t) => !t.done);

  const groups: { key: string; label: string; items: WeddingTodo[] }[] = [
    {
      key: "late",
      label: "En retard",
      items: open.filter((t) => t.dueDate && t.dueDate < today),
    },
    {
      key: "month",
      label: "Ce mois",
      items: open.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= endOfMonth),
    },
    {
      key: "later",
      label: "Plus tard",
      items: open.filter((t) => t.dueDate && t.dueDate > endOfMonth),
    },
    { key: "undated", label: "Sans échéance", items: open.filter((t) => !t.dueDate) },
    { key: "done", label: "Faites", items: rows.filter((t) => t.done) },
  ].filter((g) => g.items.length > 0);

  // La progression porte sur toutes les tâches, pas sur le filtre courant.
  const done = data.filter((t) => t.done).length;
  const late = data.filter((t) => !t.done && t.dueDate && t.dueDate < today).length;
  const thisMonth = data.filter(
    (t) => !t.done && t.dueDate && t.dueDate >= today && t.dueDate <= endOfMonth,
  ).length;
  const pct = pctOf(done, data.length);

  return (
    <div className="flex flex-col gap-4">
      <div className="card">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold">
              {done} tâche{done > 1 ? "s" : ""} sur {data.length} faite{done > 1 ? "s" : ""}
            </div>
            <div className="mt-0.5 text-xs text-slate-400">
              {[
                late > 0 ? `${late} en retard` : null,
                thisMonth > 0 ? `${thisMonth} ce mois` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Rien d'urgent"}
            </div>
          </div>
          <div className="w-24 shrink-0">
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <span className="block h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 text-right text-xs text-slate-400">{pct} %</div>
          </div>
        </div>
      </div>

      <FilterChips
        value={filter}
        onChange={(v) => setFilter(v as typeof filter)}
        items={[
          { value: "all", label: "Tout" },
          { value: "a", label: members.a.name },
          { value: "b", label: members.b.name },
          { value: "none", label: "Sans responsable" },
        ]}
      />

      {groups.length === 0 ? (
        <div className="card text-center">
          <div className="font-semibold">
            {data.length === 0 ? "Aucune tâche pour l'instant." : "Aucune tâche dans ce filtre."}
          </div>
          <button onClick={() => setModal({ open: true, item: null })} className="btn-primary mt-3">
            Ajouter la première
          </button>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.key} className="flex flex-col gap-2">
            <SectionLabel>
              {g.label} · {g.items.length}
            </SectionLabel>
            <div className="card">
              {g.items.map((t, i) => (
                <TodoRow
                  key={t.id}
                  todo={t}
                  pending={toggle.isPending && toggle.variables?.id === t.id}
                  onToggle={() => toggle.mutate(t)}
                  onOpen={() => setModal({ open: true, item: t })}
                  last={i === g.items.length - 1}
                />
              ))}
            </div>
          </div>
        ))
      )}

      <MobileActionBar label="Nouvelle tâche" onClick={() => setModal({ open: true, item: null })} />

      {modal.open && (
        <TodoModal
          key={modal.item?.id ?? "new"}
          item={modal.item}
          onClose={() => setModal({ open: false, item: null })}
          onSaved={() => {
            setModal({ open: false, item: null });
            invalidate();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Prestataires — mobile                                               */
/* ------------------------------------------------------------------ */

type BudgetFilter = "all" | "a-payer" | "a-chercher" | "paye";

const BUDGET_FILTERS: { value: BudgetFilter; label: string }[] = [
  { value: "all", label: "Tout" },
  { value: "a-payer", label: "À payer" },
  { value: "a-chercher", label: "À chercher" },
  { value: "paye", label: "Payé" },
];

/** Pastille de statut d'un poste — un mot, pas une couleur de carte entière. */
function StatusPill({ k }: { k: BudgetStatus }) {
  const tone =
    k === "paye"
      ? "bg-brand-600/15 text-brand-700"
      : k === "partiel"
        ? "bg-warning-soft text-warning"
        : k === "trouve"
          ? "bg-info-soft text-info"
          : "bg-surface-2 text-ink-2";
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold ${tone}`}>
      {k === "partiel" ? "Partiel" : BUDGET_STATUS_META[k].label}
    </span>
  );
}

function BudgetMobile() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<BudgetFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<WeddingBudgetItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [payModal, setPayModal] = useState<{
    item: WeddingBudgetItem;
    payment: WeddingPayment | null;
    defaultAmount: number;
  } | null>(null);

  const { data } = useQuery({
    queryKey: ["wedding-budget"],
    queryFn: () => api.get<WeddingBudgetItem[]>("/api/wedding/budget"),
  });
  const { data: payments } = useQuery({
    queryKey: ["wedding-payments"],
    queryFn: () => api.get<WeddingPayment[]>("/api/wedding/payments"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["wedding-budget"] });
    qc.invalidateQueries({ queryKey: ["wedding-payments"] });
    qc.invalidateQueries({ queryKey: ["wedding-summary"] });
  };
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/wedding/budget/${id}`),
    onSuccess: invalidate,
  });
  const togglePaid = useMutation({
    mutationFn: (p: WeddingPayment) =>
      api.patch(`/api/wedding/payments/${p.id}`, {
        amountPaid: p.amountPaid >= p.amountDue ? 0 : p.amountDue,
      }),
    onSuccess: invalidate,
  });
  const removePayment = useMutation({
    mutationFn: (id: string) => api.del(`/api/wedding/payments/${id}`),
    onSuccess: invalidate,
  });

  if (!data || !payments) return <PageLoader variant="mariage" />;
  if (data.length === 0) return <InitBudget onCreated={invalidate} />;

  const itemById = new Map(data.map((i) => [i.id, i]));
  const linked = payments.filter((p) => !!p.budgetItemId && itemById.has(p.budgetItemId));
  const paymentsOf = (id: string) =>
    linked
      .filter((p) => p.budgetItemId === id)
      .sort((a, b) => (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99"));
  const paidOf = (id: string) => paymentsOf(id).reduce((s, p) => s + p.amountPaid, 0);

  const total = data.reduce((s, i) => s + i.amount, 0);
  const paidTotal = linked.reduce((s, p) => s + p.amountPaid, 0);
  const reste = data.reduce((s, i) => s + Math.max(0, i.amount - paidOf(i.id)), 0);
  const found = data.filter((i) => i.prestataire && i.prestataire.trim()).length;

  // Prochain paiement dû : la seule échéance qui appelle une action aujourd'hui.
  const next = linked
    .filter((p) => p.amountPaid < p.amountDue && p.dueDate)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

  const statusOf = (i: WeddingBudgetItem) => budgetStatus(i, paidOf(i.id));
  const matches = (i: WeddingBudgetItem) => {
    const st = statusOf(i);
    if (filter === "a-payer") return st === "trouve" || st === "partiel";
    if (filter === "a-chercher") return st === "recherche";
    if (filter === "paye") return st === "paye";
    return true;
  };
  const shown = data.filter(matches);
  const groups = [...new Set(shown.map((i) => i.groupName))];

  const openItem = openId ? (itemById.get(openId) ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      <HeroStat
        label="Reste à payer"
        value={eur0(reste)}
        of={eur0(total)}
        pct={pctOf(paidTotal, total)}
        left={`${eur0(paidTotal)} payés`}
        right={`${found} poste${found > 1 ? "s" : ""} sur ${data.length} trouvé${found > 1 ? "s" : ""}`}
      />

      {next && (
        <Callout
          icon={<IconClock size={20} />}
          title={`Prochain paiement · ${dateFrShort(next.dueDate)}`}
          sub={[itemById.get(next.budgetItemId!)?.label, next.type, eur0(next.amountDue)]
            .filter(Boolean)
            .join(" · ")}
          action={{ label: "Payer", onClick: () => togglePaid.mutate(next) }}
        />
      )}

      <FilterChips
        value={filter}
        onChange={(v) => setFilter(v as BudgetFilter)}
        items={BUDGET_FILTERS}
      />

      {groups.length === 0 ? (
        <div className="card text-sm text-slate-400">Aucun poste dans ce filtre.</div>
      ) : (
        groups.map((g) => {
          const items = shown.filter((i) => i.groupName === g);
          const gTotal = items.reduce((s, i) => s + i.amount, 0);
          const gReste = items.reduce((s, i) => s + Math.max(0, i.amount - paidOf(i.id)), 0);
          return (
            <div key={g} className="flex flex-col gap-2">
              <SectionLabel
                right={
                  <span className="shrink-0 text-xs text-slate-400">
                    <span className="font-semibold text-ink">{eur0(gTotal)}</span>
                    {gReste > 0 && <> · reste {eur0(gReste)}</>}
                  </span>
                }
              >
                {g}
              </SectionLabel>
              <div className="card">
                {items.map((i, idx) => {
                  const paid = paidOf(i.id);
                  const left = i.amount - paid;
                  const n = paymentsOf(i.id).length;
                  return (
                    <button
                      key={i.id}
                      type="button"
                      onClick={() => setOpenId(i.id)}
                      className={`w-full text-left ${rowCls(idx === items.length - 1)}`}
                    >
                      <span className="min-w-0 flex-1 py-2">
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 truncate text-base font-semibold">{i.label}</span>
                          <StatusPill k={statusOf(i)} />
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-ink-2">
                          {[
                            i.prestataire || "prestataire à trouver",
                            n > 0 ? `${n} paiement${n > 1 ? "s" : ""}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-base font-semibold">{eur0(i.amount)}</span>
                        <span
                          className={`block text-xs ${left > 0 ? "text-warning" : "text-brand-600"}`}
                        >
                          {left > 0 ? `reste ${eur0(left)}` : "soldé"}
                        </span>
                      </span>
                      <IconChevronRight size={20} className="shrink-0 text-slate-400" />
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      <MobileActionBar label="Nouveau poste" onClick={() => setCreating(true)} />

      {openItem && (
        <Sheet
          key={openItem.id}
          title={openItem.label}
          subtitle={[openItem.prestataire || "prestataire à trouver", eur0(openItem.amount)].join(" · ")}
          onClose={() => setOpenId(null)}
          actions={[
            { label: "Modifier le poste", onClick: () => setEditing(openItem) },
            {
              label: "Supprimer le poste",
              danger: true,
              onClick: () => {
                if (confirm(`Supprimer « ${openItem.label} » ?`)) {
                  remove.mutate(openItem.id);
                  setOpenId(null);
                }
              },
            },
          ]}
        >
          <div className="p-3">
            <ExpenseDetail
              item={openItem}
              payments={paymentsOf(openItem.id)}
              scheduled={paymentsOf(openItem.id).reduce((s, p) => s + p.amountDue, 0)}
              onEditItem={() => setEditing(openItem)}
              onDelete={() => {
                if (confirm(`Supprimer « ${openItem.label} » ?`)) {
                  remove.mutate(openItem.id);
                  setOpenId(null);
                }
              }}
              onAddPayment={() =>
                setPayModal({
                  item: openItem,
                  payment: null,
                  defaultAmount: Math.max(
                    0,
                    openItem.amount - paymentsOf(openItem.id).reduce((s, p) => s + p.amountDue, 0),
                  ),
                })
              }
              onEditPayment={(p) =>
                setPayModal({ item: openItem, payment: p, defaultAmount: p.amountDue })
              }
              onTogglePaid={(p) => togglePaid.mutate(p)}
              onRemovePayment={(id) => removePayment.mutate(id)}
            />
          </div>
        </Sheet>
      )}

      {(creating || editing) && (
        <BudgetModal
          key={editing?.id ?? "new"}
          item={editing}
          groups={[...new Set(data.map((i) => i.groupName))]}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            invalidate();
          }}
        />
      )}

      {payModal && (
        <PaymentModal
          key={payModal.payment?.id ?? `new-${payModal.item.id}`}
          item={payModal.item}
          payment={payModal.payment}
          defaultAmount={payModal.defaultAmount}
          onClose={() => setPayModal(null)}
          onSaved={() => {
            setPayModal(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Épargne — mobile                                                    */
/* ------------------------------------------------------------------ */

function EpargneMobile() {
  const qc = useQueryClient();
  const members = useMe().household.members;
  const [year, setYear] = useState<string | null>(null);
  const [entry, setEntry] = useState<SavingsContribution | null>(null);

  const summaryQ = useQuery({
    queryKey: ["wedding-summary"],
    queryFn: () => api.get<WeddingSummary>("/api/wedding/summary"),
  });
  const contribQ = useQuery({
    queryKey: ["wedding-savings"],
    queryFn: () => api.get<SavingsContribution[]>("/api/wedding/savings"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["wedding-savings"] });
    qc.invalidateQueries({ queryKey: ["wedding-summary"] });
  };
  const markPaid = useMutation({
    mutationFn: (p: { id: string; member: Member }) =>
      api.patch(`/api/wedding/savings/${p.id}`, { [p.member === "a" ? "realizedA" : "realizedB"]: true }),
    onSuccess: invalidate,
  });

  if (!summaryQ.data || !contribQ.data) return <PageLoader variant="mariage" />;
  const s = summaryQ.data;
  if (contribQ.data.length === 0) return <InitSavingsPlan targetDate={s.targetDate} />;

  const sorted = [...contribQ.data].sort((a, b) => a.month.localeCompare(b.month));
  const cumulById = new Map<string, number>();
  let running = 0;
  for (const ct of sorted) {
    running += ct.amountA + ct.amountB;
    cumulById.set(ct.id, running);
  }
  const nowMonth = currentMonth();
  const years = [...new Set(sorted.map((c) => c.month.slice(0, 4)))];
  const shownYear = year && years.includes(year) ? year : (years.find((y) => y >= nowMonth.slice(0, 4)) ?? years[0]);
  const thisMonth = sorted.find((c) => c.month === nowMonth) ?? null;

  // Le mois à saisir en priorité : le mois courant, sinon le premier non versé.
  const toEnter =
    thisMonth && (!thisMonth.realizedA || !thisMonth.realizedB)
      ? thisMonth
      : (sorted.find((c) => c.month <= nowMonth && (!c.realizedA || !c.realizedB)) ?? thisMonth ?? sorted[0]);

  const late = s.surplus < 0;

  return (
    <div className="flex flex-col gap-4">
      <HeroStat
        label="Mis de côté"
        value={eur0(s.savedToDate)}
        of={eur0(s.targetAmount)}
        pct={s.percentFunded}
        left={`${s.percentFunded} % financé`}
        leftTone="brand"
        right={`${eur0(s.savedToDate - s.totalPaid)} en compte · ${eur0(s.totalPaid)} payés`}
      />

      <Callout
        tone={late ? "warning" : "brand"}
        icon={late ? <IconInbox size={20} /> : <IconCheck size={20} />}
        title={
          late
            ? `${eur0(-s.surplus)} de retard sur la cible`
            : `${eur0(s.surplus)} d'avance sur la cible`
        }
        sub={`cible à date ${eur0(s.shouldHaveByNow)} · ${eur0(s.monthlyRequired)} / mois pour tenir`}
      />

      {thisMonth && (
        <div className="flex flex-col gap-2">
          <SectionLabel>Ce mois · {monthFr(nowMonth)}</SectionLabel>
          <div className="card">
            {(["a", "b"] as Member[]).map((m) => {
              const amount = m === "a" ? thisMonth.amountA : thisMonth.amountB;
              const paid = m === "a" ? thisMonth.realizedA : thisMonth.realizedB;
              return (
                <div key={m} className={rowCls(false)}>
                  <MemberAvatar id={m} className="h-9 w-9 shrink-0 text-sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-medium">{members[m].name}</div>
                    <div className="text-xs text-slate-400">{paid ? "versé" : "à verser"}</div>
                  </div>
                  {paid ? (
                    <span className="shrink-0 text-base font-semibold">{eur0(amount)}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => markPaid.mutate({ id: thisMonth.id, member: m })}
                      disabled={markPaid.isPending}
                      className="min-h-tap shrink-0 rounded-full border border-brand-600/40 px-4 text-sm font-semibold text-brand-600 disabled:opacity-50"
                    >
                      Saisir {eur0(amount)}
                    </button>
                  )}
                </div>
              );
            })}
            <div className={rowCls(true)}>
              <span className="min-w-0 flex-1 text-sm text-ink-2">
                Cumul fin {monthName(nowMonth).toLowerCase()}
              </span>
              <span className="shrink-0 text-base font-semibold">
                {eur0(cumulById.get(thisMonth.id) ?? 0)}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <SectionLabel
          right={
            years.length > 1 ? (
              <Select
                className="w-24"
                value={shownYear}
                onChange={setYear}
                options={years.map((y) => ({ value: y, label: y }))}
              />
            ) : undefined
          }
        >
          Plan d'épargne
        </SectionLabel>
        <div className="card">
          <div className="flex items-center gap-2 border-b border-hairline py-2">
            <span className="eyebrow min-w-0 flex-1" style={{ lineHeight: 1.25 }}>
              Mois
            </span>
            <span className="eyebrow w-16 text-right" style={{ lineHeight: 1.25 }}>
              {members.a.name}
            </span>
            <span className="eyebrow w-16 text-right" style={{ lineHeight: 1.25 }}>
              {members.b.name}
            </span>
            <span className="eyebrow w-20 text-right" style={{ lineHeight: 1.25 }}>
              Cumul
            </span>
          </div>
          {sorted
            .filter((ct) => ct.month.startsWith(shownYear))
            .map((ct, i, arr) => {
              const paid = ct.realizedA && ct.realizedB;
              const isNow = ct.month === nowMonth;
              return (
                <button
                  key={ct.id}
                  type="button"
                  onClick={() => setEntry(ct)}
                  className={`w-full text-left ${rowCls(i === arr.length - 1, "min-h-[48px]")} ${
                    isNow ? "bg-brand-600/10" : ""
                  }`}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    {paid ? (
                      <IconCheck size={15} className="shrink-0 text-brand-600" />
                    ) : (
                      <span className="w-[15px] shrink-0" aria-hidden="true" />
                    )}
                    <span className={`truncate text-sm ${isNow ? "font-semibold" : ""}`}>
                      {monthName(ct.month)}
                    </span>
                  </span>
                  <span className="w-16 shrink-0 text-right text-sm">{Math.round(ct.amountA / 100)}</span>
                  <span className="w-16 shrink-0 text-right text-sm">{Math.round(ct.amountB / 100)}</span>
                  <span className="w-20 shrink-0 text-right text-sm font-semibold">
                    {eur0(cumulById.get(ct.id) ?? 0)}
                  </span>
                </button>
              );
            })}
        </div>
      </div>

      <MobileActionBar
        label="Saisir un versement"
        onClick={() => setEntry(toEnter)}
        disabled={!toEnter}
      />

      {entry && (
        <ContributionSheet key={entry.id} entry={entry} onClose={() => setEntry(null)} />
      )}
    </div>
  );
}

/**
 * Versement d'un mois : le montant de chacun et qui a déjà versé. Un mois peut
 * être à moitié versé — c'est le cas courant quand l'un des deux paie plus tard.
 */
function ContributionSheet({
  entry,
  onClose,
}: {
  entry: SavingsContribution;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const members = useMe().household.members;
  const [form, setForm] = useState({
    amountA: entry.amountA / 100,
    amountB: entry.amountB / 100,
    realizedA: entry.realizedA,
    realizedB: entry.realizedB,
  });

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/wedding/savings/${entry.id}`, {
        amountA: eurToCents(form.amountA),
        amountB: eurToCents(form.amountB),
        realizedA: form.realizedA,
        realizedB: form.realizedB,
        // `planned` reste la vue mois entier, lue par la vue ordinateur.
        planned: !(form.realizedA && form.realizedB),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wedding-savings"] });
      qc.invalidateQueries({ queryKey: ["wedding-summary"] });
      onClose();
    },
  });

  const total = eurToCents(form.amountA) + eurToCents(form.amountB);

  return (
    <Sheet
      title={monthFr(entry.month)}
      subtitle={`${eur0(total)} prévus ce mois`}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="btn-primary h-[52px] w-full rounded-full text-base"
        >
          {save.isPending ? "Enregistrement…" : "Enregistrer"}
        </button>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        {(["a", "b"] as Member[]).map((m) => {
          const amountKey = m === "a" ? "amountA" : "amountB";
          const paidKey = m === "a" ? "realizedA" : "realizedB";
          return (
            <div key={m} className="flex items-center gap-3">
              <MemberAvatar id={m} className="h-9 w-9 shrink-0 text-sm" />
              <span className="min-w-0 flex-1 truncate text-base font-medium">{members[m].name}</span>
              <div className="w-24 shrink-0">
                <Input
                  type="number"
                  step={10}
                  min={0}
                  aria-label={`Montant de ${members[m].name}`}
                  value={form[amountKey]}
                  onChange={(e) => setForm({ ...form, [amountKey]: Number(e.target.value) || 0 })}
                />
              </div>
              <span className="shrink-0">
                <Checkbox
                  checked={form[paidKey]}
                  onChange={() => setForm({ ...form, [paidKey]: !form[paidKey] })}
                  label="versé"
                />
              </span>
            </div>
          );
        })}
        <p className="text-xs text-slate-400">
          « Versé » n'ajoute rien au total épargné : celui-ci vient du solde des comptes d'épargne.
          La coche sert à savoir qui a déjà fait son virement du mois.
        </p>
      </div>
    </Sheet>
  );
}

/* Statut d'une dépense — dérivé du prestataire trouvé (done) et des paiements réglés. */
type BudgetStatus = "recherche" | "trouve" | "partiel" | "paye";
const BUDGET_STATUS_META: Record<BudgetStatus, { label: string; cls: string }> = {
  recherche: { label: "En recherche", cls: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300" },
  trouve: { label: "Trouvé", cls: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" },
  partiel: { label: "Partiellement payé", cls: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  paye: { label: "Payé", cls: "bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300" },
};
const BUDGET_STATUS_ORDER: BudgetStatus[] = ["recherche", "trouve", "partiel", "paye"];
function budgetStatus(item: WeddingBudgetItem, paidSum: number): BudgetStatus {
  if (item.amount > 0 && paidSum >= item.amount) return "paye";
  if (paidSum > 0) return "partiel";
  // « Trouvé » dès qu'un nom de prestataire est renseigné.
  return item.prestataire && item.prestataire.trim() ? "trouve" : "recherche";
}
const StatusBadge = ({ k }: { k: BudgetStatus }) => (
  <span
    className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-medium ${BUDGET_STATUS_META[k].cls}`}
  >
    {BUDGET_STATUS_META[k].label}
  </span>
);
// Chevron d'expansion réutilisé (déplié / replié).
const Chevron = ({ open }: { open: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="9 6 15 12 9 18" />
  </svg>
);
// Ajoute https:// si l'utilisateur a saisi un domaine nu.
const normalizeUrl = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);
const fmtSize = (b: number) =>
  b < 1024 ? `${b} o` : b < 1024 * 1024 ? `${Math.round(b / 1024)} Ko` : `${(b / 1_048_576).toFixed(1)} Mo`;
// Vignette « logo de fichier » : document coloré selon le type + extension.
function FileTypeIcon({ f, className = "" }: { f: WeddingBudgetFile; className?: string }) {
  const ext = (f.fileName.split(".").pop() ?? "").toLowerCase();
  const ct = f.contentType ?? "";
  const isImg =
    ct.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "svg"].includes(ext);

  let color = "#64748b"; // slate par défaut
  let label = ext.toUpperCase().slice(0, 4) || "FIC";
  if (ext === "pdf" || ct === "application/pdf") {
    color = "#e5252a";
    label = "PDF";
  } else if (isImg) {
    color = "#5b6ee1";
    label = (ext || "img").toUpperCase().slice(0, 4);
  } else if (["xls", "xlsx", "csv"].includes(ext)) {
    color = "#1d7145";
    label = ext.toUpperCase();
  } else if (["ppt", "pptx"].includes(ext)) {
    color = "#d24625";
    label = "PPT";
  }
  const fontSize = label.length >= 4 ? 9 : 12;

  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label={label}>
      <path
        d="M12 3h18l10 10v30a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"
        fill={color}
      />
      <path d="M30 3 L40 13 L30 13 Z" fill="#ffffff" fillOpacity="0.4" />
      <text
        x="24"
        y="33"
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight="700"
        fill="#ffffff"
        fontFamily="system-ui, sans-serif"
      >
        {label}
      </text>
    </svg>
  );
}

function BudgetDesktop() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<WeddingBudgetItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [payModal, setPayModal] = useState<{
    item: WeddingBudgetItem;
    payment: WeddingPayment | null;
    defaultAmount: number;
  } | null>(null);

  const { data } = useQuery({
    queryKey: ["wedding-budget"],
    queryFn: () => api.get<WeddingBudgetItem[]>("/api/wedding/budget"),
  });
  const { data: payments } = useQuery({
    queryKey: ["wedding-payments"],
    queryFn: () => api.get<WeddingPayment[]>("/api/wedding/payments"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["wedding-budget"] });
    qc.invalidateQueries({ queryKey: ["wedding-payments"] });
    qc.invalidateQueries({ queryKey: ["wedding-summary"] });
  };

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/wedding/budget/${id}`),
    onSuccess: invalidate,
  });
  const togglePaid = useMutation({
    mutationFn: (p: WeddingPayment) =>
      api.patch(`/api/wedding/payments/${p.id}`, {
        amountPaid: p.amountPaid >= p.amountDue ? 0 : p.amountDue,
      }),
    onSuccess: invalidate,
  });
  const removePayment = useMutation({
    mutationFn: (id: string) => api.del(`/api/wedding/payments/${id}`),
    onSuccess: invalidate,
  });
  const assignPayment = useMutation({
    mutationFn: (p: { id: string; budgetItemId: string }) =>
      api.patch(`/api/wedding/payments/${p.id}`, { budgetItemId: p.budgetItemId }),
    onSuccess: invalidate,
  });
  const reorder = useMutation({
    mutationFn: (orderedIds: string[]) => api.patch("/api/wedding/budget/reorder", { orderedIds }),
    onSuccess: invalidate,
  });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [reorderMode, setReorderMode] = useState(false);

  // Filtres
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<BudgetStatus>>(new Set());
  const [noVendor, setNoVendor] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  // La recherche est hors modale ; le badge ne compte que les filtres de la modale.
  const modalFilterCount = statusFilter.size + (noVendor ? 1 : 0);
  const toggleStatus = (k: BudgetStatus) =>
    setStatusFilter((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  const clearFilters = () => {
    setSearch("");
    setStatusFilter(new Set());
    setNoVendor(false);
  };
  const hasFilters = !!search.trim() || statusFilter.size > 0 || noVendor;

  if (!data || !payments) return <PageLoader variant="mariage" />;

  const itemById = new Map(data.map((i) => [i.id, i]));
  // Une échéance est « rattachée » si elle pointe vers une dépense existante.
  const isLinked = (p: WeddingPayment) => !!p.budgetItemId && itemById.has(p.budgetItemId);
  const linked = payments.filter(isLinked);
  const orphans = payments.filter((p) => !isLinked(p));

  // Paiements groupés par dépense.
  const paymentsByItem = new Map<string, WeddingPayment[]>();
  for (const p of linked) {
    if (!paymentsByItem.has(p.budgetItemId!)) paymentsByItem.set(p.budgetItemId!, []);
    paymentsByItem.get(p.budgetItemId!)!.push(p);
  }

  const total = data.reduce((s, i) => s + i.amount, 0);
  const paidTotal = linked.reduce((s, p) => s + p.amountPaid, 0);
  const resteTotal = data.reduce(
    (s, i) => s + Math.max(0, i.amount - (paymentsByItem.get(i.id)?.reduce((a, p) => a + p.amountPaid, 0) ?? 0)),
    0,
  );
  const foundCount = data.filter((i) => i.prestataire && i.prestataire.trim()).length;

  // Statut d'une dépense (réutilisé pour le filtre et l'affichage).
  const statusOf = (i: WeddingBudgetItem) =>
    budgetStatus(i, paymentsByItem.get(i.id)?.reduce((a, p) => a + p.amountPaid, 0) ?? 0);
  const q = search.trim().toLowerCase();
  const matches = (i: WeddingBudgetItem) => {
    if (statusFilter.size > 0 && !statusFilter.has(statusOf(i))) return false;
    if (noVendor && i.prestataire && i.prestataire.trim()) return false;
    if (q) {
      const hay = `${i.label} ${i.prestataire ?? ""} ${Math.round(i.amount / 100)} ${eur0(i.amount)}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };
  // En mode réorganisation on ignore les filtres (on réordonne sur la liste complète).
  const source = reorderMode ? data : data.filter(matches);
  const groups = [...new Set(source.map((i) => i.groupName))];

  // Échéancier consolidé : uniquement les paiements rattachés, triés par date croissante (vides en dernier).
  const scheduleRows = linked
    .slice()
    .sort((a, b) => (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99"));

  const toggleOpen = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  // Réordonne une dépense à l'intérieur de son groupe (drag & drop ou flèches),
  // puis renvoie l'ordre global complet à l'endpoint /reorder.
  const reorderWithin = (groupName: string, from: number, to: number) => {
    const groupIds = data.filter((i) => i.groupName === groupName).map((i) => i.id);
    if (to < 0 || to >= groupIds.length || from === to) return;
    const newGroupIds = arrayMove(groupIds, from, to);
    let gi = 0;
    const full = data.map((i) => (i.groupName === groupName ? newGroupIds[gi++] : i.id));
    reorder.mutate(full);
  };
  const onGroupDragEnd = (groupName: string) => (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const groupIds = data.filter((i) => i.groupName === groupName).map((i) => i.id);
    const from = groupIds.indexOf(String(e.active.id));
    const to = groupIds.indexOf(String(e.over.id));
    reorderWithin(groupName, from, to);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicator label="Budget total" value={total} money />
        <Indicator label="Déjà payé" value={paidTotal} money tone="green" />
        <Indicator label="Reste à payer" value={resteTotal} money tone={resteTotal > 0 ? "orange" : "default"} />
        <Indicator
          label="Prestataire trouvé"
          value={`${foundCount}/${data.length}`}
          tone={data.length > 0 && foundCount === data.length ? "green" : "default"}
        />
      </div>

      {/* Barre d'actions. Mobile : « Ajouter » est un bouton flottant en bas. */}
      <div className="flex items-center gap-2">
        {!reorderMode && (
          <>
            <input
              className="input min-w-0 flex-1 md:max-w-xs"
              placeholder="Rechercher…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setFilterOpen(true)}
              className={`btn-ghost shrink-0 ${modalFilterCount > 0 ? "ring-1 ring-brand-500" : ""}`}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 4h18l-7 8v6l-4 2v-8z" />
              </svg>
              <span className="hidden sm:inline">Filtrer</span>
              {modalFilterCount > 0 && (
                <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-2xs font-semibold text-on-brand">
                  {modalFilterCount}
                </span>
              )}
            </button>
          </>
        )}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => setReorderMode((v) => !v)}
            aria-label={reorderMode ? "Terminer la réorganisation" : "Réorganiser les postes"}
            className={reorderMode ? "btn-primary" : "btn-ghost"}
          >
            <span aria-hidden="true">{reorderMode ? "✓" : "⠿"}</span>
            <span className="hidden md:inline">{reorderMode ? "Terminer" : "Réorganiser"}</span>
          </button>
          <button onClick={() => setCreating(true)} className="btn-primary hidden md:inline-flex">
            + Ajouter un poste
          </button>
        </div>
      </div>

      {/* Budget jamais renseigné : on propose un modèle de postes à ajuster. */}
      {data.length === 0 && <InitBudget onCreated={invalidate} />}

      {hasFilters && !reorderMode && groups.length === 0 && (
        <div className="card text-sm text-slate-400">Aucune dépense ne correspond aux filtres.</div>
      )}

      {groups.map((g) => {
        const groupItems = source.filter((i) => i.groupName === g);
        const groupTotal = groupItems.reduce((s, i) => s + i.amount, 0);
        const groupReste = groupItems.reduce(
          (s, i) =>
            s + Math.max(0, i.amount - (paymentsByItem.get(i.id)?.reduce((a, p) => a + p.amountPaid, 0) ?? 0)),
          0,
        );
        return (
        <div key={g} className="card">
          <div className="mb-3 flex items-baseline justify-between gap-3 pb-3">
            <h3 className="text-base font-semibold sm:text-lg">{g}</h3>
            <div className="shrink-0 text-right">
              <span className="text-lg font-bold tabular-nums sm:text-xl">{eur0(groupTotal)}</span>
              {groupReste > 0 && (
                <span className="ml-2 text-xs font-normal text-slate-400 tabular-nums">
                  reste {eur0(groupReste)}
                </span>
              )}
            </div>
          </div>
          {reorderMode ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onGroupDragEnd(g)}>
              <SortableContext
                items={data.filter((i) => i.groupName === g).map((i) => i.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-1.5">
                  {data
                    .filter((i) => i.groupName === g)
                    .map((i, idx, arr) => (
                      <SortableBudgetRow
                        key={i.id}
                        item={i}
                        isFirst={idx === 0}
                        isLast={idx === arr.length - 1}
                        onMove={(dir) => reorderWithin(g, idx, idx + dir)}
                      />
                    ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <>
          {/* En-tête de colonnes (ordinateur seulement) */}
          <div className="hidden border-b border-slate-100 pb-1 text-2xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 lg:grid lg:grid-cols-[1.5rem_minmax(0,1fr)_11rem_9rem_7rem_3.5rem] lg:gap-x-2">
            <span />
            <span>Poste</span>
            <span>Prestataire</span>
            <span>Statut</span>
            <span className="text-right">Montant</span>
            <span />
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {source
              .filter((i) => i.groupName === g)
              .map((i) => {
                const ip = (paymentsByItem.get(i.id) ?? [])
                  .slice()
                  .sort((a, b) => (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99"));
                const paidSum = ip.reduce((s, p) => s + p.amountPaid, 0);
                const scheduled = ip.reduce((s, p) => s + p.amountDue, 0);
                const reste = i.amount - paidSum;
                const st = budgetStatus(i, paidSum);
                const isOpen = !!open[i.id];
                const amountBlock = (
                  <>
                    <div className="font-medium tabular-nums">{eur0(i.amount)}</div>
                    {reste > 0 ? (
                      <div className="text-xs text-slate-400 tabular-nums">reste {eur0(reste)}</div>
                    ) : i.amount > 0 ? (
                      <div className="text-xs text-green-600">payé</div>
                    ) : null}
                  </>
                );
                return (
                  <div key={i.id} className="group py-2">
                    {/* En-tête mobile / tablette : empilé sur plusieurs lignes */}
                    <div className="flex items-start gap-2 lg:hidden">
                      <button
                        onClick={() => toggleOpen(i.id)}
                        aria-label={isOpen ? "Replier" : "Déplier"}
                        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
                      >
                        <Chevron open={isOpen} />
                      </button>
                      <button onClick={() => toggleOpen(i.id)} className="min-w-0 flex-1 text-left">
                        <div className="break-words font-medium">{i.label}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          {i.prestataire && <span className="text-xs text-slate-500">{i.prestataire}</span>}
                          <StatusBadge k={st} />
                        </div>
                      </button>
                      <div className="shrink-0 text-right">{amountBlock}</div>
                    </div>

                    {/* En-tête ordinateur : colonnes alignées */}
                    <div className="hidden lg:grid lg:grid-cols-[1.5rem_minmax(0,1fr)_11rem_9rem_7rem_3.5rem] lg:items-start lg:gap-x-2">
                      <button
                        onClick={() => toggleOpen(i.id)}
                        aria-label={isOpen ? "Replier" : "Déplier"}
                        className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
                      >
                        <Chevron open={isOpen} />
                      </button>
                      <div className="min-w-0 break-words font-medium">{i.label}</div>
                      <div className="min-w-0 break-words text-slate-500">
                        {i.prestataire || <span className="text-slate-400">—</span>}
                      </div>
                      <div>
                        <StatusBadge k={st} />
                      </div>
                      <div className="text-right">{amountBlock}</div>
                      <div className="whitespace-nowrap text-right">
                        <button
                          onClick={() => setEditing(i)}
                          title="Modifier"
                          className="px-1 text-slate-400 opacity-0 transition hover:text-brand-600 group-hover:opacity-100"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Supprimer « ${i.label} » ?`)) remove.mutate(i.id);
                          }}
                          title="Supprimer"
                          className="px-1 text-slate-300 hover:text-red-500"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {/* Détail déplié (commun mobile / ordinateur) */}
                    {isOpen && (
                      <div className="mt-2 lg:pl-7">
                        <ExpenseDetail
                          item={i}
                          payments={ip}
                          scheduled={scheduled}
                          onEditItem={() => setEditing(i)}
                          onDelete={() => {
                            if (confirm(`Supprimer « ${i.label} » ?`)) remove.mutate(i.id);
                          }}
                          onAddPayment={() =>
                            setPayModal({ item: i, payment: null, defaultAmount: Math.max(0, i.amount - scheduled) })
                          }
                          onEditPayment={(p) => setPayModal({ item: i, payment: p, defaultAmount: p.amountDue })}
                          onTogglePaid={(p) => togglePaid.mutate(p)}
                          onRemovePayment={(id) => removePayment.mutate(id)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
            </>
          )}
        </div>
        );
      })}

      {/* ------- Échéances non rattachées (héritées de l'ancien échéancier) ------- */}
      {orphans.length > 0 && (
        <div className="card border-l-4" style={{ borderLeftColor: "#d4a843" }}>
          <div className="mb-1 text-sm font-semibold">⚠️ Échéances non rattachées ({orphans.length})</div>
          <div className="mb-3 text-xs text-slate-500">
            Ces échéances proviennent de l'ancien échéancier. Rattache chacune à une dépense, ou supprime-la.
          </div>
          <div className="space-y-2">
            {orphans
              .slice()
              .sort((a, b) => (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99"))
              .map((p) => (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {p.prestataire}
                      {p.type ? <span className="text-slate-400"> · {p.type}</span> : null}
                    </div>
                    <div className="text-xs text-slate-400">
                      {p.dueDate ? dateFr(p.dueDate) : "date à définir"} · {eur(p.amountDue)}
                    </div>
                  </div>
                  <Select
                    className="w-52"
                    value=""
                    placeholder="Rattacher à…"
                    onChange={(v) => {
                      if (v) assignPayment.mutate({ id: p.id, budgetItemId: v });
                    }}
                    options={data.map((i) => ({
                      value: i.id,
                      label: i.prestataire ? `${i.label} · ${i.prestataire}` : i.label,
                    }))}
                  />
                  <button
                    onClick={() => {
                      if (confirm("Supprimer cette échéance ?")) removePayment.mutate(p.id);
                    }}
                    className="shrink-0 px-1 text-slate-300 hover:text-red-500"
                    title="Supprimer"
                  >
                    ✕
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ------- Échéancier consolidé ------- */}
      <div className="py-6">
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
          <span className="text-2xs font-semibold uppercase tracking-wide text-slate-400">
            Échéancier
          </span>
          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
        </div>
      </div>
      <div className="card">
        <div className="mb-2 text-sm font-semibold">📅 Échéancier des paiements</div>
        {scheduleRows.length === 0 ? (
          <div className="text-sm text-slate-400">Aucun paiement prévu pour l'instant.</div>
        ) : (
          <>
            {/* Mobile : lignes empilées */}
            <ul className="divide-y divide-slate-100 dark:divide-slate-800 md:hidden">
              {scheduleRows.map((p) => {
                const it = p.budgetItemId ? itemById.get(p.budgetItemId) : undefined;
                const paid = p.amountPaid >= p.amountDue && p.amountDue > 0;
                return (
                  <li key={p.id} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="break-words text-sm font-medium">
                        {it?.label ?? "—"}
                        {p.type && <span className="text-slate-400"> · {p.type}</span>}
                      </div>
                      <div className="text-xs text-slate-400">{it?.prestataire || p.prestataire}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={`text-sm tabular-nums ${paid ? "text-green-600" : ""}`}>
                        {eur(p.amountDue)}
                      </div>
                      <div className="text-xs text-slate-400">
                        {p.dueDate ? dateFr(p.dueDate) : "à définir"}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Ordinateur : tableau */}
            <table className="hidden w-full text-sm md:table">
              <thead className="text-left text-xs text-slate-400">
                <tr>
                  <th className="py-1">Dépense</th>
                  <th>Prestataire</th>
                  <th>Date</th>
                  <th className="text-right">Montant</th>
                </tr>
              </thead>
              <tbody>
                {scheduleRows.map((p) => {
                  const it = p.budgetItemId ? itemById.get(p.budgetItemId) : undefined;
                  const paid = p.amountPaid >= p.amountDue && p.amountDue > 0;
                  return (
                    <tr key={p.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-1.5">
                        {it?.label ?? "—"}
                        {p.type && <span className="ml-1 text-xs text-slate-400">· {p.type}</span>}
                      </td>
                      <td className="text-slate-500">{it?.prestataire || p.prestataire}</td>
                      <td className={p.dueDate ? "" : "text-slate-400"}>
                        {p.dueDate ? dateFr(p.dueDate) : "à définir"}
                      </td>
                      <td className={`text-right tabular-nums ${paid ? "text-green-600" : ""}`}>
                        {eur(p.amountDue)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* Modale de filtres */}
      {filterOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
          onClick={() => setFilterOpen(false)}
        >
          <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Filtrer les dépenses</h2>
              <button onClick={() => setFilterOpen(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 text-xs text-slate-400">Statut</div>
                <div className="flex flex-wrap gap-1.5">
                  {BUDGET_STATUS_ORDER.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => toggleStatus(k)}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                        statusFilter.has(k)
                          ? `${BUDGET_STATUS_META[k].cls} ring-1 ring-brand-500`
                          : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                      }`}
                    >
                      {BUDGET_STATUS_META[k].label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={noVendor} onChange={() => setNoVendor((v) => !v)} size="sm" />
                Uniquement sans prestataire
              </label>
            </div>
            <div className="mt-5 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={clearFilters}
                disabled={!hasFilters}
                className="btn-ghost disabled:opacity-40"
              >
                Effacer
              </button>
              <button type="button" onClick={() => setFilterOpen(false)} className="btn-primary">
                Voir les résultats
              </button>
            </div>
          </div>
        </div>
      )}

      {(creating || editing) && (
        <BudgetModal
          key={editing?.id ?? "new"}
          item={editing}
          groups={groups}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            invalidate();
          }}
        />
      )}

      {payModal && (
        <PaymentModal
          key={payModal.payment?.id ?? `new-${payModal.item.id}`}
          item={payModal.item}
          payment={payModal.payment}
          defaultAmount={payModal.defaultAmount}
          onClose={() => setPayModal(null)}
          onSaved={() => {
            setPayModal(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

// Ligne d'une dépense en mode réorganisation : poignée de glissement (ordinateur)
// + flèches ↑/↓ (indispensables au tactile).
function SortableBudgetRow({
  item,
  isFirst,
  isLast,
  onMove,
}: {
  item: WeddingBudgetItem;
  isFirst: boolean;
  isLast: boolean;
  onMove: (dir: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900"
    >
      <button
        {...attributes}
        {...listeners}
        className="hidden shrink-0 cursor-grab touch-none text-slate-400 hover:text-brand-600 sm:block"
        title="Glisser pour déplacer"
        aria-label="Glisser pour déplacer"
      >
        ⠿
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{item.label}</div>
        {item.prestataire && <div className="truncate text-xs text-slate-400">{item.prestataire}</div>}
      </div>
      <span className="shrink-0 text-sm tabular-nums text-slate-500">{eur0(item.amount)}</span>
      <div className="flex shrink-0 flex-col">
        <button
          onClick={() => onMove(-1)}
          disabled={isFirst}
          aria-label="Monter"
          className="text-slate-400 transition hover:text-brand-600 disabled:opacity-30"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
        <button
          onClick={() => onMove(1)}
          disabled={isLast}
          aria-label="Descendre"
          className="text-slate-400 transition hover:text-brand-600 disabled:opacity-30"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function ExpenseDetail({
  item,
  payments,
  scheduled,
  onEditItem,
  onDelete,
  onAddPayment,
  onEditPayment,
  onTogglePaid,
  onRemovePayment,
}: {
  item: WeddingBudgetItem;
  payments: WeddingPayment[];
  scheduled: number;
  onEditItem: () => void;
  onDelete: () => void;
  onAddPayment: () => void;
  onEditPayment: (p: WeddingPayment) => void;
  onTogglePaid: (p: WeddingPayment) => void;
  onRemovePayment: (id: string) => void;
}) {
  return (
    <div className="space-y-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/40">
      {/* Coordonnées */}
      <section className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-2xs font-semibold uppercase tracking-wide text-slate-400">Coordonnées</span>
          <button onClick={onEditItem} className="text-xs text-slate-500 underline hover:text-brand-600">
            modifier
          </button>
        </div>
        {!item.url && !item.address ? (
          <div className="text-xs text-slate-400">Aucune coordonnée renseignée.</div>
        ) : (
          <div className="flex items-center justify-between gap-3 text-sm">
            {item.address ? (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-brand-600 hover:underline dark:text-brand-400"
                title={item.address}
              >
                📍 {item.address}
              </a>
            ) : (
              <span className="min-w-0 flex-1 truncate text-xs text-slate-400">Adresse non renseignée</span>
            )}
            {item.url ? (
              <a
                href={normalizeUrl(item.url)}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 truncate text-right text-brand-600 hover:underline dark:text-brand-400 sm:min-w-0 sm:max-w-[45%]"
                title={item.url}
              >
                🔗<span className="hidden sm:inline"> {item.url}</span>
              </a>
            ) : (
              <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">Lien non renseigné</span>
            )}
          </div>
        )}
      </section>

      {/* Paiements */}
      <section className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-2xs font-semibold uppercase tracking-wide text-slate-400">Paiements prévus</span>
          <button
            onClick={onAddPayment}
            className="rounded-lg bg-brand-600 px-2 py-1 text-xs font-medium text-on-brand transition hover:bg-brand-700"
          >
            + paiement
          </button>
        </div>
        {payments.length === 0 ? (
          <div className="text-xs text-slate-400">Aucun paiement prévu.</div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {payments.map((p) => {
              const paid = p.amountPaid >= p.amountDue && p.amountDue > 0;
              return (
                <li key={p.id} className="group/pay flex items-center gap-2 py-1.5">
                  <button
                    onClick={() => onTogglePaid(p)}
                    title={paid ? "Marquer comme non réglé" : "Marquer comme réglé"}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs transition ${
                      paid
                        ? "border-green-600 bg-green-600 text-white"
                        : "border-slate-300 bg-white hover:border-green-500 dark:border-slate-600 dark:bg-slate-800"
                    }`}
                  >
                    {paid && "✓"}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-sm ${paid ? "text-slate-400" : ""}`}>{p.type || "Paiement"}</div>
                    <div className="text-xs text-slate-400">
                      {p.dueDate ? dateFr(p.dueDate) : "date à définir"}
                    </div>
                  </div>
                  <span className={`shrink-0 text-sm tabular-nums ${paid ? "text-green-600" : ""}`}>
                    {eur(p.amountDue)}
                  </span>
                  <button
                    onClick={() => onEditPayment(p)}
                    title="Modifier"
                    className="shrink-0 px-1 text-slate-400 opacity-0 transition hover:text-brand-600 group-hover/pay:opacity-100"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => {
                      if (confirm("Supprimer ce paiement ?")) onRemovePayment(p.id);
                    }}
                    className="shrink-0 px-1 text-slate-300 hover:text-red-500"
                    title="Supprimer"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {payments.length > 0 && scheduled < item.amount && (
          <div className="mt-1.5 border-t border-slate-100 pt-1.5 text-xs text-slate-400 dark:border-slate-800">
            Non planifié : {eur0(item.amount - scheduled)}
          </div>
        )}
      </section>

      {/* Fichiers joints */}
      <section className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <BudgetFiles itemId={item.id} />
      </section>

      {/* Suppression (mobile / tablette : pas d'actions au survol) */}
      <button onClick={onDelete} className="text-xs text-red-500 hover:underline lg:hidden">
        Supprimer cette dépense
      </button>
    </div>
  );
}

function BudgetFiles({ itemId }: { itemId: string }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const { data: files } = useQuery({
    queryKey: ["wedding-budget-files", itemId],
    queryFn: () => api.get<WeddingBudgetFile[]>(`/api/wedding/budget/${itemId}/files`),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["wedding-budget-files", itemId] });

  const upload = async (list: FileList) => {
    const rejected: string[] = [];
    const valid = Array.from(list).filter((f) => {
      if (!isAllowedWeddingFile(f.name)) {
        rejected.push(`${f.name} — type non autorisé`);
        return false;
      }
      if (f.size > WEDDING_FILE_MAX_BYTES) {
        rejected.push(`${f.name} — trop volumineux (max 25 Mo)`);
        return false;
      }
      return true;
    });
    if (rejected.length) alert(`Fichier(s) ignoré(s) :\n${rejected.join("\n")}`);
    if (fileRef.current) fileRef.current.value = "";
    if (!valid.length) return;
    setBusy(true);
    try {
      for (const f of valid) {
        await fetch(`${API_URL}/api/wedding/budget/${itemId}/files?name=${encodeURIComponent(f.name)}`, {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": f.type || "application/octet-stream" },
          body: f,
        });
      }
      invalidate();
    } finally {
      setBusy(false);
    }
  };

  const view = async (f: WeddingBudgetFile) => {
    const res = await fetch(`${API_URL}/api/wedding/budget/files/${f.id}`, { credentials: "include" });
    if (!res.ok) return;
    window.open(URL.createObjectURL(await res.blob()), "_blank");
  };

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/wedding/budget/files/${id}`),
    onSuccess: invalidate,
  });

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-2xs font-semibold uppercase tracking-wide text-slate-400">Fichiers</span>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="rounded-lg bg-brand-600 px-2 py-1 text-xs font-medium text-on-brand transition hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? "Envoi…" : "+ fichier"}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,.pdf,.csv,.xls,.xlsx,.ppt,.pptx"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) upload(e.target.files);
          }}
        />
      </div>
      {!files || files.length === 0 ? (
        <div className="text-xs text-slate-400">Aucun fichier.</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {files.map((f) => (
            <div key={f.id} className="group/file relative w-24">
              <button
                onClick={() => view(f)}
                title={`${f.fileName} · ${fmtSize(f.size)}`}
                className="flex w-full flex-col items-center gap-1 rounded-lg border border-slate-200 p-2 transition hover:border-brand-400 hover:bg-brand-50/50 dark:border-slate-700 dark:hover:bg-brand-600/10"
              >
                <FileTypeIcon f={f} className="h-10 w-10" />
                <span className="w-full truncate text-center text-xs text-slate-600 dark:text-slate-300">
                  {f.fileName}
                </span>
              </button>
              <button
                onClick={() => {
                  if (confirm("Supprimer ce fichier ?")) remove.mutate(f.id);
                }}
                title="Supprimer"
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-xs text-slate-400 shadow-sm transition hover:text-red-500 dark:border-slate-600 dark:bg-slate-800"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BudgetModal({
  item,
  groups,
  onClose,
  onSaved,
}: {
  item: WeddingBudgetItem | null;
  groups: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!item;
  const [form, setForm] = useState({
    groupName: item?.groupName ?? groups[0] ?? "Divers",
    label: item?.label ?? "",
    prestataire: item?.prestataire ?? "",
    amount: item ? item.amount / 100 : 0,
    url: item?.url ?? "",
    address: item?.address ?? "",
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        groupName: form.groupName || "Divers",
        label: form.label,
        prestataire: form.prestataire.trim() || null,
        amount: eurToCents(form.amount),
        url: form.url.trim() || null,
        address: form.address.trim() || null,
      };
      return isEdit
        ? api.patch(`/api/wedding/budget/${item!.id}`, payload)
        : api.post("/api/wedding/budget", payload);
    },
    onSuccess: onSaved,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{isEdit ? "Modifier le poste" : "Nouveau poste"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (form.label) save.mutate();
          }}
          className="space-y-3"
        >
          <input
            autoFocus
            className="input"
            placeholder="Libellé (ex. Photographe samedi)"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
          <input
            className="input"
            placeholder="Prestataire (ex. Studio Photo Martin) — optionnel"
            value={form.prestataire}
            onChange={(e) => setForm({ ...form, prestataire: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-400">
              Catégorie
              <input
                className="input"
                list="budget-groups"
                value={form.groupName}
                onChange={(e) => setForm({ ...form, groupName: e.target.value })}
              />
              <datalist id="budget-groups">
                {groups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </label>
            <label className="text-xs text-slate-400">
              Montant (€)
              <input
                type="number"
                step="0.01"
                className="input"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
              />
            </label>
          </div>
          <input
            className="input"
            placeholder="Site du prestataire (URL) — optionnel"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
          />
          <input
            className="input"
            placeholder="Adresse du prestataire — optionnel"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost">
              Annuler
            </button>
            <button className="btn-primary" disabled={save.isPending}>
              {save.isPending ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditAmount({
  value,
  onSave,
  muted,
}: {
  value: number;
  onSave: (cents: number) => void;
  muted: boolean;
}) {
  return (
    <input
      type="number"
      step="1"
      defaultValue={value / 100}
      key={value}
      onBlur={(e) => {
        const cents = eurToCents(Number(e.target.value));
        if (cents !== value) onSave(cents);
      }}
      className={`w-20 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-right text-sm hover:border-slate-300 focus:border-brand-500 focus:bg-white dark:focus:bg-slate-900 ${
        muted ? "text-slate-400" : ""
      }`}
    />
  );
}

function EpargneDesktop() {
  const qc = useQueryClient();
  const members = useMe().household.members;
  const [editDate, setEditDate] = useState(false);
  const saveTargetDate = useMutation({
    mutationFn: (targetDate: string) => api.patch("/api/wedding/target", { targetDate }),
    onSuccess: () => {
      setEditDate(false);
      qc.invalidateQueries({ queryKey: ["wedding-summary"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  const summaryQ = useQuery({
    queryKey: ["wedding-summary"],
    queryFn: () => api.get<WeddingSummary>("/api/wedding/summary"),
  });
  const contribQ = useQuery({
    queryKey: ["wedding-savings"],
    queryFn: () => api.get<SavingsContribution[]>("/api/wedding/savings"),
  });

  const patch = useMutation({
    mutationFn: (p: { id: string; field: "amountA" | "amountB"; cents: number }) =>
      api.patch(`/api/wedding/savings/${p.id}`, { [p.field]: p.cents }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wedding-savings"] });
      qc.invalidateQueries({ queryKey: ["wedding-summary"] });
    },
  });
  // Coche « réalisé » manuelle. Le mois entier bascule les deux membres à la
  // fois : le détail par personne se saisit sur mobile (feuille du versement).
  const togglePlanned = useMutation({
    mutationFn: (p: { id: string; planned: boolean }) =>
      api.patch(`/api/wedding/savings/${p.id}`, {
        planned: p.planned,
        realizedA: !p.planned,
        realizedB: !p.planned,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wedding-savings"] });
      qc.invalidateQueries({ queryKey: ["wedding-summary"] });
    },
  });

  if (!summaryQ.data || !contribQ.data) return <div className="text-slate-400">Chargement…</div>;
  const s = summaryQ.data;

  // Plan jamais renseigné : on demande la date du mariage et on pré-remplit.
  if (contribQ.data.length === 0) return <InitSavingsPlan targetDate={s.targetDate} />;

  const sorted = [...contribQ.data].sort((a, b) => a.month.localeCompare(b.month));
  const cumulById = new Map<string, number>();
  let running = 0;
  for (const ct of sorted) {
    running += ct.amountA + ct.amountB;
    cumulById.set(ct.id, running);
  }
  const currentMonth = new Date().toISOString().slice(0, 7);
  const years = [...new Set(sorted.map((c) => c.month.slice(0, 4)))];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicator label="Épargne sur les comptes" value={s.savedToDate - s.totalPaid} money />
        <Indicator label="Déjà payé" value={s.totalPaid} money />
        <Indicator label="Cible à date" value={s.shouldHaveByNow} money />
        <Indicator
          label={s.surplus >= 0 ? "Avance" : "Retard"}
          value={Math.abs(s.surplus)}
          money
          tone={s.surplus >= 0 ? "green" : "orange"}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Indicator label="Total épargné et payé" value={s.savedToDate} money />
        <Indicator label="Objectif final" value={s.targetAmount} money />
        <Indicator label="Requis / mois" value={s.monthlyRequired} money />
      </div>

      <div className="card">
        <div className="mb-2 flex items-center justify-between gap-2 text-sm">
          <span className="font-semibold">{s.percentFunded}% financé</span>
          <span className="flex items-center gap-2 text-slate-400">
            {editDate ? (
              <>
                <DateInput
                  value={s.targetDate}
                  onChange={(d) => {
                    if (d) saveTargetDate.mutate(d);
                  }}
                />
                <button
                  type="button"
                  onClick={() => setEditDate(false)}
                  className="text-slate-300 hover:text-slate-500"
                  title="Annuler"
                >
                  ✕
                </button>
              </>
            ) : (
              <>
                Mariage le {dateFr(s.targetDate)} · {s.monthsLeft} mois restants
                <button
                  type="button"
                  onClick={() => setEditDate(true)}
                  className="text-slate-300 transition hover:text-brand-600"
                  title="Modifier la date du mariage"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  </svg>
                </button>
              </>
            )}
          </span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, s.percentFunded)}%` }} />
        </div>
      </div>

      {years.map((year) => (
        <div key={year} className="card overflow-x-auto">
          <div className="mb-2 text-sm font-semibold">Plan d'épargne {year}</div>
          <table className="w-full min-w-[22rem] table-fixed text-sm">
            <colgroup>
              <col />
              <col className="w-24" />
              <col className="w-24" />
              <col className="w-28" />
              <col className="w-14" />
            </colgroup>
            <thead className="text-left text-xs text-slate-400">
              <tr>
                <th className="py-1">Mois</th>
                <th className="text-right">{members.a.name}</th>
                <th className="text-right">{members.b.name}</th>
                <th className="text-right">Cumul</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted
                .filter((ct) => ct.month.startsWith(year))
                .map((ct) => {
                  const past = ct.month <= currentMonth;
                  // Réalisé = les deux membres ont versé (la coche du mois les
                  // bascule ensemble ; l'un peut avoir versé seul sur mobile).
                  const realized = ct.realizedA && ct.realizedB;
                  return (
                    <tr key={ct.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className={`py-1.5 ${past ? "text-slate-400" : ""}`}>{monthName(ct.month)}</td>
                      <td className="text-right">
                        <EditAmount
                          value={ct.amountA}
                          muted={past}
                          onSave={(cents) => patch.mutate({ id: ct.id, field: "amountA", cents })}
                        />
                      </td>
                      <td className="text-right">
                        <EditAmount
                          value={ct.amountB}
                          muted={past}
                          onSave={(cents) => patch.mutate({ id: ct.id, field: "amountB", cents })}
                        />
                      </td>
                      <td className={`text-right font-medium ${past ? "text-slate-400" : ""}`}>
                        {eur0(cumulById.get(ct.id) ?? 0)}
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={() => togglePlanned.mutate({ id: ct.id, planned: realized })}
                          disabled={togglePlanned.isPending}
                          title={realized ? "Marquer comme prévu" : "Marquer comme réalisé"}
                          className="cursor-pointer"
                        >
                          {realized ? (
                            <span className="text-green-600">✓</span>
                          ) : (
                            <span className="text-xs text-slate-400 underline decoration-dotted hover:text-brand-600">
                              prévu
                            </span>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/**
 * Budget vide : propose le modèle de postes (montants indicatifs, sans
 * prestataire). Aperçu groupé avant création ; tout est modifiable ensuite.
 */
function InitBudget({ onCreated }: { onCreated: () => void }) {
  const groups = [...new Set(WEDDING_BUDGET_TEMPLATE.map((t) => t.group))];
  const total = WEDDING_BUDGET_TEMPLATE.reduce((s, t) => s + t.amount, 0);
  const create = useMutation({
    mutationFn: () => api.post("/api/wedding/budget/init"),
    onSuccess: onCreated,
  });

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="text-lg font-bold">💰 Créer le budget</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {WEDDING_BUDGET_TEMPLATE.length} postes classiques avec des montants indicatifs, sans
          prestataire assigné. Tu pourras les renommer, les chiffrer ou les supprimer ensuite.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => {
          const items = WEDDING_BUDGET_TEMPLATE.filter((t) => t.group === g);
          return (
            <div key={g} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">{g}</span>
                <span className="text-xs text-slate-400">
                  {eur0(items.reduce((s, t) => s + t.amount, 0))}
                </span>
              </div>
              <ul className="space-y-0.5 text-sm">
                {items.map((t) => (
                  <li key={t.label} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate text-slate-600 dark:text-slate-300">
                      {t.label}
                    </span>
                    <span className="shrink-0 tabular-nums">{eur0(t.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => create.mutate()}
          disabled={create.isPending}
          className="btn-primary"
        >
          {create.isPending ? "Création…" : `Créer ces ${WEDDING_BUDGET_TEMPLATE.length} postes`}
        </button>
        <span className="text-sm text-slate-500 dark:text-slate-400">
          Total du modèle : <span className="font-semibold">{eur0(total)}</span>
        </span>
      </div>
      {create.isError && (
        <div className="text-sm text-red-600 dark:text-red-400">
          La création a échoué. Recharge la page et réessaie.
        </div>
      )}
    </div>
  );
}

/**
 * Première mise en place du plan d'épargne : date du mariage + montant par
 * personne et par mois (100 € par défaut). Une ligne est créée pour chaque mois
 * jusqu'au mariage ; tout reste modifiable ensuite dans le tableau.
 */
function InitSavingsPlan({ targetDate }: { targetDate: string }) {
  const qc = useQueryClient();
  const members = useMe().household.members;
  // La date par défaut du foyer est un repère : on part d'un champ vide.
  const [date, setDate] = useState(targetDate === WEDDING_DATE_PLACEHOLDER ? "" : targetDate);
  const [perPerson, setPerPerson] = useState(WEDDING_SAVINGS_DEFAULT_PER_PERSON / 100);

  const months = date ? monthsUntil(date) : 0;
  const tooLong = months > WEDDING_SAVINGS_MAX_MONTHS;
  const total = months * eurToCents(perPerson) * 2;

  const init = useMutation({
    mutationFn: () =>
      api.post("/api/wedding/savings/init", {
        targetDate: date,
        monthlyPerPerson: eurToCents(perPerson),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wedding-savings"] });
      qc.invalidateQueries({ queryKey: ["wedding-summary"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  return (
    <form
      className="card max-w-xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (date && !tooLong) init.mutate();
      }}
    >
      <div>
        <h2 className="text-lg font-bold">🐖 Créer le plan d'épargne</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Un versement par mois et par personne, du mois courant jusqu'au mariage. Tu pourras
          ajuster chaque mois ensuite.
        </p>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">Date du mariage</span>
        <DateInput value={date} onChange={(d) => setDate(d ?? "")} />
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">Épargne par personne et par mois</span>
        <div className="flex items-center gap-2">
          {/* `Input` porte `w-full` : la largeur se pose sur le conteneur. */}
          <div className="w-28">
            <Input
              type="number"
              min={0}
              step={10}
              value={perPerson}
              onChange={(e) => setPerPerson(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
          <span className="text-slate-400">€</span>
        </div>
      </label>

      {date && (
        <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
          {tooLong ? (
            <span className="text-red-600 dark:text-red-400">
              {months} mois jusqu'au mariage : vérifie la date (maximum{" "}
              {WEDDING_SAVINGS_MAX_MONTHS} mois).
            </span>
          ) : (
            <>
              <div>
                {months} mois × 2 personnes × {eur0(eurToCents(perPerson))} ={" "}
                <span className="font-semibold">{eur0(total)}</span>
              </div>
              <div className="mt-0.5 text-xs text-slate-400">
                {members.a.name} et {members.b.name} épargnent chacun{" "}
                {eur0(eurToCents(perPerson))} par mois.
              </div>
            </>
          )}
        </div>
      )}

      <button className="btn-primary" disabled={!date || tooLong || init.isPending}>
        {init.isPending ? "Création…" : "Créer le plan d'épargne"}
      </button>
      {init.isError && (
        <div className="text-sm text-red-600 dark:text-red-400">
          La création a échoué. Recharge la page et réessaie.
        </div>
      )}
    </form>
  );
}

/** Nombre de mois du mois courant au mois du mariage, inclus. */
function monthsUntil(targetDate: string): number {
  const now = new Date();
  const [year, month] = targetDate.split("-").map(Number);
  const diff = (year - now.getFullYear()) * 12 + (month - 1 - now.getMonth());
  return Math.max(1, diff + 1);
}

function PaymentModal({
  item,
  payment,
  defaultAmount,
  onClose,
  onSaved,
}: {
  item: WeddingBudgetItem;
  payment: WeddingPayment | null;
  defaultAmount: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!payment;
  const [form, setForm] = useState({
    type: payment?.type ?? "",
    dueDate: payment?.dueDate ?? "",
    amount: (payment ? payment.amountDue : defaultAmount) / 100,
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        type: form.type.trim() || null,
        dueDate: form.dueDate,
        amountDue: eurToCents(form.amount),
      };
      return isEdit
        ? api.patch(`/api/wedding/payments/${payment!.id}`, payload)
        : api.post("/api/wedding/payments", {
            ...payload,
            budgetItemId: item.id,
            prestataire: item.prestataire?.trim() || item.label,
          });
    },
    onSuccess: onSaved,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{isEdit ? "Modifier le paiement" : "Nouveau paiement"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <div className="mb-3 text-sm text-slate-500">
          {item.label}
          {item.prestataire ? ` · ${item.prestataire}` : ""}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-3"
        >
          <input
            autoFocus
            className="input"
            placeholder="Description (ex. acompte 1, solde…)"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="text-xs text-slate-400">
              <div className="flex items-center justify-between">
                <span>Date de paiement</span>
                {form.dueDate && (
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, dueDate: "" })}
                    className="text-slate-400 underline hover:text-red-500"
                  >
                    effacer
                  </button>
                )}
              </div>
              <DateInput
                value={form.dueDate}
                onChange={(d) => setForm({ ...form, dueDate: d })}
                placeholder="À définir"
              />
            </div>
            <label className="text-xs text-slate-400">
              Montant à payer (€)
              <input
                type="number"
                step="0.01"
                className="input"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost">
              Annuler
            </button>
            <button className="btn-primary" disabled={save.isPending}>
              {save.isPending ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TodosDesktop() {
  const qc = useQueryClient();
  const me = useMe();
  const [showDone, setShowDone] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; item: WeddingTodo | null }>({
    open: false,
    item: null,
  });

  const { data } = useQuery({
    queryKey: ["wedding-todos"],
    queryFn: () => api.get<WeddingTodo[]>("/api/wedding/todos"),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["wedding-todos"] });

  const toggle = useMutation({
    mutationFn: (t: WeddingTodo) => api.patch(`/api/wedding/todos/${t.id}`, { done: !t.done }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/wedding/todos/${id}`),
    onSuccess: invalidate,
  });

  if (!data) return <div className="text-slate-400">Chargement…</div>;

  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = (t: WeddingTodo) => !t.done && !!t.dueDate && t.dueDate < today;
  const doneCount = data.filter((t) => t.done).length;
  const rows = data
    .filter((t) => showDone || !t.done)
    .filter((t) => !mineOnly || t.owner === me.member || !t.owner)
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
    });

  const filterControls = (
    <>
      <Checkbox
        checked={showDone}
        onChange={() => setShowDone((v) => !v)}
        label={`Afficher les tâches réalisées (${doneCount})`}
      />
      <Checkbox
        checked={mineOnly}
        onChange={() => setMineOnly((v) => !v)}
        label="Mes tâches + sans responsable"
      />
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        {/* Mobile : filtres repliés derrière un bouton. */}
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          className={`btn-ghost text-xs md:hidden ${showDone || mineOnly ? "ring-1 ring-brand-500" : ""}`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M3 4h18l-7 8v6l-4 2v-8z" />
          </svg>
          Filtres
        </button>
        {/* Ordinateur : filtres inline. */}
        <div className="hidden flex-wrap items-center gap-4 md:flex">{filterControls}</div>
        {/* Ordinateur : bouton d'ajout (mobile = bouton flottant plus bas). */}
        <button
          onClick={() => setModal({ open: true, item: null })}
          className="btn-primary hidden md:inline-flex"
        >
          + Ajouter une tâche
        </button>
      </div>

      {/* Mobile : panneau de filtres dépliable. */}
      {filtersOpen && (
        <div className="card flex flex-col gap-3 md:hidden">{filterControls}</div>
      )}

      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <div className="text-sm text-slate-400">
            {data.length === 0 ? "Aucune tâche pour le mariage." : "Aucune tâche à afficher."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-400">
              <tr>
                <th className="w-8"></th>
                <th className="py-1">Description</th>
                <th>Échéance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="group border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5">
                    <Checkbox checked={t.done} onChange={() => toggle.mutate(t)} />
                  </td>
                  <td className={t.done ? "text-slate-400 line-through" : ""}>
                    {t.description}
                    <button
                      onClick={() => setModal({ open: true, item: t })}
                      title="Modifier"
                      className="ml-1 text-slate-400 opacity-0 transition hover:text-brand-600 group-hover:opacity-100"
                    >
                      ✎
                    </button>
                  </td>
                  <td
                    className={`${t.done ? "line-through" : ""} ${
                      isOverdue(t) ? "font-medium text-red-600" : "text-slate-500"
                    }`}
                  >
                    {t.dueDate ? dateFr(t.dueDate) : "—"}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-2">
                      {t.owner && <MemberAvatar id={t.owner} className={`h-6 w-6 text-xs ${t.done ? "opacity-60" : ""}`} />}
                      <button
                        onClick={() => {
                          if (confirm("Supprimer cette tâche ?")) remove.mutate(t.id);
                        }}
                        className="px-1 text-slate-300 hover:text-red-500"
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal.open && (
        <TodoModal
          key={modal.item?.id ?? "new"}
          item={modal.item}
          onClose={() => setModal({ open: false, item: null })}
          onSaved={() => {
            setModal({ open: false, item: null });
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function TodoModal({
  item,
  onClose,
  onSaved,
}: {
  item: WeddingTodo | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!item;
  const [form, setForm] = useState({
    description: item?.description ?? "",
    dueDate: item?.dueDate ?? "",
    owner: (item?.owner ?? "") as "" | Member,
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        description: form.description,
        dueDate: form.dueDate || null,
        owner: form.owner || null,
      };
      return isEdit
        ? api.patch(`/api/wedding/todos/${item!.id}`, payload)
        : api.post("/api/wedding/todos", payload);
    },
    onSuccess: onSaved,
  });
  // Sur mobile la ligne ne porte que sa case à cocher : supprimer se fait ici,
  // avec un libellé texte, comme toute action irréversible.
  const remove = useMutation({
    mutationFn: () => api.del(`/api/wedding/todos/${item!.id}`),
    onSuccess: onSaved,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{isEdit ? "Modifier la tâche" : "Nouvelle tâche"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (form.description) save.mutate();
          }}
          className="space-y-3"
        >
          <Input
            autoFocus
            placeholder="Description (ex. Réserver le DJ)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="text-xs text-slate-400">
            Responsable (optionnel)
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setForm({ ...form, owner: "" })}
                className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                  form.owner === ""
                    ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                    : "border-slate-300 text-slate-500 hover:border-slate-400 dark:border-slate-700"
                }`}
              >
                Aucun
              </button>
              {(["a", "b"] as Member[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setForm({ ...form, owner: m })}
                  aria-label={m}
                  className={`flex items-center justify-center rounded-full p-0.5 ring-2 transition ${
                    form.owner === m ? "ring-brand-500" : "ring-transparent hover:ring-slate-300"
                  }`}
                >
                  <MemberAvatar id={m} className="h-9 w-9 text-sm" />
                </button>
              ))}
            </div>
          </div>
          <div className="text-xs text-slate-400">
            Échéance (optionnel)
            <DateInput
              value={form.dueDate}
              onChange={(d) => setForm({ ...form, dueDate: d })}
              placeholder="Aucune"
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            {isEdit && (
              <button
                type="button"
                onClick={() => {
                  if (confirm("Supprimer cette tâche ?")) remove.mutate();
                }}
                disabled={remove.isPending}
                className="btn-ghost text-danger"
              >
                Supprimer
              </button>
            )}
            <button type="button" onClick={onClose} className="btn-ghost ml-auto">
              Annuler
            </button>
            <button className="btn-primary" disabled={save.isPending}>
              {save.isPending ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------------- Invités ---------------- */

/**
 * Un « jour » est un emplacement de présence (colonne de `wedding_guest`). Le
 * nombre d'emplacements retenus et leurs libellés viennent de la config du
 * foyer (`useMe().household.weddingDays`) : rien n'est codé en dur ici.
 */
type Day = WeddingDayKey;
/** Libellé configuré d'un emplacement de jour. */
const labelOf = (days: WeddingDay[], key: Day) => days.find((d) => d.key === key)?.label ?? key;
/**
 * Jours du mariage retenus par le foyer (1 à 3), dans l'ordre. Le repli couvre
 * un `/me` encore en cache sans le champ, juste après un déploiement.
 */
const useWeddingDays = () => useMe().household.weddingDays ?? WEDDING_DAYS_DEFAULT;

function InvitesDesktop() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ open: boolean; item: WeddingGuest | null; group: GuestGroup }>({
    open: false,
    item: null,
    group: "vendredi",
  });
  const weddingDays = useWeddingDays();
  const dayKeys = weddingDays.map((d) => d.key);
  const dayLabel = (k: Day) => labelOf(weddingDays, k);
  // Deux tableaux « à partir de … » n'ont de sens qu'à partir de deux jours.
  const twoGroups = weddingDays.length > 1;
  const [daysModal, setDaysModal] = useState(false);
  const [rawFilter, setFilter] = useState<"tout" | Day>("tout");
  const [showArchived, setShowArchived] = useState(false);
  // Recherche (nom / adresse) + filtres famille (adresse, taille) dans une modale.
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [addressFilter, setAddressFilter] = useState<"all" | "with" | "without">("all");
  const [minSize, setMinSize] = useState("");

  const { data } = useQuery({
    queryKey: ["wedding-guests"],
    queryFn: () => api.get<WeddingGuest[]>("/api/wedding/guests"),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["wedding-guests"] });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<WeddingGuest> }) =>
      api.patch(`/api/wedding/guests/${id}`, body),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/wedding/guests/${id}`),
    onSuccess: invalidate,
  });
  const reorderGuests = useMutation({
    mutationFn: (orderedIds: string[]) => api.patch("/api/wedding/guests/reorder", { orderedIds }),
    onSuccess: invalidate,
  });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  // Mode "famille" : id de l'invité principal auquel on rattache des personnes (clic)
  const [groupingFor, setGroupingFor] = useState<string | null>(null);

  if (!data) return <div className="text-slate-400">Chargement…</div>;

  // Un filtre sur un jour qu'on vient de retirer retombe sur « Tout ».
  const filter: "tout" | Day =
    rawFilter === "tout" || dayKeys.includes(rawFilter) ? rawFilter : "tout";

  const matchFilter = (g: WeddingGuest) => filter === "tout" || g[filter];
  const active = data.filter((g) => !g.archived);
  const archivedGuests = data.filter((g) => g.archived);

  // Filtres au niveau famille (principal + enfants). Une famille passe = elle est
  // affichée en entier ; sinon masquée. Recherche = nom d'un membre OU adresse.
  const familyAddress = (p: WeddingGuest) =>
    [p.address, p.postalCode, p.city].filter(Boolean).join(" ").trim();
  const q = search.trim().toLowerCase();
  const minN = minSize.trim() ? parseInt(minSize, 10) : 0;
  const familyPasses = (p: WeddingGuest, members: WeddingGuest[]) => {
    if (minN && members.length < minN) return false;
    const hasAddr = familyAddress(p) !== "";
    if (addressFilter === "with" && !hasAddr) return false;
    if (addressFilter === "without" && hasAddr) return false;
    if (q) {
      const hay = `${members.map((m) => m.name).join(" ")} ${familyAddress(p)}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };
  const anyFilter = q !== "" || addressFilter !== "all" || minSize.trim() !== "";
  const visibleIds = new Set<string>();
  for (const p of active.filter((g) => !g.parentId)) {
    const members = [p, ...active.filter((g) => g.parentId === p.id)];
    if (familyPasses(p, members)) members.forEach((m) => visibleIds.add(m.id));
  }
  const filteredActive = anyFilter ? active.filter((g) => visibleIds.has(g.id)) : active;
  const shown = filteredActive.filter(matchFilter);

  const count = (guests: WeddingGuest[], day: Day) => guests.filter((g) => g[day]).length;
  // Nombre d'adultes / enfants (optionnellement présents un jour donné).
  const countAge = (guests: WeddingGuest[], age: GuestAge, day?: Day) =>
    guests.filter((g) => g.ageGroup === age && (!day || g[day])).length;
  // Ligne récap "🧑 N · 🧒 N" pour un ensemble d'invités (jour optionnel).
  const ageBreakdown = (guests: WeddingGuest[], day?: Day) => (
    <span className="whitespace-nowrap">
      {GUEST_AGE_META.adult.icon} {countAge(guests, "adult", day)} · {GUEST_AGE_META.child.icon}{" "}
      {countAge(guests, "child", day)}
    </span>
  );

  const toggle = (g: WeddingGuest, day: Day) =>
    patch.mutate({ id: g.id, body: { [day]: !g[day] } as Partial<WeddingGuest> });

  // Export .xlsx des invités (hors « non invités »), triés par tableau puis ordre.
  const downloadExcel = () => {
    const guests = active
      .slice()
      .sort((a, b) =>
        a.guestGroup === b.guestGroup
          ? a.position - b.position
          : a.guestGroup === "vendredi"
            ? -1
            : 1,
      );
    // Colonnes de présence : une par jour configuré, avec son libellé.
    const header = [
      "Nom",
      "Type (adulte/enfant)",
      "Adresse",
      "Code postal",
      "Ville",
      "Type (amis/famille/témoin/mariés)",
      ...(twoGroups ? [`Invité dès ${dayLabel("vendredi")}`] : []),
      ...weddingDays.map((d) => `Présent ${d.label}`),
      "Faire-part",
    ];
    const rows = guests.map((g) => [
      g.name,
      GUEST_AGE_META[g.ageGroup].label,
      g.address ?? "",
      g.postalCode ?? "",
      g.city ?? "",
      GUEST_TYPE_META[g.type].label,
      ...(twoGroups ? [g.guestGroup === "vendredi" ? "oui" : "non"] : []),
      ...weddingDays.map((d) => (g[d.key] ? "oui" : "non")),
      g.parentId ? "-" : INVITATION_STATUS_META[g.invitationStatus].label,
    ]);
    downloadXlsx("invites.xlsx", "Invités", [header, ...rows]);
  };

  const transfer = (g: WeddingGuest) => {
    const target: GuestGroup = g.guestGroup === "vendredi" ? "samedi" : "vendredi";
    const body: Partial<WeddingGuest> = { guestGroup: target };
    if (target === "samedi") body.vendredi = false; // le groupe samedi n'a pas de vendredi
    patch.mutate({ id: g.id, body });
  };

  const showDays = filter === "tout" && !showArchived; // colonnes de jours seulement en vue "Tout"

  const renderGuestTable = (opts: {
    title: string;
    guests: WeddingGuest[];
    group: GuestGroup;
    showCreate: boolean;
  }) => {
    const { title, guests, group, showCreate } = opts;
    const isActive = (d: Day) => group === "vendredi" || d !== "vendredi";
    return (
      <div className="card">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex flex-col">
            <span className="font-semibold">
              {title} <span className="text-slate-400">({guests.length})</span>
            </span>
            <span className="text-xs text-slate-400">{ageBreakdown(guests)}</span>
          </div>
          {showCreate && (
            <button
              onClick={() => setModal({ open: true, item: null, group })}
              className="btn-primary hidden text-xs md:inline-flex"
            >
              + Invité
            </button>
          )}
        </div>
        {guests.length === 0 ? (
          <div className="text-sm text-slate-400">Aucun invité.</div>
        ) : (
          <>
          <table className="w-full table-fixed text-sm">
            <thead className="sticky top-0 z-10 bg-white text-xs text-slate-400 dark:bg-slate-900">
              <tr>
                <th className="py-1 text-left">Invité</th>
                <th className="w-28 px-1 text-center">Faire-part</th>
                {showDays &&
                  dayKeys.map((d) => (
                    <th key={d} className="w-12 px-1 text-center sm:w-16">
                      {isActive(d) ? dayLabel(d) : ""}
                    </th>
                  ))}
                <th className="w-24"></th>
              </tr>
            </thead>
            <tbody>
              {guests.map((g) => (
                <tr key={g.id} className="group border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5">
                    <span className="mr-1.5" title={guestIcon(g).label}>
                      {guestIcon(g).icon}
                    </span>
                    {g.name}
                    <button
                      onClick={() => setModal({ open: true, item: g, group })}
                      title="Modifier"
                      className="ml-1 text-slate-400 opacity-0 transition hover:text-brand-600 group-hover:opacity-100"
                    >
                      ✎
                    </button>
                  </td>
                  <td className="px-1 text-center">
                    <InvitationCell
                      g={g}
                      onChange={(s) => patch.mutate({ id: g.id, body: { invitationStatus: s } })}
                    />
                  </td>
                  {showDays &&
                    dayKeys.map((d) => (
                      <td key={d} className="px-1 text-center">
                        {isActive(d) && (
                          <div className="flex justify-center">
                            <Checkbox checked={g[d]} onChange={() => toggle(g, d)} size="sm" />
                          </div>
                        )}
                      </td>
                    ))}
                  <td className="whitespace-nowrap text-right">
                    {showDays && (
                      <button
                        onClick={() => transfer(g)}
                        title={group === "vendredi" ? "Transférer vers samedi" : "Transférer vers vendredi"}
                        className="px-1 text-slate-400 hover:text-brand-600"
                      >
                        ⇄
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (confirm(`Supprimer ${g.name} ?`)) remove.mutate(g.id);
                      }}
                      className="px-1 text-slate-300 hover:text-red-500"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            {showDays && (
            <tfoot>
              <tr className="border-t-2 border-slate-300 font-semibold dark:border-slate-700">
                <td className="py-1.5">Total présents</td>
                <td></td>
                {dayKeys.map((d) => (
                  <td key={d} className="px-1 text-center tabular-nums">
                    {isActive(d) && (
                      <>
                        <div>{count(guests, d)}</div>
                        <div className="text-2xs font-normal text-slate-400">
                          {ageBreakdown(guests, d)}
                        </div>
                      </>
                    )}
                  </td>
                ))}
                <td></td>
              </tr>
            </tfoot>
            )}
          </table>
          </>
        )}
      </div>
    );
  };

  // Vue "Tout" : tableau arborescent (familles) avec drag & drop (réordonner / regrouper).
  // `mergeAll` : un seul jour configuré → un seul tableau, tous les invités.
  const renderFamilyTable = (group: GuestGroup, mergeAll = false) => {
    const isActive = (d: Day) => mergeAll || group === "vendredi" || d !== "vendredi";
    const childrenIds = (pid: string) => filteredActive.filter((g) => g.parentId === pid).map((g) => g.id);
    const principals = filteredActive
      .filter((g) => (mergeAll || g.guestGroup === group) && !g.parentId)
      .sort((a, b) => a.position - b.position);
    const childrenOf = (pid: string) =>
      filteredActive.filter((g) => g.parentId === pid).sort((a, b) => a.position - b.position);
    const flat: { g: WeddingGuest; child: boolean }[] = [];
    principals.forEach((p) => {
      flat.push({ g: p, child: false });
      childrenOf(p.id).forEach((ch) => flat.push({ g: ch, child: true }));
    });
    const flatIds = flat.map((f) => f.g.id);
    const guestsInTable = flat.map((f) => f.g);
    const byId = (id: string) => filteredActive.find((g) => g.id === id);

    // Drag & drop = réorganisation uniquement (le regroupement se fait via le mode famille).
    const onDragEnd = (e: DragEndEvent) => {
      const ov = e.over;
      if (!ov || e.active.id === ov.id) return;
      const ag = byId(String(e.active.id));
      const og = byId(String(ov.id));
      if (!ag || !og) return;
      const aBlock = childrenIds(ag.id).length > 0 ? [ag.id, ...childrenIds(ag.id)] : [ag.id];
      const rest = flatIds.filter((id) => !aBlock.includes(id));
      const idx = rest.indexOf(og.id);
      const at = idx < 0 ? rest.length : idx;
      const newOrder = [...rest.slice(0, at), ...aBlock, ...rest.slice(at)];
      reorderGuests.mutate(newOrder);
    };

    return (
      <div className="card">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex flex-col">
            <span className="font-semibold">
              {mergeAll
                ? "Invités"
                : `Invités à partir de ${dayLabel(group === "vendredi" ? "vendredi" : "samedi")}`}{" "}
              <span className="text-slate-400">({guestsInTable.length})</span>
            </span>
            <span className="text-xs text-slate-400">{ageBreakdown(guestsInTable)}</span>
          </div>
          <button
            onClick={() => setModal({ open: true, item: null, group })}
            className="btn-primary hidden text-xs md:inline-flex"
          >
            + Invité
          </button>
        </div>
        {guestsInTable.length === 0 ? (
          <div className="text-sm text-slate-400">Aucun invité.</div>
        ) : (
          <>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <table className="w-full table-fixed text-sm">
              <thead className="sticky top-0 z-10 bg-white text-xs text-slate-400 dark:bg-slate-900">
                <tr>
                  <th className="py-1 text-left">Invité</th>
                  <th className="w-28 px-1 text-center">Faire-part</th>
                  {dayKeys.map((d) => (
                    <th key={d} className="w-12 px-1 text-center sm:w-16">
                      {isActive(d) ? dayLabel(d) : ""}
                    </th>
                  ))}
                  <th className="w-28"></th>
                </tr>
              </thead>
              <tbody>
                <SortableContext items={flatIds} strategy={verticalListSortingStrategy}>
                  {flat.map(({ g, child }) => (
                    <FamilyRow
                      key={g.id}
                      g={g}
                      child={child}
                      days={dayKeys}
                      isActive={isActive}
                      groupingActive={groupingFor !== null}
                      isGroupPrincipal={groupingFor === g.id}
                      isMember={groupingFor !== null && g.parentId === groupingFor}
                      canJoin={groupingFor !== null && groupingFor !== g.id && childrenIds(g.id).length === 0}
                      onStartGroup={() => setGroupingFor(g.id)}
                      onStopGroup={() => setGroupingFor(null)}
                      onToggleMember={() => {
                        if (!groupingFor) return;
                        if (g.parentId === groupingFor) {
                          patch.mutate({ id: g.id, body: { parentId: null } });
                        } else {
                          const p = byId(groupingFor);
                          patch.mutate({
                            id: g.id,
                            body: { parentId: groupingFor, guestGroup: p ? p.guestGroup : group },
                          });
                        }
                      }}
                      onToggle={(d) => toggle(g, d)}
                      onStatus={(s) => patch.mutate({ id: g.id, body: { invitationStatus: s } })}
                      onUngroup={() => patch.mutate({ id: g.id, body: { parentId: null } })}
                      onEdit={() => setModal({ open: true, item: g, group })}
                      onRemove={() => {
                        if (confirm(`Supprimer ${g.name} ?`)) remove.mutate(g.id);
                      }}
                    />
                  ))}
                </SortableContext>
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-semibold dark:border-slate-700">
                  <td className="py-1.5">Total présents</td>
                  <td></td>
                  {dayKeys.map((d) => (
                    <td key={d} className="px-1 text-center tabular-nums">
                      {isActive(d) && (
                        <>
                          <div>{count(guestsInTable, d)}</div>
                          <div className="text-2xs font-normal text-slate-400">
                            {ageBreakdown(guestsInTable, d)}
                          </div>
                        </>
                      )}
                    </td>
                  ))}
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </DndContext>
          </>
        )}
      </div>
    );
  };

  const FILTERS: { id: "tout" | Day; label: string }[] = [
    { id: "tout", label: "Tout" },
    ...weddingDays.map((d) => ({ id: d.key, label: d.label })),
  ];

  return (
    <div className="space-y-4">
      {!showArchived ? (
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher (nom, adresse…)"
            className="input min-w-0 flex-1"
          />
          <button
            onClick={() => setFiltersOpen(true)}
            className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-sm ${
              addressFilter !== "all" || minSize.trim() !== ""
                ? "border-brand-500 text-brand-600 ring-1 ring-brand-500"
                : "border-slate-300 text-slate-500 dark:border-slate-700"
            }`}
            aria-label="Filtres"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path d="M3 4h18l-7 8v6l-4 2v-8L3 4z" />
            </svg>
            Filtres
          </button>
        </div>
      ) : (
        // Vue « non invités » : sur mobile, un bouton Filtres pour rouvrir la modale (et en sortir).
        <div className="md:hidden">
          <button
            onClick={() => setFiltersOpen(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-brand-500 px-3 py-2 text-sm text-brand-600 ring-1 ring-brand-500"
            aria-label="Filtres"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path d="M3 4h18l-7 8v6l-4 2v-8L3 4z" />
            </svg>
            Filtres
          </button>
        </div>
      )}

      {/* Présence + « non invités » : sur mobile ces contrôles sont dans la modale de filtres. */}
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        {!showArchived && (
          <>
            <span className="text-sm text-slate-400">Présence :</span>
            <SubNav
              value={filter}
              onChange={(v) => setFilter(v as "tout" | Day)}
              bleed={false}
              items={FILTERS.map((f) => ({ value: f.id, label: f.label }))}
            />
          </>
        )}
        <button
          onClick={() => setDaysModal(true)}
          className="subtab ml-auto"
          title="Choisir le nombre de jours et leurs noms"
        >
          📅 Jours ({weddingDays.length})
        </button>
        <button
          onClick={() => setShowArchived((v) => !v)}
          className={`subtab ${showArchived ? "active" : ""}`}
        >
          🗄️ Non invités ({archivedGuests.length})
        </button>
      </div>

      {daysModal && <WeddingDaysModal days={weddingDays} onClose={() => setDaysModal(false)} />}

      {showArchived ? (
        renderGuestTable({
          title: "Non invités",
          guests: archivedGuests,
          group: "vendredi",
          showCreate: false,
        })
      ) : (
        <>
          {showDays ? (
            <>
              {groupingFor && (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-700 dark:bg-brand-600/20 dark:text-brand-50">
                  <span>
                    👪 Mode famille — coche les invités à rattacher à{" "}
                    <b>{active.find((g) => g.id === groupingFor)?.name}</b>.
                  </span>
                  <button
                    onClick={() => setGroupingFor(null)}
                    className="rounded-lg bg-brand-600 px-2 py-0.5 text-xs font-medium text-on-brand"
                  >
                    Terminé
                  </button>
                </div>
              )}
              {twoGroups ? (
                <>
                  {renderFamilyTable("vendredi")}
                  {renderFamilyTable("samedi")}
                </>
              ) : (
                renderFamilyTable("vendredi", true)
              )}
            </>
          ) : (
            renderGuestTable({
              title: `Invités présents le ${dayLabel(filter as Day).toLowerCase()}`,
              guests: shown,
              group: "vendredi",
              showCreate: false,
            })
          )}

          <div className="card">
            <div className="mb-2 font-semibold">Total invités présents</div>
            <div
              className="grid gap-3 text-center"
              style={{ gridTemplateColumns: `repeat(${weddingDays.length}, minmax(0, 1fr))` }}
            >
              {weddingDays.map((d) => (
                <div key={d.key}>
                  <div className="text-xs text-slate-400">{d.label}</div>
                  <div className="text-2xl font-bold tabular-nums">{count(shown, d.key)}</div>
                  <div className="mt-0.5 text-xs text-slate-400">{ageBreakdown(shown, d.key)}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="flex justify-center pt-2">
        <button onClick={downloadExcel} className="btn-ghost inline-flex items-center gap-2">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="M7 10l5 5 5-5" />
            <path d="M12 15V3" />
          </svg>
          Télécharger Excel
        </button>
      </div>

      {modal.open && (
        <GuestModal
          key={modal.item?.id ?? "new"}
          item={modal.item}
          defaultGroup={modal.group}
          onClose={() => setModal({ open: false, item: null, group: "vendredi" })}
          onSaved={() => {
            setModal({ open: false, item: null, group: "vendredi" });
            invalidate();
          }}
        />
      )}

      {filtersOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
          onClick={() => setFiltersOpen(false)}
        >
          <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Filtres</h2>
              <button onClick={() => setFiltersOpen(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            <div className="flex flex-col gap-4">
              {/* Présence + non invités : uniquement sur mobile (inline sur ordinateur). */}
              <div className="md:hidden">
                <div className="mb-1.5 text-xs text-slate-400">Présence</div>
                <div className="flex flex-wrap gap-1.5">
                  {FILTERS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFilter(f.id)}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                        filter === f.id
                          ? "bg-brand-600 text-on-brand"
                          : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm md:hidden">
                <Checkbox checked={showArchived} onChange={() => setShowArchived((v) => !v)} size="sm" />
                Afficher les non invités ({archivedGuests.length})
              </label>
              <div>
                <div className="mb-1.5 text-xs text-slate-400">Adresse de la famille</div>
                <div className="flex rounded-xl border border-slate-300 p-0.5 dark:border-slate-700">
                  {(
                    [
                      { v: "all", label: "Toutes" },
                      { v: "with", label: "Avec adresse" },
                      { v: "without", label: "Sans adresse" },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setAddressFilter(o.v)}
                      className={`flex-1 rounded-lg px-2 py-1.5 text-sm ${
                        addressFilter === o.v
                          ? "bg-brand-600 text-on-brand"
                          : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="text-xs text-slate-400">
                Familles d'au moins X personnes
                <input
                  type="number"
                  min="1"
                  value={minSize}
                  onChange={(e) => setMinSize(e.target.value)}
                  placeholder="ex. 3"
                  className="input mt-1 tabular-nums"
                />
              </label>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={() => {
                  setAddressFilter("all");
                  setMinSize("");
                }}
                className="btn-ghost text-sm"
              >
                Réinitialiser
              </button>
              <button onClick={() => setFiltersOpen(false)} className="btn-primary">
                Voir les résultats
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Réglage des jours du mariage : combien (1 à 3) et sous quel nom. Les présences
 * saisies sur un jour retiré restent en base et réapparaissent s'il est remis.
 */
function WeddingDaysModal({ days, onClose }: { days: WeddingDay[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [labels, setLabels] = useState<string[]>(() =>
    WEDDING_DAY_KEYS.map((_, i) => days[i]?.label ?? WEDDING_DAYS_DEFAULT[i].label),
  );
  const [count, setCount] = useState(days.length);

  const save = useMutation({
    mutationFn: () =>
      api.put("/api/wedding/days", {
        days: WEDDING_DAY_KEYS.slice(0, count).map((key, i) => ({
          key,
          label: labels[i].trim() || WEDDING_DAYS_DEFAULT[i].label,
        })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      onClose();
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">📅 Jours du mariage</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div>
            <div className="mb-1 text-xs text-slate-400">Combien de jours ?</div>
            <div className="flex gap-2">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCount(n)}
                  className={count === n ? "btn-primary flex-1" : "btn-ghost flex-1"}
                >
                  {n} jour{n > 1 ? "s" : ""}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs text-slate-400">Nom de chaque jour</div>
            {WEDDING_DAY_KEYS.slice(0, count).map((key, i) => (
              <div key={key} className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-xs text-slate-400">Jour {i + 1}</span>
                <Input
                  value={labels[i]}
                  maxLength={24}
                  onChange={(e) =>
                    setLabels((prev) => prev.map((l, j) => (j === i ? e.target.value : l)))
                  }
                  placeholder={WEDDING_DAYS_DEFAULT[i].label}
                />
              </div>
            ))}
          </div>

          <p className="text-xs text-slate-400">
            Les présences déjà cochées sur un jour retiré sont conservées : elles réapparaissent si
            tu remets ce jour.
          </p>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-ghost">
              Annuler
            </button>
            <button className="btn-primary" disabled={save.isPending}>
              {save.isPending ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FamilyRow({
  g,
  child,
  days,
  isActive,
  groupingActive,
  isGroupPrincipal,
  isMember,
  canJoin,
  onStartGroup,
  onStopGroup,
  onToggleMember,
  onToggle,
  onStatus,
  onUngroup,
  onEdit,
  onRemove,
}: {
  g: WeddingGuest;
  child: boolean;
  days: Day[];
  isActive: (d: Day) => boolean;
  groupingActive: boolean;
  isGroupPrincipal: boolean;
  isMember: boolean;
  canJoin: boolean;
  onStartGroup: () => void;
  onStopGroup: () => void;
  onToggleMember: () => void;
  onToggle: (d: Day) => void;
  onStatus: (s: InvitationStatus) => void;
  onUngroup: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: g.id,
    disabled: groupingActive,
  });
  const rowClick = groupingActive && canJoin ? onToggleMember : undefined;
  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={rowClick}
      className={`group border-t border-slate-100 dark:border-slate-800 ${isDragging ? "bg-brand-50 dark:bg-slate-800" : ""} ${
        isGroupPrincipal ? "bg-brand-50 dark:bg-slate-800" : ""
      } ${rowClick ? "cursor-pointer hover:bg-brand-50/60 dark:hover:bg-slate-800" : ""}`}
    >
      <td className={child ? "py-1" : "py-2.5"}>
        <div className={`flex items-center gap-1 ${child ? "pl-6" : ""}`}>
          {groupingActive ? (
            canJoin ? (
              <span className="w-4 text-center">{isMember ? "☑" : "☐"}</span>
            ) : (
              <span className="w-4" />
            )
          ) : (
            <button
              {...attributes}
              {...listeners}
              className="cursor-grab text-slate-300 hover:text-slate-500"
              title="Glisser pour réordonner"
            >
              ⠿
            </button>
          )}
          {child && <span className="text-slate-300">↳</span>}
          <span
            className={child ? "text-xs" : "text-base"}
            title={guestIcon(g).label}
          >
            {guestIcon(g).icon}
          </span>
          <span className={`truncate ${child ? "text-xs text-slate-500 dark:text-slate-400" : "font-semibold"}`}>
            {g.name}
          </span>
          {!groupingActive && (
            <button
              onClick={onEdit}
              title="Modifier"
              className="text-slate-400 opacity-0 transition hover:text-brand-600 group-hover:opacity-100"
            >
              ✎
            </button>
          )}
        </div>
        {!child && (g.address || g.postalCode || g.city) && (
          <div className="truncate pl-6 text-xs text-slate-400">
            📍{" "}
            {[g.address, [g.postalCode, g.city].filter(Boolean).join(" ")]
              .filter(Boolean)
              .join(", ")}
          </div>
        )}
      </td>
      <td className="px-1 text-center">{!groupingActive && <InvitationCell g={g} onChange={onStatus} />}</td>
      {days.map((d) => (
        <td key={d} className="px-1 text-center">
          {isActive(d) && (
            <div className="flex justify-center">
              <Checkbox checked={g[d]} onChange={() => onToggle(d)} size="sm" />
            </div>
          )}
        </td>
      ))}
      <td className="whitespace-nowrap text-right">
        {isGroupPrincipal ? (
          <button
            onClick={onStopGroup}
            className="rounded-lg bg-brand-600 px-2 py-0.5 text-xs font-medium text-on-brand"
          >
            Terminé
          </button>
        ) : groupingActive ? null : (
          <>
            {child && (
              <button
                onClick={onUngroup}
                title="Détacher de la famille"
                className="px-1 text-slate-400 hover:text-brand-600"
              >
                ⤴
              </button>
            )}
            {!child && (
              <button
                onClick={onStartGroup}
                title="Créer une famille : rattacher des invités sous cette personne"
                className="px-1 text-slate-400 hover:text-brand-600"
              >
                👪
              </button>
            )}
            <button onClick={onRemove} className="px-1 text-slate-300 hover:text-red-500">
              ✕
            </button>
          </>
        )}
      </td>
    </tr>
  );
}

function GuestModal({
  item,
  defaultGroup,
  onClose,
  onSaved,
}: {
  item: WeddingGuest | null;
  defaultGroup: GuestGroup;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!item;
  const [form, setForm] = useState({
    name: item?.name ?? "",
    type: (item?.type ?? "famille") as GuestType,
    ageGroup: (item?.ageGroup ?? "adult") as GuestAge,
    invitationStatus: (item?.invitationStatus ?? "to_send") as InvitationStatus,
    guestGroup: (item?.guestGroup ?? defaultGroup) as GuestGroup,
    vendredi: item?.vendredi ?? true,
    samedi: item?.samedi ?? true,
    dimanche: item?.dimanche ?? true,
    address: item?.address ?? "",
    postalCode: item?.postalCode ?? "",
    city: item?.city ?? "",
    archived: item?.archived ?? false,
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name,
        type: form.type,
        ageGroup: form.ageGroup,
        invitationStatus: form.invitationStatus,
        guestGroup: form.guestGroup,
        vendredi: form.guestGroup === "samedi" ? false : form.vendredi,
        samedi: form.samedi,
        dimanche: form.dimanche,
        address: form.address || null,
        postalCode: form.postalCode || null,
        city: form.city || null,
        archived: form.archived,
      };
      return isEdit
        ? api.patch(`/api/wedding/guests/${item!.id}`, payload)
        : api.post("/api/wedding/guests", payload);
    },
    onSuccess: onSaved,
  });

  // Jours configurés ; le tableau « à partir du jour 2 » exclut le premier jour.
  const cfgDays = useWeddingDays();
  const days: Day[] = cfgDays
    .map((d) => d.key)
    .filter((k) => form.guestGroup === "vendredi" || k !== "vendredi");

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{isEdit ? "Modifier l'invité" : "Nouvel invité"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (form.name) save.mutate();
          }}
          className="space-y-3"
        >
          <Input
            autoFocus
            placeholder="Nom de l'invité"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <div className="text-xs text-slate-400">
            Type de personne
            <div className="mt-1 grid grid-cols-2 gap-2">
              {(Object.keys(GUEST_AGE_META) as GuestAge[]).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setForm({ ...form, ageGroup: a })}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition-colors ${
                    form.ageGroup === a
                      ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                      : "border-slate-300 text-slate-500 hover:border-slate-400 dark:border-slate-700"
                  }`}
                >
                  <span className="text-base">{GUEST_AGE_META[a].icon}</span>
                  {GUEST_AGE_META[a].label}
                </button>
              ))}
            </div>
          </div>
          <Input
            placeholder="Adresse — n° et rue (optionnel)"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
          <div className="grid grid-cols-3 gap-3">
            <Input
              placeholder="Code postal"
              value={form.postalCode}
              onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
            />
            <Input
              className="col-span-2"
              placeholder="Ville"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="text-xs text-slate-400">
              Type
              <Select
                value={form.type}
                onChange={(v) => setForm({ ...form, type: v as GuestType })}
                options={GUEST_TYPE.map((t) => ({
                  value: t,
                  label: `${GUEST_TYPE_META[t].icon} ${GUEST_TYPE_META[t].label}`,
                }))}
              />
            </div>
            {/* Le regroupement par jour d'arrivée n'a de sens qu'à plusieurs jours. */}
            {cfgDays.length > 1 && (
              <div className="text-xs text-slate-400">
                Tableau
                <Select
                  value={form.guestGroup}
                  onChange={(v) => setForm({ ...form, guestGroup: v as GuestGroup })}
                  options={GUEST_GROUP.map((g, i) => ({
                    value: g,
                    label: `À partir de ${labelOf(cfgDays, cfgDays[i].key)}`,
                  }))}
                />
              </div>
            )}
          </div>
          <div className="text-xs text-slate-400">
            Présence
            <div className="mt-1 flex gap-4">
              {days.map((d) => (
                <Checkbox
                  key={d}
                  checked={form[d]}
                  onChange={() => setForm({ ...form, [d]: !form[d] })}
                  label={labelOf(cfgDays, d)}
                />
              ))}
            </div>
          </div>
          {!item?.parentId && (
            <div className="text-xs text-slate-400">
              Faire-part
              <Select
                value={form.invitationStatus}
                onChange={(v) => setForm({ ...form, invitationStatus: v as InvitationStatus })}
                options={INVITATION_STATUS.map((s) => ({
                  value: s,
                  label: INVITATION_STATUS_META[s].label,
                }))}
              />
            </div>
          )}
          <div className="rounded-xl border border-slate-200 p-2.5 dark:border-slate-700">
            <Checkbox
              checked={form.archived}
              onChange={() => setForm({ ...form, archived: !form.archived })}
              label="Non invité (archivé — ne compte pas dans les totaux)"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost">
              Annuler
            </button>
            <button className="btn-primary" disabled={save.isPending}>
              {save.isPending ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
