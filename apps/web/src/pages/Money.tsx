import { useState, useEffect, useRef, Fragment, type ReactNode } from "react";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { Link, useNavigate, useParams } from "react-router-dom";
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
} from "@gfa/shared";
import { TX_TYPE_LABEL, TX_TYPES } from "@gfa/shared";
import { useMe } from "../auth";
import { api, ApiError } from "../lib/api";
import PageLoader from "../components/PageLoader";
import { eur, eurToCents, dateFr, dateFrShort, todayIso } from "../lib/format";
import { Select, MultiSelect, Checkbox, DateInput, Input, SubNav, PillToggle, DateRangeCalendar } from "../components/ui";
import { Indicator } from "../components/Indicator";
import { ExpenseFormModal, type ExpenseFormValues } from "../components/ExpenseForm";
import { MemberAvatar } from "../components/MemberAvatar";
import { useToast } from "../components/Toast";
import { useExpenseCategories, categoryMeta } from "../lib/categories";

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
  const dim = size === "sm" ? "h-5 w-5 text-[8px]" : "h-8 w-8 text-[10px]";
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-lg font-bold text-white ${dim}`}
      style={{ backgroundColor: bg }}
      title={name}
    >
      {label}
    </span>
  );
}

const MONEY_TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "depenses", label: "Dépenses", icon: "💸" },
  { id: "tresorerie", label: "Trésorerie", icon: "📊" },
  { id: "equilibrage", label: "Équilibrage", icon: "⚖️" },
  { id: "prevue", label: "Prévue", icon: "🗓️" },
  { id: "elec", label: "Électricité", icon: "⚡" },
  { id: "comptes", label: "Comptes bancaires", icon: "🏦" },
];

export default function Money() {
  const navigate = useNavigate();
  const { tab: tabParam, view: viewParam } = useParams();
  const tab: Tab = MONEY_TABS.some((t) => t.id === tabParam) ? (tabParam as Tab) : "depenses";

  return (
    <div className="space-y-4">
      <SubNav
        value={tab}
        onChange={(v) => navigate(`/money/${v}`)}
        items={MONEY_TABS.map((t) => ({ value: t.id, label: t.label, icon: t.icon }))}
      />
      {tab === "depenses" && <Depenses view={viewParam} />}
      {tab === "tresorerie" && <Tresorerie />}
      {tab === "equilibrage" && <Equilibrage />}
      {tab === "prevue" && <Prevue view={viewParam} />}
      {tab === "elec" && <Electricite />}
      {tab === "comptes" && <Transactions view={viewParam} />}
    </div>
  );
}

/* ---------------- Comptes bancaires : soldes des comptes ---------------- */

// Horodatage court "12 juin, 14:32" pour la dernière synchro LunchFlow.
function syncTimeFr(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Icône chaîne (associer / lien LunchFlow).
function LinkIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

// Icône crayon (éditer le solde manuel).
function PencilIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

// Icône rafraîchir (forcer la synchro).
function RefreshIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

// Icône import de fichier (upload d'un relevé PDF).
function UploadIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5" />
      <path d="M12 3v12" />
    </svg>
  );
}

/**
 * Carte d'un compte bancaire : solde + état LunchFlow (synchro / date / erreur).
 * Sélectionnable au clic (filtre les transactions). Comptes non connectés :
 * édition manuelle du solde (crayon → input + OK). Comptes connectés : bouton de
 * resynchronisation forcée. Icône 🔗 pour gérer l'association LunchFlow.
 */
function AccountCard({
  account: a,
  selected,
  onSelect,
  onOpenLink,
}: {
  account: Account;
  selected: boolean;
  onSelect: () => void;
  onOpenLink: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const linked = !!a.lunchflowAccountId;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  // Import d'un relevé PDF : Claude en extrait les transactions côté back.
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
          ? `${r.added} transaction(s) importée(s)${r.skipped > 0 ? `, ${r.skipped} déjà présente(s)` : ""}`
          : r.total > 0
            ? "Toutes les transactions du relevé sont déjà importées"
            : "Aucune transaction trouvée dans le relevé",
      );
    },
    onError: (e) => {
      const raw = e instanceof ApiError ? e.message : "";
      const code = raw.includes("no-key")
        ? "Clé Claude manquante (Réglages)"
        : raw.includes("no-text")
          ? "Ce PDF ne contient pas de texte (relevé scanné ?)"
          : raw.includes("too-large")
            ? "Fichier trop volumineux (max 15 Mo)"
            : raw.includes("not-pdf")
              ? "Le fichier doit être un PDF"
              : "Échec de l'import du relevé";
      toast.error(code);
    },
  });

  const updateBalance = useMutation({
    mutationFn: (cents: number) => api.patch(`/api/accounts/${a.id}`, { currentBalance: cents }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      setEditing(false);
    },
  });
  const forceSync = useMutation({
    mutationFn: () => api.post(`/api/lunchflow/sync/${a.id}`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["bank-transactions"] });
    },
  });

  const iconBtn =
    "shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800 disabled:opacity-40";

  return (
    <div
      onClick={onSelect}
      className={`card cursor-pointer transition ${selected ? "ring-2 ring-brand-500" : "hover:border-brand-400"}`}
      title="Cliquer pour filtrer les transactions de ce compte"
    >
      <div className="flex items-center gap-1.5">
        <BankBadge name={a.name} size="sm" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{a.name}</span>
        <button
          onClick={(e) => {
            stop(e);
            onOpenLink();
          }}
          title={linked ? "Gérer la connexion LunchFlow" : "Connecter à LunchFlow"}
          className={`shrink-0 rounded-lg p-1 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 ${
            a.lunchflowError
              ? "text-red-500"
              : linked
                ? "text-brand-600"
                : "text-slate-400 hover:text-brand-600"
          }`}
        >
          <LinkIcon />
        </button>
      </div>

      {editing ? (
        <div className="mt-1 flex items-center gap-1" onClick={stop}>
          <input
            type="number"
            step="0.01"
            value={val}
            autoFocus
            onChange={(e) => setVal(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900"
          />
          <button
            onClick={() => {
              const num = parseFloat(val);
              if (!isNaN(num)) updateBalance.mutate(eurToCents(num));
            }}
            disabled={updateBalance.isPending}
            className="btn-primary shrink-0 px-2 py-1 text-xs"
          >
            OK
          </button>
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-1.5">
          <span className="text-xl font-bold tabular-nums">{eur(a.currentBalance)}</span>
          {!linked && (
            <button
              onClick={(e) => {
                stop(e);
                setVal((a.currentBalance / 100).toString());
                setEditing(true);
              }}
              title="Modifier le solde"
              className={iconBtn}
            >
              <PencilIcon />
            </button>
          )}
        </div>
      )}

      {/* Compte non connecté : import d'un relevé PDF (icône en bas à droite). */}
      {!linked && (
        <div className="mt-1 flex items-center text-[11px]">
          {importPdf.isPending && <span className="text-slate-400">Import en cours…</span>}
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              e.stopPropagation();
              const f = e.target.files?.[0];
              e.target.value = ""; // permet de ré-importer le même fichier
              if (f) importPdf.mutate(f);
            }}
          />
          <button
            onClick={(e) => {
              stop(e);
              fileRef.current?.click();
            }}
            disabled={importPdf.isPending}
            title="Importer un relevé de compte (PDF)"
            className={`${iconBtn} ml-auto`}
          >
            <UploadIcon className={`h-4 w-4 ${importPdf.isPending ? "animate-pulse" : ""}`} />
          </button>
        </div>
      )}

      {linked && (
        <div className="mt-1 flex items-center gap-1 text-[11px]">
          <div className="min-w-0 flex-1">
            {a.lunchflowError ? (
              <button
                onClick={(e) => {
                  stop(e);
                  onOpenLink();
                }}
                className="flex items-start gap-1 text-left text-red-500 hover:underline"
              >
                <span>⚠️</span>
                <span className="min-w-0 truncate">{a.lunchflowError}</span>
              </button>
            ) : (
              <span className="text-slate-400">
                {a.lunchflowSyncedAt ? `synchro : ${syncTimeFr(a.lunchflowSyncedAt)}` : "jamais synchronisé"}
              </span>
            )}
          </div>
          <button
            onClick={(e) => {
              stop(e);
              forceSync.mutate();
            }}
            disabled={forceSync.isPending}
            title="Forcer la synchronisation"
            className={`${iconBtn} ml-auto`}
          >
            <RefreshIcon className={`h-4 w-4 ${forceSync.isPending ? "animate-spin" : ""}`} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- Modale d'association LunchFlow ---------------- */

function LunchflowLinkModal({ account: initial, onClose }: { account: Account; onClose: () => void }) {
  const me = useMe();
  const qc = useQueryClient();

  // Version à jour du compte (reflète solde/synchro après association ou synchro forcée).
  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<Account[]>("/api/accounts"),
  });
  const account = accounts?.find((a) => a.id === initial.id) ?? initial;

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
      api.put(`/api/lunchflow/link/${account.id}`, { lunchflowAccountId }),
    onSuccess: invalidate,
  });
  const unlink = useMutation({
    mutationFn: () => api.del(`/api/lunchflow/link/${account.id}`),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });
  const sync = useMutation({
    mutationFn: () => api.post(`/api/lunchflow/sync/${account.id}`, {}),
    onSuccess: invalidate,
  });
  const removeAccount = useMutation({
    mutationFn: () => api.del(`/api/accounts/${account.id}`),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["bank-transactions"] });
      qc.invalidateQueries({ queryKey: ["recurring"] });
      onClose();
    },
  });
  // Réglages du compte : type / compte principal / compte par défaut du foyer.
  const patchAccount = useMutation({
    mutationFn: (payload: { type?: string; isPrimary?: boolean; forecast?: boolean }) =>
      api.patch(`/api/accounts/${account.id}`, payload),
    onSuccess: invalidate,
  });
  const setDefaultAccount = useMutation({
    mutationFn: (accountId: string | null) =>
      api.patch("/api/household/default-account", { accountId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });

  const linkedHere = list.data?.accounts.find((r) => r.linkedAccountId === account.id);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="card max-h-[85vh] w-full max-w-md overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-bold">Connexion LunchFlow</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <div className="mb-3 flex items-center gap-2 text-sm text-slate-500">
          <BankBadge name={account.name} size="sm" />
          <span className="truncate">{account.name}</span>
        </div>

        {account.lunchflowError && (
          <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40">
            ⚠️ Dernière synchro en échec : {account.lunchflowError}
          </div>
        )}

        {!me.hasLunchflowKey ? (
          <p className="text-sm text-slate-500">
            Configure d'abord ta clé API LunchFlow dans{" "}
            <span className="font-medium">Réglages → Paramètres</span>.
          </p>
        ) : list.isLoading ? (
          <p className="text-sm text-slate-400">Chargement des comptes LunchFlow…</p>
        ) : list.isError ? (
          <p className="text-sm text-red-500">
            Impossible de contacter LunchFlow. Vérifie ta clé API.
          </p>
        ) : (
          <div className="space-y-2">
            {(list.data?.accounts ?? []).length === 0 && (
              <p className="text-sm text-slate-400">Aucun compte accessible via LunchFlow.</p>
            )}
            {(list.data?.accounts ?? []).map((r) => {
              const isHere = r.linkedAccountId === account.id;
              const isElsewhere = !!r.linkedAccountId && !isHere;
              const inactive = r.status !== "ACTIVE";
              return (
                <div
                  key={r.id}
                  className={`flex items-center gap-2.5 rounded-xl border p-2.5 ${
                    isHere
                      ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                      : "border-slate-200 dark:border-slate-800"
                  }`}
                >
                  {r.institutionLogo ? (
                    <img
                      src={r.institutionLogo}
                      alt=""
                      className="h-8 w-8 shrink-0 rounded-lg object-contain"
                    />
                  ) : (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-xs dark:bg-slate-700">
                      🏦
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.institutionName || r.name}</div>
                    <div className="truncate text-xs text-slate-400">{r.name}</div>
                    {inactive && (
                      <div className="mt-0.5 text-xs font-medium text-red-500">
                        ⚠️ Reconnexion nécessaire ({r.status})
                      </div>
                    )}
                    {isElsewhere && (
                      <div className="mt-0.5 text-xs text-amber-600">Associé à un autre compte</div>
                    )}
                  </div>
                  {isHere ? (
                    <span className="shrink-0 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-medium text-white">
                      Associé
                    </span>
                  ) : (
                    <button
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

        {linkedHere && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            {account.lunchflowSyncedAt && (
              <span className="mr-auto text-xs text-slate-400">
                Dernière synchro : {syncTimeFr(account.lunchflowSyncedAt)}
              </span>
            )}
            <button
              onClick={() => sync.mutate()}
              disabled={sync.isPending}
              className="btn-ghost text-xs disabled:opacity-40"
            >
              {sync.isPending ? "Synchro…" : "Forcer la synchro"}
            </button>
            <button
              onClick={() => unlink.mutate()}
              disabled={unlink.isPending}
              className="text-xs text-red-500 hover:text-red-600 disabled:opacity-40"
            >
              Dissocier
            </button>
          </div>
        )}

        {/* Réglages du compte : type, compte principal, compte par défaut. */}
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-3 dark:border-slate-800">
          <div className="text-sm font-semibold">Réglages du compte</div>
          <label className="block text-xs text-slate-400">
            Type de compte
            <div className="mt-1">
              <Select
                value={account.type}
                onChange={(v) => patchAccount.mutate({ type: v })}
                options={[
                  { value: "checking", label: "🏦 Courant" },
                  { value: "savings", label: "🐖 Épargne" },
                  { value: "investment", label: "📈 Investissement" },
                ]}
              />
            </div>
          </label>
          {account.owner !== "joint" && (
            <Checkbox
              checked={account.isPrimary}
              onChange={() => patchAccount.mutate({ isPrimary: !account.isPrimary })}
              label="Compte principal (dépenses prévues de son propriétaire)"
            />
          )}
          <Checkbox
            checked={me.household.defaultAccountId === account.id}
            onChange={() =>
              setDefaultAccount.mutate(
                me.household.defaultAccountId === account.id ? null : account.id,
              )
            }
            label="Compte par défaut à la création d'une dépense"
          />
          <Checkbox
            checked={account.forecast}
            onChange={() => patchAccount.mutate({ forecast: !account.forecast })}
            label="Afficher dans les prévisions (Trésorerie)"
          />
        </div>

        {/* Suppression définitive du compte (compte inutilisé). */}
        <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
          <button
            onClick={() => {
              if (
                confirm(
                  `Supprimer le compte « ${account.name} » ?\nToutes ses transactions bancaires et charges associées seront aussi supprimées. Cette action est irréversible.`,
                )
              )
                removeAccount.mutate();
            }}
            disabled={removeAccount.isPending}
            className="text-xs font-medium text-red-500 hover:text-red-600 disabled:opacity-40"
          >
            🗑️ {removeAccount.isPending ? "Suppression…" : "Supprimer le compte bancaire"}
          </button>
        </div>
      </div>
    </div>
  );
}

const ACCOUNT_TYPE_OPTIONS = [
  { value: "checking", label: "🏦 Courant" },
  { value: "savings", label: "🐖 Épargne" },
  { value: "investment", label: "📈 Investissement" },
];

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

          <div>
            <label className="mb-1.5 block text-xs text-slate-400">Nom du compte</label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex. BoursoBank, LCL commun, Livret A…"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-slate-400">Type de compte</label>
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

/* ---------------- Transactions bancaires ---------------- */

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

/** Libellés des vues membre/commun, depuis la config du foyer. */
function useMemberLabels(): Record<string, string> {
  const members = useMe().household.members;
  return { a: members.a.name, b: members.b.name, joint: "Commun" };
}
// Vues de l'onglet Transactions = propriétaire des comptes affichés.
const TX_VIEW_IDS = ["a", "b", "joint"] as const;
function useTxViews() {
  const labels = useMemberLabels();
  return TX_VIEW_IDS.map((v) => ({ value: v as string, label: labels[v] }));
}

// Icône entonnoir (bouton « Filtres » mobile).
function FunnelIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
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
          <div className="absolute left-0 z-[70] mt-1 w-[min(92vw,340px)] rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <SubNav
              value={tab}
              onChange={(v) => setTab(v as "periode" | "date")}
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
                      className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                          sel ? "border-brand-600" : "border-slate-300 dark:border-slate-600"
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
      strokeWidth="2"
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

// Champs de filtre montant + sens, partagés entre l'affichage inline (ordinateur)
// et la modale (mobile). `stacked` = empilé pleine largeur (modale).
function TxFilterFields({
  stacked,
  minAmount,
  setMinAmount,
  maxAmount,
  setMaxAmount,
  sign,
  setSign,
  types,
  setTypes,
}: {
  stacked: boolean;
  minAmount: string;
  setMinAmount: (v: string) => void;
  maxAmount: string;
  setMaxAmount: (v: string) => void;
  sign: SignFilter;
  setSign: (v: SignFilter) => void;
  types: string[];
  setTypes: (v: string[]) => void;
}) {
  const amountW = stacked ? "w-full" : "w-24 shrink-0";
  const Label = ({ text }: { text: string }) =>
    stacked ? <label className="mb-1 block text-xs text-slate-400">{text}</label> : null;
  const signOptions: { v: SignFilter; label: string }[] = [
    { v: "all", label: "Tous" },
    { v: "in", label: "Entrées" },
    { v: "out", label: "Sorties" },
  ];
  return (
    <>
      <div className={stacked ? "w-full" : "shrink-0"}>
        <Label text="Sens" />
        <div className="flex rounded-xl border border-slate-300 p-0.5 dark:border-slate-700">
          {signOptions.map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => setSign(o.v)}
              className={`rounded-lg px-2.5 py-1.5 text-sm ${stacked ? "flex-1" : ""} ${
                sign === o.v
                  ? "bg-brand-600 text-white"
                  : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className={stacked ? "w-full" : "w-44 shrink-0"}>
        <Label text="Type" />
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
      <div className={amountW}>
        <Label text="Montant min (€)" />
        <input
          type="number"
          step="0.01"
          min="0"
          value={minAmount}
          onChange={(e) => setMinAmount(e.target.value)}
          placeholder="Min €"
          className="input tabular-nums"
        />
      </div>
      <div className={amountW}>
        <Label text="Montant max (€)" />
        <input
          type="number"
          step="0.01"
          min="0"
          value={maxAmount}
          onChange={(e) => setMaxAmount(e.target.value)}
          placeholder="Max €"
          className="input tabular-nums"
        />
      </div>
    </>
  );
}

function Transactions({ view }: { view?: string }) {
  const me = useMe();
  const navigate = useNavigate();
  const cats = useExpenseCategories();
  const txViews = useTxViews();
  const memberLabels = useMemberLabels();
  const member = TX_VIEW_IDS.some((v) => v === view) ? (view as string) : me.member;

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<Account[]>("/api/accounts"),
  });
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["bank-transactions", member],
    queryFn: ({ pageParam }) =>
      api.get<{ transactions: BankTransaction[]; hasOlder: boolean; page: number }>(
        `/api/lunchflow/transactions?member=${member}&page=${pageParam}`,
      ),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasOlder ? last.page + 1 : undefined),
  });
  // Charges récurrentes (page Dépenses) pour repérer/masquer les mouvements attendus.
  const { data: recurring } = useQuery({
    queryKey: ["recurring"],
    queryFn: () => api.get<Recurring[]>("/api/recurring"),
  });

  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [sign, setSign] = useState<SignFilter>("all");
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [onlyUnusual, setOnlyUnusual] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [linkTarget, setLinkTarget] = useState<Account | null>(null);
  const [linkExpenseTx, setLinkExpenseTx] = useState<BankTransaction | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
    setSearch("");
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
    return { label: i === 0 ? "Mois en cours" : name.charAt(0).toUpperCase() + name.slice(1), start, end };
  });

  // Ordre : compte principal d'abord, puis courant → investissement → épargne, puis le nom.
  const typeRank = { checking: 0, investment: 1, savings: 2 } as const;
  const accountRank = (a: Account) =>
    (a.isPrimary ? 0 : 10) + (typeRank[a.type as keyof typeof typeRank] ?? 3);
  const myAccounts = (accounts ?? [])
    .filter((a) => a.owner === member)
    .sort((x, y) => accountRank(x) - accountRank(y) || x.name.localeCompare(y.name, "fr"));
  const linkedCount = myAccounts.filter((a) => a.lunchflowAccountId).length;
  const total = myAccounts.reduce((s, a) => s + a.currentBalance, 0);
  // Sélection effective : ignorée si le compte n'appartient pas à la vue courante
  // (évite une sélection fantôme en changeant de vue membre a/membre b/Commun).
  const activeAccount = myAccounts.some((a) => a.id === selectedAccount) ? selectedAccount : null;

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
    if (activeAccount && t.accountId !== activeAccount) return false;
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
  const hasFilters = search.trim() !== "" || hasAdvanced;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-4 pb-24 md:pb-0">
      {/* Bascule membre a / membre b / Commun — une URL par vue ; bouton de création aligné à droite (ordinateur) */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <span aria-hidden="true" />
        <PillToggle value={member} onChange={(v) => navigate(`/money/comptes/${v}`)} items={txViews} />
        <div className="flex justify-end">
          <button onClick={() => setCreateOpen(true)} className="btn-primary hidden md:inline-flex">
            + Ajouter un compte
          </button>
        </div>
      </div>

      {/* Cartes des comptes : solde éditable / synchro / sélection = filtre */}
      {myAccounts.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {myAccounts.map((a) => (
            <AccountCard
              key={a.id}
              account={a}
              selected={activeAccount === a.id}
              onSelect={() => setSelectedAccount((cur) => (cur === a.id ? null : a.id))}
              onOpenLink={() => setLinkTarget(a)}
            />
          ))}
          <div className="card bg-brand-50 dark:bg-brand-500/10">
            <div className="text-xs font-medium text-brand-700 dark:text-brand-300">Total</div>
            <div className="mt-1 text-xl font-bold tabular-nums text-brand-700 dark:text-brand-300">
              {eur(total)}
            </div>
          </div>
        </div>
      )}

      {/* Recherche (toujours) + filtres. Ordinateur : inline. Mobile : bouton
          « Filtres » qui ouvre une modale. */}
      {linkedCount > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[12rem] flex-1">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher (vendeur, libellé, montant…)"
              className="input"
            />
          </div>

          {/* Filtre Période — ordinateur seulement (mobile : dans la modale) */}
          <div className="hidden w-56 md:block">
            <PeriodFilter
              dateFrom={dateFrom}
              dateTo={dateTo}
              setDateFrom={setDateFrom}
              setDateTo={setDateTo}
              presets={datePresets}
            />
          </div>

          {/* Ordinateur : filtres inline */}
          <div className="hidden flex-wrap items-center gap-2 md:flex">
            <TxFilterFields
              stacked={false}
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
              title="Masquer les charges récurrentes (page Dépenses) pour ne voir que le ponctuel"
              className={`shrink-0 rounded-xl border px-3 py-2 text-sm ${
                onlyUnusual
                  ? "border-brand-500 text-brand-600 ring-1 ring-brand-500"
                  : "border-slate-300 text-slate-500 dark:border-slate-700"
              }`}
            >
              Ponctuel
            </button>
          </div>

          {/* Mobile : bouton Filtres (entonnoir), anneau si un filtre est actif */}
          <button
            onClick={() => setFiltersOpen(true)}
            className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-sm md:hidden ${
              hasAdvanced
                ? "border-brand-500 text-brand-600 ring-1 ring-brand-500"
                : "border-slate-300 text-slate-500 dark:border-slate-700"
            }`}
            aria-label="Filtres"
          >
            <FunnelIcon />
            Filtres
          </button>
        </div>
      )}

      {/* Modale filtres (mobile) */}
      {filtersOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center md:hidden"
          onClick={() => setFiltersOpen(false)}
        >
          <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Filtres</h2>
              <button onClick={() => setFiltersOpen(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            <div className="flex flex-col gap-3">
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
                stacked
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
                  onlyUnusual
                    ? "border-brand-500 text-brand-600 ring-1 ring-brand-500"
                    : "border-slate-300 text-slate-500 dark:border-slate-700"
                }`}
              >
                {onlyUnusual ? "✓ " : ""}Ponctuel uniquement (masque les récurrentes)
              </button>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <button onClick={resetFilters} className="btn-ghost text-sm">
                Réinitialiser
              </button>
              <button onClick={() => setFiltersOpen(false)} className="btn-primary">
                Voir les résultats
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Liste des transactions */}
      <div className="card">
        {myAccounts.length === 0 ? (
          <p className="text-sm text-slate-400">Aucun compte pour {memberLabels[member] ?? member}.</p>
        ) : linkedCount === 0 ? (
          <p className="text-sm text-slate-400">
            Aucun compte connecté à LunchFlow. Utilise l'icône 🔗 sur une carte ci-dessus pour
            l'associer.
          </p>
        ) : isLoading ? (
          <p className="text-sm text-slate-400">Chargement des transactions…</p>
        ) : txs.length === 0 ? (
          <p className="text-sm text-slate-400">
            {hasFilters ? "Aucune transaction ne correspond aux filtres." : "Aucune transaction."}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
            {txs.map((t) => {
              const dimmed = t.future || t.isPending;
              const cat = categoryMeta(cats, t.category);
              const base = t.merchantName || cleanBankLabel(t.rawLabel) || "Transaction";
              // Si le nom enrichi masque la nature du mouvement, préfixer « Virement ».
              const title = t.merchantName && isVirement(t.rawLabel) ? `Virement · ${base}` : base;
              const isOpen = expanded.has(t.id);
              return (
                <li key={t.id} className="py-2.5">
                  <div
                    className={`flex cursor-pointer items-center gap-3 ${dimmed ? "text-slate-400 dark:text-slate-500" : ""}`}
                    onClick={() => toggle(t.id)}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm dark:bg-slate-800">
                      {cat?.icon ?? (t.amount >= 0 ? "💰" : "💳")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sm font-medium">
                        <TxTypeIcon type={t.type} className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="truncate">{title}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                        {!activeAccount && myAccounts.length > 1 && (
                          <span className="flex items-center gap-1">
                            <BankBadge name={t.accountName} size="sm" />
                            <span className="truncate">{t.accountName}</span>
                          </span>
                        )}
                        <span>{dateFr(t.date)}</span>
                        {cat && (
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
                            {cat.name}
                          </span>
                        )}
                        {t.isPending && (
                          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                            en attente
                          </span>
                        )}
                        {t.future && !t.isPending && (
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
                            à venir
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 text-sm font-semibold tabular-nums ${
                        dimmed ? "" : t.amount >= 0 ? "text-green-600" : ""
                      }`}
                    >
                      {eur(t.amount)}
                    </span>
                  </div>

                  {isOpen && (
                    <div className="mt-2 space-y-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
                      <div className="whitespace-pre-wrap font-mono text-[11px] text-slate-500">
                        {t.rawLabel || "—"}
                      </div>
                      {t.merchantWebsite && (
                        <div>
                          🌐{" "}
                          <a
                            href={t.merchantWebsite.startsWith("http") ? t.merchantWebsite : `https://${t.merchantWebsite}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-brand-600 underline hover:no-underline"
                          >
                            {t.merchantWebsite}
                          </a>
                        </div>
                      )}
                      {t.merchantAddress && <div>📍 {t.merchantAddress}</div>}
                      {/* Rattachement à une charge récurrente (matching par nom) */}
                      {(() => {
                        const matched = matchedByName(t);
                        return (
                          <div className="flex items-center gap-2 pt-1">
                            {matched && (
                              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                                Rattaché à « {matched.label} »
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => setLinkExpenseTx(t)}
                              className="inline-flex items-center gap-1 font-medium text-brand-600 hover:text-brand-700"
                            >
                              <LinkIcon className="h-3.5 w-3.5" />
                              {matched ? "Lier à une autre dépense" : "Lier à une dépense"}
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Sentinelle du scroll infini + indicateur de chargement de la suite */}
        {all.length > 0 && <div ref={loadMoreRef} className="h-px" />}
        {isFetchingNextPage && (
          <p className="pt-3 text-center text-xs text-slate-400">Chargement…</p>
        )}
        {!hasNextPage && all.length > 0 && (
          <p className="pt-3 text-center text-xs text-slate-300 dark:text-slate-600">
            Fin de l'historique
          </p>
        )}
      </div>

      {/* Bouton flottant de création (mobile uniquement). */}
      <button
        type="button"
        onClick={() => setCreateOpen(true)}
        aria-label="Ajouter un compte"
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

      {createOpen && (
        <CreateAccountModal defaultOwner={member} onClose={() => setCreateOpen(false)} />
      )}

      {linkTarget && (
        <LunchflowLinkModal account={linkTarget} onClose={() => setLinkTarget(null)} />
      )}

      {linkExpenseTx && (
        <LinkExpenseModal
          tx={linkExpenseTx}
          recurring={recurring ?? []}
          accounts={accounts ?? []}
          onClose={() => setLinkExpenseTx(null)}
        />
      )}
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

// Vue mobile d'une charge : nom sur sa propre ligne, détails (compte, jour, parts, actions) en dessous.
function ExpenseCardMobile({
  r,
  acctName,
  onEdit,
  onMoveUp,
  onMoveDown,
  canUp,
  canDown,
}: {
  r: Recurring;
  acctName: (id: string) => string;
  onEdit: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canUp: boolean;
  canDown: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasDebits = r.debits.length > 0;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <li className="py-2.5 select-none" onDoubleClick={onEdit} title="Double-cliquer pour modifier">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {hasDebits && (
            <button
              onClick={() => setOpen((o) => !o)}
              onDoubleClick={stop}
              className="shrink-0 text-slate-400"
            >
              {open ? "▾" : "▸"}
            </button>
          )}
          <span className="font-medium">{r.label}</span>
        </div>
        <span
          className={`shrink-0 font-semibold tabular-nums ${r.amount >= 0 ? "text-green-600" : ""}`}
        >
          {eur(Math.abs(r.amount))}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5">
          <BankBadge name={acctName(r.accountId)} size="sm" />
          {acctName(r.accountId)}
        </span>
        <span>{r.dayOfMonth ? `le ${r.dayOfMonth}` : hasDebits ? `${r.debits.length} débits` : "—"}</span>
        <span className="flex items-center gap-1">
          <MemberAvatar id="a" className="h-4 w-4 text-[10px]" />
          <span className="tabular-nums">{eur(Math.abs(r.shareA))}</span>
        </span>
        <span className="flex items-center gap-1">
          <MemberAvatar id="b" className="h-4 w-4 text-[10px]" />
          <span className="tabular-nums">{eur(Math.abs(r.shareB))}</span>
        </span>
        <span className="ml-auto flex items-center gap-0.5 text-slate-400">
          <button
            onClick={onMoveUp}
            onDoubleClick={stop}
            disabled={!canUp}
            className="px-0.5 disabled:opacity-30"
            aria-label="Monter"
          >
            ↑
          </button>
          <button
            onClick={onMoveDown}
            onDoubleClick={stop}
            disabled={!canDown}
            className="px-0.5 disabled:opacity-30"
            aria-label="Descendre"
          >
            ↓
          </button>
        </span>
      </div>
      {open && hasDebits && (
        <ul className="mt-1.5 space-y-1 border-l border-slate-100 pl-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          {r.debits.map((d) => (
            <li key={d.id} className="flex justify-between gap-2">
              <span className="truncate">
                ↳ {d.label || "Débit"}
                {d.dayOfMonth ? ` · le ${d.dayOfMonth}` : ""}
              </span>
              <span className="shrink-0 tabular-nums">{eur(Math.abs(d.amount))}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// Onglet « Dépenses » : sous-menu mensuel / annuel (une URL par vue).
function Depenses({ view }: { view?: string }) {
  const navigate = useNavigate();
  const sub = view === "annuel" ? "annuel" : "mensuel";
  return (
    <div className="flex flex-col gap-4">
      <PillToggle
        value={sub}
        onChange={(v) => navigate(`/money/depenses/${v}`)}
        items={[
          { value: "mensuel", label: "Mensuel", icon: "🗓️" },
          { value: "annuel", label: "Annuel", icon: "📅" },
        ]}
      />
      {sub === "mensuel" ? <DepensesMensuel /> : <DepensesAnnuel />}
    </div>
  );
}

function DepensesMensuel() {
  const me = useMe();
  const members = me.household.members;
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [editing, setEditing] = useState<Recurring | null>(null);
  const [creating, setCreating] = useState(false);

  // Filtres : contributeur (part ≠ 0) + compte bancaire. Repliés sur mobile.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [fPerson, setFPerson] = useState<"" | "a" | "b">("");
  const [fAccount, setFAccount] = useState("");

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
    <div className="flex flex-col gap-4 pb-24 md:pb-0">
      {/* En-tête + filtres sur une même ligne (ordinateur). Mobile : bouton Filtres
          repliable ; création via le FAB en bas. */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
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
          Filtres
        </button>

        {/* Contrôles de filtre : repliés sur mobile, inline sur ordinateur. */}
        <div
          className={`${filtersOpen ? "grid" : "hidden"} grid-cols-1 gap-2 sm:grid-cols-2 md:flex md:flex-row md:items-center`}
        >
          <Select
            value={fPerson}
            onChange={(v) => setFPerson(v as "" | "a" | "b")}
            className="md:w-48"
            options={[
              { value: "", label: "Tout le monde" },
              { value: "a", label: `${members.a.name} contribue`, icon: <MemberAvatar id="a" className="h-5 w-5 text-[10px]" /> },
              { value: "b", label: `${members.b.name} contribue`, icon: <MemberAvatar id="b" className="h-5 w-5 text-[10px]" /> },
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicator label="Revenus" value={eur(incomeJ + incomeN)} tone="green" />
        <Indicator label="Dépenses" value={eur(totalExp)} tone="red" />
        <Indicator label={`Reste à vivre ${members.a.name}`} value={eur(resteJ)} tone={resteJ < 0 ? "red" : "default"} />
        <Indicator label={`Reste à vivre ${members.b.name}`} value={eur(resteN)} tone={resteN < 0 ? "red" : "default"} />
      </div>

      {hasFilters && groups.length === 0 && (
        <div className="card text-sm text-slate-400">Aucune charge ne correspond aux filtres.</div>
      )}

      {groups.map((g) => {
        const total = g.items.reduce((s, r) => s + r.amount, 0);
        return (
          <div key={g.id ?? "none"} className="card">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">{g.name}</div>
              <div className="text-sm font-medium text-slate-500">{eur(Math.abs(total))}</div>
            </div>
            {g.kind === "income" && (
              <div className="mb-3 rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                ℹ️ Clé de répartition calculée sur les salaires : <b>{pctJ}% {members.a.name} / {pctN}% {members.b.name}</b>.
                C'est la clé appliquée par défaut aux charges du foyer.{" "}
                <Link to="/settings" className="font-medium underline hover:text-blue-900">
                  Modifier la répartition
                </Link>
              </div>
            )}
            {/* Mobile : chaque charge en carte, nom sur sa propre ligne. */}
            <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800 md:hidden">
              {g.items.map((r, idx) => {
                const moveInGroup = (dir: number) => {
                  const groupIds = g.items.map((i) => i.id);
                  const to = idx + dir;
                  if (to < 0 || to >= groupIds.length) return;
                  const moved = arrayMove(groupIds, idx, to);
                  let k = 0;
                  const newGlobal = recurring.map((rr) =>
                    groupIds.includes(rr.id) ? moved[k++] : rr.id,
                  );
                  reorder.mutate(newGlobal);
                };
                return (
                  <ExpenseCardMobile
                    key={r.id}
                    r={r}
                    acctName={acctName}
                    onEdit={() => setEditing(r)}
                    onMoveUp={() => moveInGroup(-1)}
                    onMoveDown={() => moveInGroup(1)}
                    canUp={idx > 0}
                    canDown={idx < g.items.length - 1}
                  />
                );
              })}
            </ul>

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

      {/* Bouton flottant de création (mobile uniquement). */}
      <button
        type="button"
        onClick={() => setCreating(true)}
        aria-label="Ajouter une charge"
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
                {/* Mobile : chaque charge en carte, nom sur sa propre ligne. */}
                <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800 md:hidden">
                  {items.map((r, idx) => (
                    <ExpenseCardMobile
                      key={r.id}
                      r={r}
                      acctName={acctName}
                      onEdit={() => setEditing(r)}
                      onMoveUp={() => idx > 0 && applyOrder(arrayMove(monthIds, idx, idx - 1))}
                      onMoveDown={() =>
                        idx < monthIds.length - 1 && applyOrder(arrayMove(monthIds, idx, idx + 1))
                      }
                      canUp={idx > 0}
                      canDown={idx < items.length - 1}
                    />
                  ))}
                </ul>

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

function Tresorerie() {
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
  const debitColor = (c: number) => (c > 0 ? "text-amber-600" : "");

  return (
    <div className="space-y-4">
      <Virements />

      <div className="flex items-center justify-between gap-2 border-t-2 border-slate-200 pt-6">
        <h2 className="text-lg font-bold capitalize">Prévisions — fin {monthLabel}</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMonthOffset((o) => Math.max(0, o - 1))}
            disabled={monthOffset === 0}
            aria-label="Mois précédent"
            className="rounded-lg p-1 text-slate-400 transition hover:text-brand-600 disabled:opacity-30"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setMonthOffset((o) => Math.min(12, o + 1))}
            disabled={monthOffset >= 12}
            aria-label="Mois suivant"
            className="rounded-lg p-1 text-slate-400 transition hover:text-brand-600 disabled:opacity-30"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
      </div>

      {/* détail par compte : compte joint seul, puis comptes du membre a, puis ceux du membre b */}
      <div className="space-y-3">
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

  function ownerRows(owner: string) {
    const ids = new Set(accounts!.filter((a) => a.owner === owner).map((a) => a.id));
    return rows.filter((r) => ids.has(r.accountId));
  }

  function renderCard(a: Cashflow["byAccount"][number]) {
    const debits = data!.upcoming
      .filter((e) => e.accountId === a.accountId && e.amount < 0)
      .sort((x, y) => x.date.localeCompare(y.date));
    const open = openAcct === a.accountId;
    // Dépenses décochées : réintégrées au solde prévisionnel (montants négatifs → total positif).
    const skipped = debits
      .filter((e) => excluded[cashflowEntryKey(e)])
      .reduce((s, e) => s - e.amount, 0);
    const totalDebits = a.totalDebits - skipped;
    // Mois suivant : on ignore les rentrées d'argent (salaire, virements) → solde - dépenses.
    const projected =
      (monthOffset > 0 ? a.currentBalance - a.totalDebits : a.projectedBalance) + skipped;
    return (
      <div key={a.accountId} className="card">
        <button
          onClick={() => setOpenAcct(open ? null : a.accountId)}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <span className="flex min-w-0 items-center gap-2">
            <BankBadge name={a.accountName} size="sm" />
            <span className="truncate font-semibold">{a.accountName}</span>
          </span>
          <span className="text-slate-400">{open ? "▾" : "▸"}</span>
        </button>
        <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
          <div>
            <div className="text-xs text-slate-400">Solde actuel</div>
            <div className="font-medium tabular-nums">{eur(a.currentBalance)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Reste à débiter</div>
            <div className={`font-medium tabular-nums ${debitColor(totalDebits)}`}>-{eur(totalDebits)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Reste à vivre restant</div>
            <div className={`font-semibold tabular-nums ${endColor(projected)}`}>
              {eur(projected)}
            </div>
          </div>
        </div>

        {open && (
          <div className="mt-3 border-t border-slate-100 pt-2 dark:border-slate-800">
            <div className="mb-1 text-xs text-slate-400">Dépenses à venir d'ici fin {monthLabel}</div>
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
                    className={`w-full border-b border-slate-50 py-1 text-left text-sm transition dark:border-slate-800 md:flex md:items-center md:gap-2 ${
                      off ? "text-slate-400 line-through dark:text-slate-500" : ""
                    }`}
                  >
                    {/* Mobile : description sur la 1re ligne, date + montant sur la 2e. */}
                    <span className="block truncate md:order-2 md:flex-1">{e.label}</span>
                    <span className="mt-0.5 flex items-center justify-between gap-2 md:mt-0 md:contents">
                      <span className={`md:order-1 md:w-14 md:shrink-0 ${off ? "" : "text-slate-500"}`}>
                        {dateFrShort(e.date)}
                      </span>
                      <span
                        className={`shrink-0 tabular-nums md:order-3 ${off ? "" : "text-red-600"}`}
                      >
                        {eur(e.amount)}
                      </span>
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

function Virements() {
  const me = useMe();
  const members = me.household.members;
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

  if (!recurring || !accounts || !savings || !balance || !planned)
    return <PageLoader variant="argent" />;

  // Mois de mariage concerné : fenêtre [10 du mois, 10 du mois suivant) → mois suivant
  const now = new Date();
  const target =
    now.getDate() >= 10
      ? new Date(now.getFullYear(), now.getMonth() + 1, 1)
      : new Date(now.getFullYear(), now.getMonth(), 1);
  const targetMonth = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`;
  const targetLabel = target.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
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

  // Virements à faire par compte destinataire (pour le tooltip)
  const transfersA = [
    { label: lclName, amount: jLcl + ajLcl },
    { label: boursoJ?.name ?? `Compte secondaire ${members.a.name}`, amount: jVirBourso + ajVirBourso },
    { label: epargneJ?.name ?? "Épargne", amount: jMariageOut },
  ].filter((t) => t.amount > 0);

  const transfersB = [
    { label: lclName, amount: nLcl + anLcl },
    {
      label: tradeJ?.name ?? `Compte principal ${members.a.name}`,
      amount: nTradeA + anTradeA + pnTradeA + wedN + equilBToA,
    },
    { label: boursoN?.name ?? `Compte secondaire ${members.b.name}`, amount: nVirBourso + anVirBourso },
  ].filter((t) => t.amount > 0);

  const Ledger = ({
    member,
    rows,
    transfers,
  }: {
    member: "a" | "b";
    rows: Row[];
    transfers: { label: string; amount: number }[];
  }) => (
    <div className="card">
      <div className="mb-2 flex items-center justify-between gap-2">
        <MemberAvatar id={member} className="h-7 w-7 text-sm" />
        <span className="group relative">
          <span className="cursor-help text-xs font-medium text-green-700 underline">
            virements à faire
          </span>
          <div className="invisible absolute right-0 top-full z-30 mt-1 w-60 max-w-[calc(100vw-3rem)] rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700 shadow-lg group-hover:visible dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            <div className="mb-1 font-semibold text-slate-500 dark:text-slate-300">Virements par compte</div>
            {transfers.length === 0 ? (
              <div className="text-slate-400 dark:text-slate-500">Aucun virement.</div>
            ) : (
              transfers.map((t, i) => (
                <div key={i} className="flex items-center justify-between gap-3 py-0.5">
                  <span className="flex min-w-0 items-center gap-1.5 italic text-slate-500 dark:text-slate-300">
                    <BankBadge name={t.label} size="sm" />
                    <span className="truncate">{t.label}</span>
                  </span>
                  <span className="font-medium tabular-nums text-slate-800 dark:text-slate-100">{eur(t.amount)}</span>
                </div>
              ))
            )}
          </div>
        </span>
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
                      <span className="pointer-events-none invisible absolute left-1/2 top-full z-30 mt-1 w-52 max-w-[70vw] -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-2 text-[11px] font-normal normal-case text-slate-700 shadow-lg group-hover/sal:visible dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
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

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold capitalize">Versements — début {targetLabel}</h2>

      <div className="card">
        <div className="mb-2 text-xs text-slate-400">
          Ajustements de ce mois (n'affectent que les tableaux ci-dessous)
        </div>
        <div className="grid grid-cols-3 gap-3">
          {AdjInput({
            label: (
              <>
                <MemberAvatar id="a" className="h-4 w-4 text-[9px]" /> Salaire {members.a.name}
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
                <MemberAvatar id="b" className="h-4 w-4 text-[9px]" /> Salaire {members.b.name}
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
                Équilibrage (<MemberAvatar id="b" className="h-4 w-4 text-[9px]" /> →{" "}
                <MemberAvatar id="a" className="h-4 w-4 text-[9px]" />)
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
        {Ledger({ member: "a", rows: rowsA, transfers: transfersA })}
        {Ledger({ member: "b", rows: rowsB, transfers: transfersB })}
      </div>
    </div>
  );
}

/* ---------------- Dépenses prévues ---------------- */

function Prevue({ view }: { view?: string }) {
  const navigate = useNavigate();
  const sub: "prevue" | "achete" = view === "achete" ? "achete" : "prevue";
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ item: PlannedExpense | null } | null>(null);

  const { data } = useQuery({
    queryKey: ["planned"],
    queryFn: () => api.get<PlannedExpense[]>("/api/planned"),
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["planned"] });
    qc.invalidateQueries({ queryKey: ["cashflow"] });
  };
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/planned/${id}`),
    onSuccess: invalidate,
  });
  // Bascule prévue ↔ achetée : acheter = daté d'aujourd'hui (modifiable via ✎).
  const setPurchased = useMutation({
    mutationFn: (p: { id: string; purchasedAt: string | null }) =>
      api.patch(`/api/planned/${p.id}`, { purchasedAt: p.purchasedAt }),
    onSuccess: invalidate,
  });

  if (!data) return <PageLoader variant="argent" />;

  const rows =
    sub === "achete"
      ? data
          .filter((p) => p.purchasedAt)
          .slice()
          .sort((a, b) => (b.purchasedAt ?? "").localeCompare(a.purchasedAt ?? ""))
      : data
          .filter((p) => !p.purchasedAt)
          .slice()
          .sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
  const total = rows.reduce((s, p) => s + p.amount, 0);

  return (
    <div className="flex flex-col gap-4 pb-24 md:pb-0">
      {/* Bascule Prévue / Acheté, avec le bouton d'ajout aligné à droite. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <span aria-hidden="true" />
        <PillToggle
          value={sub}
          onChange={(v) => navigate(v === "achete" ? "/money/prevue/achete" : "/money/prevue")}
          items={[
            { value: "prevue", label: "Prévue", icon: "🗓️" },
            { value: "achete", label: "Acheté", icon: "✅" },
          ]}
        />
        <div className="flex justify-end">
          {sub === "prevue" && (
            <button onClick={() => setModal({ item: null })} className="btn-primary hidden md:inline-flex">
              + Ajouter
            </button>
          )}
        </div>
      </div>

      <div className="text-sm text-slate-500">
        {sub === "achete"
          ? "Dépenses prévues déjà achetées (hors trésorerie)."
          : "Dépenses que vous anticipez."}
      </div>

      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <div className="text-sm text-slate-400">
            {sub === "achete" ? "Aucune dépense achetée." : "Aucune dépense prévue."}
          </div>
        ) : (
          <>
            {/* Ordinateur : tableau. */}
            <table className="hidden w-full text-sm md:table">
              <thead className="text-left text-xs text-slate-400">
                <tr>
                  <th className="py-1">{sub === "achete" ? "Acheté le" : "Date"}</th>
                  <th>Nom</th>
                  <th className="text-center">Pour qui</th>
                  <th className="text-right">Montant</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="group border-t border-slate-100 dark:border-slate-800">
                    <td className="w-24 py-1.5 text-slate-500">
                      {sub === "achete"
                        ? p.purchasedAt
                          ? dateFr(p.purchasedAt)
                          : "—"
                        : p.date
                          ? dateFr(p.date)
                          : "—"}
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1">
                        {p.name}
                        <button
                          onClick={() => setModal({ item: p })}
                          title="Modifier"
                          className="text-slate-400 opacity-0 transition hover:text-brand-600 group-hover:opacity-100"
                        >
                          ✎
                        </button>
                      </span>
                      {p.description && (
                        <span className="block text-xs text-slate-400">{p.description}</span>
                      )}
                    </td>
                    <td>
                      <div className="flex justify-center" title={p.owner === "joint" ? "Commun" : p.owner}>
                        <OwnerAvatar owner={p.owner} className="h-7 w-7 text-sm" />
                      </div>
                    </td>
                    <td className="text-right font-medium tabular-nums">{eur(p.amount)}</td>
                    <td className="text-right">
                      <div className="inline-flex items-center gap-3">
                        {sub === "prevue" ? (
                          <button
                            onClick={() => setPurchased.mutate({ id: p.id, purchasedAt: todayIso() })}
                            disabled={setPurchased.isPending}
                            className="whitespace-nowrap rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-brand-700"
                            title="Marquer comme achetée (aujourd'hui)"
                          >
                            Acheté
                          </button>
                        ) : (
                          <button
                            onClick={() => setPurchased.mutate({ id: p.id, purchasedAt: null })}
                            disabled={setPurchased.isPending}
                            className="btn-ghost whitespace-nowrap px-2 py-0.5 text-xs"
                            title="Remettre en prévue"
                          >
                            ↩ Prévue
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (confirm(`Supprimer « ${p.name} » ?`)) remove.mutate(p.id);
                          }}
                          className="text-slate-300 hover:text-red-500"
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-300 font-semibold dark:border-slate-700">
                  <td className="py-1.5"></td>
                  <td>Total</td>
                  <td></td>
                  <td className="text-right tabular-nums">{eur(total)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>

            {/* Mobile : une carte par dépense, sur plusieurs lignes. */}
            <div className="md:hidden">
              {rows.map((p) => (
                <div
                  key={p.id}
                  className="border-t border-slate-100 py-3 first:border-t-0 first:pt-0 dark:border-slate-800"
                >
                  <button
                    onClick={() => setModal({ item: p })}
                    className="block w-full text-left"
                    title="Modifier"
                  >
                    <div className="flex items-start gap-3">
                      <OwnerAvatar owner={p.owner} className="h-8 w-8 shrink-0 text-sm" />
                      <div className="min-w-0 flex-1 self-center text-sm font-medium leading-snug">
                        {p.name}
                      </div>
                      <div className="shrink-0 text-right font-medium tabular-nums">
                        {eur(p.amount)}
                      </div>
                    </div>
                    {/* Description en pleine largeur. */}
                    {p.description && (
                      <div className="mt-1 text-xs text-slate-400">{p.description}</div>
                    )}
                  </button>
                  <div className="mt-2 flex items-center justify-end gap-4">
                    {(sub === "achete" ? p.purchasedAt : p.date) && (
                      <span className="mr-auto text-xs">
                        {sub === "achete" ? dateFr(p.purchasedAt!) : dateFr(p.date!)}
                      </span>
                    )}
                    {sub === "prevue" ? (
                      <button
                        onClick={() => setPurchased.mutate({ id: p.id, purchasedAt: todayIso() })}
                        disabled={setPurchased.isPending}
                        className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-brand-700"
                      >
                        Acheté
                      </button>
                    ) : (
                      <button
                        onClick={() => setPurchased.mutate({ id: p.id, purchasedAt: null })}
                        disabled={setPurchased.isPending}
                        className="btn-ghost px-2 py-0.5 text-xs"
                      >
                        ↩ Prévue
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (confirm(`Supprimer « ${p.name} » ?`)) remove.mutate(p.id);
                      }}
                      className="text-slate-300 hover:text-red-500"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between border-t-2 border-slate-300 pt-2 font-semibold dark:border-slate-700">
                <span>Total</span>
                <span className="tabular-nums">{eur(total)}</span>
              </div>
            </div>
          </>
        )}
      </div>

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

      {/* Bouton flottant de création (mobile uniquement, onglet Prévue). */}
      {sub === "prevue" && (
      <button
        type="button"
        onClick={() => setModal({ item: null })}
        aria-label="Ajouter une dépense prévue"
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

interface ElecData {
  years: number[];
  byYear: Record<number, Record<number, number>>;
  yearTotals: Record<number, number>;
}

function Electricite() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["utilities"],
    queryFn: () => api.get<ElecData>("/api/utilities?utility=electricity"),
  });
  // Pré-sélectionne le mois précédent (relevé du mois écoulé), avec bascule d'année en janvier.
  const prevMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  const [form, setForm] = useState({
    year: prevMonth.getFullYear(),
    month: prevMonth.getMonth() + 1,
    kwh: 0,
  });

  const add = useMutation({
    mutationFn: () => api.post("/api/utilities", { utility: "electricity", ...form }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["utilities"] }),
  });

  if (!data) return <PageLoader variant="argent" />;

  const chart = MONTHS.map((m, i) => {
    const row: Record<string, number | string> = { month: m };
    for (const y of data.years) row[String(y)] = data.byYear[y]?.[i + 1] ?? 0;
    return row;
  });
  const lineColors = ["#94a3b8", "#60a5fa", "#34d399", "#fbbf24", "#f472b6", "#4f46e5"];

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="mb-2 text-sm font-semibold">Consommation par mois (kWh)</div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              {data.years.map((y, i) => (
                <Line key={y} dataKey={String(y)} stroke={lineColors[i % lineColors.length]} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-400">
            <tr>
              <th className="py-1">Mois</th>
              {data.years.map((y) => (
                <th key={y} className="text-right">
                  {y}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MONTHS.map((m, i) => {
              // valeurs de ce mois sur toutes les années (comparaison mars vs mars, etc.)
              const vals = data.years
                .map((y) => data.byYear[y]?.[i + 1])
                .filter((v): v is number => typeof v === "number");
              const max = vals.length > 1 ? Math.max(...vals) : null;
              const min = vals.length > 1 ? Math.min(...vals) : null;
              return (
                <tr key={m} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1">{m}</td>
                  {data.years.map((y) => {
                    const v = data.byYear[y]?.[i + 1];
                    const isMax = max !== null && v === max && min !== max;
                    const isMin = min !== null && v === min && min !== max;
                    return (
                      <td
                        key={y}
                        className={`text-right font-medium ${
                          isMax ? "text-red-600" : isMin ? "text-green-600" : ""
                        }`}
                      >
                        {v ?? "—"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr className="border-t-2 border-slate-300 font-semibold dark:border-slate-700">
              <td className="py-1">Total</td>
              {data.years.map((y) => (
                <td key={y} className="text-right">
                  {data.yearTotals[y] ?? 0}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
        className="card"
      >
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden>⚡</span> Ajouter un relevé
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[6rem,1fr,1fr,auto] sm:items-end">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            Année
            <Input
              type="number"
              value={form.year}
              onChange={(e) => setForm({ ...form, year: Number(e.target.value) })}
            />
          </label>
          <div className="flex flex-col gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            Mois
            <Select
              value={String(form.month)}
              onChange={(v) => setForm({ ...form, month: Number(v) })}
              options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
            />
          </div>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            Consommation (kWh)
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={form.kwh}
              onChange={(e) => setForm({ ...form, kwh: Number(e.target.value) })}
            />
          </label>
          <button
            className="btn-primary col-span-2 disabled:opacity-40 sm:col-span-1"
            disabled={add.isPending}
          >
            {add.isPending ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------------- Équilibrage ---------------- */

function Equilibrage() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { view } = useParams();
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

  if (!balance) return <PageLoader variant="argent" />;

  // Filtrage selon le sous-onglet Actif / Archivé.
  const txShown = (transactions ?? []).filter((t) => (isArchived ? t.archived : !t.archived));
  const setShown = (settlements ?? []).filter((s) => (isArchived ? s.archived : !s.archived));
  const activeCount =
    (transactions ?? []).filter((t) => !t.archived).length +
    (settlements ?? []).filter((s) => !s.archived).length;

  return (
    <div className="space-y-4">
      {/* Sous-menus Actif / Archivé — une URL par vue */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <span aria-hidden="true" />
        <PillToggle
          value={statut}
          onChange={(v) => navigate(`/money/equilibrage/${v}`)}
          items={[
            { value: "actif", label: "Actif" },
            { value: "archive", label: "Archivé" },
          ]}
        />
        <div className="flex justify-end">
          {!isArchived && activeCount > 0 && (
            <button
              onClick={() => {
                if (confirm("Archiver toutes les dépenses et remboursements en cours ? Ils ne compteront plus dans le solde."))
                  archiveAll.mutate();
              }}
              disabled={archiveAll.isPending}
              className="btn-ghost text-sm disabled:opacity-50"
            >
              🗄️ Tout archiver
            </button>
          )}
        </div>
      </div>

      {/* Solde — uniquement en vue Actif (les archives ne comptent pas) */}
      {!isArchived && (
      <div className="card">
        <div className="text-sm font-semibold">Qui doit combien</div>
        {balance.amount === 0 ? (
          <div className="mt-2 text-green-600">Tout est équilibré ✅</div>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-lg">
              <MemberAvatar id={balance.fromUser} /> doit <b>{eur(balance.amount)}</b> à{" "}
              <MemberAvatar id={balance.toUser} />
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Calculé à partir des dépenses avancées par l'un pour les deux, moins les remboursements.
            </p>
            <button onClick={() => settle.mutate(balance)} className="btn-primary mt-3">
              Marquer le solde comme réglé
            </button>
          </>
        )}
      </div>
      )}

      {/* Dépenses partagées */}
      <div className="card">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold">Dépenses partagées{isArchived ? " archivées" : ""}</div>
          {!isArchived && (
            <button onClick={() => setExpModal({ open: true, item: null })} className="btn-primary">
              + Dépense
            </button>
          )}
        </div>
        {txShown.length === 0 ? (
          <div className="text-sm text-slate-400">
            {isArchived ? "Aucune dépense archivée." : "Aucune dépense partagée enregistrée."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-400">
              <tr>
                <th className="py-1">Date</th>
                <th>Description</th>
                <th>Payé par</th>
                <th className="text-right">Montant</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {txShown
                .slice()
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((t) => (
                  <tr key={t.id} className="group border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1.5 text-slate-500">{dateFr(t.date)}</td>
                    <td>
                      <span className="inline-flex items-center gap-1">
                        {t.label}
                        {!isArchived && (
                          <button
                            onClick={() => setExpModal({ open: true, item: t })}
                            title="Modifier"
                            className="text-slate-400 opacity-0 transition hover:text-brand-600 group-hover:opacity-100"
                          >
                            ✎
                          </button>
                        )}
                      </span>
                    </td>
                    <td>
                      {t.paidBy === "joint" ? (
                        <span className="text-slate-500">Compte joint</span>
                      ) : (
                        <MemberAvatar id={t.paidBy} />
                      )}
                    </td>
                    <td className="text-right font-medium">{eur(Math.abs(t.amount))}</td>
                    <td className="whitespace-nowrap text-right">
                      {isArchived ? (
                        <button
                          onClick={() => setTxArchived.mutate({ id: t.id, archived: false })}
                          title="Restaurer (revient dans le calcul du solde)"
                          className="px-1 text-slate-400 hover:text-brand-600"
                        >
                          ↩︎
                        </button>
                      ) : (
                        <button
                          onClick={() => setTxArchived.mutate({ id: t.id, archived: true })}
                          title="Archiver"
                          className="px-1 text-slate-300 hover:text-brand-600"
                        >
                          🗄️
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (confirm(`Supprimer « ${t.label} » ?`)) removeExpense.mutate(t.id);
                        }}
                        className="px-1 text-slate-300 hover:text-red-500"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Remboursements */}
      <div className="card">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold">Remboursements{isArchived ? " archivés" : ""}</div>
          {!isArchived && (
            <button onClick={() => setSetModal({ open: true, item: null })} className="btn-primary">
              + Remboursement
            </button>
          )}
        </div>
        {setShown.length === 0 ? (
          <div className="text-sm text-slate-400">
            {isArchived ? "Aucun remboursement archivé." : "Aucun remboursement enregistré."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-400">
              <tr>
                <th className="py-1">Date</th>
                <th>De → à</th>
                <th className="text-right">Montant</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {setShown
                .slice()
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((srow) => (
                  <tr key={srow.id} className="group border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1.5 text-slate-500">{dateFr(srow.date)}</td>
                    <td>
                      <span className="inline-flex items-center gap-1.5">
                        <MemberAvatar id={srow.fromUser} /> → <MemberAvatar id={srow.toUser} />
                        {!isArchived && (
                          <button
                            onClick={() => setSetModal({ open: true, item: srow })}
                            title="Modifier"
                            className="text-slate-400 opacity-0 transition hover:text-brand-600 group-hover:opacity-100"
                          >
                            ✎
                          </button>
                        )}
                      </span>
                    </td>
                    <td className="text-right font-medium text-green-600">{eur(srow.amount)}</td>
                    <td className="whitespace-nowrap text-right">
                      {isArchived ? (
                        <button
                          onClick={() => setSettlementArchived.mutate({ id: srow.id, archived: false })}
                          title="Restaurer"
                          className="px-1 text-slate-400 hover:text-brand-600"
                        >
                          ↩︎
                        </button>
                      ) : (
                        <button
                          onClick={() => setSettlementArchived.mutate({ id: srow.id, archived: true })}
                          title="Archiver"
                          className="px-1 text-slate-300 hover:text-brand-600"
                        >
                          🗄️
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (confirm("Supprimer ce remboursement ?")) removeSettlement.mutate(srow.id);
                        }}
                        className="px-1 text-slate-300 hover:text-red-500"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>

      {expModal.open && (
        <ExpenseModal
          key={expModal.item?.id ?? "new"}
          item={expModal.item}
          accounts={accounts ?? []}
          splitA={me.household.defaultSplitA}
          splitB={me.household.defaultSplitB}
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
  onClose,
  onSaved,
}: {
  item: Transaction | null;
  accounts: Account[];
  splitA: number;
  splitB: number;
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
      onClose={onClose}
      onSave={(v) => save.mutate(v)}
    />
  );
}

function SettlementModal({
  item,
  balance,
  onClose,
  onSaved,
}: {
  item: Settlement | null;
  /** Solde courant : pré-remplit un nouveau remboursement (montant + sens). */
  balance?: Balance;
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
