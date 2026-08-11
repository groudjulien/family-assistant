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
import { eur, eur0, eurToCents, dateFr } from "../lib/format";
import { downloadXlsx } from "../lib/xlsx";
import { Checkbox, DateInput, Input, PillToggle, Select, SubNav } from "../components/ui";
import { MemberAvatar } from "../components/MemberAvatar";
import { Indicator } from "../components/Indicator";

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

type Tab = "budget" | "epargne" | "todo" | "invites";
type Group = "financier" | "organisation";

const WEDDING_GROUPS: {
  id: Group;
  label: string;
  tabs: { id: Tab; label: string; icon: string }[];
}[] = [
  {
    id: "organisation",
    label: "Organisation",
    tabs: [
      { id: "invites", label: "Invités", icon: "👥" },
      { id: "todo", label: "Todo", icon: "✅" },
    ],
  },
  {
    id: "financier",
    label: "Financier",
    tabs: [
      { id: "budget", label: "Budget", icon: "💰" },
      { id: "epargne", label: "Épargne", icon: "🐖" },
    ],
  },
];

const ALL_WEDDING_TABS = WEDDING_GROUPS.flatMap((g) => g.tabs);

export default function Wedding() {
  const navigate = useNavigate();
  const { tab: tabParam } = useParams();
  const tab: Tab = ALL_WEDDING_TABS.some((t) => t.id === tabParam) ? (tabParam as Tab) : "epargne";
  const activeGroup = WEDDING_GROUPS.find((g) => g.tabs.some((t) => t.id === tab)) ?? WEDDING_GROUPS[0];

  return (
    <div className="space-y-4">
      {/* Niveau 1 (Organisation / Financier) : onglets pleine largeur comme les
          autres menus. Niveau 2 : bascule compacte. */}
      <SubNav
        value={activeGroup.id}
        onChange={(v) => {
          const grp = WEDDING_GROUPS.find((g) => g.id === v);
          if (grp) navigate(`/wedding/${grp.tabs[0].id}`);
        }}
        items={WEDDING_GROUPS.map((g) => ({ value: g.id, label: g.label }))}
      />
      <PillToggle
        value={tab}
        onChange={(v) => navigate(`/wedding/${v}`)}
        items={activeGroup.tabs.map((t) => ({ value: t.id, label: t.label, icon: t.icon }))}
      />
      {tab === "budget" && <Budget />}
      {tab === "epargne" && <Epargne />}
      {tab === "todo" && <WeddingTodos />}
      {tab === "invites" && <Invites />}
    </div>
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
    className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${BUDGET_STATUS_META[k].cls}`}
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

function Budget() {
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
    <div className="space-y-4 pb-24 md:pb-0">
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
                <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white">
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
          <div className="hidden border-b border-slate-100 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 lg:grid lg:grid-cols-[1.5rem_minmax(0,1fr)_11rem_9rem_7rem_3.5rem] lg:gap-x-2">
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
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
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

      {/* Bouton flottant de création (mobile uniquement). */}
      <button
        type="button"
        onClick={() => setCreating(true)}
        aria-label="Ajouter un poste"
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
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Coordonnées</span>
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
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Paiements prévus</span>
          <button
            onClick={onAddPayment}
            className="rounded-lg bg-brand-600 px-2 py-1 text-xs font-medium text-white transition hover:bg-brand-700"
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
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Fichiers</span>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="rounded-lg bg-brand-600 px-2 py-1 text-xs font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
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

function Epargne() {
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
  // Coche « réalisé » manuelle : planned=false ↔ réalisé.
  const togglePlanned = useMutation({
    mutationFn: (p: { id: string; planned: boolean }) =>
      api.patch(`/api/wedding/savings/${p.id}`, { planned: p.planned }),
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
                  // Coche manuelle : c'est l'utilisateur qui marque un mois réalisé.
                  const realized = !ct.planned;
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

function WeddingTodos() {
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
    <div className="flex flex-col gap-4 pb-24 md:pb-0">
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

      {/* Bouton flottant de création (mobile uniquement). */}
      <button
        type="button"
        onClick={() => setModal({ open: true, item: null })}
        aria-label="Ajouter une tâche"
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

function Invites() {
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
          {/* Mobile : une carte par invité (nom / adresse / jours), pas de drag & drop. */}
          <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800 md:hidden">
            {guests.map((g) => (
              <li key={g.id}>
                <GuestCardMobile
                  g={g}
                  child={false}
                  days={showDays ? dayKeys : undefined}
                  isActive={isActive}
                  onToggle={(d) => toggle(g, d)}
                  onStatus={(s) => patch.mutate({ id: g.id, body: { invitationStatus: s } })}
                  onEdit={() => setModal({ open: true, item: g, group })}
                  onRemove={() => remove.mutate(g.id)}
                />
              </li>
            ))}
          </ul>

          {/* Desktop : tableau. */}
          <table className="hidden w-full table-fixed text-sm md:table">
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
                        <div className="text-[10px] font-normal text-slate-400">
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
          {/* Mobile : une carte par invité (nom / adresse / jours), pas de drag & drop. */}
          <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800 md:hidden">
            {flat.map(({ g, child }) => (
              <li key={g.id}>
                <GuestCardMobile
                  g={g}
                  child={child}
                  days={dayKeys}
                  isActive={isActive}
                  onToggle={(d) => toggle(g, d)}
                  onStatus={(s) => patch.mutate({ id: g.id, body: { invitationStatus: s } })}
                  onEdit={() => setModal({ open: true, item: g, group })}
                  onRemove={() => remove.mutate(g.id)}
                />
              </li>
            ))}
          </ul>

          {/* Desktop : tableau avec drag & drop. */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <table className="hidden w-full table-fixed text-sm md:table">
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
                          <div className="text-[10px] font-normal text-slate-400">
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
    <div className="space-y-4 pb-24 md:pb-0">
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
                    className="rounded-lg bg-brand-600 px-2 py-0.5 text-xs font-medium text-white"
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
                          ? "bg-brand-600 text-white"
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
                          ? "bg-brand-600 text-white"
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

      {/* Bouton flottant de création (mobile uniquement). */}
      {!showArchived && (
        <button
          type="button"
          onClick={() => setModal({ open: true, item: null, group: "vendredi" })}
          aria-label="Ajouter un invité"
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
      )}
    </div>
  );
}

// Swipe-left (mobile) pour révéler un bouton « Supprimer » derrière la carte.
function SwipeToDelete({ onDelete, children }: { onDelete: () => void; children: ReactNode }) {
  const [dx, setDx] = useState(0);
  const [animate, setAnimate] = useState(true);
  const start = useRef({ x: 0, y: 0, base: 0, drag: false });
  const REVEAL = 76;
  return (
    <div className="relative overflow-hidden">
      <button
        type="button"
        onClick={onDelete}
        aria-label="Supprimer"
        className="absolute inset-y-0 right-0 flex w-[76px] items-center justify-center bg-red-500 text-sm font-medium text-white"
      >
        Supprimer
      </button>
      <div
        className={`relative bg-white dark:bg-slate-900 ${animate ? "transition-transform duration-150" : ""}`}
        style={{ transform: `translateX(${dx}px)`, touchAction: "pan-y" }}
        onTouchStart={(e) => {
          start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, base: dx, drag: false };
          setAnimate(false);
        }}
        onTouchMove={(e) => {
          const mx = e.touches[0].clientX - start.current.x;
          const my = e.touches[0].clientY - start.current.y;
          if (!start.current.drag && Math.abs(mx) > Math.abs(my) && Math.abs(mx) > 6)
            start.current.drag = true;
          if (start.current.drag) setDx(Math.max(-REVEAL, Math.min(0, start.current.base + mx)));
        }}
        onTouchEnd={() => {
          setAnimate(true);
          setDx((d) => (d < -REVEAL / 2 ? -REVEAL : 0));
        }}
      >
        {children}
      </div>
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

// Carte d'un invité sur mobile : nom, adresse, jours de présence empilés.
// Suppression par swipe-left ; pas de drag & drop.
function GuestCardMobile({
  g,
  child,
  days,
  isActive,
  onToggle,
  onStatus,
  onEdit,
  onRemove,
}: {
  g: WeddingGuest;
  child: boolean;
  days?: Day[];
  isActive?: (d: Day) => boolean;
  onToggle?: (d: Day) => void;
  onStatus?: (s: InvitationStatus) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const cfgDays = useWeddingDays();
  const addr = [g.address, [g.postalCode, g.city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const isPrincipal = !g.parentId;
  return (
    <SwipeToDelete
      onDelete={() => {
        if (confirm(`Supprimer ${g.name} ?`)) onRemove();
      }}
    >
      <div
        className={
          child
            ? "ml-4 border-l-2 border-slate-200 py-1.5 pl-3 dark:border-slate-700"
            : "py-2.5"
        }
      >
        <div className="flex items-center gap-1.5">
          <span className={child ? "text-sm" : "text-base"} title={guestIcon(g).label}>
            {guestIcon(g).icon}
          </span>
          <span
            className={`min-w-0 flex-1 truncate ${child ? "text-sm text-slate-500 dark:text-slate-400" : "font-semibold"}`}
          >
            {g.name}
          </span>
          <button
            onClick={onEdit}
            aria-label="Modifier"
            className="shrink-0 px-1 text-slate-400 hover:text-brand-600"
          >
            ✎
          </button>
        </div>
        {addr && <div className="mt-0.5 truncate pl-6 text-xs text-slate-400">📍 {addr}</div>}
        {days && isActive && onToggle && (
          <div className="mt-2 flex flex-wrap gap-4 pl-6">
            {days.map(
              (d) =>
                isActive(d) && (
                  <Checkbox
                    key={d}
                    checked={g[d]}
                    onChange={() => onToggle(d)}
                    label={labelOf(cfgDays, d).slice(0, 3)}
                    size="sm"
                  />
                ),
            )}
          </div>
        )}
        {isPrincipal && onStatus && (
          <div className="mt-2 flex items-center gap-2 pl-6 text-xs text-slate-400">
            <span className="shrink-0">Faire-part</span>
            <div className="w-1/2">
              <InvitationCell g={g} onChange={onStatus} />
            </div>
          </div>
        )}
      </div>
    </SwipeToDelete>
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
            className="rounded-lg bg-brand-600 px-2 py-0.5 text-xs font-medium text-white"
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
