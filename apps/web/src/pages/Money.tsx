import { useState, useEffect, useRef, Fragment, type ReactNode } from "react";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  Account,
  Category,
  Recurring,
  Balance,
  Cashflow,
  Transaction,
  Settlement,
  SavingsContribution,
  PlannedExpense,
  LunchflowAccount,
  BankTransaction,
  MoneySummary,
  TransferCheck,
  UtilityData,
  UtilityReading,
} from "@gfa/shared";
import { TX_TYPE_LABEL, TX_TYPES } from "@gfa/shared";
import { useMe } from "../auth";
import { api, ApiError } from "../lib/api";
import PageLoader from "../components/PageLoader";
import {
  eur,
  eur0,
  eurToCents,
  dateFr,
  dateFrShort,
  monthFr,
  relativeFr,
  todayIso,
} from "../lib/format";
import type { OverflowItem } from "../components/ui";
import {
  Select,
  MultiSelect,
  Checkbox,
  Switch,
  DateInput,
  Input,
  SubNav,
  PillToggle,
  DateRangeCalendar,
  MobileActionBar,
  OverflowMenu,
  ActionSheet,
  FilterChips,
  SearchField,
  Sheet,
  SheetRow,
} from "../components/ui";
import {
  IconAlert,
  IconArrowRight,
  IconBank,
  IconBolt,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconFilter,
  IconMoney,
  IconScale,
  IconTrend,
  IconWave,
} from "../components/icons";
import { useLastView } from "../lib/lastView";
import { Indicator } from "../components/Indicator";
import { ExpenseFormModal, type ExpenseFormValues } from "../components/ExpenseForm";
import { MemberAvatar } from "../components/MemberAvatar";
import { useToast } from "../components/Toast";
import { useExpenseCategories, categoryMeta } from "../lib/categories";
import { usePageHeader, usePageChrome, usePageTabs } from "../components/PageHeader";

type Tab = "depenses" | "tresorerie" | "equilibrage" | "prevue" | "elec" | "comptes";

// Vrai en dessous du breakpoint `md` (mobile). Pour adapter ce que CSS ne peut pas (props recharts).
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)").matches : false,
  );
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

const MONTHS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];

// Couleurs officielles de banques courantes reconnues dans le nom du compte,
// avec repli générique : initiales + couleur stable déduite du nom.
const KNOWN_BANKS: { match: string; label: string; bg: string }[] = [
  { match: "trade", label: "TR", bg: "#0b0b0c" },
  { match: "bourso", label: "b", bg: "#e6007e" },
  { match: "lcl", label: "LCL", bg: "#0033a0" },
  { match: "crédit agricole", label: "CA", bg: "#006a4e" },
  { match: "bnp", label: "BNP", bg: "#00915a" },
  { match: "société générale", label: "SG", bg: "#e60028" },
  { match: "caisse d'épargne", label: "CE", bg: "#e2001a" },
  { match: "revolut", label: "R", bg: "#191c1f" },
  { match: "n26", label: "N26", bg: "#26a17b" },
  { match: "fortuneo", label: "F", bg: "#cb0044" },
];
const BADGE_COLORS = ["#64748b", "#0f766e", "#7c3aed", "#b45309", "#be123c", "#1d4ed8", "#4d7c0f"];

/**
 * Nom de compte débarrassé de sa banque : la pastille la porte déjà, la ligne
 * n'a besoin que de ce qui distingue le compte (« LCL joint » → « joint »).
 */
function shortAccountName(name: string): string {
  const bank = KNOWN_BANKS.find((b) => name.toLowerCase().includes(b.match));
  if (!bank) return name;
  const rest = name.replace(new RegExp(bank.match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "").trim();
  return rest || name;
}

/** Petit badge coloré déduit du nom du compte (banque connue, sinon initiales). */
function BankBadge({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const n = name.toLowerCase();
  const known = KNOWN_BANKS.find((b) => n.includes(b.match));
  let label: string;
  let bg: string;
  if (known) {
    ({ label, bg } = known);
  } else {
    // Repli générique : initiales des 2 premiers mots + couleur stable par nom.
    const words = name.split(/\s+/).filter(Boolean);
    label = words
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join("") || "€";
    let hash = 0;
    for (const ch of n) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    bg = BADGE_COLORS[Math.abs(hash) % BADGE_COLORS.length];
  }
  // Rond comme les avatars des membres : les deux se côtoient dans les mêmes
  // listes. Et assez large pour un libellé de 3 lettres à 11 px — en 20 px,
  // « LCL » débordait de sa pastille.
  const dim = size === "sm" ? "h-7 w-7" : "h-9 w-9";
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full text-2xs font-bold leading-none tracking-tight text-white ${dim}`}
      style={{ backgroundColor: bg }}
      title={name}
    >
      {label.slice(0, 3)}
    </span>
  );
}

/**
 * Onglets d'Argent. `group` découpe le hub mobile : ce qu'on **suit** (des
 * chiffres du mois) et ce qu'on **gère** (des références qui bougent peu).
 */
const MONEY_TABS: { id: Tab; label: string; title?: string; group: "suivre" | "gerer" }[] = [
  { id: "depenses", label: "Dépenses", group: "suivre" },
  { id: "tresorerie", label: "Trésorerie", group: "suivre" },
  { id: "equilibrage", label: "Équilibrage", group: "suivre" },
  // `title` : le nom complet en tête de page, quand l'onglet doit rester court.
  { id: "prevue", label: "Prévue", title: "Dépenses prévues", group: "suivre" },
  { id: "elec", label: "Électricité", group: "gerer" },
  { id: "comptes", label: "Comptes bancaires", group: "gerer" },
];

/** Sommaire de la section, partagé par le hub et l'onglet Dépenses. */
function useMoneySummary() {
  return useQuery({
    queryKey: ["money-summary"],
    queryFn: () => api.get<MoneySummary>("/api/money/summary"),
  });
}

/**
 * Le chiffre-héros du foyer : ce qui reste après tout ce qui est déjà engagé
 * d'ici la fin du mois, et d'où ça vient. Même carte en tête du sommaire de la
 * section et de l'onglet Dépenses — c'est le repère commun des deux écrans.
 */
function LivingCard({ split }: { split: MoneySummary["split"] }) {
  // Une part négative (découvert) ne se dessine pas : la barre tombe à zéro et
  // le montant passe en rouge, ce qui dit déjà l'essentiel.
  const free = Math.max(0, split.freeCents);
  const base = split.chargesCents + split.variablesCents + free;
  const pct = (v: number) => (base > 0 ? Math.round((v / base) * 100) : 0);
  const pCharges = pct(split.chargesCents);
  const pVariables = pct(split.variablesCents);
  return (
    <div className="card">
      <div className="text-sm text-ink-2">Reste à vivre du foyer</div>
      <div className={`mt-1 text-3xl font-bold ${split.freeCents < 0 ? "text-danger" : ""}`}>
        {eur(split.freeCents)}
      </div>
      <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-surface-2">
        <span className="block bg-brand-600" style={{ width: `${pCharges}%` }} />
        <span className="block bg-warning" style={{ width: `${pVariables}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-xs text-slate-400">
        <span>Charges {pCharges} %</span>
        <span>Variables {pVariables} %</span>
        <span>Libre {Math.max(0, 100 - pCharges - pVariables)} %</span>
      </div>
    </div>
  );
}

/** « d'août 2026 » / « de mars 2026 » — l'élision devant une voyelle. */
function ofMonthFr(year: number, month: number): string {
  const name = new Date(year, month - 1, 1).toLocaleDateString("fr-FR", { month: "long" });
  return /^[aeiouyéè]/i.test(name) ? `d'${name} ${year}` : `de ${name} ${year}`;
}

const HUB_ICON: Record<Tab, (p: { size?: number; className?: string }) => JSX.Element> = {
  depenses: IconTrend,
  tresorerie: IconWave,
  equilibrage: IconScale,
  prevue: IconCalendar,
  elec: IconBolt,
  comptes: IconBank,
};

export default function Money() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const monthLabel = new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const { tab: tabParam, view: viewParam } = useParams();
  const tab: Tab = MONEY_TABS.some((t) => t.id === tabParam) ? (tabParam as Tab) : "depenses";
  // `/money` sans onglet = sommaire de la section (mobile). Sur ordinateur, les
  // onglets sont toujours là : la page ouvre directement Dépenses, comme avant.
  const hub = isMobile && !tabParam;
  // Le « ⋯ » de la barre appartient au shell : un onglet ne peut pas le
  // déclarer lui-même (l'effet du parent passe après et l'écraserait). Seule
  // Électricité en a un pour l'instant — le tarif du kWh, qui chiffre la page.
  const [elecPrice, setElecPrice] = useState(false);

  usePageHeader(
    hub
      ? "Argent"
      : (() => {
          const cur = MONEY_TABS.find((t) => t.id === tab);
          return cur?.title ?? cur?.label ?? "Argent";
        })(),
    hub
      ? `${monthLabel} · Foyer`
      : // Trésorerie porte ses propres sélecteurs de mois : annoncer le mois
        // courant dans l'en-tête contredirait la vue qu'on regarde.
        tab === "tresorerie"
        ? "Argent"
        : `Argent · ${monthLabel}`,
  );
  // Depuis un onglet, la barre mobile porte un retour vers le sommaire — c'est
  // lui qui remplace la rangée d'onglets (plus appelée : `usePageTabs`).
  usePageChrome(
    tabParam ? "/money" : null,
    tab === "elec" ? [{ label: "Prix du kWh", onClick: () => setElecPrice(true) }] : [],
  );

  return (
    <div className="flex flex-col gap-4">
      <SubNav
        value={tab}
        onChange={(v) => navigate(`/money/${v}`)}
        items={MONEY_TABS.map((t) => ({ value: t.id, label: t.label }))}
        className="hidden md:block"
      />
      {hub ? (
        <MoneyHub />
      ) : (
        <>
          {tab === "depenses" && <Depenses view={viewParam} />}
          {tab === "tresorerie" && <Tresorerie view={viewParam} />}
          {tab === "equilibrage" && <Equilibrage />}
          {tab === "prevue" && <Prevue view={viewParam} />}
          {tab === "elec" && (
            <Electricite
              view={viewParam}
              priceOpen={elecPrice}
              onPriceOpen={setElecPrice}
            />
          )}
          {tab === "comptes" && <Transactions view={viewParam} />}
        </>
      )}
    </div>
  );
}

/* ---------------- Hub de section (mobile) ---------------- */

/** Rangée du sommaire : rubrique, ce qu'elle contient, son chiffre. */
function HubRow({
  tab,
  sub,
  value,
  tone = "default",
  last,
}: {
  tab: Tab;
  sub: string;
  value: string;
  tone?: "default" | "danger" | "warning";
  last: boolean;
}) {
  const Icon = HUB_ICON[tab];
  const label = MONEY_TABS.find((t) => t.id === tab)?.label ?? "";
  const toneClass =
    tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-ink";
  return (
    <div className={last ? "" : "border-b border-hairline"}>
      <Link to={`/money/${tab}`} className="flex min-h-[64px] items-center gap-3 py-2.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-2">
          <Icon size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold">{label}</span>
          <span className="block truncate text-xs text-slate-400">{sub}</span>
        </span>
        <span className={`shrink-0 text-base font-semibold ${toneClass}`}>{value}</span>
        <IconChevronRight size={20} className="shrink-0 text-slate-400" />
      </Link>
    </div>
  );
}

/**
 * Sommaire chiffré de la section. Un seul appel (`/api/money/summary`) : six
 * requêtes séparées auraient rendu l'écran d'entrée plus lent que les onglets
 * qu'il résume.
 */
function MoneyHub() {
  const navigate = useNavigate();
  const me = useMe();
  const members = me.household.members;
  const { data } = useMoneySummary();

  if (!data) return <PageLoader variant="argent" />;

  const eq = data.equilibrage;
  const elec = data.electricite;
  const suivre = MONEY_TABS.filter((t) => t.group === "suivre");
  const gerer = MONEY_TABS.filter((t) => t.group === "gerer");

  const subOf: Record<Tab, string> = {
    depenses: `${data.depenses.count} charge${data.depenses.count > 1 ? "s" : ""} fixe${
      data.depenses.count > 1 ? "s" : ""
    }`,
    tresorerie: `${data.tresorerie.accounts} compte${data.tresorerie.accounts > 1 ? "s" : ""} · aujourd'hui`,
    equilibrage:
      eq.amount === 0
        ? "Tout est équilibré"
        : `${members[eq.fromUser].name} doit à ${members[eq.toUser].name}`,
    prevue: `${data.prevue.count} à venir`,
    elec: elec ? `relevé ${ofMonthFr(elec.year, elec.month)}` : "aucun relevé",
    comptes: data.comptes.names.join(" · ") || "aucun compte",
  };
  const valueOf: Record<Tab, { value: string; tone?: "danger" | "warning" }> = {
    depenses: { value: `−${eur0(data.depenses.monthlyCents)}`, tone: "danger" },
    tresorerie: { value: eur0(data.tresorerie.balanceCents) },
    equilibrage:
      eq.amount === 0
        ? { value: "0 €" }
        : { value: `+${eur0(eq.amount)}`, tone: "warning" },
    prevue: { value: `−${eur0(data.prevue.totalCents)}`, tone: "danger" },
    elec: { value: elec ? `${elec.kwh} kWh` : "—" },
    comptes: { value: String(data.comptes.count) },
  };

  const section = (title: string, tabs: typeof MONEY_TABS) => (
    <div className="flex flex-col gap-2">
      <div className="eyebrow">{title}</div>
      <div className="card">
        {tabs.map((t, i) => (
          <HubRow
            key={t.id}
            tab={t.id}
            sub={subOf[t.id]}
            value={valueOf[t.id].value}
            tone={valueOf[t.id].tone}
            last={i === tabs.length - 1}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-5 pb-28">
      <LivingCard split={data.split} />

      {section("Suivre", suivre)}
      {section("Gérer", gerer)}

      <MobileActionBar
        label="Nouvelle dépense"
        onClick={() => navigate("/money/equilibrage?nouvelle=1")}
      />
    </div>
  );
}

/* ---------------- Comptes bancaires ---------------- */

/**
 * Deux écrans, pas un. Les opérations avaient leur propre recherche et leurs
 * propres filtres collés sous les comptes : c'était une deuxième page.
 */
const COMPTES_VIEWS = ["comptes", "operations"] as const;

// Horodatage long « le 12 août à 20:03 » — la ligne de pied de la feuille de réglages.
function syncTimeFr(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("fr-FR", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Icône chaîne (lier une opération à une dépense).
function LinkIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

const ACCOUNT_TYPE_OPTIONS = [
  { value: "checking", label: "🏦 Courant" },
  { value: "savings", label: "🐖 Épargne" },
  { value: "investment", label: "📈 Investissement" },
];

/**
 * Épargne et courants ne répondent pas à la même question : mélanger 500 € de
 * livret aux comptes du quotidien faussait la lecture du disponible. Un groupe
 * par nature, dans cet ordre.
 */
const ACCOUNT_GROUPS = [
  { type: "checking", title: "Comptes courants", short: "Courants" },
  { type: "savings", title: "Épargne", short: "Épargne" },
  { type: "investment", title: "Investissement", short: "Placé" },
] as const;

const accountTypeLabel = (type: string) =>
  ({ checking: "Compte courant", savings: "Épargne", investment: "Investissement" })[type] ??
  "Compte";

/**
 * Ce que chaque ligne dit d'elle-même : d'où vient son solde et s'il est encore
 * bon. « synchro : 11 août, 20:03 » en gris pâle sous certaines cartes ne le
 * disait pas — et ne disait rien du tout des comptes saisis à la main.
 */
type SyncTone = "ok" | "warn" | "bad";
function syncStateOf(a: Account): { tone: SyncTone; text: string } {
  if (!a.lunchflowAccountId)
    return {
      tone: "warn",
      text: a.balanceUpdatedAt
        ? `Saisi à la main · ${dateFrShort(a.balanceUpdatedAt)}`
        : "Saisi à la main",
    };
  if (a.lunchflowError) return { tone: "bad", text: "Reconnexion nécessaire" };
  if (!a.lunchflowSyncedAt) return { tone: "warn", text: "Jamais synchronisé" };
  return { tone: "ok", text: `Synchro ${relativeFr(a.lunchflowSyncedAt)}` };
}

const SYNC_TEXT: Record<SyncTone, string> = {
  ok: "text-brand-600",
  warn: "text-warning",
  bad: "text-danger",
};
const SYNC_DOT: Record<SyncTone, string> = {
  ok: "bg-brand-600",
  warn: "bg-warning",
  bad: "bg-danger",
};

/** L'état de synchro d'un compte, en une ligne : pastille + phrase. */
function SyncLine({ account: a }: { account: Account }) {
  const s = syncStateOf(a);
  return (
    // `items-start` + décalage de la pastille : « Reconnexion nécessaire » ne
    // tient pas sur une ligne à côté d'un solde, il passe donc à la ligne — un
    // état de synchro coupé au milieu ne dit plus rien.
    <span className={`flex items-start gap-1.5 text-xs ${SYNC_TEXT[s.tone]}`}>
      <span
        className={`mt-[0.3rem] h-1.5 w-1.5 shrink-0 rounded-full ${SYNC_DOT[s.tone]}`}
        aria-hidden
      />
      <span>{s.text}</span>
    </span>
  );
}

/** Les trois points de fin de ligne — ici purement indicatifs : la ligne entière ouvre la feuille. */
function DotsGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
      <circle cx="5.5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18.5" cy="12" r="1.6" />
    </svg>
  );
}

/* ---------------- Feuille de réglages d'un compte ---------------- */

/**
 * Tout ce qu'on peut faire d'un compte, au même endroit : son solde, ce à quoi
 * il sert, sa connexion, sa suppression. Remplace les quatre cibles de 20 px
 * dispersées dans les coins de l'ancienne carte, dont le sens changeait d'une
 * carte à l'autre.
 */
function AccountSheet({
  account: a,
  onClose,
  onOpenLink,
}: {
  account: Account;
  onClose: () => void;
  onOpenLink: () => void;
}) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const linked = !!a.lunchflowAccountId;
  const [balance, setBalance] = useState((a.currentBalance / 100).toFixed(2).replace(".", ","));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["accounts"] });
    qc.invalidateQueries({ queryKey: ["balance"] });
    qc.invalidateQueries({ queryKey: ["cashflow"] });
    qc.invalidateQueries({ queryKey: ["money-summary"] });
  };

  const patchAccount = useMutation({
    mutationFn: (payload: {
      type?: string;
      isPrimary?: boolean;
      forecast?: boolean;
      currentBalance?: number;
    }) => api.patch(`/api/accounts/${a.id}`, payload),
    onSuccess: invalidate,
  });
  const setDefaultAccount = useMutation({
    mutationFn: (accountId: string | null) =>
      api.patch("/api/household/default-account", { accountId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
  const forceSync = useMutation({
    mutationFn: () => api.post(`/api/lunchflow/sync/${a.id}`, {}),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["bank-transactions"] });
      toast.success("Compte synchronisé");
    },
    onError: () => toast.error("Synchro impossible"),
  });
  const removeAccount = useMutation({
    mutationFn: () => api.del(`/api/accounts/${a.id}`),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["bank-transactions"] });
      qc.invalidateQueries({ queryKey: ["recurring"] });
      onClose();
    },
  });
  // Import d'un relevé PDF : Claude en extrait les opérations côté back.
  const importPdf = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.upload<{ added: number; skipped: number; total: number }>(
        `/api/lunchflow/import/${a.id}`,
        form,
      );
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["bank-transactions"] });
      toast.success(
        r.added > 0
          ? `${r.added} opération(s) importée(s)${r.skipped > 0 ? `, ${r.skipped} déjà présente(s)` : ""}`
          : r.total > 0
            ? "Toutes les opérations du relevé sont déjà importées"
            : "Aucune opération trouvée dans le relevé",
      );
    },
    onError: (e) => {
      const raw = e instanceof ApiError ? e.message : "";
      toast.error(
        raw.includes("no-key")
          ? "Clé Claude manquante (Réglages)"
          : raw.includes("no-text")
            ? "Ce PDF ne contient pas de texte (relevé scanné ?)"
            : raw.includes("too-large")
              ? "Fichier trop volumineux (max 15 Mo)"
              : raw.includes("not-pdf")
                ? "Le fichier doit être un PDF"
                : "Échec de l'import du relevé",
      );
    },
  });

  const parsedBalance = Number(balance.replace(/\s/g, "").replace(",", "."));
  const balanceDirty =
    Number.isFinite(parsedBalance) && eurToCents(parsedBalance) !== a.currentBalance;
  const ownerName = a.owner === "joint" ? "Commun" : me.household.members[a.owner].name;

  return (
    <Sheet
      title={a.name}
      subtitle={`${accountTypeLabel(a.type)} · ${syncStateOf(a).text.toLowerCase()}`}
      thumbnail={<BankBadge name={a.name} />}
      onClose={onClose}
    >
      {/* Le solde : la seule donnée qu'on vient vraiment corriger. */}
      <div className="border-b border-hairline px-4 py-3">
        <div className="text-xs text-slate-400">Solde actuel</div>
        {linked ? (
          <div className="mt-1 flex items-center gap-3">
            <span className="text-2xl font-bold">{eur(a.currentBalance)}</span>
            <button
              type="button"
              onClick={() => forceSync.mutate()}
              disabled={forceSync.isPending}
              className="btn-ghost ml-auto text-sm disabled:opacity-40"
            >
              {forceSync.isPending ? "Synchro…" : "Synchroniser"}
            </button>
          </div>
        ) : (
          <div className="mt-1 flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Input
                type="text"
                inputMode="decimal"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                className="pr-8 text-lg font-semibold"
                aria-label="Solde actuel"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                €
              </span>
            </div>
            <button
              type="button"
              onClick={() => patchAccount.mutate({ currentBalance: eurToCents(parsedBalance) })}
              disabled={!balanceDirty || patchAccount.isPending}
              className="btn-primary shrink-0 disabled:opacity-40"
            >
              Valider
            </button>
          </div>
        )}
        <div className="mt-2 text-xs text-slate-400">
          {linked
            ? a.lunchflowSyncedAt
              ? `Dernière synchro ${syncTimeFr(a.lunchflowSyncedAt)}`
              : "Jamais synchronisé"
            : a.balanceUpdatedAt
              ? `Dernière mise à jour ${syncTimeFr(a.balanceUpdatedAt)}`
              : "Jamais mis à jour"}
        </div>
        {a.lunchflowError && (
          <div className="mt-2 rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
            Dernière synchro en échec : {a.lunchflowError}
          </div>
        )}
      </div>

      <div className="flex flex-col divide-y divide-hairline">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="min-w-0 flex-1 text-base font-medium">Type de compte</span>
          <div className="w-44 shrink-0">
            <Select
              value={a.type}
              onChange={(v) => patchAccount.mutate({ type: v })}
              options={ACCOUNT_TYPE_OPTIONS}
            />
          </div>
        </div>

        {a.owner !== "joint" && (
          <SheetRow
            label={`Compte principal de ${ownerName}`}
            hint="ses dépenses prévues y sont imputées"
            trailing={
              <Switch
                checked={a.isPrimary}
                onChange={() => patchAccount.mutate({ isPrimary: !a.isPrimary })}
              />
            }
          />
        )}
        <SheetRow
          label="Compte par défaut"
          hint="pré-sélectionné pour une nouvelle dépense"
          trailing={
            <Switch
              checked={me.household.defaultAccountId === a.id}
              onChange={() =>
                setDefaultAccount.mutate(me.household.defaultAccountId === a.id ? null : a.id)
              }
            />
          }
        />
        <SheetRow
          label="Afficher dans Trésorerie"
          hint="compté dans le reste à vivre"
          trailing={
            <Switch checked={a.forecast} onChange={() => patchAccount.mutate({ forecast: !a.forecast })} />
          }
        />

        <SheetRow
          label={linked ? "Gérer la connexion" : "Connecter à la banque"}
          hint={
            linked
              ? "compte associé à LunchFlow"
              : me.hasLunchflowKey
                ? "récupère soldes et opérations automatiquement"
                : "clé API à configurer dans Réglages"
          }
          onClick={onOpenLink}
          trailing={<IconChevronRight size={20} className="shrink-0 text-slate-400" />}
        />

        {!linked && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = ""; // permet de ré-importer le même fichier
                if (f) importPdf.mutate(f);
              }}
            />
            <SheetRow
              label={importPdf.isPending ? "Import en cours…" : "Importer un relevé (PDF)"}
              hint="Claude en extrait les opérations"
              onClick={() => fileRef.current?.click()}
              disabled={importPdf.isPending}
              trailing={<IconChevronRight size={20} className="shrink-0 text-slate-400" />}
            />
          </>
        )}

        {/* Détachée du reste : irréversible, et sa conséquence est écrite. */}
        {confirmDelete ? (
          <div className="px-4 py-3">
            <div className="text-sm font-medium text-danger">Supprimer « {a.name} » ?</div>
            <div className="mt-1 text-xs text-slate-400">
              Ses opérations bancaires et ses charges récurrentes seront supprimées avec lui.
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDelete(false)} className="btn-ghost">
                Annuler
              </button>
              <button
                type="button"
                onClick={() => removeAccount.mutate()}
                disabled={removeAccount.isPending}
                className="btn-primary bg-danger disabled:opacity-40"
              >
                {removeAccount.isPending ? "Suppression…" : "Supprimer"}
              </button>
            </div>
          </div>
        ) : (
          <SheetRow
            label="Supprimer ce compte"
            hint="ses opérations et ses charges seront supprimées"
            danger
            onClick={() => setConfirmDelete(true)}
          />
        )}
      </div>
    </Sheet>
  );
}

/* ---------------- Feuille de connexion à la banque ---------------- */

/**
 * Uniquement l'association : les réglages du compte vivent dans sa feuille.
 * L'écran ne fait plus qu'une chose — choisir le compte bancaire d'en face.
 */
function LunchflowLinkSheet({ account: a, onClose }: { account: Account; onClose: () => void }) {
  const me = useMe();
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ["lunchflow-accounts"],
    queryFn: () => api.get<{ accounts: LunchflowAccount[] }>("/api/lunchflow/accounts"),
    enabled: me.hasLunchflowKey,
    retry: false,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["accounts"] });
    qc.invalidateQueries({ queryKey: ["lunchflow-accounts"] });
    qc.invalidateQueries({ queryKey: ["balance"] });
    qc.invalidateQueries({ queryKey: ["cashflow"] });
  };
  const link = useMutation({
    mutationFn: (lunchflowAccountId: string) =>
      api.put(`/api/lunchflow/link/${a.id}`, { lunchflowAccountId }),
    onSuccess: invalidate,
  });
  const unlink = useMutation({
    mutationFn: () => api.del(`/api/lunchflow/link/${a.id}`),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const linkedHere = list.data?.accounts.find((r) => r.linkedAccountId === a.id);

  return (
    <Sheet
      title="Connexion à la banque"
      subtitle={a.name}
      thumbnail={<BankBadge name={a.name} />}
      onClose={onClose}
    >
      <div className="p-4">
        {!me.hasLunchflowKey ? (
          <p className="text-sm text-ink-2">
            Configure d'abord ta clé API LunchFlow dans{" "}
            <span className="font-medium">Réglages → Paramètres</span>.
          </p>
        ) : list.isLoading ? (
          <p className="text-sm text-slate-400">Chargement des comptes LunchFlow…</p>
        ) : list.isError ? (
          <p className="text-sm text-danger">
            Impossible de contacter LunchFlow. Vérifie ta clé API.
          </p>
        ) : (list.data?.accounts ?? []).length === 0 ? (
          <p className="text-sm text-slate-400">Aucun compte accessible via LunchFlow.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {(list.data?.accounts ?? []).map((r) => {
              const isHere = r.linkedAccountId === a.id;
              const isElsewhere = !!r.linkedAccountId && !isHere;
              const inactive = r.status !== "ACTIVE";
              return (
                <div
                  key={r.id}
                  className={`flex items-center gap-2.5 rounded-xl border p-2.5 ${
                    isHere ? "border-brand-500 bg-brand-50" : "border-line"
                  }`}
                >
                  {r.institutionLogo ? (
                    <img
                      src={r.institutionLogo}
                      alt=""
                      className="h-8 w-8 shrink-0 rounded-lg object-contain"
                    />
                  ) : (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-xs">
                      🏦
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.institutionName || r.name}</div>
                    <div className="truncate text-xs text-slate-400">{r.name}</div>
                    {inactive && (
                      <div className="mt-0.5 text-xs font-medium text-danger">
                        Reconnexion nécessaire ({r.status})
                      </div>
                    )}
                    {isElsewhere && (
                      <div className="mt-0.5 text-xs text-warning">Associé à un autre compte</div>
                    )}
                  </div>
                  {isHere ? (
                    <span className="shrink-0 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-medium text-on-brand">
                      Associé
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => link.mutate(r.id)}
                      disabled={link.isPending}
                      className="btn-primary shrink-0 px-3 py-1 text-xs disabled:opacity-40"
                    >
                      Associer
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {linkedHere && (
        <div className="border-t border-hairline">
          <SheetRow
            label="Dissocier la banque"
            hint="le solde repassera en saisie manuelle, les opérations sont conservées"
            danger
            disabled={unlink.isPending}
            onClick={() => unlink.mutate()}
          />
        </div>
      )}
    </Sheet>
  );
}

// Avatar d'un propriétaire : membre (photo Google) ou « Commun » (pastille 👫).
function OwnerAvatar({ owner, className }: { owner: string; className: string }) {
  if (owner === "joint")
    return (
      <span
        className={`flex items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700 ${className}`}
      >
        👫
      </span>
    );
  return <MemberAvatar id={owner} className={className} />;
}

// Sélecteur de propriétaire (membre a / membre b / Commun) en 3 cartes avatar.
function OwnerPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: "a" | "b" | "joint") => void;
}) {
  const members = useMe().household.members;
  const OWNERS = [
    { value: "a", label: members.a.name },
    { value: "b", label: members.b.name },
    { value: "joint", label: "Commun" },
  ] as const;
  return (
    <div className="grid grid-cols-3 gap-2">
      {OWNERS.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-sm transition ${
              active
                ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                : "border-slate-200 hover:border-brand-300 dark:border-slate-700"
            }`}
          >
            <OwnerAvatar owner={o.value} className="h-8 w-8 text-base" />
            <span
              className={
                active
                  ? "font-medium text-brand-700 dark:text-brand-300"
                  : "text-slate-600 dark:text-slate-300"
              }
            >
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Modale de création d'un compte : propriétaire (avatars), nom, type.
function CreateAccountModal({ defaultOwner, onClose }: { defaultOwner: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [owner, setOwner] = useState(
    ["a", "b", "joint"].includes(defaultOwner) ? defaultOwner : "joint",
  );
  const [name, setName] = useState("");
  const [type, setType] = useState("checking");
  const [isPrimary, setIsPrimary] = useState(false);

  const canSave = name.trim() !== "";
  const create = useMutation({
    mutationFn: () =>
      api.post("/api/accounts", {
        name: name.trim(),
        owner,
        type,
        isPrimary: owner !== "joint" && isPrimary,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
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
          <h2 className="text-lg font-bold">Nouveau compte bancaire</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) create.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <div className="mb-1.5 text-xs text-slate-400">Propriétaire</div>
            <OwnerPicker value={owner} onChange={setOwner} />
          </div>

          <label className="flex flex-col gap-1.5 text-xs text-slate-400">
            Nom du compte
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex. BoursoBank, LCL commun, Livret A…"
            />
          </label>

          <div className="flex flex-col gap-1.5 text-xs text-slate-400">
            Type de compte
            <Select value={type} onChange={setType} options={ACCOUNT_TYPE_OPTIONS} />
          </div>

          {owner !== "joint" && (
            <Checkbox
              checked={isPrimary}
              onChange={() => setIsPrimary((v) => !v)}
              label="Compte principal (dépenses prévues de son propriétaire)"
            />
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost">
              Annuler
            </button>
            <button className="btn-primary" disabled={!canSave || create.isPending}>
              {create.isPending ? "Création…" : "Créer le compte"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------------- Opérations : helpers ---------------- */

// Libellé bancaire brut (multiligne SEPA) condensé en une ligne lisible.
function cleanBankLabel(s: string): string {
  return s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .join(" — ");
}

// Détecte un virement d'après le libellé bancaire brut (VIR, VIREMENT, VIR INST/SEPA…).
function isVirement(rawLabel: string): boolean {
  return /\bvir(ement)?\b/i.test(rawLabel);
}

/**
 * Titre lisible d'une opération. On préfixe « Virement » quand le nom enrichi
 * masque la nature du mouvement — mais pas quand il la dit déjà, sinon on
 * affiche « Virement · Virement Julien Gabriel ».
 */
function txTitle(t: BankTransaction): string {
  const base = t.merchantName || cleanBankLabel(t.rawLabel) || "Opération";
  const needsPrefix = !!t.merchantName && isVirement(t.rawLabel) && !isVirement(base);
  return needsPrefix ? `Virement · ${base}` : base;
}

/** Libellés des périmètres membre/commun, depuis la config du foyer. */
function useMemberLabels(): Record<string, string> {
  const members = useMe().household.members;
  return { a: members.a.name, b: members.b.name, joint: "Commun" };
}

// Icône entonnoir (bouton « Filtres »).
function FunnelIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" className={className}>
      <path d="M3 4h18l-7 8v6l-4 2v-8L3 4z" />
    </svg>
  );
}

// Icône calendrier (déclencheur du filtre Période).
function CalendarIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

type Preset = { label: string; start: string; end: string };

// Filtre « Période » : input qui ouvre un popover à onglets — « Période » (choix
// prédéfinis en liste radio) et « Date » (calendrier de plage personnalisée).
function PeriodFilter({
  dateFrom,
  dateTo,
  setDateFrom,
  setDateTo,
  presets,
}: {
  dateFrom: string;
  dateTo: string;
  setDateFrom: (v: string) => void;
  setDateTo: (v: string) => void;
  presets: Preset[];
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"periode" | "date">("periode");

  const options: Preset[] = [{ label: "Toutes les périodes", start: "", end: "" }, ...presets];
  const active = options.find((o) => o.start === dateFrom && o.end === dateTo);
  const label = active
    ? active.label
    : dateFrom && dateTo
      ? `${dateFr(dateFrom)} → ${dateFr(dateTo)}`
      : dateFrom
        ? `Depuis ${dateFr(dateFrom)}`
        : `Jusqu'au ${dateFr(dateTo)}`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="input flex items-center justify-between gap-2 text-left"
      >
        <span className="truncate text-sm">{label}</span>
        <CalendarIcon className="h-4 w-4 shrink-0 text-slate-400" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-[70] mt-1 w-[min(92vw,340px)] rounded-xl border border-line bg-surface p-3 shadow-xl">
            <SubNav
              value={tab}
              onChange={(v) => setTab(v as "periode" | "date")}
              bleed={false}
              items={[
                { value: "periode", label: "Période" },
                { value: "date", label: "Date" },
              ]}
            />
            {tab === "periode" ? (
              <div className="mt-3 flex flex-col gap-0.5">
                {options.map((o) => {
                  const sel = o.start === dateFrom && o.end === dateTo;
                  return (
                    <button
                      key={o.label}
                      onClick={() => {
                        setDateFrom(o.start);
                        setDateTo(o.end);
                        setOpen(false);
                      }}
                      className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm hover:bg-surface-2"
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                          sel ? "border-brand-600" : "border-line"
                        }`}
                      >
                        {sel && <span className="h-2 w-2 rounded-full bg-brand-600" />}
                      </span>
                      {o.label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3">
                <div className="flex justify-center">
                  <DateRangeCalendar
                    months={1}
                    bare
                    start={dateFrom}
                    end={dateTo}
                    onChange={(s, e) => {
                      setDateFrom(s);
                      setDateTo(e);
                    }}
                  />
                </div>
                <div className="mt-2 flex justify-end">
                  <button onClick={() => setOpen(false)} className="btn-primary text-sm">
                    Appliquer
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Icône par type de mouvement (SVG inline, stroke currentColor).
function TxTypeIcon({ type, className = "h-4 w-4" }: { type: string; className?: string }) {
  const svg = (children: React.ReactNode) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
  switch (type) {
    case "virement_in": // flèche vers le bas (argent entrant)
      return svg(<><path d="M12 4v13" /><path d="M6 11l6 6 6-6" /></>);
    case "virement_out": // flèche vers le haut (argent sortant)
      return svg(<><path d="M12 20V7" /><path d="M6 13l6-6 6 6" /></>);
    case "cb_out":
    case "cb_in": // carte bancaire
      return svg(<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>);
    case "retrait": // billet (distributeur)
      return svg(<><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></>);
    default: // autre : points de suspension
      return svg(<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>);
  }
}

// Filtre par sens du montant : tous / entrées (crédits) / sorties (débits).
type SignFilter = "all" | "in" | "out";

// Champs de filtre montant + sens de la feuille de filtres.
function TxFilterFields({
  minAmount,
  setMinAmount,
  maxAmount,
  setMaxAmount,
  sign,
  setSign,
  types,
  setTypes,
}: {
  minAmount: string;
  setMinAmount: (v: string) => void;
  maxAmount: string;
  setMaxAmount: (v: string) => void;
  sign: SignFilter;
  setSign: (v: SignFilter) => void;
  types: string[];
  setTypes: (v: string[]) => void;
}) {
  const signOptions: { v: SignFilter; label: string }[] = [
    { v: "all", label: "Tous" },
    { v: "in", label: "Entrées" },
    { v: "out", label: "Sorties" },
  ];
  return (
    <>
      <div>
        <label className="mb-1 block text-xs text-slate-400">Sens</label>
        <div className="flex rounded-xl border border-line p-0.5">
          {signOptions.map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => setSign(o.v)}
              className={`flex-1 rounded-lg px-2.5 py-1.5 text-sm ${
                sign === o.v ? "bg-brand-600 text-on-brand" : "text-ink-2 hover:text-ink"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-400">Type</label>
        <MultiSelect
          values={types}
          onChange={setTypes}
          placeholder="Tous les types"
          options={TX_TYPES.map((t) => ({
            value: t,
            label: TX_TYPE_LABEL[t],
            icon: <TxTypeIcon type={t} />,
          }))}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Montant min (€)
          <Input
            type="number"
            step="0.01"
            min="0"
            value={minAmount}
            onChange={(e) => setMinAmount(e.target.value)}
            placeholder="Min"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Montant max (€)
          <Input
            type="number"
            step="0.01"
            min="0"
            value={maxAmount}
            onChange={(e) => setMaxAmount(e.target.value)}
            placeholder="Max"
          />
        </label>
      </div>
    </>
  );
}

/** « Aujourd'hui » · « Hier » · « 31 juillet » · « 31 juillet 2025 ». */
function dayHeaderFr(iso: string): string {
  const today = todayIso();
  if (iso === today) return "Aujourd'hui";
  const y = new Date(`${today}T00:00:00`);
  y.setDate(y.getDate() - 1);
  if (iso === y.toISOString().slice(0, 10)) return "Hier";
  const d = new Date(`${iso}T00:00:00`);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Montant signé : « +590,00 € » / « −582,12 € ». Le « + » n'est pas dans `eur`. */
const eurSigned = (cents: number) => (cents > 0 ? `+${eur(cents)}` : eur(cents));

/* ---------------- Feuille d'une opération ---------------- */

/**
 * Ce qu'on veut faire d'une ligne : savoir ce que c'est vraiment (le libellé
 * bancaire brut), la classer, et la rattacher à une charge. Remplace le
 * dépliage sous la ligne, qui poussait le reste de la liste vers le bas.
 */
function TxSheet({
  tx: t,
  matched,
  onClose,
  onLinkExpense,
}: {
  tx: BankTransaction;
  matched: Recurring | null;
  onClose: () => void;
  onLinkExpense: () => void;
}) {
  const qc = useQueryClient();
  const cats = useExpenseCategories();
  const setCategory = useMutation({
    mutationFn: (category: string | null) =>
      api.patch(`/api/lunchflow/transactions/${t.id}`, { category }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bank-transactions"] }),
  });

  return (
    <Sheet
      title={txTitle(t)}
      subtitle={`${dateFr(t.date)} · ${t.accountName}`}
      thumbnail={
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-2">
          <TxTypeIcon type={t.type} className="h-5 w-5" />
        </span>
      }
      onClose={onClose}
    >
      <div className="border-b border-hairline px-4 py-3">
        <div className={`text-2xl font-bold ${t.amount > 0 ? "text-brand-600" : ""}`}>
          {eurSigned(t.amount)}
        </div>
        <div className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-slate-400">
          {t.rawLabel || "—"}
        </div>
        {t.merchantAddress && <div className="mt-1 text-xs text-slate-400">{t.merchantAddress}</div>}
        {t.merchantWebsite && (
          <a
            href={t.merchantWebsite.startsWith("http") ? t.merchantWebsite : `https://${t.merchantWebsite}`}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block truncate text-xs text-brand-600 underline hover:no-underline"
          >
            {t.merchantWebsite}
          </a>
        )}
      </div>

      <div className="border-b border-hairline px-4 py-3">
        <div className="eyebrow">Catégorie</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {cats.map((c) => {
            const active = t.category === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory.mutate(active ? null : c.key)}
                disabled={setCategory.isPending}
                className={`flex min-h-tap items-center gap-1.5 rounded-full px-3 text-sm ${
                  active
                    ? "bg-brand-600 font-semibold text-on-brand"
                    : "border border-line text-ink-2 hover:bg-surface-2"
                }`}
              >
                <span aria-hidden>{c.icon}</span>
                {c.name}
              </button>
            );
          })}
        </div>
      </div>

      <SheetRow
        label={matched ? "Lier à une autre dépense" : "Lier à une dépense"}
        hint={matched ? `rattachée à « ${matched.label} »` : "rattache la ligne à une charge récurrente"}
        onClick={onLinkExpense}
        trailing={<LinkIcon className="h-5 w-5 shrink-0 text-slate-400" />}
      />
    </Sheet>
  );
}

/* ---------------- Onglet Comptes ---------------- */

function ComptesTab({
  accounts,
  onOpenAccount,
  onCreate,
}: {
  accounts: Account[];
  onOpenAccount: (a: Account) => void;
  onCreate: () => void;
}) {
  const memberLabels = useMemberLabels();
  // Périmètre : un **filtre**, pas un sous-menu — l'URL porte déjà l'onglet
  // (Comptes / Opérations). « Tous » par défaut : on veut d'abord voir le foyer.
  const [scope, setScope] = useState("tous");

  // « À débiter » = ce qui doit encore sortir d'ici la fin du mois, même source
  // que Trésorerie (projection des charges), pas un compteur maison.
  const now = new Date();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const daysLeft = Math.max(
    1,
    Math.round((endOfMonth.getTime() - now.getTime()) / 86_400_000),
  );
  const { data: cashflow } = useQuery({
    queryKey: ["cashflow", "month", daysLeft],
    queryFn: () => api.get<Cashflow>(`/api/cashflow?days=${daysLeft}`),
  });

  const shown = accounts.filter((a) => scope === "tous" || a.owner === scope);
  const total = shown.reduce((s, a) => s + a.currentBalance, 0);
  const debits = (cashflow?.byAccount ?? [])
    .filter((b) => shown.some((a) => a.id === b.accountId))
    .reduce((s, b) => s + b.totalDebits, 0);

  const groups = ACCOUNT_GROUPS.map((g) => ({
    ...g,
    items: shown.filter((a) => a.type === g.type),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <FilterChips
        value={scope}
        onChange={setScope}
        items={[
          { value: "tous", label: "Tous" },
          { value: "a", label: memberLabels.a },
          { value: "b", label: memberLabels.b },
          { value: "joint", label: memberLabels.joint },
        ]}
      />

      {shown.length === 0 ? (
        <div className="card">
          <div className="text-sm text-ink-2">
            {accounts.length === 0
              ? "Aucun compte bancaire pour l'instant."
              : `Aucun compte pour ${memberLabels[scope] ?? "ce périmètre"}.`}
          </div>
          <button type="button" onClick={onCreate} className="btn-primary mt-3">
            Ajouter un compte
          </button>
        </div>
      ) : (
        <>
          {/* Le total n'est plus une tuile parmi les comptes : c'est la réponse. */}
          <div className="card">
            <div className="text-sm text-ink-2">
              Total disponible · {shown.length} compte{shown.length > 1 ? "s" : ""}
            </div>
            <div className="mt-1 text-3xl font-bold">{eur(total)}</div>
            <div className="mt-4 flex gap-3 border-t border-hairline pt-3">
              {/* À l'euro près : le montant exact est déjà au-dessus, et quatre
                  colonnes de centimes ne tiennent pas sur une largeur de téléphone. */}
              {groups.map((g) => (
                <MiniStat
                  key={g.type}
                  label={g.short}
                  value={eur0(g.items.reduce((s, a) => s + a.currentBalance, 0))}
                />
              ))}
              {debits > 0 && <MiniStat label="À débiter" value={`−${eur0(debits)}`} tone="danger" />}
            </div>
          </div>

          {groups.map((g) => (
            <div key={g.type} className="flex flex-col gap-2">
              <div className="eyebrow">{g.title}</div>
              <div className="card">
                {g.items.map((a, i) => (
                  <div key={a.id} className={i === g.items.length - 1 ? "" : "border-b border-hairline"}>
                    <button
                      type="button"
                      onClick={() => onOpenAccount(a)}
                      className="flex min-h-[64px] w-full items-center gap-3 py-2 text-left"
                    >
                      <BankBadge name={a.name} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base font-medium">{a.name}</span>
                        <span className="mt-0.5 block">
                          <SyncLine account={a} />
                        </span>
                      </span>
                      <span className="shrink-0 text-base font-semibold">
                        {eur(a.currentBalance)}
                      </span>
                      <span className="shrink-0 text-ink-3">
                        <DotsGlyph />
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/* ---------------- Onglet Opérations ---------------- */

function OperationsTab({ accounts }: { accounts: Account[] }) {
  const cats = useExpenseCategories();
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["bank-transactions", "all"],
    queryFn: ({ pageParam }) =>
      api.get<{ transactions: BankTransaction[]; hasOlder: boolean; page: number }>(
        `/api/lunchflow/transactions?member=all&page=${pageParam}`,
      ),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasOlder ? last.page + 1 : undefined),
  });
  // Charges récurrentes (page Dépenses) pour repérer/masquer les mouvements attendus.
  const { data: recurring } = useQuery({
    queryKey: ["recurring"],
    queryFn: () => api.get<Recurring[]>("/api/recurring"),
  });

  // Filtre rapide à une dimension : tout, un compte, ou les lignes à classer.
  // Deux dimensions dans une même rangée de pastilles se contredisent ; les
  // filtres croisés vivent dans l'entonnoir.
  const [quick, setQuick] = useState("tous");
  const [search, setSearch] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [sign, setSign] = useState<SignFilter>("all");
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [onlyUnusual, setOnlyUnusual] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [txSheet, setTxSheet] = useState<BankTransaction | null>(null);
  const [linkExpenseTx, setLinkExpenseTx] = useState<BankTransaction | null>(null);

  // Scroll infini : charge la fenêtre suivante (plus ancienne) quand la sentinelle
  // en bas de liste devient visible.
  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: "300px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const resetFilters = () => {
    setMinAmount("");
    setMaxAmount("");
    setSign("all");
    setTypeFilter([]);
    setOnlyUnusual(false);
    setDateFrom("");
    setDateTo("");
  };

  // Pré-sélections de dates : mois en cours + 3 mois précédents (dynamiques).
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const datePresets = [0, 1, 2, 3].map((i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    const start = `${y}-${pad(m + 1)}-01`;
    const end = `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`;
    const name = d.toLocaleDateString("fr-FR", { month: "long" });
    return { label: i === 0 ? "Mois en cours" : cap(name), start, end };
  });

  const all = data?.pages.flatMap((p) => p.transactions) ?? [];
  const q = search.trim().toLowerCase();
  // Recherche montant : si la requête est numérique, on matche à 1 € près (ex. « 20 »
  // trouve 20,57 €). Accepte la virgule décimale et un éventuel « € ».
  const qNumStr = q.replace(/[^\d.,]/g, "").replace(",", ".");
  const qNum = q !== "" && qNumStr !== "" ? parseFloat(qNumStr) : NaN;
  const min = minAmount.trim() ? parseFloat(minAmount) : null;
  const max = maxAmount.trim() ? parseFloat(maxAmount) : null;
  // Montants attendus = charges récurrentes + leurs sous-débits (centimes absolus + sens).
  const expected = (recurring ?? []).flatMap((r) => [
    { accountId: r.accountId, cents: Math.abs(r.amount), debit: r.amount < 0 },
    ...(r.debits ?? []).map((d) => ({
      accountId: r.accountId,
      cents: Math.abs(d.amount),
      debit: d.amount < 0,
    })),
  ]);
  // Texte de recherche pour le matching par nom : nom de vendeur enrichi + libellé nettoyé.
  const txNameHay = (t: BankTransaction) =>
    `${t.merchantName ?? ""} ${cleanBankLabel(t.rawLabel)}`.toLowerCase();
  // Charge récurrente rattachée par nom (un motif est contenu dans le nom de la
  // transaction). Utile pour les montants variables (ex. DDFIP). Pas de contrainte
  // de compte : le motif est choisi explicitement à la liaison, donc suffisant.
  const matchedByName = (t: BankTransaction): Recurring | null =>
    (recurring ?? []).find((r) =>
      (r.matchNames ?? []).some((m) => {
        const mm = m.trim().toLowerCase();
        return mm !== "" && txNameHay(t).includes(mm);
      }),
    ) ?? null;
  const isRecurring = (t: BankTransaction) => {
    const cents = Math.abs(t.amount);
    const debit = t.amount < 0;
    const byAmount = expected.some(
      (e) => e.accountId === t.accountId && e.debit === debit && Math.abs(e.cents - cents) <= 100,
    );
    return byAmount || matchedByName(t) !== null;
  };

  const txs = all.filter((t) => {
    if (quick === "sans-categorie" && t.category) return false;
    if (quick.startsWith("acc:") && t.accountId !== quick.slice(4)) return false;
    const abs = Math.abs(t.amount) / 100;
    if (q) {
      const hay = `${t.merchantName ?? ""} ${t.rawLabel} ${t.accountName}`.toLowerCase();
      const textMatch = hay.includes(q);
      const amountMatch = !isNaN(qNum) && Math.abs(abs - qNum) < 1;
      if (!textMatch && !amountMatch) return false;
    }
    if (min !== null && !isNaN(min) && abs < min) return false;
    if (max !== null && !isNaN(max) && abs > max) return false;
    if (typeFilter.length > 0 && !typeFilter.includes(t.type)) return false;
    if (sign === "in" && t.amount <= 0) return false;
    if (sign === "out" && t.amount >= 0) return false;
    if (onlyUnusual && isRecurring(t)) return false;
    if (dateFrom && t.date < dateFrom) return false;
    if (dateTo && t.date > dateTo) return false;
    return true;
  });
  const hasAdvanced =
    minAmount.trim() !== "" ||
    maxAmount.trim() !== "" ||
    sign !== "all" ||
    typeFilter.length > 0 ||
    onlyUnusual ||
    dateFrom !== "" ||
    dateTo !== "";
  const hasFilters = q !== "" || hasAdvanced || quick !== "tous";

  // Regroupement par jour, avec le solde du jour : une date répétée sur dix
  // lignes ne dit rien, une date en tête de groupe dit combien la journée a coûté.
  const days: { date: string; net: number; items: BankTransaction[] }[] = [];
  for (const t of txs) {
    const last = days[days.length - 1];
    if (last && last.date === t.date) {
      last.items.push(t);
      last.net += t.amount;
    } else {
      days.push({ date: t.date, net: t.amount, items: [t] });
    }
  }

  const linkedCount = accounts.filter((a) => a.lunchflowAccountId).length;
  const uncategorized = all.filter((t) => !t.category).length;

  return (
    <div className="flex flex-col gap-4">
      <SearchField
        value={search}
        onChange={setSearch}
        placeholder="Libellé, montant…"
        trailing={
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            aria-label="Filtres"
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              hasAdvanced ? "bg-brand-600 text-on-brand" : "text-ink-3 hover:text-ink"
            }`}
          >
            <FunnelIcon />
          </button>
        }
      />

      <FilterChips
        value={quick}
        onChange={setQuick}
        items={[
          { value: "tous", label: "Tous" },
          ...accounts.map((a) => ({ value: `acc:${a.id}`, label: a.name })),
          ...(uncategorized > 0
            ? [{ value: "sans-categorie", label: `Sans catégorie · ${uncategorized}` }]
            : []),
        ]}
      />

      {accounts.length === 0 ? (
        <div className="card text-sm text-ink-2">Aucun compte bancaire pour l'instant.</div>
      ) : linkedCount === 0 && all.length === 0 ? (
        <div className="card text-sm text-ink-2">
          Aucun compte connecté. Ouvre un compte dans l'onglet Comptes pour le connecter à ta banque
          ou importer un relevé.
        </div>
      ) : isLoading ? (
        <div className="card text-sm text-slate-400">Chargement des opérations…</div>
      ) : days.length === 0 ? (
        <div className="card text-sm text-ink-2">
          {hasFilters ? "Aucune opération ne correspond aux filtres." : "Aucune opération."}
        </div>
      ) : (
        days.map((d) => (
          <div key={d.date} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="eyebrow">{dayHeaderFr(d.date)}</span>
              <span className={`text-xs font-semibold ${d.net > 0 ? "text-brand-600" : "text-ink-2"}`}>
                {eurSigned(d.net)}
              </span>
            </div>
            <div className="card">
              {d.items.map((t, i) => {
                const cat = categoryMeta(cats, t.category);
                const parts = [
                  cat?.name,
                  matchedByName(t) ? "récurrent" : null,
                  t.isPending ? "en attente" : t.future ? "à venir" : null,
                ].filter(Boolean);
                return (
                  <div
                    key={t.id}
                    className={i === d.items.length - 1 ? "" : "border-b border-hairline"}
                  >
                    <button
                      type="button"
                      onClick={() => setTxSheet(t)}
                      className="flex min-h-[64px] w-full items-center gap-3 py-2 text-left"
                    >
                      {/* Le type de mouvement, pas l'avatar de banque : la banque
                          est déjà dite par le filtre, le type ne l'est nulle part. */}
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-2">
                        <TxTypeIcon type={t.type} className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base font-medium">{txTitle(t)}</span>
                        {cat ? (
                          <span className="mt-0.5 block truncate text-xs text-slate-400">
                            {parts.join(" · ")}
                          </span>
                        ) : (
                          <span className="mt-0.5 block text-xs text-warning">
                            Sans catégorie · toucher pour classer
                          </span>
                        )}
                      </span>
                      <span
                        className={`shrink-0 text-base font-semibold ${
                          t.amount > 0 ? "text-brand-600" : ""
                        }`}
                      >
                        {eurSigned(t.amount)}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* Sentinelle du scroll infini + indicateur de chargement de la suite */}
      {all.length > 0 && <div ref={loadMoreRef} className="h-px" />}
      {isFetchingNextPage && <p className="text-center text-xs text-slate-400">Chargement…</p>}
      {!hasNextPage && all.length > 0 && (
        <p className="text-center text-xs text-ink-3">Fin de l'historique</p>
      )}

      {filtersOpen && (
        <Sheet title="Filtres" onClose={() => setFiltersOpen(false)}>
          <div className="flex flex-col gap-3 p-4">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Période</label>
              <PeriodFilter
                dateFrom={dateFrom}
                dateTo={dateTo}
                setDateFrom={setDateFrom}
                setDateTo={setDateTo}
                presets={datePresets}
              />
            </div>
            <TxFilterFields
              minAmount={minAmount}
              setMinAmount={setMinAmount}
              maxAmount={maxAmount}
              setMaxAmount={setMaxAmount}
              sign={sign}
              setSign={setSign}
              types={typeFilter}
              setTypes={setTypeFilter}
            />
            <button
              type="button"
              onClick={() => setOnlyUnusual((v) => !v)}
              className={`w-full rounded-xl border px-3 py-2 text-sm ${
                onlyUnusual ? "border-brand-500 text-brand-600 ring-1 ring-brand-500" : "border-line text-ink-2"
              }`}
            >
              {onlyUnusual ? "✓ " : ""}Ponctuel uniquement (masque les récurrentes)
            </button>
            <div className="mt-1 flex items-center justify-between">
              <button onClick={resetFilters} className="btn-ghost text-sm">
                Réinitialiser
              </button>
              <button onClick={() => setFiltersOpen(false)} className="btn-primary">
                Voir les résultats
              </button>
            </div>
          </div>
        </Sheet>
      )}

      {txSheet && (
        <TxSheet
          tx={txSheet}
          matched={matchedByName(txSheet)}
          onClose={() => setTxSheet(null)}
          onLinkExpense={() => {
            setLinkExpenseTx(txSheet);
            setTxSheet(null);
          }}
        />
      )}

      {linkExpenseTx && (
        <LinkExpenseModal
          tx={linkExpenseTx}
          recurring={recurring ?? []}
          accounts={accounts}
          onClose={() => setLinkExpenseTx(null)}
        />
      )}
    </div>
  );
}

/* ---------------- Onglet Comptes bancaires ---------------- */

function Transactions({ view }: { view?: string }) {
  const navigate = useNavigate();
  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<Account[]>("/api/accounts"),
  });

  const sub = useLastView("money:comptes", COMPTES_VIEWS, "comptes", view, "/money/comptes");
  const items = [
    { value: "comptes", label: "Comptes" },
    { value: "operations", label: "Opérations" },
  ];
  const go = (v: string) => navigate(`/money/comptes/${v}`);
  usePageTabs(sub, items, go);

  const [createOpen, setCreateOpen] = useState(false);
  const [sheetAccount, setSheetAccount] = useState<Account | null>(null);
  const [linkTarget, setLinkTarget] = useState<Account | null>(null);

  // Ordre : compte principal d'abord, puis courant → investissement → épargne, puis le nom.
  const typeRank = { checking: 0, investment: 1, savings: 2 } as const;
  const accountRank = (a: Account) =>
    (a.isPrimary ? 0 : 10) + (typeRank[a.type as keyof typeof typeRank] ?? 3);
  const sorted = (accounts ?? [])
    .slice()
    .sort((x, y) => accountRank(x) - accountRank(y) || x.name.localeCompare(y.name, "fr"));
  // Version fraîche du compte ouvert : la feuille reflète ce qu'on vient d'y changer.
  const openAccount = sorted.find((a) => a.id === sheetAccount?.id) ?? null;
  const linkAccount = sorted.find((a) => a.id === linkTarget?.id) ?? null;

  if (!accounts) return <PageLoader variant="argent" />;

  return (
    <div className="flex flex-col gap-4 pb-28 md:pb-0">
      <div className="flex items-center justify-between gap-3">
        <SubNav value={sub} onChange={go} items={items} className="hidden md:block" />
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="btn-primary ml-auto hidden md:inline-flex"
        >
          Ajouter un compte
        </button>
      </div>

      {sub === "comptes" ? (
        <ComptesTab
          accounts={sorted}
          onOpenAccount={setSheetAccount}
          onCreate={() => setCreateOpen(true)}
        />
      ) : (
        <OperationsTab accounts={sorted} />
      )}

      {sub === "comptes" && (
        <MobileActionBar label="Ajouter un compte" onClick={() => setCreateOpen(true)} />
      )}

      {createOpen && <CreateAccountModal defaultOwner="joint" onClose={() => setCreateOpen(false)} />}

      {openAccount && (
        <AccountSheet
          account={openAccount}
          onClose={() => setSheetAccount(null)}
          onOpenLink={() => {
            setLinkTarget(openAccount);
            setSheetAccount(null);
          }}
        />
      )}

      {linkAccount && <LunchflowLinkSheet account={linkAccount} onClose={() => setLinkTarget(null)} />}
    </div>
  );
}

// Modale « Lier à une dépense » : ajoute le nom de la transaction comme motif de
// matching sur une charge récurrente choisie (crée le « paiement » côté charge).
function LinkExpenseModal({
  tx,
  recurring,
  accounts,
  onClose,
}: {
  tx: BankTransaction;
  recurring: Recurring[];
  accounts: Account[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(tx.merchantName?.trim() || cleanBankLabel(tx.rawLabel));
  const [search, setSearch] = useState("");
  const acctName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "—";

  const link = useMutation({
    mutationFn: (recurringId: string) =>
      api.post(`/api/recurring/${recurringId}/match`, { name: name.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring"] });
      onClose();
    },
  });

  const q = search.trim().toLowerCase();
  // Charges du compte de la transaction en premier, puis recherche libre.
  const list = recurring
    .filter((r) => !q || r.label.toLowerCase().includes(q))
    .sort(
      (a, b) =>
        (a.accountId === tx.accountId ? 0 : 1) - (b.accountId === tx.accountId ? 0 : 1) ||
        a.label.localeCompare(b.label, "fr"),
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="card max-h-[85vh] w-full max-w-md overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Lier à une dépense</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        <label className="text-xs text-slate-400">
          Nom à matcher
          <input
            className="input mt-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ex. DGFIP"
          />
        </label>
        <p className="mt-1.5 text-xs text-slate-400">
          Ce nom sera ajouté à la charge choisie. Les prochains mouvements dont le nom le contient y
          seront rattachés, même si le montant change.
        </p>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher une charge…"
          className="input mt-3"
        />

        <div className="mt-2 flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
          {list.length === 0 ? (
            <p className="py-4 text-sm text-slate-400">Aucune charge récurrente.</p>
          ) : (
            list.map((r) => (
              <button
                key={r.id}
                type="button"
                disabled={!name.trim() || link.isPending}
                onClick={() => link.mutate(r.id)}
                className="flex items-center justify-between gap-3 py-2.5 text-left hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-slate-800/60"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{r.label}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
                    <span>{acctName(r.accountId)}</span>
                    {(r.matchNames ?? []).length > 0 && (
                      <span className="truncate">· {r.matchNames.join(", ")}</span>
                    )}
                  </div>
                </div>
                <span className="shrink-0 text-sm tabular-nums text-slate-500">{eur(r.amount)}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Dépenses ---------------- */

function ExpenseRow({
  r,
  acctName,
  onEdit,
}: {
  r: Recurring;
  acctName: (id: string) => string;
  onEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: r.id,
  });
  const [open, setOpen] = useState(false);
  const hasDebits = r.debits.length > 0;
  return (
    <>
      <tr
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={`group border-t border-slate-100 dark:border-slate-800 ${isDragging ? "opacity-60" : ""}`}
      >
        <td className="truncate py-1.5">
          <button
            {...attributes}
            {...listeners}
            className="mr-1 cursor-grab text-slate-300 hover:text-slate-500"
            title="Déplacer"
          >
            ⠿
          </button>
          {hasDebits && (
            <button onClick={() => setOpen((o) => !o)} className="mr-1 text-slate-400">
              {open ? "▾" : "▸"}
            </button>
          )}
          {r.label}
        </td>
        <td className="text-slate-500">
          <div className="flex items-center gap-1.5">
            <BankBadge name={acctName(r.accountId)} size="sm" />
            <span className="truncate">{acctName(r.accountId)}</span>
          </div>
        </td>
        <td className="text-right text-slate-500">
          {r.dayOfMonth ? `le ${r.dayOfMonth}` : hasDebits ? `${r.debits.length} débits` : "—"}
        </td>
        <td className="text-right tabular-nums">{eur(Math.abs(r.shareA))}</td>
        <td className="text-right tabular-nums">{eur(Math.abs(r.shareB))}</td>
        <td className={`text-right font-medium tabular-nums ${r.amount >= 0 ? "text-green-600" : ""}`}>
          {eur(Math.abs(r.amount))}
        </td>
        <td className="whitespace-nowrap text-right">
          <button onClick={onEdit} className="px-1 text-slate-400 hover:text-brand-600">
            ✎
          </button>
        </td>
      </tr>
      {open &&
        hasDebits &&
        r.debits.map((d) => (
          <tr key={d.id} className="border-t border-slate-50 text-xs dark:border-slate-800/50">
            <td className="truncate py-1 pl-9 text-slate-500">↳ {d.label || "Débit"}</td>
            <td></td>
            <td className="text-right text-slate-400">{d.dayOfMonth ? `le ${d.dayOfMonth}` : "—"}</td>
            <td></td>
            <td></td>
            <td className="text-right tabular-nums text-slate-500">{eur(Math.abs(d.amount))}</td>
            <td></td>
          </tr>
        ))}
    </>
  );
}

/**
 * Ligne d'une charge sur mobile : la banque, le libellé, sa ligne de détail
 * (jour · compte · parts), le montant, et le « ⋯ ». Une seule colonne de
 * chiffres à droite — c'est elle qu'on balaie du regard.
 *
 * Les sous-débits se déplient en touchant la ligne ; toucher une charge sans
 * sous-débit ne fait rien (modifier vit dans le « ⋯ », pas dans un double-clic
 * qui n'existe pas au tactile).
 */
function ChargeRow({
  r,
  acctName,
  last,
  onEdit,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  r: Recurring;
  acctName: (id: string) => string;
  last: boolean;
  onEdit: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const hasDebits = r.debits.length > 0;
  const split =
    r.shareA !== 0 && r.shareB !== 0
      ? `${Math.round(Math.abs(r.shareA) / 100)} / ${Math.round(Math.abs(r.shareB) / 100)}`
      : null;
  const meta = [
    r.dayOfMonth ? `le ${r.dayOfMonth}` : hasDebits ? `${r.debits.length} débits` : null,
    shortAccountName(acctName(r.accountId)),
    split,
  ]
    .filter(Boolean)
    .join(" · ");

  const actions: OverflowItem[] = [
    { label: "Modifier", onClick: onEdit },
    ...(onMoveUp ? [{ label: "Déplacer vers le haut", onClick: onMoveUp }] : []),
    ...(onMoveDown ? [{ label: "Déplacer vers le bas", onClick: onMoveDown }] : []),
    { label: "Supprimer", danger: true, onClick: onDelete },
  ];

  return (
    <div className={last && !open ? "" : "border-b border-hairline"}>
      <div className="flex min-h-[60px] items-center gap-3">
        <button
          type="button"
          onClick={() => hasDebits && setOpen((o) => !o)}
          aria-expanded={hasDebits ? open : undefined}
          className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
        >
          <BankBadge name={acctName(r.accountId)} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold">{r.label}</span>
            <span className="block truncate text-xs text-slate-400">{meta}</span>
          </span>
        </button>
        <span
          className={`shrink-0 text-base font-semibold tabular-nums ${
            r.amount >= 0 ? "text-brand-600" : ""
          }`}
        >
          {r.amount < 0 ? "−" : "+"}
          {eur0(Math.abs(r.amount))}
        </span>
        <OverflowMenu items={actions} label={`Actions sur « ${r.label} »`} />
      </div>
      {open && hasDebits && (
        <ul className="mb-2 space-y-1 border-l border-line pl-3 text-xs text-slate-400">
          {r.debits.map((d) => (
            <li key={d.id} className="flex justify-between gap-2">
              <span className="truncate">
                {d.label || "Débit"}
                {d.dayOfMonth ? ` · le ${d.dayOfMonth}` : ""}
              </span>
              <span className="shrink-0 tabular-nums">{eur(Math.abs(d.amount))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Onglet « Dépenses » : sous-menu mensuel / annuel (une URL par vue).
function Depenses({ view }: { view?: string }) {
  const navigate = useNavigate();
  const sub = view === "annuel" ? "annuel" : "mensuel";
  // Les filtres vivent ici pour tenir sur la **même rangée** que la bascule
  // Mensuel / Annuel : un entonnoir muet à droite, le panneau juste en dessous.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [fPerson, setFPerson] = useState<"" | "a" | "b">("");
  const [fAccount, setFAccount] = useState("");
  const hasFilters = fPerson !== "" || fAccount !== "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <PillToggle
          value={sub}
          onChange={(v) => navigate(`/money/depenses/${v}`)}
          align="start"
          items={[
            { value: "mensuel", label: "Mensuel" },
            { value: "annuel", label: "Annuel" },
          ]}
        />
        {sub === "mensuel" && (
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            aria-label="Filtres"
            aria-pressed={hasFilters || filtersOpen}
            // Sur ordinateur les deux listes déroulantes sont déjà à l'écran :
            // l'entonnoir n'aurait rien à ouvrir.
            className={`ml-auto flex h-tap w-tap shrink-0 items-center justify-center rounded-full border transition md:hidden ${
              hasFilters
                ? "border-brand-600 text-brand-600"
                : "border-line text-ink-2 hover:text-ink"
            }`}
          >
            <IconFilter size={20} />
          </button>
        )}
      </div>
      {sub === "mensuel" ? (
        <DepensesMensuel
          filters={{ open: filtersOpen, person: fPerson, account: fAccount }}
          setPerson={setFPerson}
          setAccount={setFAccount}
        />
      ) : (
        <DepensesAnnuel />
      )}
    </div>
  );
}

function DepensesMensuel({
  filters,
  setPerson,
  setAccount,
}: {
  filters: { open: boolean; person: "" | "a" | "b"; account: string };
  setPerson: (v: "" | "a" | "b") => void;
  setAccount: (v: string) => void;
}) {
  const me = useMe();
  const members = me.household.members;
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [editing, setEditing] = useState<Recurring | null>(null);
  const [creating, setCreating] = useState(false);
  const { open: filtersOpen, person: fPerson, account: fAccount } = filters;
  const setFPerson = setPerson;
  const setFAccount = setAccount;

  // Le sommaire alimente la carte « reste à vivre » en tête (mobile) ; il est
  // déjà en cache quand on arrive depuis le sommaire de la section.
  const { data: summary } = useMoneySummary();

  const { data: recurring } = useQuery({
    queryKey: ["recurring"],
    queryFn: () => api.get<Recurring[]>("/api/recurring"),
  });
  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/api/categories"),
  });
  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<Account[]>("/api/accounts"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/recurring/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring"] }),
  });
  const reorder = useMutation({
    mutationFn: (orderedIds: string[]) => api.patch("/api/recurring/reorder", { orderedIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring"] }),
  });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  if (!recurring || !categories || !accounts) return <PageLoader variant="argent" />;

  // Les dépenses annuelles (frequency "yearly") vivent dans le sous-onglet « Annuel ».
  // La vue mensuelle ne considère que les charges non annuelles.
  const monthly = recurring.filter((r) => r.frequency !== "yearly");

  // Jeu filtré : pilote la répartition (camembert) et les tableaux par catégorie.
  // Les indicateurs et le total du bas restent sur l'ensemble (vue d'ensemble).
  const filtered = monthly.filter((r) => {
    if (fPerson === "a" && r.shareA === 0) return false;
    if (fPerson === "b" && r.shareB === 0) return false;
    if (fAccount && r.accountId !== fAccount) return false;
    return true;
  });
  const hasFilters = fPerson !== "" || fAccount !== "";
  const resetFilters = () => {
    setFPerson("");
    setFAccount("");
  };

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "Sans catégorie";
  const acctName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "—";
  const catKind = (id: string | null) => categories.find((c) => c.id === id)?.kind ?? "expense";

  const incomeJ = monthly.filter((r) => r.amount > 0).reduce((s, r) => s + r.shareA, 0);
  const incomeN = monthly.filter((r) => r.amount > 0).reduce((s, r) => s + r.shareB, 0);
  const incomeTotal = incomeJ + incomeN;
  const pctJ = incomeTotal > 0 ? Math.round((incomeJ / incomeTotal) * 100) : me.household.defaultSplitA;
  const pctN = 100 - pctJ;
  const expenses = monthly.filter((r) => r.amount < 0);
  const resteJ = monthly.reduce((s, r) => s + r.shareA, 0);
  const resteN = monthly.reduce((s, r) => s + r.shareB, 0);
  const totalExp = expenses.reduce((s, r) => s + r.amount, 0);

  // donut by category (sur le jeu filtré)
  const byCat = new Map<string, number>();
  for (const r of filtered) {
    if (r.amount >= 0) continue;
    const name = catName(r.categoryId);
    byCat.set(name, (byCat.get(name) ?? 0) + Math.abs(r.amount));
  }
  const pie = [...byCat.entries()].map(([name, value]) => ({ name, value }));
  const colors = ["#ef4444", "#f59e0b", "#8b5cf6", "#3b82f6", "#10b981", "#ec4899", "#22c55e", "#14b8a6"];
  const pieTotal = pie.reduce((s, p) => s + p.value, 0);
  const pctOf = (v: number) => (pieTotal > 0 ? Math.round((v / pieTotal) * 100) : 0);

  // group recurring by category (one table each), keep category order from the list
  const orderedCatIds = [
    ...categories.map((c) => c.id),
    null as string | null, // "Sans catégorie" bucket
  ];
  const groups = orderedCatIds
    .map((cid) => ({
      id: cid,
      name: cid ? catName(cid) : "Sans catégorie",
      kind: cid ? catKind(cid) : "expense",
      items: filtered.filter((r) => (r.categoryId ?? null) === cid),
    }))
    .filter((g) => g.items.length > 0)
    // revenus en premier, puis le reste
    .sort((a, b) => (a.kind === "income" ? 0 : 1) - (b.kind === "income" ? 0 : 1));

  return (
    <div className="flex flex-col gap-4 pb-28 md:pb-0">
      {/* L'entonnoir qui ouvre ce panneau vit chez le parent, sur la rangée de
          la bascule Mensuel / Annuel. Sur ordinateur, les filtres sont inline. */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div
          className={`${filtersOpen ? "grid" : "hidden"} grid-cols-1 gap-2 sm:grid-cols-2 md:flex md:flex-row md:items-center`}
        >
          <Select
            value={fPerson}
            onChange={(v) => setFPerson(v as "" | "a" | "b")}
            className="md:w-48"
            options={[
              { value: "", label: "Tout le monde" },
              { value: "a", label: `${members.a.name} contribue`, icon: <MemberAvatar id="a" className="h-5 w-5 text-2xs" /> },
              { value: "b", label: `${members.b.name} contribue`, icon: <MemberAvatar id="b" className="h-5 w-5 text-2xs" /> },
            ]}
          />
          <Select
            value={fAccount}
            onChange={setFAccount}
            className="md:w-56"
            options={[
              { value: "", label: "Tous les comptes" },
              ...accounts.map((a) => ({
                value: a.id,
                label: a.name,
                icon: <BankBadge name={a.name} size="sm" />,
              })),
            ]}
          />
          {hasFilters && (
            <button onClick={resetFilters} className="btn-ghost w-max text-xs">
              Réinitialiser
            </button>
          )}
        </div>

        <button
          onClick={() => setCreating(true)}
          className="btn-primary hidden md:ml-auto md:inline-flex"
        >
          + Ajouter une charge
        </button>
      </div>

      {/* Mobile : le même chiffre-héros qu'au sommaire de la section — on garde
          le repère en changeant d'écran. Sur ordinateur, les quatre
          indicateurs tiennent déjà sur une rangée. */}
      {summary && (
        <div className="md:hidden">
          <LivingCard split={summary.split} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Euros pleins : sur une colonne de chiffres, les centimes ne servent
            qu'à allonger la ligne. Le détail au centime reste dans les lignes. */}
        <Indicator label="Revenus" value={incomeJ + incomeN} money tone="green" />
        <Indicator label="Dépenses" value={totalExp} money tone="red" />
        <Indicator label={`Reste à vivre ${members.a.name}`} value={resteJ} money tone={resteJ < 0 ? "red" : "default"} />
        <Indicator label={`Reste à vivre ${members.b.name}`} value={resteN} money tone={resteN < 0 ? "red" : "default"} />
      </div>

      {/* La clé de répartition concerne toute la page, pas la seule catégorie
          « revenus » où elle était rangée : elle remonte sous les indicateurs. */}
      <div className="rounded-xl border-l-4 border-info bg-surface-2 px-3 py-2.5 text-sm text-ink-2">
        Répartition par défaut{" "}
        <b className="text-ink">
          {pctJ} % {members.a.name} / {pctN} % {members.b.name}
        </b>
        , calculée sur les salaires.{" "}
        <Link to="/settings" className="font-medium text-info underline">
          Modifier
        </Link>
      </div>

      {hasFilters && groups.length === 0 && (
        <div className="card text-sm text-slate-400">Aucune charge ne correspond aux filtres.</div>
      )}

      {groups.map((g) => {
        const total = g.items.reduce((s, r) => s + r.amount, 0);
        const moveInGroup = (idx: number, dir: number) => {
          const groupIds = g.items.map((i) => i.id);
          const to = idx + dir;
          if (to < 0 || to >= groupIds.length) return;
          const moved = arrayMove(groupIds, idx, to);
          let k = 0;
          const newGlobal = recurring.map((rr) => (groupIds.includes(rr.id) ? moved[k++] : rr.id));
          reorder.mutate(newGlobal);
        };
        return (
          <Fragment key={g.id ?? "none"}>
            {/* Mobile : l'étiquette et le total de la section vivent au-dessus
                de la carte — l'œil balaie la colonne des étiquettes. */}
            <div className="flex flex-col gap-2 md:hidden">
              <div className="flex items-baseline justify-between gap-2">
                <span className="eyebrow">{g.name}</span>
                <span className="text-xs tabular-nums text-slate-400">
                  {total < 0 ? "−" : ""}
                  {eur0(Math.abs(total))}
                </span>
              </div>
              <div className="card">
                {g.items.map((r, idx) => (
                  <ChargeRow
                    key={r.id}
                    r={r}
                    acctName={acctName}
                    last={idx === g.items.length - 1}
                    onEdit={() => setEditing(r)}
                    onMoveUp={idx > 0 ? () => moveInGroup(idx, -1) : undefined}
                    onMoveDown={idx < g.items.length - 1 ? () => moveInGroup(idx, 1) : undefined}
                    onDelete={() => {
                      if (confirm(`Supprimer « ${r.label} » ?`)) remove.mutate(r.id);
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="card hidden md:block">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">{g.name}</div>
              <div className="text-sm font-medium text-slate-500">{eur(Math.abs(total))}</div>
            </div>

            {/* Desktop : tableau avec drag & drop. */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(e: DragEndEvent) => {
                if (!e.over || e.active.id === e.over.id) return;
                const groupIds = g.items.map((i) => i.id);
                const from = groupIds.indexOf(String(e.active.id));
                const to = groupIds.indexOf(String(e.over.id));
                if (from < 0 || to < 0) return;
                const moved = arrayMove(groupIds, from, to);
                let k = 0;
                const newGlobal = recurring.map((r) => (groupIds.includes(r.id) ? moved[k++] : r.id));
                reorder.mutate(newGlobal);
              }}
            >
              <table className="hidden w-full table-fixed text-sm md:table">
                <colgroup>
                  <col />
                  <col className="w-32" />
                  <col className="w-16" />
                  <col className="w-24" />
                  <col className="w-24" />
                  <col className="w-24" />
                  <col className="w-16" />
                </colgroup>
                <thead className="text-left text-xs text-slate-400">
                  <tr>
                    <th className="py-1">Libellé</th>
                    <th>Compte</th>
                    <th className="text-right">Débit</th>
                    <th>
                      <div className="flex justify-end">
                        <MemberAvatar id="a" className="h-6 w-6 text-xs" />
                      </div>
                    </th>
                    <th>
                      <div className="flex justify-end">
                        <MemberAvatar id="b" className="h-6 w-6 text-xs" />
                      </div>
                    </th>
                    <th className="text-right">Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <SortableContext
                    items={g.items.map((i) => i.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {g.items.map((r) => (
                      <ExpenseRow
                        key={r.id}
                        r={r}
                        acctName={acctName}
                        onEdit={() => setEditing(r)}
                      />
                    ))}
                  </SortableContext>
                </tbody>
              </table>
            </DndContext>
            </div>
          </Fragment>
        );
      })}

      <div className="card">
        <div className="mb-2 font-semibold">Total des dépenses (hors salaires)</div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="flex justify-center">
              <MemberAvatar id="a" className="h-6 w-6 text-xs" />
            </div>
            <div className="mt-1 text-lg font-bold tabular-nums">
              {eur(expenses.reduce((s, r) => s + Math.abs(r.shareA), 0))}
            </div>
          </div>
          <div>
            <div className="flex justify-center">
              <MemberAvatar id="b" className="h-6 w-6 text-xs" />
            </div>
            <div className="mt-1 text-lg font-bold tabular-nums">
              {eur(expenses.reduce((s, r) => s + Math.abs(r.shareB), 0))}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Total</div>
            <div className="text-lg font-bold tabular-nums">{eur(Math.abs(totalExp))}</div>
          </div>
        </div>

        {/* Détail des dépenses par compte */}
        {(() => {
          const byAccount = new Map<string, number>();
          for (const r of expenses) {
            byAccount.set(r.accountId, (byAccount.get(r.accountId) ?? 0) + Math.abs(r.amount));
          }
          const rows = [...byAccount.entries()].sort((a, b) => b[1] - a[1]);
          if (rows.length === 0) return null;
          return (
            <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 dark:border-slate-800">
              <div className="mb-1 text-xs text-slate-400">Par compte</div>
              {rows.map(([id, total]) => (
                <div key={id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <BankBadge name={acctName(id)} size="sm" />
                    <span className="truncate text-slate-600 dark:text-slate-300">{acctName(id)}</span>
                  </span>
                  <span className="font-medium tabular-nums">{eur(total)}</span>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Répartition des dépenses (camembert) — tout en bas, sous le total. */}
      <div className="card">
        <div className="mb-2 text-sm font-semibold">Répartition des dépenses</div>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pie}
                dataKey="value"
                nameKey="name"
                cx={isMobile ? "50%" : "38%"}
                cy={isMobile ? "42%" : "50%"}
                innerRadius={isMobile ? 50 : 65}
                outerRadius={isMobile ? 85 : 110}
              >
                {pie.map((_, i) => (
                  <Cell key={i} fill={colors[i % colors.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => `${eur(v)} · ${pctOf(v)} %`} />
              <Legend
                layout={isMobile ? "horizontal" : "vertical"}
                align={isMobile ? "center" : "right"}
                verticalAlign={isMobile ? "bottom" : "middle"}
                iconType="circle"
                wrapperStyle={isMobile ? undefined : { maxWidth: "45%" }}
                formatter={(value, entry) => {
                  const v = (entry?.payload as { value?: number } | undefined)?.value ?? 0;
                  return (
                    <span>
                      {value} · {eur(v)} ·{" "}
                      <span className="font-bold text-slate-900 dark:text-white">
                        {pctOf(v)} %
                      </span>
                    </span>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {(creating || editing) && (
        <RecurringModal
          key={editing?.id ?? "new"}
          recurring={editing}
          categories={categories}
          accounts={accounts}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["recurring"] });
          }}
          onDelete={(id) => {
            remove.mutate(id);
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      <MobileActionBar label="Nouvelle charge" onClick={() => setCreating(true)} />
    </div>
  );
}

/* ---------------- Dépenses annuelles ---------------- */

const MONTH_LABELS = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

// Vue « Annuel » : les dépenses récurrentes annuelles réparties par mois. Une
// dépense annuelle = un `recurring` frequency "yearly" ; son mois vient du mois
// de `startDate`. Reprise automatiquement dans la Trésorerie (cashflow yearly).
function DepensesAnnuel() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Recurring | null>(null);
  const [creating, setCreating] = useState<number | null>(null); // mois (0-11) pré-sélectionné

  const { data: recurring } = useQuery({
    queryKey: ["recurring"],
    queryFn: () => api.get<Recurring[]>("/api/recurring"),
  });
  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<Account[]>("/api/accounts"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/recurring/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring"] });
      qc.invalidateQueries({ queryKey: ["cashflow"] });
    },
  });
  const reorder = useMutation({
    mutationFn: (orderedIds: string[]) => api.patch("/api/recurring/reorder", { orderedIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring"] }),
  });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  if (!recurring || !accounts) return <PageLoader variant="argent" />;

  const acctName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "—";
  const monthOf = (r: Recurring) => new Date(r.startDate).getMonth();

  const annual = recurring.filter((r) => r.frequency === "yearly");
  const byMonth = (m: number) => annual.filter((r) => monthOf(r) === m);
  const totalYear = annual.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);

  const close = () => {
    setCreating(null);
    setEditing(null);
  };

  return (
    <div className="flex flex-col gap-4 pb-24 md:pb-0">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-slate-500">
          Dépenses récurrentes annuelles, réparties sur les mois de l'année.
        </div>
        <button
          onClick={() => setCreating(new Date().getMonth())}
          className="btn-primary hidden shrink-0 md:inline-flex"
        >
          + Ajouter une dépense annuelle
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicator label="Total sur l'année" value={eur(Math.abs(totalYear))} tone="red" />
        <Indicator label="Lissé par mois" value={eur(Math.abs(Math.round(totalYear / 12)))} />
      </div>

      {MONTH_LABELS.map((label, m) => {
        const items = byMonth(m);
        const total = items.reduce((s, r) => s + r.amount, 0);
        const monthIds = items.map((i) => i.id);
        // Réordonne le sous-ensemble du mois tout en préservant l'ordre global
        // (autres mois + charges mensuelles) via l'endpoint /recurring/reorder.
        const applyOrder = (moved: string[]) => {
          let k = 0;
          const newGlobal = recurring.map((rr) => (monthIds.includes(rr.id) ? moved[k++] : rr.id));
          reorder.mutate(newGlobal);
        };
        return (
          <div key={m} className="card">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">{label}</div>
              <div className="flex items-center gap-2">
                {items.length > 0 && (
                  <div className="text-base font-semibold tabular-nums text-slate-900 dark:text-white">
                    {eur(Math.abs(total))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setCreating(m)}
                  aria-label={`Ajouter une dépense en ${label}`}
                  className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    className="h-4 w-4"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </div>
            </div>

            {items.length === 0 ? (
              <div className="text-sm text-slate-400">Aucune dépense annuelle.</div>
            ) : (
              <>
                {/* Mobile : une rangée par charge, même ligne que le mensuel. */}
                <div className="md:hidden">
                  {items.map((r, idx) => (
                    <ChargeRow
                      key={r.id}
                      r={r}
                      acctName={acctName}
                      last={idx === items.length - 1}
                      onEdit={() => setEditing(r)}
                      onMoveUp={
                        idx > 0 ? () => applyOrder(arrayMove(monthIds, idx, idx - 1)) : undefined
                      }
                      onMoveDown={
                        idx < items.length - 1
                          ? () => applyOrder(arrayMove(monthIds, idx, idx + 1))
                          : undefined
                      }
                      onDelete={() => {
                        if (confirm(`Supprimer « ${r.label} » ?`)) remove.mutate(r.id);
                      }}
                    />
                  ))}
                </div>

                {/* Desktop : tableau avec drag & drop. */}
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(e: DragEndEvent) => {
                    if (!e.over || e.active.id === e.over.id) return;
                    const from = monthIds.indexOf(String(e.active.id));
                    const to = monthIds.indexOf(String(e.over.id));
                    if (from < 0 || to < 0) return;
                    applyOrder(arrayMove(monthIds, from, to));
                  }}
                >
                  <table className="hidden w-full table-fixed text-sm md:table">
                    <colgroup>
                      <col />
                      <col className="w-32" />
                      <col className="w-16" />
                      <col className="w-24" />
                      <col className="w-24" />
                      <col className="w-24" />
                      <col className="w-16" />
                    </colgroup>
                    <thead className="text-left text-xs text-slate-400">
                      <tr>
                        <th className="py-1">Libellé</th>
                        <th>Compte</th>
                        <th className="text-right">Débit</th>
                        <th>
                          <div className="flex justify-end">
                            <MemberAvatar id="a" className="h-6 w-6 text-xs" />
                          </div>
                        </th>
                        <th>
                          <div className="flex justify-end">
                            <MemberAvatar id="b" className="h-6 w-6 text-xs" />
                          </div>
                        </th>
                        <th className="text-right">Total</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      <SortableContext items={monthIds} strategy={verticalListSortingStrategy}>
                        {items.map((r) => (
                          <ExpenseRow
                            key={r.id}
                            r={r}
                            acctName={acctName}
                            onEdit={() => setEditing(r)}
                          />
                        ))}
                      </SortableContext>
                    </tbody>
                  </table>
                </DndContext>
              </>
            )}
          </div>
        );
      })}

      {(creating !== null || editing) && (
        <AnnualModal
          key={editing?.id ?? `new-${creating}`}
          recurring={editing}
          initialMonth={creating ?? 0}
          accounts={accounts}
          onClose={close}
          onSaved={() => {
            close();
            qc.invalidateQueries({ queryKey: ["recurring"] });
            qc.invalidateQueries({ queryKey: ["cashflow"] });
          }}
          onDelete={(id) => {
            remove.mutate(id);
            close();
          }}
        />
      )}

      <button
        type="button"
        onClick={() => setCreating(new Date().getMonth())}
        aria-label="Ajouter une dépense annuelle"
        className="btn-primary fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full p-0 shadow-lg md:hidden"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="h-6 w-6"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}

function AnnualModal({
  recurring,
  initialMonth,
  accounts,
  onClose,
  onSaved,
  onDelete,
}: {
  recurring: Recurring | null;
  initialMonth: number;
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
  onDelete: (id: string) => void;
}) {
  const me = useMe();
  const members = me.household.members;
  const isEdit = !!recurring;
  // Compte par défaut à la création : celui configuré sur le foyer, sinon 1er compte.
  const defaultAccountId =
    (me.household.defaultAccountId &&
      accounts.find((a) => a.id === me.household.defaultAccountId)?.id) ||
    accounts[0]?.id ||
    "";
  const [form, setForm] = useState({
    label: recurring?.label ?? "",
    accountId: recurring?.accountId ?? defaultAccountId,
    type: recurring ? (recurring.amount >= 0 ? "income" : "expense") : "expense",
    total: recurring ? Math.abs(recurring.amount) / 100 : 0,
    a: recurring ? Math.abs(recurring.shareA) / 100 : 0,
    b: recurring ? Math.abs(recurring.shareB) / 100 : 0,
    month: recurring ? new Date(recurring.startDate).getMonth() : initialMonth,
    dayOfMonth: recurring?.dayOfMonth ?? (recurring ? new Date(recurring.startDate).getDate() : 1),
  });

  const [debits, setDebits] = useState(
    (recurring?.debits ?? []).map((d) => ({
      label: d.label,
      amount: Math.abs(d.amount) / 100,
      day: d.dayOfMonth ?? 1,
    })),
  );
  const hasDebits = debits.length > 0;
  const debitsTotal = Math.round(debits.reduce((s, d) => s + (Number(d.amount) || 0), 0) * 100) / 100;
  const effectiveTotal = hasDebits ? debitsTotal : form.total;

  const autoSplit = () => {
    const j = Math.round(effectiveTotal * (me.household.defaultSplitA / 100) * 100) / 100;
    setForm({ ...form, a: j, b: Math.round((effectiveTotal - j) * 100) / 100 });
  };

  const save = useMutation({
    mutationFn: () => {
      const sign = form.type === "income" ? 1 : -1;
      const year = new Date().getFullYear();
      // Clamp du jour au nombre de jours du mois (évite une date invalide qui
      // décalerait le mois de la dépense). Avec des débits, le jour de startDate
      // sert de repli : le mois vient de là, le jour de chaque débit du sous-débit.
      const daysInMonth = new Date(year, form.month + 1, 0).getDate();
      const baseDay = hasDebits ? (debits[0]?.day ?? 1) : form.dayOfMonth;
      const day = Math.max(1, Math.min(daysInMonth, baseDay));
      const mm = String(form.month + 1).padStart(2, "0");
      const dd = String(day).padStart(2, "0");
      const payload = {
        label: form.label,
        categoryId: null,
        accountId: form.accountId,
        amount: sign * eurToCents(effectiveTotal),
        shareA: sign * eurToCents(form.a),
        shareB: sign * eurToCents(form.b),
        frequency: "yearly" as const,
        dayOfMonth: hasDebits ? null : day,
        startDate: `${year}-${mm}-${dd}`,
        active: true,
        debits: hasDebits
          ? debits.map((d) => ({
              label: d.label,
              amount: sign * eurToCents(Number(d.amount) || 0),
              dayOfMonth: Math.max(1, Math.min(daysInMonth, d.day)),
            }))
          : [],
        matchNames: [],
      };
      return isEdit
        ? api.patch(`/api/recurring/${recurring!.id}`, payload)
        : api.post("/api/recurring", payload);
    },
    onSuccess: onSaved,
  });

  const splitOk = Math.abs(form.a + form.b - effectiveTotal) < 0.01;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="card max-h-[85vh] w-full max-w-md overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {isEdit ? "Modifier la dépense annuelle" : "Nouvelle dépense annuelle"}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (form.label && form.accountId) save.mutate();
          }}
          className="space-y-3"
        >
          <input
            autoFocus
            className="input"
            placeholder="Libellé (ex. Assurance habitation)"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="text-xs text-slate-400">
              Type
              <Select
                value={form.type}
                onChange={(v) => setForm({ ...form, type: v })}
                options={[
                  { value: "expense", label: "Dépense" },
                  { value: "income", label: "Revenu" },
                ]}
              />
            </div>
            <div className="text-xs text-slate-400">
              Compte
              <Select
                value={form.accountId}
                onChange={(v) => setForm({ ...form, accountId: v })}
                options={accounts.map((a) => ({ value: a.id, label: a.name }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="text-xs text-slate-400">
              Mois
              <Select
                value={String(form.month)}
                onChange={(v) => setForm({ ...form, month: Number(v) })}
                options={MONTH_LABELS.map((label, i) => ({ value: String(i), label }))}
              />
            </div>
            {!hasDebits && (
              <label className="text-xs text-slate-400">
                Jour du mois
                <input
                  type="number"
                  min={1}
                  max={31}
                  className="input"
                  value={form.dayOfMonth}
                  onChange={(e) =>
                    setForm({ ...form, dayOfMonth: Math.max(1, Math.min(31, Number(e.target.value))) })
                  }
                />
              </label>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs text-slate-400">
              Total (€)
              <input
                type="number"
                step="0.01"
                className="input disabled:opacity-60"
                value={hasDebits ? effectiveTotal : form.total}
                disabled={hasDebits}
                title={hasDebits ? "Calculé depuis les débits" : undefined}
                onChange={(e) => setForm({ ...form, total: Number(e.target.value) })}
              />
            </label>
            <label className="text-xs text-slate-400">
              Part {members.a.name}
              <input
                type="number"
                step="0.01"
                className="input"
                value={form.a}
                onChange={(e) => setForm({ ...form, a: Number(e.target.value) })}
              />
            </label>
            <label className="text-xs text-slate-400">
              Part {members.b.name}
              <input
                type="number"
                step="0.01"
                className="input"
                value={form.b}
                onChange={(e) => setForm({ ...form, b: Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="flex items-center justify-between text-xs">
            <button type="button" onClick={autoSplit} className="text-brand-600">
              Répartir auto ({me.household.defaultSplitA}/{me.household.defaultSplitB})
            </button>
            {!splitOk && <span className="text-amber-600">{members.a.name} + {members.b.name} ≠ Total</span>}
          </div>

          {/* Sous-débits : plusieurs débits pour cette dépense annuelle */}
          <div className="rounded-xl border border-slate-200 p-2.5 dark:border-slate-700">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">
                Débits {hasDebits && `(${debits.length})`}
              </span>
              <button
                type="button"
                onClick={() => setDebits([...debits, { label: "", amount: 0, day: form.dayOfMonth }])}
                className="text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                + Ajouter un débit
              </button>
            </div>
            {!hasDebits ? (
              <div className="text-xs text-slate-400">
                Un seul débit (jour ci-dessus). Ajoute des débits pour étaler la dépense sur
                plusieurs dates du mois.
              </div>
            ) : (
              <div className="space-y-1.5">
                {debits.map((d, i) => {
                  const dField =
                    "rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900";
                  return (
                    <div key={i} className="flex items-center gap-1.5">
                      <input
                        placeholder="Libellé"
                        className={`${dField} min-w-0 flex-1`}
                        value={d.label}
                        onChange={(e) => {
                          const next = [...debits];
                          next[i] = { ...next[i], label: e.target.value };
                          setDebits(next);
                        }}
                      />
                      <input
                        type="number"
                        step="0.01"
                        placeholder="€"
                        className={`${dField} w-20 shrink-0 text-right`}
                        value={d.amount}
                        onChange={(e) => {
                          const next = [...debits];
                          next[i] = { ...next[i], amount: Number(e.target.value) };
                          setDebits(next);
                        }}
                      />
                      <input
                        type="number"
                        min={1}
                        max={31}
                        placeholder="jour"
                        className={`${dField} w-14 shrink-0 text-right`}
                        value={d.day}
                        onChange={(e) => {
                          const next = [...debits];
                          next[i] = { ...next[i], day: Math.max(1, Math.min(31, Number(e.target.value))) };
                          setDebits(next);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setDebits(debits.filter((_, j) => j !== i))}
                        className="shrink-0 px-1 text-slate-300 hover:text-red-500"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            {isEdit && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Supprimer « ${recurring!.label} » ?`)) onDelete(recurring!.id);
                }}
                className="btn-ghost text-red-600 hover:text-red-700"
              >
                Supprimer
              </button>
            )}
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={onClose} className="btn-ghost">
                Annuler
              </button>
              <button className="btn-primary" disabled={save.isPending || !splitOk}>
                {save.isPending ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function RecurringModal({
  recurring,
  categories,
  accounts,
  onClose,
  onSaved,
  onDelete,
}: {
  recurring: Recurring | null;
  categories: Category[];
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
  onDelete: (id: string) => void;
}) {
  const me = useMe();
  const members = me.household.members;
  const isEdit = !!recurring;
  const [form, setForm] = useState({
    label: recurring?.label ?? "",
    categoryId: recurring?.categoryId ?? categories[0]?.id ?? "",
    accountId: recurring?.accountId ?? accounts[0]?.id ?? "",
    type: recurring ? (recurring.amount >= 0 ? "income" : "expense") : "expense",
    total: recurring ? Math.abs(recurring.amount) / 100 : 0,
    a: recurring ? Math.abs(recurring.shareA) / 100 : 0,
    b: recurring ? Math.abs(recurring.shareB) / 100 : 0,
    dayOfMonth: recurring?.dayOfMonth ?? 5,
  });

  const [debits, setDebits] = useState(
    (recurring?.debits ?? []).map((d) => ({
      label: d.label,
      amount: Math.abs(d.amount) / 100,
      day: d.dayOfMonth ?? 5,
    })),
  );
  const hasDebits = debits.length > 0;
  const debitsTotal = Math.round(debits.reduce((s, d) => s + (Number(d.amount) || 0), 0) * 100) / 100;
  const effectiveTotal = hasDebits ? debitsTotal : form.total;

  // Motifs de nom (matching des transactions bancaires au montant variable).
  const [matchNames, setMatchNames] = useState<string[]>(recurring?.matchNames ?? []);

  const autoSplit = () => {
    const j = Math.round(effectiveTotal * (me.household.defaultSplitA / 100) * 100) / 100;
    setForm({ ...form, a: j, b: Math.round((effectiveTotal - j) * 100) / 100 });
  };

  const save = useMutation({
    mutationFn: () => {
      const sign = form.type === "income" ? 1 : -1;
      const payload = {
        label: form.label,
        categoryId: form.categoryId || null,
        accountId: form.accountId,
        amount: sign * eurToCents(effectiveTotal),
        shareA: sign * eurToCents(form.a),
        shareB: sign * eurToCents(form.b),
        frequency: "monthly" as const,
        dayOfMonth: hasDebits ? null : form.dayOfMonth,
        startDate: todayIso(),
        active: true,
        debits: hasDebits
          ? debits.map((d) => ({
              label: d.label,
              amount: sign * eurToCents(Number(d.amount) || 0),
              dayOfMonth: d.day,
            }))
          : [],
        matchNames: matchNames.map((n) => n.trim()).filter(Boolean),
      };
      return isEdit
        ? api.patch(`/api/recurring/${recurring!.id}`, payload)
        : api.post("/api/recurring", payload);
    },
    onSuccess: onSaved,
  });

  const splitOk = Math.abs(form.a + form.b - effectiveTotal) < 0.01;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div className="card max-h-[85vh] w-full max-w-md overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{isEdit ? "Modifier la charge" : "Nouvelle charge"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (form.label && form.accountId) save.mutate();
          }}
          className="space-y-3"
        >
          <input
            autoFocus
            className="input"
            placeholder="Libellé (ex. Électricité)"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="text-xs text-slate-400">
              Type
              <Select
                value={form.type}
                onChange={(v) => setForm({ ...form, type: v })}
                options={[
                  { value: "expense", label: "Dépense" },
                  { value: "income", label: "Revenu" },
                ]}
              />
            </div>
            <div className="text-xs text-slate-400">
              Catégorie
              <Select
                value={form.categoryId}
                onChange={(v) => setForm({ ...form, categoryId: v })}
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="text-xs text-slate-400">
              Compte
              <Select
                value={form.accountId}
                onChange={(v) => setForm({ ...form, accountId: v })}
                options={accounts.map((a) => ({ value: a.id, label: a.name }))}
              />
            </div>
            {!hasDebits && (
              <label className="text-xs text-slate-400">
                Jour de débit
                <input
                  type="number"
                  min={1}
                  max={31}
                  className="input"
                  value={form.dayOfMonth}
                  onChange={(e) =>
                    setForm({ ...form, dayOfMonth: Math.max(1, Math.min(31, Number(e.target.value))) })
                  }
                />
              </label>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs text-slate-400">
              Total (€)
              <input
                type="number"
                step="0.01"
                className="input disabled:opacity-60"
                value={hasDebits ? effectiveTotal : form.total}
                disabled={hasDebits}
                title={hasDebits ? "Calculé depuis les débits" : undefined}
                onChange={(e) => setForm({ ...form, total: Number(e.target.value) })}
              />
            </label>
            <label className="text-xs text-slate-400">
              Part {members.a.name}
              <input
                type="number"
                step="0.01"
                className="input"
                value={form.a}
                onChange={(e) => setForm({ ...form, a: Number(e.target.value) })}
              />
            </label>
            <label className="text-xs text-slate-400">
              Part {members.b.name}
              <input
                type="number"
                step="0.01"
                className="input"
                value={form.b}
                onChange={(e) => setForm({ ...form, b: Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="flex items-center justify-between text-xs">
            <button type="button" onClick={autoSplit} className="text-brand-600">
              Répartir auto ({me.household.defaultSplitA}/{me.household.defaultSplitB})
            </button>
            {!splitOk && <span className="text-amber-600">{members.a.name} + {members.b.name} ≠ Total</span>}
          </div>

          {/* Sous-débits : plusieurs débits pour cette dépense */}
          <div className="rounded-xl border border-slate-200 p-2.5 dark:border-slate-700">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">
                Débits {hasDebits && `(${debits.length})`}
              </span>
              <button
                type="button"
                onClick={() => setDebits([...debits, { label: "", amount: 0, day: form.dayOfMonth }])}
                className="text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                + Ajouter un débit
              </button>
            </div>
            {!hasDebits ? (
              <div className="text-xs text-slate-400">
                Un seul débit (jour ci-dessus). Ajoute des débits pour étaler la dépense sur
                plusieurs dates.
              </div>
            ) : (
              <div className="space-y-1.5">
                {debits.map((d, i) => {
                  const dField =
                    "rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900";
                  return (
                  <div key={i} className="flex items-center gap-1.5">
                    <input
                      placeholder="Libellé"
                      className={`${dField} min-w-0 flex-1`}
                      value={d.label}
                      onChange={(e) => {
                        const next = [...debits];
                        next[i] = { ...next[i], label: e.target.value };
                        setDebits(next);
                      }}
                    />
                    <input
                      type="number"
                      step="0.01"
                      placeholder="€"
                      className={`${dField} w-20 shrink-0 text-right`}
                      value={d.amount}
                      onChange={(e) => {
                        const next = [...debits];
                        next[i] = { ...next[i], amount: Number(e.target.value) };
                        setDebits(next);
                      }}
                    />
                    <input
                      type="number"
                      min={1}
                      max={31}
                      placeholder="jour"
                      className={`${dField} w-14 shrink-0 text-right`}
                      value={d.day}
                      onChange={(e) => {
                        const next = [...debits];
                        next[i] = { ...next[i], day: Math.max(1, Math.min(31, Number(e.target.value))) };
                        setDebits(next);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setDebits(debits.filter((_, j) => j !== i))}
                      className="shrink-0 px-1 text-slate-300 hover:text-red-500"
                    >
                      ✕
                    </button>
                  </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Motifs de nom : matching des transactions bancaires (montant variable). */}
          <div className="rounded-xl border border-slate-200 p-2.5 dark:border-slate-700">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">
                Noms de paiement {matchNames.length > 0 && `(${matchNames.length})`}
              </span>
              <button
                type="button"
                onClick={() => setMatchNames([...matchNames, ""])}
                className="text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                + Ajouter un nom
              </button>
            </div>
            {matchNames.length === 0 ? (
              <div className="text-xs text-slate-400">
                Un mouvement bancaire dont le nom contient l'un de ces motifs sera rattaché à cette
                charge (utile quand le montant varie). Rempli automatiquement en liant une
                transaction depuis les Comptes bancaires.
              </div>
            ) : (
              <div className="space-y-1.5">
                {matchNames.map((n, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input
                      placeholder="Nom (ex. DGFIP)"
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900"
                      value={n}
                      onChange={(e) => {
                        const next = [...matchNames];
                        next[i] = e.target.value;
                        setMatchNames(next);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setMatchNames(matchNames.filter((_, j) => j !== i))}
                      className="shrink-0 px-1 text-slate-300 hover:text-red-500"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            {isEdit && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Supprimer « ${recurring!.label} » ?`)) onDelete(recurring!.id);
                }}
                className="btn-ghost text-red-600 hover:text-red-700"
              >
                Supprimer
              </button>
            )}
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={onClose} className="btn-ghost">
                Annuler
              </button>
              <button className="btn-primary" disabled={save.isPending || !splitOk}>
                {save.isPending ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------------- Trésorerie ---------------- */

/** Clé stable d'une dépense à venir (pas d'id renvoyé par /api/cashflow). */
const cashflowEntryKey = (e: Cashflow["upcoming"][number]) =>
  `${e.accountId}|${e.date}|${e.label}|${e.amount}`;

/**
 * Trésorerie — deux questions différentes, donc deux vues :
 * « qu'est-ce que je dois virer ? » en début de mois, et « combien me
 * reste-t-il, compte par compte ? » le reste du temps.
 */
const TRESO_VIEWS = ["virements", "reste"] as const;

function Tresorerie({ view }: { view?: string }) {
  const navigate = useNavigate();
  const sub = useLastView(
    "money:tresorerie",
    TRESO_VIEWS,
    "virements",
    view,
    "/money/tresorerie",
  );
  const items = [
    { value: "virements", label: "Virements" },
    { value: "reste", label: "Reste à vivre" },
  ];
  const go = (v: string) => navigate(`/money/tresorerie/${v}`);
  usePageTabs(sub, items, go);

  return (
    <div className="flex flex-col gap-4">
      <SubNav value={sub} onChange={go} items={items} className="hidden md:block" />
      {sub === "virements" ? <VirementsTab /> : <ResteAVivre />}
    </div>
  );
}

/** Sélecteur de mois : ‹ libellé › — même barre sur les deux vues. */
function MonthStepper({
  label,
  onPrev,
  onNext,
  canPrev = true,
  canNext = true,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  canPrev?: boolean;
  canNext?: boolean;
}) {
  const btn =
    "flex h-tap w-tap shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink transition disabled:opacity-30";
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={onPrev} disabled={!canPrev} aria-label="Mois précédent" className={btn}>
        <IconChevronLeft size={20} />
      </button>
      <span className="flex-1 text-center text-base font-semibold first-letter:uppercase">
        {label}
      </span>
      <button type="button" onClick={onNext} disabled={!canNext} aria-label="Mois suivant" className={btn}>
        <IconChevronRight size={20} />
      </button>
    </div>
  );
}

function ResteAVivre() {
  const [openAcct, setOpenAcct] = useState<string | null>(null);
  // 0 = mois courant, 1 = mois suivant, etc. (prévision jusqu'à la fin de ce mois-là)
  const [monthOffset, setMonthOffset] = useState(0);
  // Dépenses à venir décochées au clic : barrées et sorties du calcul (local, non persisté).
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const toggleExcluded = (key: string) => setExcluded((x) => ({ ...x, [key]: !x[key] }));

  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0, 23, 59, 59);
  const days = Math.max(0, Math.floor((target.getTime() - now.getTime()) / 86_400_000));
  const monthLabel = target.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  const { data } = useQuery({
    queryKey: ["cashflow", "month", days],
    queryFn: () => api.get<Cashflow>(`/api/cashflow?days=${days}`),
  });
  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<Account[]>("/api/accounts"),
  });

  if (!data || !accounts) return <PageLoader variant="argent" />;

  // comptes cochés « Afficher dans les prévisions » (Réglages du compte)
  const okIds = new Set(accounts.filter((a) => a.forecast).map((a) => a.id));
  const rows = data.byAccount.filter((a) => okIds.has(a.accountId));

  // couleurs : solde fin de mois (vert ≥10€, orange 0–10€, rouge <0) ; reste à débiter (noir si 0, orange si >0)
  const endColor = (c: number) => (c >= 1000 ? "text-green-600" : c < 0 ? "text-red-600" : "text-amber-600");

  // Consolidé, sur les comptes suivis : ce qu'il y a, ce qui va sortir, ce qui
  // reste. Les trois chiffres du haut sont la somme des cartes du dessous.
  const onAccounts = rows.reduce((s, a) => s + a.currentBalance, 0);
  const toDebit = rows.reduce((s, a) => s + debitsOf(a), 0);
  const living = rows.reduce((s, a) => s + projectedOf(a), 0);
  const lastDay = target.getDate();

  // Comptes qui passeront en négatif : ce que la page doit dire en premier.
  const shortfalls = rows
    .map((a) => ({ row: a, projected: projectedOf(a) }))
    .filter((x) => x.projected < 0);

  return (
    <div className="flex flex-col gap-4 pb-4">
      <MonthStepper
        label={`D'ici fin ${monthLabel}`}
        onPrev={() => setMonthOffset((o) => Math.max(0, o - 1))}
        onNext={() => setMonthOffset((o) => Math.min(12, o + 1))}
        canPrev={monthOffset > 0}
        canNext={monthOffset < 12}
      />

      <div className="card">
        <div className="text-sm text-ink-2">Reste à vivre, tous comptes</div>
        <div className={`mt-1 text-3xl font-bold ${living < 0 ? "text-danger" : ""}`}>
          {eur(living)}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-hairline pt-3">
          <div>
            <div className="text-xs text-slate-400">Sur les comptes</div>
            <div className="mt-0.5 font-semibold tabular-nums">{eur(onAccounts)}</div>
          </div>
          <div className="border-l border-hairline pl-4">
            <div className="text-xs text-slate-400">Reste à débiter</div>
            <div className="mt-0.5 font-semibold tabular-nums text-danger">−{eur(toDebit)}</div>
          </div>
        </div>
      </div>

      {shortfalls.map(({ row, projected }) => {
        // Le compte le mieux garni qui pourrait combler le trou sans y passer.
        const gap = -projected;
        const rescue = rows
          .filter((r) => r.accountId !== row.accountId && projectedOf(r) > gap)
          .sort((x, y) => projectedOf(y) - projectedOf(x))[0];
        return (
          <div
            key={row.accountId}
            className="rounded-2xl border border-warning bg-warning-soft p-3 text-sm"
          >
            <div className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-0.5 shrink-0 text-warning">
                <IconAlert size={20} />
              </span>
              <div className="min-w-0">
                <div className="font-semibold text-warning">
                  {row.accountName} passera à {eur(projected)}
                </div>
                <p className="mt-0.5 text-ink-2">
                  Il manque {eur(gap)} avant le {lastDay} {monthLabel.split(" ")[0]}.
                  {rescue ? ` Un virement depuis ${rescue.accountName} suffit.` : ""}
                </p>
              </div>
            </div>
          </div>
        );
      })}

      {/* Une carte par compte : joint d'abord, puis les comptes de chacun. */}
      <div className="flex flex-col gap-3">
        {ownerRows("joint").map(renderCard)}
        {ownerRows("a").length > 0 && (
          <div className="grid gap-3 md:grid-cols-2">{ownerRows("a").map(renderCard)}</div>
        )}
        {ownerRows("b").length > 0 && (
          <div className="grid gap-3 md:grid-cols-2">{ownerRows("b").map(renderCard)}</div>
        )}
      </div>
    </div>
  );

  /** Débits restants d'un compte, dépenses décochées déduites. */
  function debitsOf(a: Cashflow["byAccount"][number]) {
    const skipped = data!.upcoming
      .filter(
        (e) => e.accountId === a.accountId && e.amount < 0 && excluded[cashflowEntryKey(e)],
      )
      .reduce((s, e) => s - e.amount, 0);
    return a.totalDebits - skipped;
  }

  /** Solde de fin de mois. Au-delà du mois courant, on ignore les rentrées. */
  function projectedOf(a: Cashflow["byAccount"][number]) {
    const skipped = a.totalDebits - debitsOf(a);
    return (monthOffset > 0 ? a.currentBalance - a.totalDebits : a.projectedBalance) + skipped;
  }

  function ownerRows(owner: string) {
    const ids = new Set(accounts!.filter((a) => a.owner === owner).map((a) => a.id));
    return rows.filter((r) => ids.has(r.accountId));
  }

  function renderCard(a: Cashflow["byAccount"][number]) {
    const debits = data!.upcoming
      .filter((e) => e.accountId === a.accountId && e.amount < 0)
      .sort((x, y) => x.date.localeCompare(y.date));
    const open = openAcct === a.accountId;
    const totalDebits = debitsOf(a);
    const projected = projectedOf(a);
    return (
      <div key={a.accountId} className="card">
        <button
          onClick={() => setOpenAcct(open ? null : a.accountId)}
          aria-expanded={open}
          className="flex w-full items-center gap-3 text-left"
        >
          <BankBadge name={a.accountName} />
          <span className="min-w-0 flex-1 truncate text-base font-semibold">{a.accountName}</span>
          <IconChevronDown
            size={20}
            className={`shrink-0 text-slate-400 transition-transform ${open ? "" : "-rotate-90"}`}
          />
        </button>
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <div>
            <div className="text-xs text-slate-400">Solde</div>
            <div className="mt-0.5 font-semibold tabular-nums">{eur(a.currentBalance)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">À débiter</div>
            <div className="mt-0.5 font-semibold tabular-nums text-danger">−{eur(totalDebits)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Restant</div>
            <div className={`mt-0.5 font-semibold tabular-nums ${endColor(projected)}`}>
              {eur(projected)}
            </div>
          </div>
        </div>

        {open && (
          <div className="mt-3 border-t border-hairline pt-3">
            <div className="eyebrow mb-1">À venir d'ici le {target.getDate()}</div>
            {debits.length === 0 ? (
              <div className="text-sm text-slate-400">Aucune dépense à débiter.</div>
            ) : (
              debits.map((e, i) => {
                const key = cashflowEntryKey(e);
                const off = !!excluded[key];
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleExcluded(key)}
                    aria-pressed={off}
                    title={off ? "Reprendre en compte" : "Ignorer dans le calcul"}
                    className={`flex w-full min-h-[48px] items-center gap-3 border-b border-hairline text-left last:border-0 ${
                      off ? "text-slate-400 line-through" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1 py-1.5">
                      <span className="block truncate text-sm">{e.label}</span>
                      <span className="block text-xs text-slate-400">{dateFrShort(e.date)}</span>
                    </span>
                    <span className={`shrink-0 tabular-nums ${off ? "" : "text-danger"}`}>
                      {eur(e.amount)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    );
  }
}

/* ---------------- Virements de début de mois ---------------- */

/** Un virement à faire : d'où, vers où, pourquoi, combien. */
type Transfer = { key: string; to: string; why: string; amount: number };

/** « 1er sept. » — jour sans zéro initial, contrairement à `dateFrShort`. */
function dayFr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getDate() === 1 ? "1er" : String(d.getDate());
  return `${day} ${d.toLocaleDateString("fr-FR", { month: "short" })}`;
}

function VirementsTab() {
  const me = useMe();
  const members = me.household.members;
  // Mois des virements : la fenêtre bascule le 10 (au-delà, on prépare le mois
  // suivant). Les flèches décalent à partir de là.
  const [monthOffset, setMonthOffset] = useState(0);
  // Replié par défaut sur les deux tailles d'écran : ce qu'on vient faire ici,
  // c'est cocher des virements, pas relire le calcul. (Pas d'état initial déduit
  // du viewport : la première mesure peut tomber avant la mise en page.)
  const [detailOpen, setDetailOpen] = useState(false);
  const { data: recurring } = useQuery({
    queryKey: ["recurring"],
    queryFn: () => api.get<Recurring[]>("/api/recurring"),
  });
  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<Account[]>("/api/accounts"),
  });
  const { data: savings } = useQuery({
    queryKey: ["wedding-savings"],
    queryFn: () => api.get<SavingsContribution[]>("/api/wedding/savings"),
  });
  const { data: balance } = useQuery({
    queryKey: ["balance"],
    queryFn: () => api.get<Balance>("/api/balance"),
  });
  const { data: planned } = useQuery({
    queryKey: ["planned"],
    queryFn: () => api.get<PlannedExpense[]>("/api/planned"),
  });

  // Overrides locaux pour ce mois (n'affectent que ces tableaux, non persistés)
  const qc = useQueryClient();
  const [salJOv, setSalJOv] = useState<number | null>(null);
  const [salNOv, setSalNOv] = useState<number | null>(null);
  // Salaire déjà reçu (déjà inclus dans le solde actuel) → ne pas le recompter
  const [salJReceived, setSalJReceived] = useState(false);
  const [salNReceived, setSalNReceived] = useState(false);
  const [equilOv, setEquilOv] = useState<number | null>(null);
  const [soldeJOv, setSoldeJOv] = useState<number | null>(null);
  const [soldeNOv, setSoldeNOv] = useState<number | null>(null);
  // Lignes dépliées (détail des dépenses), clé = `${member}-${index}`.
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const toggleRow = (key: string) => setOpenRows((o) => ({ ...o, [key]: !o[key] }));

  // Réinitialise un override et refetch la donnée depuis la DB
  const resetFrom = (set: (v: number | null) => void, key: string) => () => {
    set(null);
    qc.invalidateQueries({ queryKey: [key] });
  };

  // Mois concerné : fenêtre [10 du mois, 10 du mois suivant) → mois suivant.
  // Calculé avant tout retour anticipé : la requête des cases cochées en dépend.
  const now = new Date();
  const target = new Date(
    now.getFullYear(),
    now.getMonth() + (now.getDate() >= 10 ? 1 : 0) + monthOffset,
    1,
  );
  const targetMonth = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`;
  const targetLabel = target.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  // Virements déjà faits ce mois-là. Le serveur ne stocke que des clés cochées :
  // la liste elle-même est recalculée ici à chaque fois.
  const { data: checks } = useQuery({
    queryKey: ["transfers", targetMonth],
    queryFn: () => api.get<{ done: TransferCheck[] }>(`/api/transfers?month=${targetMonth}`),
  });
  const setChecks = useMutation({
    mutationFn: (v: { keys: string[]; done: boolean }) =>
      api.put("/api/transfers", { month: targetMonth, ...v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["transfers"] }),
  });

  if (!recurring || !accounts || !savings || !balance || !planned)
    return <PageLoader variant="argent" />;

  const contrib = savings.find((s) => s.month === targetMonth);

  const ownerOf = (id: string) => accounts.find((a) => a.id === id)?.owner;
  // Base mensuelle : on exclut les dépenses annuelles (frequency "yearly"), qui
  // ne comptent que le mois où elles tombent (traitées à part ci-dessous).
  const expenses = recurring.filter((r) => r.amount < 0 && r.frequency !== "yearly");
  const income = recurring.filter((r) => r.amount > 0 && r.frequency !== "yearly");
  // Comptes par rôle (plus de matching par nom) : principal = dépenses prévues,
  // courant secondaire = compte chèque non principal, épargne = type savings.
  const primaryAcc = (m: string) => accounts.find((a) => a.owner === m && a.isPrimary);
  const secondaryChecking = (m: string) =>
    accounts.find((a) => a.owner === m && a.type === "checking" && !a.isPrimary);
  const savingsAcc = (m: string) => accounts.find((a) => a.owner === m && a.type === "savings");
  const lclName = accounts.find((a) => a.owner === "joint")?.name ?? "Compte joint";

  const shareOf = (r: Recurring, m: string) => Math.abs(m === "a" ? r.shareA : r.shareB);
  const shareByOwner = (m: string, owner: string) =>
    expenses.filter((r) => ownerOf(r.accountId) === owner).reduce((s, r) => s + shareOf(r, m), 0);
  const totalOnAccount = (id?: string) =>
    id ? expenses.filter((r) => r.accountId === id).reduce((s, r) => s + Math.abs(r.amount), 0) : 0;
  const salaryOf = (m: string) => income.reduce((s, r) => s + shareOf(r, m), 0);

  // Dépenses annuelles qui tombent le mois cible (mois de startDate). Elles sont
  // intégrées à « Dépenses engagées » du membre qui paie, avec remboursement de
  // la part de l'autre — même mécanique que les charges mensuelles, sur des
  // lignes « annuelles » dédiées.
  const annualThisMonth = recurring.filter(
    (r) =>
      r.amount < 0 &&
      r.frequency === "yearly" &&
      r.active &&
      new Date(r.startDate).getMonth() === target.getMonth(),
  );
  const annShareByOwner = (m: string, owner: string) =>
    annualThisMonth
      .filter((r) => ownerOf(r.accountId) === owner)
      .reduce((s, r) => s + shareOf(r, m), 0);
  const annTotalOnAccount = (id?: string) =>
    id
      ? annualThisMonth.filter((r) => r.accountId === id).reduce((s, r) => s + Math.abs(r.amount), 0)
      : 0;

  // Dépenses prévues (onglet « Prévue ») datées le mois cible, réparties selon leur
  // responsable :
  //  - a : imputée à 100 % à « Dépenses engagées » du membre a ;
  //  - b : imputée à 100 % à « Dépenses engagées » du membre b ;
  //  - joint (commun) : a avance le total, b rembourse sa part (prorata)
  //    sur le compte principal de a — comme les dépenses annuelles communes.
  // Les dépenses déjà achetées (purchasedAt) sortent de la projection de fin de mois.
  const plannedThisMonth = planned.filter(
    (p) => !p.purchasedAt && p.date && p.date.startsWith(targetMonth),
  );
  const plannedJoint = plannedThisMonth.filter((p) => (p.owner ?? "joint") === "joint");
  const plannedOwnA = plannedThisMonth.filter((p) => p.owner === "a");
  const plannedOwnB = plannedThisMonth.filter((p) => p.owner === "b");
  const sumPlanned = (list: PlannedExpense[]) => list.reduce((s, p) => s + p.amount, 0);
  // Part du membre b (clé par défaut), arrondie par item pour rester cohérente avec le détail.
  const pShareB = (p: PlannedExpense) =>
    Math.round((p.amount * (100 - me.household.defaultSplitA)) / 100);
  // a avance le total du commun + ses dépenses propres.
  const pjDepenses = sumPlanned(plannedJoint) + sumPlanned(plannedOwnA);
  // b : ses dépenses propres, débitées directement de son compte principal.
  const pnDepenses = sumPlanned(plannedOwnB);
  // Remboursement de b vers le compte principal de a : uniquement la part du commun.
  const pnTradeA = plannedJoint.reduce((s, p) => s + pShareB(p), 0);

  const wedJ = contrib?.amountA ?? 0;
  const wedN = contrib?.amountB ?? 0;
  // équilibrage : montant que b envoie à a (éditable)
  const equilAmount = equilOv ?? (balance.fromUser === "b" ? balance.amount : 0);
  const equilBToA = equilAmount;

  const tradeJ = primaryAcc("a");
  const tradeN = primaryAcc("b");
  const boursoJ = secondaryChecking("a");
  const boursoN = secondaryChecking("b");
  const epargneJ = savingsAcc("a");

  // Détail d'une ligne : dépenses qui composent son total (dépliable).
  type Detail = { label: string; amount: number };
  type Row =
    | {
        kind: "in" | "out" | "total";
        label: string;
        account?: string;
        amount: number;
        strong?: boolean;
        struck?: boolean;
        onToggle?: () => void;
        details?: Detail[];
      }
    | {
        kind: "edit";
        label: string;
        cents: number;
        onChange: (c: number | null) => void;
        onReset: () => void;
        overridden: boolean;
      }
    | { kind: "empty" };

  // Constructeurs du détail (par ligne) : mêmes filtres que les agrégats ci-dessous.
  const salaryDetails = (m: string): Detail[] =>
    income.map((r) => ({ label: r.label, amount: shareOf(r, m) })).filter((d) => d.amount !== 0);
  const shareDetails = (m: string, owner: string): Detail[] =>
    expenses
      .filter((r) => ownerOf(r.accountId) === owner)
      .map((r) => ({ label: r.label, amount: shareOf(r, m) }))
      .filter((d) => d.amount !== 0);
  const annShareDetails = (m: string, owner: string): Detail[] =>
    annualThisMonth
      .filter((r) => ownerOf(r.accountId) === owner)
      .map((r) => ({ label: r.label, amount: shareOf(r, m) }))
      .filter((d) => d.amount !== 0);
  const accountDetails = (id?: string): Detail[] =>
    id
      ? expenses.filter((r) => r.accountId === id).map((r) => ({ label: r.label, amount: Math.abs(r.amount) }))
      : [];
  const annAccountDetails = (id?: string): Detail[] =>
    id
      ? annualThisMonth
          .filter((r) => r.accountId === id)
          .map((r) => ({ label: r.label, amount: Math.abs(r.amount) }))
      : [];
  // Détail « Dépenses engagées » de a : commun (plein) + dépenses propres (plein).
  const plannedDetailsOwnA = (): Detail[] =>
    [...plannedJoint, ...plannedOwnA].map((p) => ({ label: p.name, amount: p.amount }));
  // Détail « Dépenses engagées » de b : ses dépenses propres (plein).
  const plannedDetailsOwnB = (): Detail[] =>
    plannedOwnB.map((p) => ({ label: p.name, amount: p.amount }));
  // Détail des remboursements (part de b sur le commun uniquement).
  const plannedShareDetails = (): Detail[] =>
    plannedJoint.map((p) => ({ label: p.name, amount: pShareB(p) }));

  // Logique de base : chacun paie sa part sur le compte joint ; b envoie en plus
  // sa part des charges des comptes de a directement sur le compte principal de a.
  const jLcl = shareByOwner("a", "joint");
  const nLcl = shareByOwner("b", "joint");
  const nTradeA = shareByOwner("b", "a"); // remboursement des charges sur les comptes de a

  // Équivalents annuels (mois cible uniquement).
  const ajLcl = annShareByOwner("a", "joint");
  const anLcl = annShareByOwner("b", "joint");
  const anTradeA = annShareByOwner("b", "a"); // part annuelle de b sur les comptes de a

  // ----- Membre a -----
  const jSalaire = salJOv ?? salaryOf("a");
  const jVirBourso = totalOnAccount(boursoJ?.id);
  const ajVirBourso = annTotalOnAccount(boursoJ?.id);
  const ajDepenses = annTotalOnAccount(tradeJ?.id); // dépenses annuelles sur le compte principal de a
  const jSolde = soldeJOv ?? (tradeJ?.currentBalance ?? 0);
  const jMontantTrade =
    (salJReceived ? 0 : jSalaire) +
    equilBToA +
    wedN +
    nTradeA +
    anTradeA +
    pnTradeA -
    jVirBourso -
    ajVirBourso -
    jLcl -
    ajLcl +
    jSolde;
  const jMariageOut = wedJ + wedN;
  const jDepenses = totalOnAccount(tradeJ?.id);
  // « Dépenses engagées » = mensuel + annuel + prévu du mois (sur le compte principal de a).
  const jDepensesTotal = jDepenses + ajDepenses + pjDepenses;
  const jReste = jMontantTrade - jMariageOut - jDepensesTotal;

  const rowsA: Row[] = [
    {
      kind: "edit",
      label: "Solde actuel",
      cents: jSolde,
      onChange: setSoldeJOv,
      onReset: resetFrom(setSoldeJOv, "accounts"),
      overridden: soldeJOv !== null,
    },
    {
      kind: "in",
      label: "Salaire",
      amount: jSalaire,
      struck: salJReceived,
      onToggle: () => setSalJReceived((v) => !v),
      details: salaryDetails("a"),
    },
    { kind: "out", label: "Dépenses mensuels", account: lclName, amount: jLcl, details: shareDetails("a", "joint") },
    ...((ajLcl > 0
      ? [{ kind: "out", label: "Dépenses annuelles", account: lclName, amount: ajLcl, details: annShareDetails("a", "joint") }]
      : []) as Row[]),
    { kind: "out", label: "Dépenses mensuels", account: boursoJ?.name ?? "Compte courant", amount: jVirBourso, details: accountDetails(boursoJ?.id) },
    ...((ajVirBourso > 0
      ? [{ kind: "out", label: "Dépenses annuelles", account: boursoJ?.name ?? "Compte courant", amount: ajVirBourso, details: annAccountDetails(boursoJ?.id) }]
      : []) as Row[]),
    { kind: "in", label: `Dépenses mensuels de ${members.b.name}`, amount: nTradeA, details: shareDetails("b", "a") },
    ...((anTradeA > 0
      ? [{ kind: "in", label: `Dépenses annuelles de ${members.b.name}`, amount: anTradeA, details: annShareDetails("b", "a") }]
      : []) as Row[]),
    ...((pnTradeA > 0
      ? [{ kind: "in", label: `Dépenses prévues de ${members.b.name}`, amount: pnTradeA, details: plannedShareDetails() }]
      : []) as Row[]),
    { kind: "in", label: `Mariage de ${members.b.name}`, amount: wedN },
    { kind: "in", label: "Équilibrage", amount: equilBToA },
    { kind: "empty" },
    { kind: "total", label: "Solde trade après virements", amount: jMontantTrade, strong: true },
    {
      kind: "out",
      label: "Mariage",
      account: epargneJ?.name ?? "Épargne",
      amount: jMariageOut,
      details: [
        { label: `Mariage de ${members.a.name}`, amount: wedJ },
        { label: `Mariage de ${members.b.name}`, amount: wedN },
      ].filter((d) => d.amount > 0),
    },
    {
      kind: "out",
      label: "Dépenses engagées",
      amount: jDepensesTotal,
      details: [...accountDetails(tradeJ?.id), ...annAccountDetails(tradeJ?.id), ...plannedDetailsOwnA()],
    },
    { kind: "total", label: "Reste à vivre", amount: jReste, strong: true },
  ];

  // ----- Membre b ----- (salaire sur son compte principal ; dépenses secondaires virées sur son compte secondaire)
  const nSalaire = salNOv ?? salaryOf("b");
  const nVirBourso = totalOnAccount(boursoN?.id); // dépenses Bourso, virées sur Bourso
  const anVirBourso = annTotalOnAccount(boursoN?.id);
  const anDepenses = annTotalOnAccount(tradeN?.id); // dépenses annuelles sur le compte principal de b
  const nSolde = soldeNOv ?? (tradeN?.currentBalance ?? 0);
  const nMontantTrade =
    (salNReceived ? 0 : nSalaire) -
    nLcl -
    anLcl -
    nTradeA -
    anTradeA -
    pnTradeA -
    nVirBourso -
    anVirBourso -
    wedN -
    equilBToA +
    nSolde;
  const nDepenses = totalOnAccount(tradeN?.id); // dépenses engagées sur Trade, payées directement
  // « Dépenses engagées » de b = mensuel + annuel + dépenses prévues qui lui sont propres.
  const nDepensesTotal = nDepenses + anDepenses + pnDepenses;
  const nReste = nMontantTrade - nDepensesTotal;

  const rowsB: Row[] = [
    {
      kind: "edit",
      label: "Solde actuel",
      cents: nSolde,
      onChange: setSoldeNOv,
      onReset: resetFrom(setSoldeNOv, "accounts"),
      overridden: soldeNOv !== null,
    },
    {
      kind: "in",
      label: "Salaire",
      amount: nSalaire,
      struck: salNReceived,
      onToggle: () => setSalNReceived((v) => !v),
      details: salaryDetails("b"),
    },
    { kind: "out", label: "Dépenses mensuels", account: lclName, amount: nLcl, details: shareDetails("b", "joint") },
    ...((anLcl > 0
      ? [{ kind: "out", label: "Dépenses annuelles", account: lclName, amount: anLcl, details: annShareDetails("b", "joint") }]
      : []) as Row[]),
    { kind: "out", label: "Dépenses mensuels", account: boursoN?.name ?? "Compte courant", amount: nVirBourso, details: accountDetails(boursoN?.id) },
    ...((anVirBourso > 0
      ? [{ kind: "out", label: "Dépenses annuelles", account: boursoN?.name ?? "Compte courant", amount: anVirBourso, details: annAccountDetails(boursoN?.id) }]
      : []) as Row[]),
    { kind: "out", label: "Dépenses mensuels", account: tradeJ?.name ?? `Compte principal ${members.a.name}`, amount: nTradeA, details: shareDetails("b", "a") },
    ...((anTradeA > 0
      ? [{ kind: "out", label: "Dépenses annuelles", account: tradeJ?.name ?? `Compte principal ${members.a.name}`, amount: anTradeA, details: annShareDetails("b", "a") }]
      : []) as Row[]),
    ...((pnTradeA > 0
      ? [{ kind: "out", label: "Dépenses prévues", account: tradeJ?.name ?? `Compte principal ${members.a.name}`, amount: pnTradeA, details: plannedShareDetails() }]
      : []) as Row[]),
    { kind: "out", label: "Mariage", account: tradeJ?.name ?? `Compte principal ${members.a.name}`, amount: wedN },
    { kind: "out", label: "Équilibrage", account: tradeJ?.name ?? `Compte principal ${members.a.name}`, amount: equilBToA },
    { kind: "empty" },
    { kind: "total", label: "Solde trade après virements", amount: nMontantTrade, strong: true },
    {
      kind: "out",
      label: "Dépenses engagées",
      amount: nDepensesTotal,
      details: [...accountDetails(tradeN?.id), ...annAccountDetails(tradeN?.id), ...plannedDetailsOwnB()],
    },
    { kind: "total", label: "Reste à vivre", amount: nReste, strong: true },
  ];

  // Virements à faire, par membre et par compte destinataire. La `key` sert de
  // case à cocher côté serveur : elle doit rester stable d'un mois à l'autre,
  // d'où l'id du compte (et un repli lisible quand le compte n'existe pas).
  const jointAcc = accounts.find((a) => a.owner === "joint");
  const tKey = (m: string, id: string | undefined, slug: string) => `${m}:${id ?? slug}`;

  const transfersA: Transfer[] = [
    { key: tKey("a", jointAcc?.id, "joint"), to: lclName, why: "dépenses du mois", amount: jLcl + ajLcl },
    {
      key: tKey("a", boursoJ?.id, "secondaire"),
      to: boursoJ?.name ?? `Compte secondaire ${members.a.name}`,
      why: "dépenses perso",
      amount: jVirBourso + ajVirBourso,
    },
    {
      key: tKey("a", epargneJ?.id, "epargne"),
      to: epargneJ?.name ?? "Épargne",
      why: "mariage",
      amount: jMariageOut,
    },
  ].filter((t) => t.amount > 0);

  const transfersB: Transfer[] = [
    { key: tKey("b", jointAcc?.id, "joint"), to: lclName, why: "dépenses du mois", amount: nLcl + anLcl },
    {
      key: tKey("b", tradeJ?.id, "principal-a"),
      to: tradeJ?.name ?? `Compte principal ${members.a.name}`,
      why: "parts, mariage et équilibrage",
      amount: nTradeA + anTradeA + pnTradeA + wedN + equilBToA,
    },
    {
      key: tKey("b", boursoN?.id, "secondaire"),
      to: boursoN?.name ?? `Compte secondaire ${members.b.name}`,
      why: "dépenses perso",
      amount: nVirBourso + anVirBourso,
    },
  ].filter((t) => t.amount > 0);

  const doneBy = new Map((checks?.done ?? []).map((d) => [d.key, d]));

  /** Tout ce qu'il faut pour afficher — et vérifier — le mois d'un membre. */
  const planOf = (m: "a" | "b") => {
    const list = m === "a" ? transfersA : transfersB;
    const remaining = list.filter((t) => !doneBy.has(t.key));
    return {
      member: m,
      list,
      remaining,
      toVire: remaining.reduce((s, t) => s + t.amount, 0),
      from:
        (m === "a" ? tradeJ : tradeN)?.name ?? `Compte principal ${members[m].name}`,
      after: m === "a" ? jMontantTrade : nMontantTrade,
      engaged: m === "a" ? jDepensesTotal : nDepensesTotal,
      living: m === "a" ? jReste : nReste,
    };
  };
  // La to-do d'abord (celle du membre connecté), puis celle de l'autre : les
  // deux colonnes de chiffres côte à côte, c'est ce qui permet de vérifier que
  // ce que l'un envoie correspond à ce que l'autre attend.
  const otherMember: "a" | "b" = me.member === "a" ? "b" : "a";
  const myPlan = planOf(me.member as "a" | "b");
  const theirPlan = planOf(otherMember);
  const remaining = myPlan.remaining;

  // Le détail du calcul. Les virements qui en découlent sont la to-do du haut :
  // cette table n'a plus à les répéter dans une info-bulle.
  const Ledger = ({ member, rows }: { member: "a" | "b"; rows: Row[] }) => (
    <div className="card">
      <div className="mb-2 flex items-center gap-2">
        <MemberAvatar id={member} className="h-7 w-7 text-sm" />
        <span className="font-semibold">{members[member].name}</span>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r, i) =>
            r.kind === "empty" ? (
              <tr key={i}>
                <td className="py-1.5">&nbsp;</td>
                <td></td>
              </tr>
            ) : r.kind === "edit" ? (
              <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-1.5">{r.label}</td>
                <td className="py-1.5">
                  <div className="flex items-center justify-end gap-1">
                    <input
                      type="number"
                      step="0.01"
                      value={r.cents / 100}
                      onChange={(e) =>
                        r.onChange(e.target.value === "" ? null : eurToCents(Number(e.target.value)))
                      }
                      className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-0.5 text-right text-sm tabular-nums text-slate-900 outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={r.onReset}
                      title="Réinitialiser depuis les réglages"
                      className={`text-sm ${r.overridden ? "text-brand-600 hover:text-brand-700" : "text-slate-300 hover:text-slate-500"}`}
                    >
                      ↻
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              <Fragment key={i}>
              <tr className={r.kind === "total" ? "border-t-2 border-slate-300 dark:border-slate-700" : "border-t border-slate-100 dark:border-slate-800"}>
                <td className={`py-1.5 ${r.strong ? "font-semibold" : ""} ${r.struck ? "text-slate-400 line-through" : ""}`}>
                  {r.label}
                  {r.account && (
                    <span className="ml-1.5 inline-flex items-center gap-1 align-middle italic text-slate-400">
                      <BankBadge name={r.account} size="sm" />
                      {r.account}
                    </span>
                  )}
                  {r.onToggle && (
                    <span className="group/sal relative ml-1.5 inline-block align-middle">
                      <button
                        type="button"
                        onClick={r.onToggle}
                        className={`text-xs ${r.struck ? "text-brand-600" : "text-slate-300 hover:text-brand-600"}`}
                      >
                        {r.struck ? "✅" : "💰"}
                      </button>
                      <span className="pointer-events-none invisible absolute left-1/2 top-full z-30 mt-1 w-52 max-w-[70vw] -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-2 text-2xs font-normal normal-case text-slate-700 shadow-lg group-hover/sal:visible dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                        {r.struck
                          ? "Salaire déjà reçu : il n'est pas compté dans le total (il est déjà inclus dans le solde actuel). Clique pour le recompter."
                          : "Clique si le salaire est déjà tombé : la ligne sera barrée et non comptée, pour éviter de le compter deux fois avec le solde actuel."}
                      </span>
                    </span>
                  )}
                </td>
                <td className="text-right">
                  <span className="inline-flex items-center justify-end gap-1.5">
                    <span
                      className={`tabular-nums ${r.strong ? "font-bold" : "font-medium"} ${
                        r.struck
                          ? "text-slate-400 line-through"
                          : r.kind === "in"
                            ? "text-green-600"
                            : r.kind === "out"
                              ? "text-red-600"
                              : ""
                      }`}
                    >
                      {r.kind === "in" ? "+" : r.kind === "out" ? "−" : ""}
                      {eur(r.amount)}
                    </span>
                    {/* Emplacement fixe pour la flèche → montants alignés même sans détail */}
                    <span className="w-3 shrink-0 text-center">
                      {r.details && r.details.length > 0 && (
                        <button
                          type="button"
                          onClick={() => toggleRow(`${member}-${i}`)}
                          className="text-slate-400 hover:text-brand-600"
                          aria-label="Déplier le détail"
                        >
                          {openRows[`${member}-${i}`] ? "▾" : "▸"}
                        </button>
                      )}
                    </span>
                  </span>
                </td>
              </tr>
              {r.details &&
                r.details.length > 0 &&
                openRows[`${member}-${i}`] &&
                r.details.map((d, j) => (
                  <tr key={`${i}-d-${j}`} className="text-xs text-slate-500 dark:text-slate-400">
                    <td className="truncate py-0.5 pl-5">↳ {d.label}</td>
                    <td className="py-0.5 text-right">
                      <span className="inline-flex items-center justify-end gap-1.5">
                        <span className="tabular-nums">
                          {r.kind === "in" ? "+" : r.kind === "out" ? "−" : ""}
                          {eur(d.amount)}
                        </span>
                        <span className="w-3 shrink-0" />
                      </span>
                    </td>
                  </tr>
                ))}
              </Fragment>
            ),
          )}
        </tbody>
      </table>
    </div>
  );

  const AdjInput = ({
    label,
    cents,
    onChange,
    onReset,
    overridden,
  }: {
    label: ReactNode;
    cents: number;
    onChange: (c: number | null) => void;
    onReset: () => void;
    overridden: boolean;
  }) => (
    <label className="text-xs text-slate-400">
      <span className="flex items-center justify-between gap-1">
        <span className="flex min-w-0 items-center gap-1.5 truncate">{label}</span>
        <button
          type="button"
          onClick={onReset}
          title="Réinitialiser depuis la base"
          className={`text-sm ${overridden ? "text-brand-600 hover:text-brand-700" : "text-slate-300 hover:text-slate-500"}`}
        >
          ↻
        </button>
      </span>
      <input
        type="number"
        step="0.01"
        value={cents / 100}
        onChange={(e) => onChange(e.target.value === "" ? null : eurToCents(Number(e.target.value)))}
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
    </label>
  );

  const detailLines = rowsA.length + rowsB.length;
  type Plan = ReturnType<typeof planOf>;

  /** Les virements d'un membre, cochables. Les deux blocs partagent ce rendu. */
  const TransferList = ({ plan }: { plan: Plan }) =>
    plan.list.length === 0 ? (
      <p className="text-sm text-slate-400">Aucun virement à faire ce mois-ci.</p>
    ) : (
      <div className="pt-1">
        {plan.list.map((t, i) => {
          const done = doneBy.get(t.key);
          return (
            <div
              key={t.key}
              className={`flex min-h-[60px] items-center gap-3 ${
                i === plan.list.length - 1 ? "" : "border-b border-hairline"
              }`}
            >
              <Checkbox
                size="lg"
                checked={!!done}
                onChange={() => setChecks.mutate({ keys: [t.key], done: !done })}
              />
              <span className="min-w-0 flex-1 py-2">
                <span
                  className={`block truncate text-base font-semibold ${
                    done ? "text-slate-400 line-through" : ""
                  }`}
                >
                  Vers {t.to}
                </span>
                {/* Pas de `truncate` : « depuis X · pourquoi » doit se lire
                    en entier, quitte à passer sur deux lignes. */}
                <span className="block text-xs text-slate-400">
                  {done ? `fait le ${dayFr(done.doneAt)}` : `depuis ${plan.from} · ${t.why}`}
                </span>
              </span>
              <span
                className={`shrink-0 text-base font-semibold tabular-nums ${
                  done ? "text-slate-400" : ""
                }`}
              >
                {eur(t.amount)}
              </span>
            </div>
          );
        })}
      </div>
    );

  /** Ce que les virements laissent : solde, engagé, reste à vivre. */
  const Summary = ({ plan }: { plan: Plan }) => (
    <>
      <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
        <span className="min-w-0">Solde {plan.from} après virements</span>
        <span className="shrink-0 font-semibold tabular-nums">{eur(plan.after)}</span>
      </div>
      <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
        <span>Dépenses engagées</span>
        <span
          className={`shrink-0 font-semibold tabular-nums ${plan.engaged > 0 ? "text-danger" : ""}`}
        >
          {plan.engaged > 0 ? "−" : ""}
          {eur(plan.engaged)}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-3 border-t border-hairline pt-3">
        <span className="text-base font-semibold">Reste à vivre</span>
        <span
          className={`shrink-0 text-xl font-bold tabular-nums ${
            plan.living < 0 ? "text-danger" : "text-brand-600"
          }`}
        >
          {eur(plan.living)}
        </span>
      </div>
    </>
  );

  const Progress = ({ plan }: { plan: Plan }) =>
    plan.list.length === 0 ? null : (
      <div className="shrink-0 text-right">
        <div className="text-xs text-slate-400">
          {plan.list.length - plan.remaining.length} sur {plan.list.length} fait
        </div>
        <span className="mt-1.5 block h-1.5 w-20 overflow-hidden rounded-full bg-surface-2">
          <span
            className="block h-full rounded-full bg-brand-600"
            style={{
              width: `${Math.round(((plan.list.length - plan.remaining.length) / plan.list.length) * 100)}%`,
            }}
          />
        </span>
      </div>
    );

  return (
    <div className="flex flex-col gap-4 pb-28 md:pb-0">
      <MonthStepper
        label={`Début ${targetLabel}`}
        onPrev={() => setMonthOffset((o) => o - 1)}
        onNext={() => setMonthOffset((o) => o + 1)}
      />

      {/* La to-do : ce qu'il reste à virer, une ligne par virement. */}
      <div className="card">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm text-ink-2">Reste à virer</div>
            <div className="mt-1 text-3xl font-bold tabular-nums">{eur(myPlan.toVire)}</div>
          </div>
          <Progress plan={myPlan} />
        </div>
        <div className="mt-3 border-t border-hairline pt-1">
          <TransferList plan={myPlan} />
        </div>
      </div>

      {/* Ce que les virements laissent : le solde, ce qui est déjà engagé, le reste. */}
      <div className="card">
        <Summary plan={myPlan} />
      </div>

      {/* Le mois de l'autre membre, à la même échelle : c'est en lisant les deux
          côte à côte qu'on vérifie que les parts tombent juste. */}
      <div className="eyebrow mt-1">Virements de {members[otherMember].name}</div>
      <div className="card">
        <div className="flex items-center gap-3">
          <MemberAvatar id={otherMember} className="h-9 w-9 text-sm" />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-slate-400">Reste à virer</div>
            <div className="text-xl font-bold tabular-nums">{eur(theirPlan.toVire)}</div>
          </div>
          <Progress plan={theirPlan} />
        </div>
        <div className="mt-3 border-t border-hairline pt-1">
          <TransferList plan={theirPlan} />
        </div>
        <div className="mt-3 border-t border-hairline pt-2">
          <Summary plan={theirPlan} />
        </div>
      </div>

      {/* Le calcul complet, replié : on ne le consulte que pour vérifier. */}
      <div className="card">
        <button
          type="button"
          onClick={() => setDetailOpen((o) => !o)}
          aria-expanded={detailOpen}
          className="flex w-full items-center gap-3 text-left"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-2">
            <IconTrend size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold">Détail du calcul</span>
            <span className="block text-xs text-slate-400">
              salaires, dépenses, équilibrage · {detailLines} lignes
            </span>
          </span>
          <IconChevronDown
            size={20}
            className={`shrink-0 text-slate-400 transition-transform ${detailOpen ? "" : "-rotate-90"}`}
          />
        </button>
      </div>

      {detailOpen && (
      <div className="flex flex-col gap-3">
      <div className="card">
        <div className="mb-2 text-xs text-slate-400">
          Ajustements de ce mois (n'affectent que les tableaux ci-dessous)
        </div>
        <div className="grid grid-cols-3 gap-3">
          {AdjInput({
            label: (
              <>
                <MemberAvatar id="a" className="h-4 w-4 text-2xs" /> Salaire {members.a.name}
              </>
            ),
            cents: jSalaire,
            onChange: setSalJOv,
            onReset: resetFrom(setSalJOv, "recurring"),
            overridden: salJOv !== null,
          })}
          {AdjInput({
            label: (
              <>
                <MemberAvatar id="b" className="h-4 w-4 text-2xs" /> Salaire {members.b.name}
              </>
            ),
            cents: nSalaire,
            onChange: setSalNOv,
            onReset: resetFrom(setSalNOv, "recurring"),
            overridden: salNOv !== null,
          })}
          {AdjInput({
            label: (
              <>
                Équilibrage (<MemberAvatar id="b" className="h-4 w-4 text-2xs" /> →{" "}
                <MemberAvatar id="a" className="h-4 w-4 text-2xs" />)
              </>
            ),
            cents: equilAmount,
            onChange: setEquilOv,
            onReset: resetFrom(setEquilOv, "balance"),
            overridden: equilOv !== null,
          })}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {Ledger({ member: "a", rows: rowsA })}
        {Ledger({ member: "b", rows: rowsB })}
      </div>
      </div>
      )}

      {remaining.length > 0 && (
        <MobileActionBar
          label="Tout marquer comme viré"
          icon={<IconCheck size={20} />}
          onClick={() => setChecks.mutate({ keys: remaining.map((t) => t.key), done: true })}
        />
      )}
    </div>
  );
}

/* ---------------- Dépenses prévues ---------------- */

/**
 * Dépenses prévues : ce qu'on anticipe d'acheter. Deux vues — « À venir » (le
 * total qu'il faudra sortir) et « Achetées » (ce qui est passé).
 */
function Prevue({ view }: { view?: string }) {
  const navigate = useNavigate();
  const sub: "prevue" | "achete" = view === "achete" ? "achete" : "prevue";
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ item: PlannedExpense | null } | null>(null);
  const me = useMe();
  const members = me.household.members;

  const { data } = useQuery({
    queryKey: ["planned"],
    queryFn: () => api.get<PlannedExpense[]>("/api/planned"),
  });
  // Épargne disponible : les comptes de type « épargne » du foyer. C'est là
  // qu'on va chercher de quoi payer ce qui est anticipé.
  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<Account[]>("/api/accounts"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["planned"] });
    qc.invalidateQueries({ queryKey: ["cashflow"] });
    qc.invalidateQueries({ queryKey: ["money-summary"] });
  };
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/planned/${id}`),
    onSuccess: invalidate,
  });
  // Bascule prévue ↔ achetée : acheter = daté d'aujourd'hui (modifiable ensuite).
  const setPurchased = useMutation({
    mutationFn: (p: { id: string; purchasedAt: string | null }) =>
      api.patch(`/api/planned/${p.id}`, { purchasedAt: p.purchasedAt }),
    onSuccess: invalidate,
  });

  usePageTabs(sub, [
    { value: "prevue", label: "À venir" },
    { value: "achete", label: "Achetées" },
  ], (v) => navigate(v === "achete" ? "/money/prevue/achete" : "/money/prevue"));

  if (!data) return <PageLoader variant="argent" />;

  const pending = data
    .filter((p) => !p.purchasedAt)
    .sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
  const bought = data
    .filter((p) => p.purchasedAt)
    .sort((a, b) => (b.purchasedAt ?? "").localeCompare(a.purchasedAt ?? ""));

  const month = new Date().toISOString().slice(0, 7);
  const datedThisMonth = pending.filter((p) => p.date?.startsWith(month));
  const dated = pending.filter((p) => p.date);
  const undated = pending.filter((p) => !p.date);
  const sum = (rows: PlannedExpense[]) => rows.reduce((s, p) => s + p.amount, 0);
  const savings = (accounts ?? [])
    .filter((a) => a.type === "savings")
    .reduce((s, a) => s + a.currentBalance, 0);
  // Achats faits sur le trimestre en cours : le lien vers l'onglet « Achetées ».
  const quarterStart = new Date();
  quarterStart.setMonth(Math.floor(quarterStart.getMonth() / 3) * 3, 1);
  const boughtThisQuarter = bought.filter(
    (p) => p.purchasedAt && p.purchasedAt >= quarterStart.toISOString().slice(0, 10),
  );

  const ownerLabel = (owner: string) =>
    owner === "joint" ? "Commun" : (members[owner as "a" | "b"]?.name ?? owner);

  const row = (p: PlannedExpense, last: boolean, purchased: boolean) => (
    <div key={p.id} className={last ? "" : "border-b border-hairline"}>
      <div className="flex min-h-[56px] items-center gap-3">
        <Checkbox
          size="lg"
          checked={purchased}
          onChange={() =>
            setPurchased.mutate({ id: p.id, purchasedAt: purchased ? null : todayIso() })
          }
        />
        <button
          type="button"
          onClick={() => setModal({ item: p })}
          className="min-w-0 flex-1 py-2 text-left"
        >
          <span
            className={`block text-base font-semibold leading-snug ${
              purchased ? "text-slate-400 line-through" : ""
            }`}
          >
            {p.name}
          </span>
          <span className="block text-xs text-slate-400">
            {[
              purchased ? `acheté le ${dateFrShort(p.purchasedAt!)}` : p.date ? dateFrShort(p.date) : null,
              ownerLabel(p.owner),
              p.description || null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </button>
        <span
          className={`shrink-0 text-base font-semibold tabular-nums ${
            purchased ? "text-slate-400" : ""
          }`}
        >
          {eur0(p.amount)}
        </span>
        <OverflowMenu
          label={`Actions sur ${p.name}`}
          items={[
            { label: "Modifier", onClick: () => setModal({ item: p }) },
            {
              label: "Supprimer",
              danger: true,
              onClick: () => {
                if (confirm(`Supprimer « ${p.name} » ?`)) remove.mutate(p.id);
              },
            },
          ]}
        />
      </div>
    </div>
  );

  const section = (title: string, hint: string | null, rows: PlannedExpense[], purchased: boolean) =>
    rows.length === 0 ? null : (
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="eyebrow">
            {title} · {rows.length}
          </span>
          {hint && <span className="text-xs text-slate-400">{hint}</span>}
        </div>
        <div className="card">{rows.map((p, i) => row(p, i === rows.length - 1, purchased))}</div>
      </div>
    );

  return (
    <div className="flex flex-col gap-3 pb-28 md:pb-0">
      <SubNav
        value={sub}
        onChange={(v) => navigate(v === "achete" ? "/money/prevue/achete" : "/money/prevue")}
        items={[
          { value: "prevue", label: "À venir" },
          { value: "achete", label: "Achetées" },
        ]}
        className="hidden md:block"
      />

      {sub === "prevue" ? (
        <>
          {/* Ce que ça va coûter, et avec quoi on compte le payer. */}
          <div className="card">
            <div className="text-sm text-ink-2">
              Total anticipé · {pending.length} achat{pending.length > 1 ? "s" : ""}
            </div>
            <div className="mt-1 text-3xl font-bold tabular-nums">{eur(sum(pending))}</div>
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-hairline pt-3">
              <div>
                <div className="text-xs text-slate-400">Daté ce mois</div>
                <div className="mt-0.5 font-semibold tabular-nums">
                  {eur0(sum(datedThisMonth))}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Sans date</div>
                <div className="mt-0.5 font-semibold tabular-nums">{eur0(sum(undated))}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Épargne dispo</div>
                <div
                  className={`mt-0.5 font-semibold tabular-nums ${
                    savings >= sum(pending) ? "text-brand-600" : "text-warning"
                  }`}
                >
                  {eur0(savings)}
                </div>
              </div>
            </div>
          </div>

          {pending.length === 0 ? (
            <div className="card flex flex-col items-start gap-3 text-sm text-slate-400">
              <p>Rien d'anticipé pour l'instant.</p>
              <button type="button" onClick={() => setModal({ item: null })} className="btn-primary">
                Prévoir le premier achat
              </button>
            </div>
          ) : (
            <>
              {section("Daté", null, dated, false)}
              {section("Sans date", "coche quand c'est acheté", undated, false)}
            </>
          )}

          {boughtThisQuarter.length > 0 && (
            <button
              type="button"
              onClick={() => navigate("/money/prevue/achete")}
              className="card flex items-center gap-3 text-left"
            >
              <IconCheck size={20} className="shrink-0 text-brand-600" />
              <span className="flex-1 text-sm">
                {boughtThisQuarter.length} achat{boughtThisQuarter.length > 1 ? "s" : ""} fait
                {boughtThisQuarter.length > 1 ? "s" : ""} ce trimestre
              </span>
              <IconChevronRight size={20} className="shrink-0 text-slate-400" />
            </button>
          )}
        </>
      ) : bought.length === 0 ? (
        <div className="card text-sm text-slate-400">Aucune dépense achetée.</div>
      ) : (
        <div className="card">{bought.map((p, i) => row(p, i === bought.length - 1, true))}</div>
      )}

      {sub === "prevue" && (
        <>
          <MobileActionBar label="Prévoir un achat" onClick={() => setModal({ item: null })} />
          <div className="hidden justify-end md:flex">
            <button type="button" onClick={() => setModal({ item: null })} className="btn-primary">
              + Prévoir un achat
            </button>
          </div>
        </>
      )}

      {modal && (
        <PrevueModal
          key={modal.item?.id ?? "new"}
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

function PrevueModal({
  item,
  onClose,
  onSaved,
}: {
  item: PlannedExpense | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!item;
  // La dépense éditée est-elle déjà achetée ? Le champ « Acheté le » n'apparaît que dans ce cas.
  const isPurchased = !!item?.purchasedAt;
  const [form, setForm] = useState({
    name: item?.name ?? "",
    description: item?.description ?? "",
    amount: item ? item.amount / 100 : 0,
    date: item?.date ?? "",
    owner: (item?.owner ?? "joint") as "a" | "b" | "joint",
    purchasedAt: item?.purchasedAt ?? "",
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name,
        description: form.description || null,
        amount: eurToCents(form.amount),
        date: form.date || null,
        owner: form.owner,
        ...(isPurchased && { purchasedAt: form.purchasedAt || null }),
      };
      return isEdit ? api.patch(`/api/planned/${item!.id}`, payload) : api.post("/api/planned", payload);
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
          <h2 className="text-lg font-bold">{isEdit ? "Modifier la dépense prévue" : "Nouvelle dépense prévue"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (form.name && form.amount > 0) save.mutate();
          }}
          className="space-y-3"
        >
          <Input
            autoFocus
            placeholder="Nom (ex. Vacances été)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            placeholder="Description (optionnel)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-400">
              Montant (€)
              <Input
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
              />
            </label>
            <div className="text-xs text-slate-400">
              Date (optionnel)
              <DateInput value={form.date} onChange={(d) => setForm({ ...form, date: d })} placeholder="Aucune" />
            </div>
          </div>
          {isPurchased && (
            <div className="text-xs text-slate-400">
              Acheté le (vider pour remettre en prévue)
              <DateInput
                value={form.purchasedAt}
                onChange={(d) => setForm({ ...form, purchasedAt: d })}
                placeholder="Aucune"
              />
            </div>
          )}
          <div className="text-xs text-slate-400">
            Pour qui ?
            <div className="mt-1">
              <OwnerPicker value={form.owner} onChange={(v) => setForm({ ...form, owner: v })} />
            </div>
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

/* ---------------- Électricité ---------------- */

/**
 * Deux vues, deux questions. « Cette année » répond à la seule chose qu'on
 * vient vérifier (est-ce qu'on consomme plus ou moins que l'an dernier ?) ;
 * « Années » sert à fouiller l'historique.
 */
const ELEC_VIEWS = ["annee", "annees"] as const;

/** « janvier » — nom long du mois, pour les phrases. */
const monthLongFr = (m: number) =>
  new Date(2000, m - 1, 1).toLocaleDateString("fr-FR", { month: "long" });

/** Première lettre en capitale — un nom de mois en tête de phrase ou de ligne. */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** « juin, juillet et août » */
const listFr = (parts: string[]) =>
  parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} et ${parts[parts.length - 1]}`;

/** « 2 783 » — séparateur de milliers français. */
const kwhFr = (v: number) => v.toLocaleString("fr-FR");

/** Variation en % ; null quand il n'y a rien à comparer. */
const pctChange = (now: number, before: number) =>
  before > 0 ? Math.round(((now - before) / before) * 100) : null;

const MONTH_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/**
 * Ce que la page sait lire dans les relevés. Passé aux blocs plutôt que
 * recalculé par chacun : tout l'écran répond des mêmes chiffres.
 */
interface ElecCalc {
  /** Triés du plus récent au plus ancien. */
  readings: UtilityReading[];
  /** Prix TTC du kWh en euros ; null = le foyer n'a pas saisi de tarif. */
  price: number | null;
  kwhOf: (year: number, month: number) => number | undefined;
  totalOf: (year: number) => number;
  /** Coût estimé d'une consommation, en centimes ; null sans tarif. */
  costOf: (kwh: number) => number | null;
  /** Mois écoulés d'une année qui n'ont pas de relevé. */
  missingOf: (year: number) => number[];
}

/**
 * Pastille de variation. Ici la couleur porte une **donnée** — consommer moins
 * est une bonne nouvelle — et non une action : vert quand ça baisse, rouge
 * quand ça monte.
 */
function DeltaPill({ pct }: { pct: number }) {
  const base =
    "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold";
  if (pct === 0) return <span className={`${base} bg-surface-2 text-ink-2`}>stable</span>;
  const down = pct < 0;
  return (
    <span className={`${base} ${down ? "bg-brand-50 text-brand-700" : "bg-danger-soft text-danger"}`}>
      {down ? "↓" : "↑"} {down ? "−" : "+"}
      {Math.abs(pct)} %
    </span>
  );
}

/** Chiffre secondaire de la carte d'en-tête ; cliquable quand il se règle. */
function MiniStat({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  /** `danger` = de l'argent qui sort. Le vert, lui, dit « réglable au doigt ». */
  tone?: "danger";
  onClick?: () => void;
}) {
  const color = tone === "danger" ? "text-danger" : onClick ? "text-brand-600" : "";
  const body = (
    <>
      <div className="truncate text-xs text-slate-400">{label}</div>
      <div className={`mt-0.5 truncate text-sm font-semibold ${color}`}>{value}</div>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="min-w-0 flex-1 text-left">
      {body}
    </button>
  ) : (
    <div className="min-w-0 flex-1">{body}</div>
  );
}

/**
 * La réponse de la page : combien on a consommé cette année, et si c'est plus
 * ou moins que l'an dernier. Remplace le tableau de 72 cases qu'il fallait
 * déchiffrer pour arriver à la même conclusion.
 */
function ElecHero({
  calc,
  year,
  onEditPrice,
}: {
  calc: ElecCalc;
  year: number;
  onEditPrice: () => void;
}) {
  const total = calc.totalOf(year);
  // Comparaison à périmètre égal : seulement les mois relevés **dans les deux**
  // années, sinon « −16 % » mettrait 5 mois en face de 12.
  const common = MONTH_NUMBERS.filter(
    (m) => calc.kwhOf(year, m) !== undefined && calc.kwhOf(year - 1, m) !== undefined,
  );
  const mine = common.reduce((s, m) => s + (calc.kwhOf(year, m) ?? 0), 0);
  const theirs = common.reduce((s, m) => s + (calc.kwhOf(year - 1, m) ?? 0), 0);
  const pct = common.length ? pctChange(mine, theirs) : null;
  const last = calc.readings.find((r) => r.year === year);
  const lastCost = last ? calc.costOf(last.kwh) : null;

  return (
    <div className="card">
      <div className="text-sm text-ink-2">
        {year === new Date().getFullYear() ? "Consommé depuis janvier" : `Consommé en ${year}`}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-3xl font-bold">{kwhFr(total)}</span>
        <span className="text-base text-ink-2">kWh</span>
      </div>
      {pct !== null && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
          <DeltaPill pct={pct} />
          <span className="text-xs text-slate-400">
            vs {kwhFr(theirs)} kWh en {year - 1}{" "}
            {mine === total ? "à la même date" : `sur ${common.length} mois comparables`}
          </span>
        </div>
      )}
      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-hairline pt-3">
        <MiniStat label="Dernier relevé" value={last ? `${kwhFr(last.kwh)} kWh` : "—"} />
        <MiniStat label="Mois" value={last ? `${MONTHS[last.month - 1]} ${last.year}` : "—"} />
        <MiniStat
          label="Coût estimé"
          value={lastCost !== null ? eur0(lastCost) : "Prix du kWh"}
          onClick={onEditPrice}
        />
      </div>
    </div>
  );
}

/**
 * Un « — » dans une grille ne dit pas si le mois s'est passé sans électricité
 * ou sans relevé. On le dit donc en toutes lettres, une fois.
 */
function MissingCard({ year, missing }: { year: number; missing: number[] }) {
  if (missing.length === 0) return null;
  const many = missing.length > 1;
  return (
    <div className="flex gap-3 rounded-2xl border border-warning/40 bg-warning-soft p-4">
      <IconAlert size={20} className="mt-0.5 shrink-0 text-warning" />
      <div className="min-w-0">
        <div className="text-sm font-semibold text-warning">
          {missing.length} relevé{many ? "s" : ""} manquant{many ? "s" : ""}
        </div>
        <div className="mt-0.5 text-xs text-ink-2">
          {cap(listFr(missing.map(monthLongFr)))} {year} n'{many ? "ont" : "a"} pas été saisi
          {many ? "s" : ""}.
        </div>
      </div>
    </div>
  );
}

/** Une barre. Un mois non saisi n'est pas « zéro » : il garde un trait bas. */
function MonthBar({
  value,
  max,
  tone,
  title,
}: {
  value?: number;
  max: number;
  tone: "brand" | "muted";
  title: string;
}) {
  const missing = value === undefined;
  return (
    <span
      title={missing ? `${title} — non saisi` : `${title} · ${kwhFr(value)} kWh`}
      className={`w-1/2 rounded-t-[3px] ${
        missing ? "bg-line" : tone === "brand" ? "bg-brand-600" : "bg-ink-3"
      }`}
      style={{ height: missing ? 2 : `${Math.max(3, ((value ?? 0) / max) * 100)}%` }}
    />
  );
}

/**
 * Deux séries et pas six : cette année contre l'an dernier. Comparer 2021 à
 * 2026 n'a aucun usage, et six couleurs sans légende ne se lisent pas.
 */
function MonthlyBars({ calc, year }: { calc: ElecCalc; year: number }) {
  const values = MONTH_NUMBERS.flatMap((m) => [calc.kwhOf(year, m), calc.kwhOf(year - 1, m)]).filter(
    (v): v is number => v !== undefined,
  );
  const max = Math.max(1, ...values);
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3">
        <div className="eyebrow">Mois par mois</div>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-brand-600" aria-hidden />
            {year}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-ink-3" aria-hidden />
            {year - 1}
          </span>
        </div>
      </div>
      <div className="mt-4 flex items-end gap-1">
        {MONTH_NUMBERS.map((m) => (
          <div key={m} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <div className="flex h-28 w-full items-end justify-center gap-[2px]">
              <MonthBar
                value={calc.kwhOf(year, m)}
                max={max}
                tone="brand"
                title={`${cap(monthLongFr(m))} ${year}`}
              />
              <MonthBar
                value={calc.kwhOf(year - 1, m)}
                max={max}
                tone="muted"
                title={`${cap(monthLongFr(m))} ${year - 1}`}
              />
            </div>
            <span className="text-2xs text-slate-400">{MONTHS[m - 1].charAt(0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Les relevés d'une année, du plus récent au plus ancien. */
function ReadingsCard({
  calc,
  year,
  onPick,
  onAdd,
}: {
  calc: ElecCalc;
  year: number;
  onPick: (r: UtilityReading) => void;
  onAdd: () => void;
}) {
  const rows = calc.readings.filter((r) => r.year === year);
  return (
    <div className="flex flex-col gap-2">
      <div className="eyebrow">Relevés {year}</div>
      {rows.length === 0 ? (
        <div className="card">
          <div className="text-sm text-ink-2">Aucun relevé saisi pour {year}.</div>
          <button type="button" onClick={onAdd} className="btn-primary mt-3">
            Ajouter le premier
          </button>
        </div>
      ) : (
        <div className="card">
          {rows.map((r, i) => {
            const before = calc.kwhOf(r.year - 1, r.month);
            const pct = before === undefined ? null : pctChange(r.kwh, before);
            return (
              <div key={r.id} className={i === rows.length - 1 ? "" : "border-b border-hairline"}>
                <button
                  type="button"
                  onClick={() => onPick(r)}
                  className="flex min-h-[56px] w-full items-center gap-3 text-left"
                >
                  <span className="min-w-0 flex-1 truncate text-base font-medium">
                    {cap(monthLongFr(r.month))}
                  </span>
                  <span className="shrink-0 text-base font-semibold">{kwhFr(r.kwh)} kWh</span>
                  {pct !== null && <DeltaPill pct={pct} />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Cinq totaux en barres : cinq nombres alignés en colonne demandaient de faire
 * la soustraction soi-même.
 */
function YearTotals({
  calc,
  years,
  current,
  onPick,
}: {
  calc: ElecCalc;
  years: number[];
  current: number;
  onPick: (year: number) => void;
}) {
  const max = Math.max(1, ...years.map(calc.totalOf));
  const thisYear = new Date().getFullYear();
  return (
    <div className="flex flex-col gap-2">
      <div className="eyebrow">Total par année</div>
      <div className="card flex flex-col gap-1">
        {years.map((y) => {
          const total = calc.totalOf(y);
          return (
            <button
              key={y}
              type="button"
              onClick={() => onPick(y)}
              className="flex min-h-tap items-center gap-3 text-left"
            >
              <span className="w-9 shrink-0 text-sm font-medium">{y}</span>
              <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
                <span
                  className={`block h-full rounded-full ${y === current ? "bg-brand-600" : "bg-ink-3"}`}
                  style={{ width: `${(total / max) * 100}%` }}
                />
              </span>
              {y === thisYear && <span className="shrink-0 text-xs text-slate-400">en cours</span>}
              <span className="w-14 shrink-0 text-right text-sm font-semibold">{kwhFr(total)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Saisie d'un relevé — une feuille appelée par un bouton, plus le formulaire
 * planté en bas de page en permanence pour une saisie mensuelle.
 */
function ReadingModal({
  reading,
  readings,
  onClose,
  onSaved,
}: {
  /** null = création : le mois écoulé le plus récent encore vide est proposé. */
  reading: UtilityReading | null;
  readings: UtilityReading[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(() => {
    if (reading) return { year: reading.year, month: reading.month, kwh: String(reading.kwh) };
    const now = new Date();
    const past = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 1 - i, 1);
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    });
    const free =
      past.find((p) => !readings.some((r) => r.year === p.year && r.month === p.month)) ?? past[0];
    return { year: free.year, month: free.month, kwh: "" };
  });

  // Un mois ne porte qu'un relevé : le dire avant d'écraser celui d'en face.
  const clash = readings.find(
    (r) => r.year === form.year && r.month === form.month && r.id !== reading?.id,
  );
  const kwh = Number(form.kwh);
  const valid = form.kwh.trim() !== "" && Number.isFinite(kwh) && kwh >= 0;

  const save = useMutation({
    mutationFn: () =>
      api.post("/api/utilities", {
        utility: "electricity",
        year: form.year,
        month: form.month,
        kwh: Math.round(kwh),
      }),
    onSuccess: onSaved,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {reading ? "Modifier le relevé" : "Ajouter un relevé"}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
          className="space-y-3"
        >
          {/* `flex flex-col gap-1` et non un `<label>` qui enveloppe le champ :
              un input est `inline-block`, il retombe alors dans une ligne de
              texte et se décale de la ligne de base — les deux colonnes ne
              s'alignent plus. */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1 text-xs text-slate-400">
              Mois
              <Select
                value={String(form.month)}
                onChange={(v) => setForm({ ...form, month: Number(v) })}
                options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
              />
            </div>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Année
              <Input
                type="number"
                inputMode="numeric"
                value={form.year}
                onChange={(e) => setForm({ ...form, year: Number(e.target.value) })}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Consommation (kWh)
            <Input
              autoFocus
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="ex. 227"
              value={form.kwh}
              onChange={(e) => setForm({ ...form, kwh: e.target.value })}
            />
          </label>
          {clash && (
            <div className="text-xs text-warning">
              {cap(monthLongFr(clash.month))} {clash.year} a déjà un relevé de {kwhFr(clash.kwh)} kWh
              : il sera remplacé.
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost">
              Annuler
            </button>
            <button className="btn-primary disabled:opacity-40" disabled={!valid || save.isPending}>
              {save.isPending ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Tarif du foyer : ce qui transforme des kWh en euros sur la page. */
function PriceModal({
  price,
  onClose,
  onSaved,
}: {
  price: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(price === null ? "" : String(price));
  const parsed = value.trim() === "" ? null : Number(value.replace(",", "."));
  const valid = parsed === null || (Number.isFinite(parsed) && parsed >= 0 && parsed <= 10);

  const save = useMutation({
    mutationFn: () => api.patch("/api/utilities/price", { pricePerKwh: parsed }),
    onSuccess: onSaved,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Prix du kWh</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
          className="space-y-3"
        >
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Prix TTC du kWh (€)
            <Input
              autoFocus
              type="text"
              inputMode="decimal"
              placeholder="ex. 0,2516"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <div className="text-xs text-slate-400">
            Sert à estimer le coût d'un relevé. Laisser vide pour ne pas afficher de coût.
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost">
              Annuler
            </button>
            <button className="btn-primary disabled:opacity-40" disabled={!valid || save.isPending}>
              {save.isPending ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Electricite({
  view,
  priceOpen,
  onPriceOpen,
}: {
  view?: string;
  /** Ouvert depuis le « ⋯ » de la barre, déclaré par le shell de la section. */
  priceOpen: boolean;
  onPriceOpen: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({
    queryKey: ["utilities"],
    queryFn: () => api.get<UtilityData>("/api/utilities?utility=electricity"),
  });

  const sub = useLastView("money:elec", ELEC_VIEWS, "annee", view, "/money/elec");
  const items = [
    { value: "annee", label: "Cette année" },
    { value: "annees", label: "Années" },
  ];
  const go = (v: string) => navigate(`/money/elec/${v}`);
  usePageTabs(sub, items, go);

  // Feuille d'actions d'un relevé, puis formulaire : `editing.reading` à null
  // = création. `open` est distinct pour garder le modal démonté au repos (son
  // état initial dépend des relevés déjà saisis).
  const [sheet, setSheet] = useState<UtilityReading | null>(null);
  const [editing, setEditing] = useState<{ open: boolean; reading: UtilityReading | null }>({
    open: false,
    reading: null,
  });
  const [histYear, setHistYear] = useState<number | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["utilities"] });
    qc.invalidateQueries({ queryKey: ["money-summary"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/utilities/${id}`),
    onSuccess: () => {
      invalidate();
      toast.success("Relevé supprimé");
    },
  });

  if (!data) return <PageLoader variant="argent" />;

  const readings = data.readings;
  const thisYear = new Date().getFullYear();
  const years = [...new Set(readings.map((r) => r.year))].sort((a, b) => b - a);

  const kwhOf = (year: number, month: number) =>
    readings.find((r) => r.year === year && r.month === month)?.kwh;
  const calc: ElecCalc = {
    readings,
    price: data.pricePerKwh,
    kwhOf,
    totalOf: (year) => readings.filter((r) => r.year === year).reduce((s, r) => s + r.kwh, 0),
    costOf: (kwh) => (data.pricePerKwh === null ? null : Math.round(kwh * data.pricePerKwh * 100)),
    // Un relevé n'est attendu qu'une fois le mois écoulé : le mois courant ne
    // compte donc jamais comme manquant.
    missingOf: (year) => {
      const until = year === thisYear ? new Date().getMonth() : 12;
      return MONTH_NUMBERS.slice(0, Math.max(0, until)).filter((m) => kwhOf(year, m) === undefined);
    },
  };

  // L'année de référence : celle en cours dès qu'elle porte un relevé, sinon la
  // dernière saisie (une instance neuve n'affiche pas une année vide).
  const refYear = readings.some((r) => r.year === thisYear) ? thisYear : (years[0] ?? thisYear);
  // L'historique s'ouvre sur l'année précédente : rejouer « Cette année » à
  // l'identique n'apprendrait rien.
  const pastYear = histYear ?? years.find((y) => y < refYear) ?? years[0] ?? refYear - 1;

  const openHistory = (year: number) => {
    setHistYear(year);
    go("annees");
  };
  const sheetCost = sheet ? calc.costOf(sheet.kwh) : null;

  return (
    <div className="flex flex-col gap-4 pb-28 md:pb-0">
      <div className="flex items-center justify-between gap-3">
        <SubNav value={sub} onChange={go} items={items} className="hidden md:block" />
        <button
          type="button"
          onClick={() => setEditing({ open: true, reading: null })}
          className="btn-primary ml-auto hidden md:inline-flex"
        >
          Ajouter un relevé
        </button>
      </div>

      {sub === "annee" ? (
        <>
          <ElecHero calc={calc} year={refYear} onEditPrice={() => onPriceOpen(true)} />
          <MissingCard year={refYear} missing={calc.missingOf(refYear)} />
          <MonthlyBars calc={calc} year={refYear} />
          <ReadingsCard
            calc={calc}
            year={refYear}
            onPick={setSheet}
            onAdd={() => setEditing({ open: true, reading: null })}
          />
          {years.length > 1 && (
            <YearTotals calc={calc} years={years} current={refYear} onPick={openHistory} />
          )}
        </>
      ) : (
        <>
          {years.length > 0 && (
            <FilterChips
              value={String(pastYear)}
              onChange={(v) => setHistYear(Number(v))}
              items={years.map((y) => ({ value: String(y), label: String(y) }))}
            />
          )}
          <ElecHero calc={calc} year={pastYear} onEditPrice={() => onPriceOpen(true)} />
          <MissingCard year={pastYear} missing={calc.missingOf(pastYear)} />
          <MonthlyBars calc={calc} year={pastYear} />
          <ReadingsCard
            calc={calc}
            year={pastYear}
            onPick={setSheet}
            onAdd={() => setEditing({ open: true, reading: null })}
          />
        </>
      )}

      <MobileActionBar
        label="Ajouter un relevé"
        onClick={() => setEditing({ open: true, reading: null })}
      />

      {sheet && (
        <ActionSheet
          title={`${cap(monthLongFr(sheet.month))} ${sheet.year}`}
          subtitle={`${kwhFr(sheet.kwh)} kWh${sheetCost !== null ? ` · ${eur0(sheetCost)}` : ""}`}
          items={[
            {
              label: "Modifier le relevé",
              onClick: () => setEditing({ open: true, reading: sheet }),
            },
            {
              label: "Supprimer le relevé",
              hint: "Le mois repassera en relevé manquant",
              danger: true,
              onClick: () => remove.mutate(sheet.id),
            },
          ]}
          onClose={() => setSheet(null)}
        />
      )}

      {editing.open && (
        <ReadingModal
          reading={editing.reading}
          readings={readings}
          onClose={() => setEditing({ open: false, reading: null })}
          onSaved={() => {
            setEditing({ open: false, reading: null });
            invalidate();
          }}
        />
      )}

      {priceOpen && (
        <PriceModal
          price={data.pricePerKwh}
          onClose={() => onPriceOpen(false)}
          onSaved={() => {
            onPriceOpen(false);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

/* ---------------- Équilibrage ---------------- */

function Equilibrage() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { view } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const members = me.household.members;
  // Nature des lignes affichées : avances (dépenses partagées) ou remboursements.
  const [nature, setNature] = useState<"tout" | "avances" | "remboursements">("tout");
  const statut: "actif" | "archive" = view === "archive" ? "archive" : "actif";
  const isArchived = statut === "archive";
  const [expModal, setExpModal] = useState<{ open: boolean; item: Transaction | null }>({
    open: false,
    item: null,
  });
  const [setModal, setSetModal] = useState<{ open: boolean; item: Settlement | null }>({
    open: false,
    item: null,
  });

  const { data: balance } = useQuery({
    queryKey: ["balance"],
    queryFn: () => api.get<Balance>("/api/balance"),
  });
  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<Account[]>("/api/accounts"),
  });
  const { data: transactions } = useQuery({
    queryKey: ["transactions", "all"],
    queryFn: () => api.get<Transaction[]>("/api/transactions"),
  });
  const { data: settlements } = useQuery({
    queryKey: ["settlements"],
    queryFn: () => api.get<Settlement[]>("/api/settlements"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["balance"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["settlements"] });
  };

  const settle = useMutation({
    mutationFn: (b: Balance) =>
      api.post("/api/settlements", {
        fromUser: b.fromUser,
        toUser: b.toUser,
        amount: b.amount,
        date: todayIso(),
        note: "Règlement du solde depuis l'app",
      }),
    onSuccess: invalidate,
  });
  const removeExpense = useMutation({
    mutationFn: (id: string) => api.del(`/api/transactions/${id}`),
    onSuccess: invalidate,
  });
  const removeSettlement = useMutation({
    mutationFn: (id: string) => api.del(`/api/settlements/${id}`),
    onSuccess: invalidate,
  });
  const archiveAll = useMutation({
    mutationFn: () => api.post("/api/equilibrage/archive-all", {}),
    onSuccess: invalidate,
  });
  const setTxArchived = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      api.patch(`/api/transactions/${id}`, { archived }),
    onSuccess: invalidate,
  });
  const setSettlementArchived = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      api.patch(`/api/settlements/${id}`, { archived }),
    onSuccess: invalidate,
  });

  // « Nouvelle dépense » depuis le sommaire de la section : l'onglet s'ouvre
  // avec sa modale. Le paramètre est retiré aussitôt, pour que le retour
  // arrière ne la rouvre pas.
  useEffect(() => {
    if (searchParams.get("nouvelle") !== "1") return;
    setExpModal({ open: true, item: null });
    const rest = new URLSearchParams(searchParams);
    rest.delete("nouvelle");
    setSearchParams(rest, { replace: true });
  }, [searchParams, setSearchParams]);

  if (!balance) return <PageLoader variant="argent" />;

  // Actif / archivé : ce qui compte encore dans le solde, ou ce qui est réglé.
  const txShown = (transactions ?? []).filter((t) => (isArchived ? t.archived : !t.archived));
  const setShown = (settlements ?? []).filter((s) => (isArchived ? s.archived : !s.archived));
  const activeCount =
    (transactions ?? []).filter((t) => !t.archived).length +
    (settlements ?? []).filter((s) => !s.archived).length;

  // Les deux natures de ligne dans un même fil chronologique : une avance
  // (quelqu'un a payé pour les deux) et un remboursement (on solde).
  type Line =
    | { kind: "avance"; id: string; date: string; label: string; amount: number; by: string; owed: number; owedTo: "a" | "b"; item: Transaction }
    | { kind: "remb"; id: string; date: string; amount: number; from: string; to: string; note: string | null; item: Settlement };
  const lines: Line[] = [
    ...txShown
      .filter((t) => t.amount < 0)
      .map<Line>((t) => ({
        kind: "avance",
        id: t.id,
        date: t.date,
        label: t.label,
        amount: Math.abs(t.amount),
        by: t.paidBy,
        // Ce que l'autre doit sur cette ligne : sa part.
        owed: Math.abs(t.paidBy === "a" ? t.shareB : t.shareA),
        owedTo: t.paidBy === "a" ? "a" : "b",
        item: t,
      })),
    ...setShown.map<Line>((st) => ({
      kind: "remb",
      id: st.id,
      date: st.date,
      amount: st.amount,
      from: st.fromUser,
      to: st.toUser,
      note: st.note,
      item: st,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const shown = lines.filter(
    (l) => nature === "tout" || (nature === "avances" ? l.kind === "avance" : l.kind === "remb"),
  );
  // Regroupement par mois : on relit ses comptes par période.
  const months: { key: string; label: string; rows: Line[] }[] = [];
  for (const l of shown) {
    const key = l.date.slice(0, 7);
    const last = months[months.length - 1];
    if (last?.key === key) last.rows.push(l);
    else months.push({ key, label: monthFr(key), rows: [l] });
  }

  const nAvances = lines.filter((l) => l.kind === "avance").length;
  const nRemb = lines.length - nAvances;

  /**
   * Bascule en tête de la modale de création : les deux natures de ligne se
   * saisissent depuis la même porte d'entrée. Sans elle, « Ajouter une ligne »
   * ne créait que des dépenses partagées et les remboursements étaient
   * inatteignables sur mobile.
   */
  const kindSwitcher = (current: "depense" | "remboursement") => (
    <PillToggle
      value={current}
      align="start"
      onChange={(v) => {
        if (v === current) return;
        if (v === "remboursement") {
          setExpModal({ open: false, item: null });
          setSetModal({ open: true, item: null });
        } else {
          setSetModal({ open: false, item: null });
          setExpModal({ open: true, item: null });
        }
      }}
      items={[
        { value: "depense", label: "Dépense partagée" },
        { value: "remboursement", label: "Remboursement" },
      ]}
    />
  );

  return (
    <div className="flex flex-col gap-3 pb-28 md:pb-0">
      <SubNav
        value={statut}
        onChange={(v) => navigate(`/money/equilibrage/${v}`)}
        items={[
          { value: "actif", label: "En cours" },
          { value: "archive", label: "Réglé" },
        ]}
        className="hidden md:block"
      />

      {/* Le solde : qui doit combien à qui, et de quoi c'est fait. */}
      {!isArchived && (
        <div className="card">
          <div className="text-sm text-ink-2">Solde entre vous</div>
          {balance.amount === 0 ? (
            <>
              <div className="mt-1 text-3xl font-bold">Tout est équilibré</div>
              <p className="mt-1 text-sm text-slate-400">
                Rien à se rendre — les avances se compensent.
              </p>
            </>
          ) : (
            <>
              <div className="mt-2 flex items-center gap-2">
                <MemberAvatar id={balance.fromUser} className="h-8 w-8 text-xs" />
                <IconArrowRight size={18} className="text-slate-400" />
                <MemberAvatar id={balance.toUser} className="h-8 w-8 text-xs" />
              </div>
              <div className="mt-2 text-3xl font-bold tabular-nums">{eur(balance.amount)}</div>
              <p className="mt-1 text-sm text-slate-400">
                {members[balance.fromUser].name} doit ce montant à {members[balance.toUser].name}
                {nAvances > 0 || nRemb > 0
                  ? ` · ${nAvances} avance${nAvances > 1 ? "s" : ""}, ${nRemb} remboursement${nRemb > 1 ? "s" : ""}`
                  : ""}
              </p>
              <button
                type="button"
                onClick={() => settle.mutate(balance)}
                disabled={settle.isPending}
                className="btn-primary mt-3 w-full"
              >
                Marquer comme réglé
              </button>
            </>
          )}
        </div>
      )}

      <FilterChips
        value={nature}
        onChange={(v) => setNature(v as "tout" | "avances" | "remboursements")}
        items={[
          { value: "tout", label: "Tout" },
          { value: "avances", label: "Avances" },
          { value: "remboursements", label: "Remboursements" },
        ]}
      />

      {shown.length === 0 ? (
        <div className="card flex flex-col items-start gap-3 text-sm text-slate-400">
          <p>{isArchived ? "Rien d'archivé." : "Aucune ligne en cours."}</p>
          {!isArchived && (
            <button
              type="button"
              onClick={() => setExpModal({ open: true, item: null })}
              className="btn-primary"
            >
              Ajouter la première
            </button>
          )}
        </div>
      ) : (
        months.map((m) => (
          <div key={m.key} className="flex flex-col gap-2">
            <div className="eyebrow">{m.label}</div>
            <div className="card">
              {m.rows.map((l, i) => (
                <div key={`${l.kind}-${l.id}`} className={i === m.rows.length - 1 ? "" : "border-b border-hairline"}>
                  <div className="flex min-h-[60px] items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                        l.kind === "remb" ? "bg-brand-600/20 text-brand-600" : "bg-surface-2 text-ink-2"
                      }`}
                    >
                      {l.kind === "remb" ? <IconArrowRight size={20} /> : <IconMoney size={20} />}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        l.kind === "avance"
                          ? setExpModal({ open: true, item: l.item })
                          : setSetModal({ open: true, item: l.item })
                      }
                      className="min-w-0 flex-1 py-2 text-left"
                    >
                      <span className="block text-base font-semibold leading-snug">
                        {l.kind === "avance"
                          ? l.label
                          : `Remboursement de ${members[l.from as "a" | "b"]?.name ?? l.from}`}
                      </span>
                      <span className="block text-xs text-slate-400">
                        {l.kind === "avance"
                          ? `${dateFrShort(l.date)} · avancé par ${members[l.by as "a" | "b"]?.name ?? l.by}`
                          : [dateFrShort(l.date), l.note].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                    <span className="shrink-0 text-right">
                      <span
                        className={`block text-base font-semibold tabular-nums ${
                          l.kind === "remb" ? "text-brand-600" : ""
                        }`}
                      >
                        {l.kind === "remb" ? "−" : ""}
                        {eur(l.amount)}
                      </span>
                      {/* L'initiale suffit : le prénom entier pousserait le
                          libellé de la ligne sur trois lignes. */}
                      {l.kind === "avance" && l.owed > 0 && (
                        <span className="block whitespace-nowrap text-xs text-slate-400">
                          +{eur0(l.owed)} pour{" "}
                          {members[(l.owedTo === "a" ? "b" : "a") as "a" | "b"].name.charAt(0)}
                        </span>
                      )}
                    </span>
                    <OverflowMenu
                      label="Actions sur la ligne"
                      items={[
                        {
                          label: "Modifier",
                          onClick: () =>
                            l.kind === "avance"
                              ? setExpModal({ open: true, item: l.item })
                              : setSetModal({ open: true, item: l.item }),
                        },
                        {
                          label: isArchived ? "Remettre en cours" : "Archiver",
                          onClick: () =>
                            l.kind === "avance"
                              ? setTxArchived.mutate({ id: l.id, archived: !isArchived })
                              : setSettlementArchived.mutate({ id: l.id, archived: !isArchived }),
                        },
                        {
                          label: "Supprimer",
                          danger: true,
                          onClick: () =>
                            l.kind === "avance" ? removeExpense.mutate(l.id) : removeSettlement.mutate(l.id),
                        },
                      ]}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {!isArchived && activeCount > 0 && (
        <button
          type="button"
          onClick={() => {
            if (
              confirm(
                "Archiver toutes les dépenses et remboursements en cours ? Ils ne compteront plus dans le solde.",
              )
            )
              archiveAll.mutate();
          }}
          className="px-1 text-left text-xs text-slate-400 underline"
        >
          Tout archiver ({activeCount})
        </button>
      )}

      {!isArchived && (
        <>
          <MobileActionBar
            label="Ajouter une ligne"
            onClick={() => setExpModal({ open: true, item: null })}
          />
          <div className="hidden justify-end gap-2 md:flex">
            <button
              type="button"
              onClick={() => setSetModal({ open: true, item: null })}
              className="btn"
            >
              + Remboursement
            </button>
            <button
              type="button"
              onClick={() => setExpModal({ open: true, item: null })}
              className="btn-primary"
            >
              + Dépense partagée
            </button>
          </div>
        </>
      )}

      {expModal.open && (
        <ExpenseModal
          key={expModal.item?.id ?? "new"}
          item={expModal.item}
          accounts={accounts ?? []}
          splitA={me.household.defaultSplitA}
          splitB={me.household.defaultSplitB}
          switcher={expModal.item ? undefined : kindSwitcher("depense")}
          onClose={() => setExpModal({ open: false, item: null })}
          onSaved={() => {
            setExpModal({ open: false, item: null });
            invalidate();
          }}
        />
      )}
      {setModal.open && (
        <SettlementModal
          key={setModal.item?.id ?? "new"}
          item={setModal.item}
          balance={balance}
          switcher={setModal.item ? undefined : kindSwitcher("remboursement")}
          onClose={() => setSetModal({ open: false, item: null })}
          onSaved={() => {
            setSetModal({ open: false, item: null });
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function ExpenseModal({
  item,
  accounts,
  splitA,
  splitB,
  switcher,
  onClose,
  onSaved,
}: {
  item: Transaction | null;
  accounts: Account[];
  splitA: number;
  splitB: number;
  switcher?: ReactNode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!item;
  const save = useMutation({
    mutationFn: (v: ExpenseFormValues) => {
      const acct =
        accounts.find((a) => a.owner === v.paidBy) ??
        accounts.find((a) => a.owner === "joint") ??
        accounts[0];
      const payload = {
        accountId: acct?.id,
        categoryId: null,
        label: v.label,
        amount: v.amount,
        paidBy: v.paidBy,
        shareA: v.shareA,
        shareB: v.shareB,
        date: v.date,
        kind: "actual" as const,
      };
      return isEdit
        ? api.patch(`/api/transactions/${item!.id}`, payload)
        : api.post("/api/transactions", payload);
    },
    onSuccess: onSaved,
  });

  return (
    <ExpenseFormModal
      title={isEdit ? "Modifier la dépense" : "Nouvelle dépense partagée"}
      initial={
        item
          ? {
              paidBy: item.paidBy === "b" ? "b" : "a",
              label: item.label,
              amount: Math.abs(item.amount) / 100,
              date: item.date,
            }
          : undefined
      }
      splitA={splitA}
      splitB={splitB}
      pending={save.isPending}
      switcher={switcher}
      onClose={onClose}
      onSave={(v) => save.mutate(v)}
    />
  );
}

function SettlementModal({
  item,
  balance,
  switcher,
  onClose,
  onSaved,
}: {
  item: Settlement | null;
  /** Solde courant : pré-remplit un nouveau remboursement (montant + sens). */
  balance?: Balance;
  switcher?: ReactNode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!item;
  const members = useMe().household.members;
  const [form, setForm] = useState({
    fromUser: (item?.fromUser ?? (balance && balance.amount > 0 ? balance.fromUser : "b")) as
      | "a"
      | "b",
    amount: item ? item.amount / 100 : balance && balance.amount > 0 ? balance.amount / 100 : 0,
    date: item?.date ?? todayIso(),
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        fromUser: form.fromUser,
        toUser: form.fromUser === "a" ? "b" : "a",
        amount: eurToCents(form.amount),
        date: form.date,
        note: "Remboursement",
      };
      return isEdit
        ? api.patch(`/api/settlements/${item!.id}`, payload)
        : api.post("/api/settlements", payload);
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
          <h2 className="text-lg font-bold">{isEdit ? "Modifier le remboursement" : "Nouveau remboursement"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        {switcher && <div className="mb-3">{switcher}</div>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (form.amount > 0) save.mutate();
          }}
          className="space-y-3"
        >
          <div className="text-xs text-slate-400">
            Qui rembourse ?
            <Select
              value={form.fromUser}
              onChange={(v) => setForm({ ...form, fromUser: v as "a" | "b" })}
              options={[
                { value: "a", label: `${members.a.name} → ${members.b.name}` },
                { value: "b", label: `${members.b.name} → ${members.a.name}` },
              ]}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-400">
              Montant (€)
              <Input
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
              />
            </label>
            <div className="text-xs text-slate-400">
              Date
              <DateInput value={form.date} onChange={(d) => setForm({ ...form, date: d })} />
            </div>
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
