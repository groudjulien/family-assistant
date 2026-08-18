import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  FollowedCity,
  ActivityFeed,
  StreamingProvider,
  HouseholdConfig,
  TransitKind,
  TransitLineConfig,
  ExpenseCategory,
  ShoppingCategory,
  DefaultPackingItem,
  PackingCategory,
  PackingPerson,
} from "@gfa/shared";
import {
  FR_CERTS,
  IDF_LINES,
  TRANSIT_KINDS,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_SHOPPING_CATEGORIES,
  FALLBACK_SHOPPING_CATEGORY,
  PACKING_CATEGORIES,
  PACKING_CATEGORY_META,
  comparePackingItems,
} from "@gfa/shared";
import { PersonAvatar, PersonPicker, usePackingPersons, useMembers, MemberAvatar } from "../components/MemberAvatar";
import { useMe } from "../auth";
import { api } from "../lib/api";
import { Select, SearchSelect, SubNav, Input } from "../components/ui";
import {
  NAV,
  ALWAYS_VISIBLE_NAV,
  orderedNav,
  newSeparatorKey,
  type NavItem,
} from "../components/Layout";
import { NavIcon } from "../components/icons";
import { getStoredTheme, setTheme, type Theme } from "../lib/theme";
import {
  getLoaderDelay,
  setLoaderDelay,
  MAX_LOADER_DELAY_MS,
  DEFAULT_LOADER_DELAY_MS,
} from "../lib/loaderDelay";
import { APP_VERSION } from "../version";
import { usePageHeader, usePageTabs } from "../components/PageHeader";

function EyeIcon({ off }: { off: boolean }) {
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
      {off ? (
        <>
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
          <line x1="2" y1="2" x2="22" y2="22" />
        </>
      ) : (
        <>
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

function SortableMenuItem({
  item,
  hidden,
  canHide,
  groupName,
  onRenameGroup,
  onCommitGroups,
  onToggleHidden,
  onRemove,
  onUp,
  onDown,
  isFirst,
  isLast,
}: {
  item: NavItem;
  hidden: boolean;
  canHide: boolean;
  /** Nom du groupe (uniquement pour un item `separator`). */
  groupName?: string;
  onRenameGroup: (name: string) => void;
  /** Enregistre le renommage (appelé à la sortie du champ, pas à chaque frappe). */
  onCommitGroups: () => void;
  onToggleHidden: () => void;
  onRemove: () => void;
  onUp: () => void;
  onDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.to,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-sm ${
        isDragging
          ? "border-brand-400 bg-brand-50 dark:bg-slate-800"
          : item.separator
            ? "border-dashed border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50"
            : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
      } ${hidden ? "opacity-50" : ""}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="hidden cursor-grab text-slate-300 hover:text-slate-500 sm:block"
        title="Glisser pour réordonner"
      >
        ⠿
      </button>
      {item.separator ? (
        <input
          value={groupName ?? ""}
          onChange={(e) => onRenameGroup(e.target.value)}
          onBlur={onCommitGroups}
          placeholder="Nom du groupe (ex. Au quotidien)"
          aria-label="Nom du groupe"
          maxLength={40}
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-2xs font-semibold uppercase text-ink outline-none placeholder:normal-case placeholder:font-normal placeholder:tracking-normal placeholder:text-ink-3 focus:border-brand-500"
        />
      ) : (
        <>
          <NavIcon to={item.to} size={20} className="shrink-0 text-ink-2" />
          <span className={`font-medium ${hidden ? "line-through" : ""}`}>{item.label}</span>
        </>
      )}
      <div className="ml-auto flex items-center gap-1">
        {item.separator && (
          <button
            onClick={onRemove}
            aria-label="Retirer le groupe"
            title="Retirer le groupe"
            className="rounded-lg px-2 py-1 text-slate-400 transition hover:bg-slate-100 hover:text-danger dark:hover:bg-slate-800"
          >
            ✕
          </button>
        )}
        {canHide && (
          <button
            onClick={onToggleHidden}
            aria-label={hidden ? "Afficher le menu" : "Masquer le menu"}
            title={hidden ? "Afficher le menu" : "Masquer le menu"}
            className="rounded-lg px-2 py-1 text-slate-400 transition hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
          >
            <EyeIcon off={hidden} />
          </button>
        )}
        <button
          onClick={onUp}
          disabled={isFirst}
          aria-label="Monter"
          className="rounded-lg px-2 py-1 text-slate-400 transition hover:bg-slate-100 hover:text-brand-600 disabled:opacity-30 dark:hover:bg-slate-800"
        >
          ↑
        </button>
        <button
          onClick={onDown}
          disabled={isLast}
          aria-label="Descendre"
          className="rounded-lg px-2 py-1 text-slate-400 transition hover:bg-slate-100 hover:text-brand-600 disabled:opacity-30 dark:hover:bg-slate-800"
        >
          ↓
        </button>
      </div>
    </div>
  );
}

function SortableTransitRow({
  line,
  onToggleKind,
  onEdit,
  onRemove,
  onUp,
  onDown,
  isFirst,
  isLast,
}: {
  line: TransitLineConfig;
  onToggleKind: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onUp: () => void;
  onDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: line.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
        isDragging
          ? "border-brand-400 bg-brand-50 dark:bg-slate-800"
          : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="hidden cursor-grab text-slate-300 hover:text-slate-500 sm:block"
        title="Glisser pour réordonner"
      >
        ⠿
      </button>
      <span
        className="flex h-6 min-w-6 items-center justify-center rounded px-1 text-2xs font-bold text-white"
        style={{ backgroundColor: line.color }}
      >
        {line.lineCode}
      </span>
      <span className="font-medium">{line.label}</span>
      <span className="text-xs text-slate-500">
        {line.stationA} ↔ {line.stationB}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={onToggleKind}
          className={`rounded-full px-2 py-0.5 text-xs font-medium transition ${
            line.kind === "principal"
              ? "bg-brand-100 text-brand-700"
              : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300"
          }`}
          title="Basculer principale / secondaire"
        >
          {line.kind === "principal" ? "Principale" : "Secondaire"}
        </button>
        <button onClick={onEdit} className="text-slate-400 hover:text-brand-600" title="Modifier">
          ✎
        </button>
        <button
          onClick={onUp}
          disabled={isFirst}
          aria-label="Monter"
          className="text-slate-400 transition hover:text-brand-600 disabled:opacity-30"
        >
          ↑
        </button>
        <button
          onClick={onDown}
          disabled={isLast}
          aria-label="Descendre"
          className="text-slate-400 transition hover:text-brand-600 disabled:opacity-30"
        >
          ↓
        </button>
        <button onClick={onRemove} className="text-slate-300 hover:text-red-500" title="Retirer">
          ✕
        </button>
      </div>
    </div>
  );
}

function MenuOrderCard() {
  const me = useMe();
  const qc = useQueryClient();
  const [order, setOrder] = useState<NavItem[]>(() => orderedNav(me.menuOrder));
  const [hidden, setHidden] = useState<string[]>(() => me.menuHidden ?? []);
  const [groups, setGroups] = useState<Record<string, string>>(() => me.menuGroups ?? {});
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const save = useMutation({
    mutationFn: (prefs: { order: string[]; hidden: string[]; groups: Record<string, string> }) =>
      api.patch("/api/household/menu-order", prefs),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
  /** Renommage : local à chaque frappe, enregistré à la sortie du champ. */
  const renameGroup = (key: string, name: string) =>
    setGroups((prev) => ({ ...prev, [key]: name }));
  const commitGroups = () => save.mutate({ order: order.map((n) => n.to), hidden, groups });
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setOrder((prev) => {
      const oldI = prev.findIndex((n) => n.to === active.id);
      const newI = prev.findIndex((n) => n.to === over.id);
      if (oldI < 0 || newI < 0) return prev;
      const next = arrayMove(prev, oldI, newI);
      save.mutate({ order: next.map((n) => n.to), hidden, groups });
      return next;
    });
  };
  const move = (index: number, dir: -1 | 1) => {
    setOrder((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = arrayMove(prev, index, target);
      save.mutate({ order: next.map((n) => n.to), hidden, groups });
      return next;
    });
  };
  const toggleHidden = (key: string) => {
    setHidden((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      save.mutate({ order: order.map((n) => n.to), hidden: next, groups });
      return next;
    });
  };
  // Groupes : ajoutés en fin de liste (puis déplaçables comme un menu).
  const addGroup = () => {
    setOrder((prev) => {
      const next = [...prev, { to: newSeparatorKey(), label: "", separator: true as const }];
      save.mutate({ order: next.map((n) => n.to), hidden, groups });
      return next;
    });
  };
  const removeAt = (index: number) => {
    setOrder((prev) => {
      const removed = prev[index];
      const next = prev.filter((_, i) => i !== index);
      // Un groupe supprimé emporte son nom : pas de clé orpheline en base.
      const nextGroups = { ...groups };
      delete nextGroups[removed.to];
      setGroups(nextGroups);
      save.mutate({ order: next.map((n) => n.to), hidden, groups: nextGroups });
      return next;
    });
  };
  const reset = () => {
    setOrder(NAV);
    setHidden([]);
    setGroups({});
    save.mutate({ order: NAV.map((n) => n.to), hidden: [], groups: {} });
  };
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">🧭 Menus de navigation</div>
        <button onClick={reset} className="text-xs text-slate-400 hover:text-brand-600">
          Réinitialiser
        </button>
      </div>
      <p className="mb-3 mt-1 text-xs text-slate-400">
        Glisse les menus pour choisir leur ordre, et utilise l'œil pour masquer ceux qui ne
        t'intéressent pas. Un groupe titre les menus placés en dessous de lui, dans le menu latéral
        comme dans le menu mobile. Réglage propre à ton compte.
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order.map((n) => n.to)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1.5">
            {order.map((n, i) => (
              <SortableMenuItem
                key={n.to}
                item={n}
                hidden={hidden.includes(n.to)}
                canHide={!n.separator && !ALWAYS_VISIBLE_NAV.includes(n.to)}
                groupName={groups[n.to]}
                onRenameGroup={(name) => renameGroup(n.to, name)}
                onCommitGroups={commitGroups}
                onToggleHidden={() => toggleHidden(n.to)}
                onRemove={() => removeAt(i)}
                onUp={() => move(i, -1)}
                onDown={() => move(i, 1)}
                isFirst={i === 0}
                isLast={i === order.length - 1}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <button onClick={addGroup} className="btn-ghost mt-3 w-full justify-center gap-2 text-xs">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        Ajouter un groupe
      </button>
    </div>
  );
}

const CERT_LABEL: Record<string, string> = {
  U: "Tous publics",
  "10": "10 ans et +",
  "12": "12 ans et +",
  "16": "16 ans et +",
  "18": "18 ans et +",
};
const PROVIDER_LABEL: Record<string, string> = {
  Netflix: "Netflix",
  "Amazon Prime Video": "Amazon Prime",
  "Disney Plus": "Disney+",
  "Canal+": "Canal+",
};

// Icône « lien externe » (flèche sortant d'un cadre) pour rediriger vers la
// console de gestion d'une clé API.
function ExternalLinkIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </svg>
  );
}

// Lien vers la console externe de gestion, positionné en haut à droite d'une card.
function KeyManageLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={label}
      aria-label={label}
      className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
    >
      <ExternalLinkIcon />
    </a>
  );
}

function AnthropicKeyCard() {
  const me = useMe();
  const qc = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [editing, setEditing] = useState(false);

  const save = useMutation({
    mutationFn: (key: string) => api.put("/api/household/anthropic-key", { apiKey: key }),
    onSuccess: () => {
      setApiKey("");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del("/api/household/anthropic-key"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });

  const showForm = editing || !me.hasAnthropicKey;

  return (
    <div className="card flex flex-col gap-3">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-semibold">🤖 Clé API Claude</div>
          <KeyManageLink
            href="https://platform.claude.com/settings/workspaces/default/keys"
            label="Gérer les clés API sur Claude"
          />
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Nécessaire pour le chat et les générations IA (voyage depuis les emails, recettes…). Stockée
          chiffrée en base. Crée une clé sur{" "}
          <span className="font-mono">platform.claude.com</span>.
        </p>
      </div>

      {me.hasAnthropicKey && !editing && (
        <div className="mt-auto flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-2.5 py-1 text-xs font-medium text-brand-700">
            ✓ Clé configurée
          </span>
          <button onClick={() => setEditing(true)} className="btn-ghost text-xs">
            Modifier
          </button>
          <button
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            className="text-xs text-red-500 hover:text-red-600"
          >
            Supprimer
          </button>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (apiKey.trim().length >= 10) save.mutate(apiKey.trim());
          }}
          className="mt-auto flex flex-wrap items-center gap-2"
        >
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-…"
            className="input flex-1 font-mono"
          />
          <button className="btn-primary" disabled={save.isPending || apiKey.trim().length < 10}>
            Enregistrer
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setApiKey("");
              }}
              className="btn-ghost"
            >
              Annuler
            </button>
          )}
        </form>
      )}
      {save.isError && <p className="text-xs text-red-500">Échec de l'enregistrement.</p>}
    </div>
  );
}

function LunchflowKeyCard() {
  const me = useMe();
  const qc = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [editing, setEditing] = useState(false);

  const save = useMutation({
    mutationFn: (key: string) => api.put("/api/household/lunchflow-key", { apiKey: key }),
    onSuccess: () => {
      setApiKey("");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del("/api/household/lunchflow-key"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });

  const showForm = editing || !me.hasLunchflowKey;

  return (
    <div className="card flex flex-col gap-3">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-semibold">🏦 Clé API LunchFlow</div>
          <KeyManageLink
            href="https://www.lunchflow.app/dashboard"
            label="Gérer sur le tableau de bord LunchFlow"
          />
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Permet de synchroniser automatiquement les soldes des comptes bancaires. Stockée chiffrée en
          base. Crée une clé depuis ton tableau de bord{" "}
          <span className="font-mono">lunchflow.app</span>, puis associe tes comptes dans{" "}
          <span className="font-medium">Argent → Comptes bancaires</span>.
        </p>
      </div>

      {me.hasLunchflowKey && !editing && (
        <div className="mt-auto flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-2.5 py-1 text-xs font-medium text-brand-700">
            ✓ Clé configurée
          </span>
          <button onClick={() => setEditing(true)} className="btn-ghost text-xs">
            Modifier
          </button>
          <button
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            className="text-xs text-red-500 hover:text-red-600"
          >
            Supprimer
          </button>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (apiKey.trim().length >= 10) save.mutate(apiKey.trim());
          }}
          className="mt-auto flex flex-wrap items-center gap-2"
        >
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Clé API LunchFlow"
            className="input flex-1 font-mono"
          />
          <button className="btn-primary" disabled={save.isPending || apiKey.trim().length < 10}>
            Enregistrer
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setApiKey("");
              }}
              className="btn-ghost"
            >
              Annuler
            </button>
          )}
        </form>
      )}
      {save.isError && <p className="text-xs text-red-500">Échec de l'enregistrement.</p>}
    </div>
  );
}

function MobiliteKeysCard() {
  const me = useMe();
  const qc = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [jeton, setJeton] = useState("");
  const [editing, setEditing] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      api.put("/api/household/mobilite-keys", { apiKey: apiKey.trim(), jeton: jeton.trim() }),
    onSuccess: () => {
      setApiKey("");
      setJeton("");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["transit"] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del("/api/household/mobilite-keys"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["transit"] });
    },
  });

  const showForm = editing || !me.hasPrimKey;

  return (
    <div className="card flex flex-col gap-3">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-semibold">🚇 Clés Mobilité (Île-de-France)</div>
          <KeyManageLink
            href="https://prim.iledefrance-mobilites.fr/"
            label="Gérer sur le portail PRIM"
          />
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Nécessaire pour le trafic et les horaires (Transilien, RER, métro). Stockées chiffrées en
          base. Crée une clé API et un jeton sur le portail{" "}
          <span className="font-mono">prim.iledefrance-mobilites.fr</span>. Le jeton est optionnel.
        </p>
      </div>

      {me.hasPrimKey && !editing && (
        <div className="mt-auto flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-2.5 py-1 text-xs font-medium text-brand-700">
            ✓ Clé API configurée
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              me.hasPrimJeton
                ? "bg-brand-100 text-brand-700"
                : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
            }`}
          >
            {me.hasPrimJeton ? "✓ Jeton configuré" : "Jeton non défini"}
          </span>
          <button onClick={() => setEditing(true)} className="btn-ghost text-xs">
            Modifier
          </button>
          <button
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            className="text-xs text-red-500 hover:text-red-600"
          >
            Supprimer
          </button>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (apiKey.trim().length >= 1) save.mutate();
          }}
          className="mt-auto space-y-2"
        >
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Clé API PRIM (PRIM_IDF_MOBILITE_API)"
            className="input w-full font-mono"
          />
          <input
            type="password"
            autoComplete="off"
            value={jeton}
            onChange={(e) => setJeton(e.target.value)}
            placeholder="Jeton PRIM (PRIM_JETON) — optionnel"
            className="input w-full font-mono"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary" disabled={save.isPending || apiKey.trim().length < 1}>
              Enregistrer
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setApiKey("");
                  setJeton("");
                }}
                className="btn-ghost"
              >
                Annuler
              </button>
            )}
          </div>
        </form>
      )}
      {save.isError && <p className="text-xs text-red-500">Échec de l'enregistrement.</p>}
    </div>
  );
}

function TmdbKeyCard() {
  const me = useMe();
  const qc = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [editing, setEditing] = useState(false);

  const save = useMutation({
    mutationFn: (key: string) => api.put("/api/household/tmdb-key", { apiKey: key }),
    onSuccess: () => {
      setApiKey("");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del("/api/household/tmdb-key"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });

  const showForm = editing || !me.hasTmdbKey;

  return (
    <div className="card flex flex-col gap-3">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-semibold">🎬 Clé API TMDB</div>
          <KeyManageLink
            href="https://www.themoviedb.org/settings/api"
            label="Gérer les clés API sur TMDB"
          />
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Nécessaire pour les suggestions de films et la disponibilité streaming. Stockée chiffrée en
          base. Crée une clé (v3) sur <span className="font-mono">themoviedb.org</span>.
        </p>
      </div>

      {me.hasTmdbKey && !editing && (
        <div className="mt-auto flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-2.5 py-1 text-xs font-medium text-brand-700">
            ✓ Clé configurée
          </span>
          <button onClick={() => setEditing(true)} className="btn-ghost text-xs">
            Modifier
          </button>
          <button
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            className="text-xs text-red-500 hover:text-red-600"
          >
            Supprimer
          </button>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (apiKey.trim().length >= 1) save.mutate(apiKey.trim());
          }}
          className="mt-auto flex flex-wrap items-center gap-2"
        >
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Clé API TMDB (v3)"
            className="input flex-1 font-mono"
          />
          <button className="btn-primary" disabled={save.isPending || apiKey.trim().length < 1}>
            Enregistrer
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setApiKey("");
              }}
              className="btn-ghost"
            >
              Annuler
            </button>
          )}
        </form>
      )}
      {save.isError && <p className="text-xs text-red-500">Échec de l'enregistrement.</p>}
    </div>
  );
}

function SortableCity({
  city,
  onRemove,
  onUp,
  onDown,
  isFirst,
  isLast,
}: {
  city: FollowedCity;
  onRemove: () => void;
  onUp: () => void;
  onDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: city.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 ${
        isDragging ? "opacity-60" : ""
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="hidden cursor-grab text-slate-400 hover:text-slate-600 sm:block"
        title="Déplacer"
      >
        ⠿
      </button>
      <span className="flex-1">{city.name}</span>
      <button
        onClick={onUp}
        disabled={isFirst}
        aria-label="Monter"
        className="rounded-lg px-1.5 text-slate-400 transition hover:text-brand-600 disabled:opacity-30"
      >
        ↑
      </button>
      <button
        onClick={onDown}
        disabled={isLast}
        aria-label="Descendre"
        className="rounded-lg px-1.5 text-slate-400 transition hover:text-brand-600 disabled:opacity-30"
      >
        ↓
      </button>
      <button onClick={onRemove} className="text-slate-300 hover:text-red-500" title="Retirer">
        ✕
      </button>
    </div>
  );
}

function WeatherCitiesCard() {
  const qc = useQueryClient();
  const [newCity, setNewCity] = useState("");
  const [order, setOrder] = useState<FollowedCity[]>([]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { data } = useQuery({
    queryKey: ["weather-cities"],
    queryFn: () => api.get<FollowedCity[]>("/api/household/weather-cities"),
  });
  useEffect(() => {
    if (data) setOrder(data);
  }, [data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["weather-cities"] });
    qc.invalidateQueries({ queryKey: ["weather"] });
  };
  const add = useMutation({
    mutationFn: (name: string) => api.post("/api/household/weather-cities", { name }),
    onSuccess: () => {
      setNewCity("");
      invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/household/weather-cities/${id}`),
    onSuccess: invalidate,
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.post("/api/household/weather-cities/reorder", { order: ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["weather"] }),
  });

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setOrder((prev) => {
      const from = prev.findIndex((c) => c.id === e.active.id);
      const to = prev.findIndex((c) => c.id === e.over!.id);
      if (from < 0 || to < 0) return prev;
      const next = arrayMove(prev, from, to);
      reorder.mutate(next.map((c) => c.id));
      return next;
    });
  };
  const move = (index: number, dir: -1 | 1) => {
    setOrder((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = arrayMove(prev, index, target);
      reorder.mutate(next.map((c) => c.id));
      return next;
    });
  };

  return (
    <div className="card">
      <div className="text-sm font-semibold">🌤️ Météo</div>
      <p className="mb-3 mt-1 text-xs text-slate-400">
        Villes du widget météo de l'accueil. Glisse ⠿ pour les réordonner.
      </p>
      {order.length === 0 ? (
        <p className="mb-3 text-sm text-slate-400">Aucune ville (Paris par défaut).</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            <div className="mb-3 space-y-1.5">
              {order.map((c, i) => (
                <SortableCity
                  key={c.id}
                  city={c}
                  onRemove={() => remove.mutate(c.id)}
                  onUp={() => move(i, -1)}
                  onDown={() => move(i, 1)}
                  isFirst={i === 0}
                  isLast={i === order.length - 1}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (newCity.trim()) add.mutate(newCity.trim());
        }}
        className="flex gap-2"
      >
        <input
          value={newCity}
          onChange={(e) => setNewCity(e.target.value)}
          placeholder="Ajouter une ville…"
          className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        <button className="btn-primary" disabled={add.isPending || !newCity.trim()}>
          Ajouter
        </button>
      </form>
      {add.isError && (
        <p className="mt-2 text-xs text-red-500">Ville introuvable, vérifie l'orthographe.</p>
      )}
    </div>
  );
}

const CATEGORY_ICON_CHOICES = [
  "🍽️", "🏠", "🚆", "🎉", "🎁", "🛍️", "☕", "🍺", "🍕", "🥐",
  "🍷", "🧀", "🛒", "⛽", "🚕", "🚌", "✈️", "⛴️", "🏨", "🏖️",
  "🎢", "🎫", "🎭", "🎨", "📸", "🎧", "📚", "💊", "🩹", "👕",
  "💇", "💐", "🐟", "🥾", "🎿", "🧾", "💶", "🎰", "🏛️", "🌍",
];

/**
 * Rayons de la liste de courses. L'ordre est celui du magasin : c'est lui qui
 * dicte l'ordre des sections sur la page Courses.
 *
 * La clé d'un rayon ne change jamais (les articles y sont rattachés) : renommer
 * « Frais » en « Marché » garde les articles en place.
 */
function ShoppingCategoriesCard() {
  const me = useMe();
  const qc = useQueryClient();
  const [cats, setCats] = useState<ShoppingCategory[]>(
    () => me.shoppingCategories ?? DEFAULT_SHOPPING_CATEGORIES.map((c) => ({ ...c })),
  );
  const [newName, setNewName] = useState("");

  const save = useMutation({
    mutationFn: (next: ShoppingCategory[]) =>
      api.patch("/api/household/shopping-categories", { categories: next }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
  const commit = (next: ShoppingCategory[]) => {
    setCats(next);
    save.mutate(next);
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= cats.length) return;
    const next = [...cats];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };
  const add = () => {
    const name = newName.trim();
    if (!name) return;
    // Le rayon « autre » reste le dernier : il accueille les produits inconnus.
    const next = [...cats];
    const fallbackAt = next.findIndex((c) => c.key === FALLBACK_SHOPPING_CATEGORY);
    const entry = { key: `r_${Date.now().toString(36)}`, name };
    if (fallbackAt >= 0) next.splice(fallbackAt, 0, entry);
    else next.push(entry);
    commit(next);
    setNewName("");
  };

  return (
    <div className="card">
      <div className="text-sm font-semibold">🛒 Rayons de courses</div>
      <p className="mb-3 mt-1 text-xs text-slate-400">
        Les articles de la liste sont regroupés par rayon, dans cet ordre — mets-les dans l'ordre de
        ton magasin. Le rayon « {DEFAULT_SHOPPING_CATEGORIES.at(-1)?.name} » reçoit les produits que
        l'app ne connaît pas ; il ne peut pas être supprimé.
      </p>
      <div className="space-y-1.5">
        {cats.map((c, i) => (
          <div key={c.key} className="flex items-center gap-1 rounded-xl border border-line px-3 py-1.5">
            <input
              value={c.name}
              onChange={(e) =>
                setCats(cats.map((x) => (x.key === c.key ? { ...x, name: e.target.value } : x)))
              }
              onBlur={() => save.mutate(cats)}
              aria-label="Nom du rayon"
              className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-ink outline-none focus:border-brand-500"
            />
            <button
              type="button"
              onClick={() => move(i, -1)}
              disabled={i === 0}
              aria-label="Monter"
              className="rounded-lg px-2 py-1 text-slate-400 transition hover:text-brand-600 disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              disabled={i === cats.length - 1}
              aria-label="Descendre"
              className="rounded-lg px-2 py-1 text-slate-400 transition hover:text-brand-600 disabled:opacity-30"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => commit(cats.filter((x) => x.key !== c.key))}
              disabled={c.key === FALLBACK_SHOPPING_CATEGORY}
              aria-label="Supprimer le rayon"
              title={
                c.key === FALLBACK_SHOPPING_CATEGORY
                  ? "Rayon de repli — non supprimable"
                  : "Supprimer le rayon"
              }
              className="rounded-lg px-2 py-1 text-slate-400 transition hover:text-danger disabled:opacity-30 disabled:hover:text-slate-400"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="mt-3 flex gap-2"
      >
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nouveau rayon…"
        />
        <button className="btn-primary shrink-0 text-xs">Ajouter</button>
      </form>
    </div>
  );
}

function ExpenseCategoriesCard() {
  const me = useMe();
  const qc = useQueryClient();
  const [cats, setCats] = useState<ExpenseCategory[]>(
    () => me.expenseCategories ?? DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c })),
  );
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState(CATEGORY_ICON_CHOICES[0]);
  const [addOpen, setAddOpen] = useState(false);
  const isDefault = (key: string) => DEFAULT_EXPENSE_CATEGORIES.some((d) => d.key === key);

  const save = useMutation({
    mutationFn: (next: ExpenseCategory[]) =>
      api.patch("/api/household/expense-categories", { categories: next }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
  const commit = (next: ExpenseCategory[]) => {
    setCats(next);
    save.mutate(next);
  };

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    commit([...cats, { key: `c_${Date.now().toString(36)}`, name, icon: newIcon }]);
    setNewName("");
    setNewIcon(CATEGORY_ICON_CHOICES[0]);
    setAddOpen(false);
  };

  return (
    <section>
      <div className="text-sm font-semibold">🏷️ Catégories de dépenses</div>
      <p className="mb-3 mt-1 text-xs text-slate-400">
        Utilisées pour les dépenses des voyages. Masque celles que tu ne veux pas proposer.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        {cats.map((c) => (
          <div
            key={c.key}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
              c.hidden
                ? "border-slate-200 text-slate-400 dark:border-slate-700"
                : "border-slate-300 dark:border-slate-600"
            }`}
          >
            <span>{c.icon}</span>
            <span className={c.hidden ? "line-through" : ""}>{c.name}</span>
            <button
              type="button"
              onClick={() => commit(cats.map((x) => (x.key === c.key ? { ...x, hidden: !x.hidden } : x)))}
              title={c.hidden ? "Afficher" : "Masquer"}
              className={c.hidden ? "text-slate-300 hover:text-brand-600" : "text-brand-600 hover:text-brand-700"}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                {c.hidden ? (
                  <>
                    <path d="M9.9 4.2A11 11 0 0 1 12 4c6.5 0 10 7 10 7a18 18 0 0 1-2.2 3.2M6.6 6.6A18 18 0 0 0 2 12s3.5 7 10 7a11 11 0 0 0 4-.8" />
                    <path d="m3 3 18 18" />
                    <path d="M9.5 9.5a3 3 0 0 0 4.2 4.2" />
                  </>
                ) : (
                  <>
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                )}
              </svg>
            </button>
            {!isDefault(c.key) && (
              <button
                type="button"
                onClick={() => commit(cats.filter((x) => x.key !== c.key))}
                title="Supprimer"
                className="text-slate-300 hover:text-red-500"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      <button type="button" onClick={() => setAddOpen(true)} className="btn-primary text-xs">
        + Ajouter une catégorie
      </button>

      {addOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
          onClick={() => setAddOpen(false)}
        >
          <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Nouvelle catégorie</h2>
              <button onClick={() => setAddOpen(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
              className="space-y-3"
            >
              <div className="text-xs text-slate-400">
                Icône
                <div className="mt-1 flex flex-wrap gap-1">
                  {CATEGORY_ICON_CHOICES.map((ic) => (
                    <button
                      key={ic}
                      type="button"
                      onClick={() => setNewIcon(ic)}
                      className={`flex h-9 w-9 items-center justify-center rounded-lg text-lg transition ${
                        newIcon === ic
                          ? "bg-brand-100 ring-2 ring-brand-500 dark:bg-brand-600/20"
                          : "hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                    >
                      {ic}
                    </button>
                  ))}
                </div>
              </div>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nom de la catégorie"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setAddOpen(false)} className="btn-ghost">
                  Annuler
                </button>
                <button className="btn-primary" disabled={!newName.trim()}>
                  Ajouter
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}


/**
 * Durée d'affichage du loader à l'entrée d'un menu. Le contenu charge en tâche
 * de fond pendant ce temps (cf. `PageGate`).
 */
function LoaderDelayCard() {
  const [ms, setMs] = useState(getLoaderDelay);
  const commit = (next: number) => {
    setMs(next);
    setLoaderDelay(next);
  };
  const seconds = (ms / 1000).toFixed(1).replace(/\.0$/, "");

  return (
    <div className="card flex flex-col lg:col-span-1">
      <div className="text-sm font-semibold">⏳ Affichage des loaders</div>
      <p className="mb-2 mt-1 text-xs text-slate-400">
        Durée minimale d'affichage du loader en arrivant sur un menu. Le contenu se charge en tâche
        de fond pendant ce temps. 0 = pas d'attente,{" "}
        {String(DEFAULT_LOADER_DELAY_MS / 1000).replace(".", ",")} s par défaut.
      </p>
      <div className="mt-auto flex items-center gap-2">
        {/* `.input` n'est pas dans un layer : un utilitaire `w-*` ne l'écrase pas,
            on contraint donc la largeur via le conteneur. */}
        <div className="w-20">
          <input
            type="number"
            min={0}
            max={MAX_LOADER_DELAY_MS / 1000}
            step={0.1}
            value={seconds}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) commit(v * 1000);
            }}
            className="input"
          />
        </div>
        <span className="text-sm text-slate-500">seconde(s)</span>
      </div>
    </div>
  );
}

/**
 * Liste d'affaires à prendre par défaut : injectée dans chaque nouveau voyage
 * (onglet 🧳 d'un voyage). Enregistrée à chaque modification.
 */
/* ---------------- Repas : ingrédients exclus des idées ---------------- */

function MealExclusionsCard() {
  const qc = useQueryClient();
  const [newExcl, setNewExcl] = useState("");

  const { data: exclusions } = useQuery({
    queryKey: ["meal-exclusions"],
    queryFn: () => api.get<string[]>("/api/courses/ideas/exclusions"),
  });
  const save = useMutation({
    mutationFn: (ingredients: string[]) => api.put("/api/courses/ideas/exclusions", { ingredients }),
    onSuccess: () => {
      setNewExcl("");
      qc.invalidateQueries({ queryKey: ["meal-exclusions"] });
      // Les idées déjà proposées contenant un ingrédient exclu sont filtrées côté API.
      qc.invalidateQueries({ queryKey: ["meal-ideas"] });
    },
  });

  return (
    <div className="card">
      <div className="text-sm font-semibold">🚫 Ingrédients exclus</div>
      <p className="mb-3 mt-1 text-xs text-slate-400">
        Ces ingrédients n'apparaîtront jamais dans les idées repas (Courses → Idées repas).
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        {(exclusions ?? []).map((ing) => (
          <span
            key={ing}
            className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
          >
            {ing}
            <button
              onClick={() => save.mutate((exclusions ?? []).filter((e) => e !== ing))}
              className="text-slate-300 hover:text-red-500"
              title="Retirer"
            >
              ✕
            </button>
          </span>
        ))}
        {(exclusions ?? []).length === 0 && (
          <span className="text-sm text-slate-400">Aucun ingrédient exclu.</span>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (newExcl.trim()) save.mutate([...(exclusions ?? []), newExcl.trim()]);
        }}
        className="flex gap-2"
      >
        <input
          value={newExcl}
          onChange={(e) => setNewExcl(e.target.value)}
          placeholder="Exclure un ingrédient (ex. champignons)…"
          className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        <button className="btn-primary" disabled={save.isPending || !newExcl.trim()}>
          Ajouter
        </button>
      </form>
    </div>
  );
}

function DefaultPackingCard() {
  const me = useMe();
  const qc = useQueryClient();
  const [items, setItems] = useState<DefaultPackingItem[]>(() => me.defaultPacking ?? []);
  const [newItem, setNewItem] = useState("");
  const [category, setCategory] = useState<PackingCategory>("vetements");
  const [person, setPerson] = useState<PackingPerson>("famille");
  const packingPersons = usePackingPersons();
  const personIds = packingPersons.map((p) => p.id);

  const save = useMutation({
    mutationFn: (next: DefaultPackingItem[]) =>
      api.patch("/api/household/default-packing", { items: next }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
  const commit = (next: DefaultPackingItem[]) => {
    setItems(next);
    save.mutate(next);
  };
  const add = () => {
    const label = newItem.trim();
    if (!label) return;
    // Un même libellé est permis pour des personnes différentes : seul le
    // doublon exact (libellé + personne) est ignoré.
    if (items.some((i) => i.label.toLowerCase() === label.toLowerCase() && i.person === person)) {
      setNewItem("");
      return;
    }
    commit([...items, { label, category, person }]);
    setNewItem("");
  };
  // Les opérations portent sur l'index : le libellé n'est pas un identifiant.
  const replaceAt = (index: number, next: DefaultPackingItem) =>
    commit(items.map((it, i) => (i === index ? next : it)));
  const removeAt = (index: number) => commit(items.filter((_, i) => i !== index));

  // Même regroupement et même tri que dans le voyage : catégorie, puis personne.
  const groups = PACKING_CATEGORIES.map((cat) => ({
    cat,
    items: items
      .map((it, index) => ({ it, index }))
      .filter(({ it }) => it.category === cat)
      .sort((a, b) => comparePackingItems(a.it, b.it, personIds) || a.index - b.index),
  })).filter((g) => g.items.length > 0);

  return (
    <section>
      <div className="text-sm font-semibold">🧳 Affaires à prendre (liste par défaut)</div>
      <p className="mb-3 mt-1 text-xs text-slate-400">
        Injectée automatiquement dans chaque nouveau voyage (Activités → Vacances, onglet 🧳). Les
        voyages existants ne sont pas modifiés : leur onglet valise propose « + Liste par défaut ».
      </p>
      {/* Même disposition que dans le voyage : une catégorie par colonne. */}
      <div className="mb-3 grid gap-x-6 gap-y-5 md:grid-cols-2 md:gap-y-7 lg:grid-cols-3">
        {groups.map((g) => (
          <div key={g.cat}>
            <div className="mb-1.5 flex items-center gap-1.5 text-base font-semibold text-slate-600 dark:text-slate-300">
              <span aria-hidden="true">{PACKING_CATEGORY_META[g.cat].icon}</span>
              {PACKING_CATEGORY_META[g.cat].label}
              <span className="text-xs font-normal text-slate-400">{g.items.length}</span>
            </div>
            <ul className="space-y-1">
              {g.items.map(({ it, index }) => (
                <li key={index} className="group flex items-center gap-2">
                  <PersonPicker
                    value={it.person}
                    onChange={(person) => replaceAt(index, { ...it, person })}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{it.label}</span>
                  <button
                    onClick={() => removeAt(index)}
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
        {items.length === 0 && (
          <span className="text-sm text-slate-400">Aucune affaire par défaut.</span>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <Input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder="Ajouter une affaire…"
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
            icon: <PersonAvatar id={p.id} className="h-5 w-5 text-2xs" />,
          }))}
        />
        <button className="btn-primary shrink-0" disabled={save.isPending || !newItem.trim()}>
          Ajouter
        </button>
      </form>
    </section>
  );
}

/** Allowlist : emails Google autorisés à se connecter (CRUD en base). */
/** Modale de création/édition d'une personne : prénom, couleur, emails. */
function PersonEditModal({
  title,
  initial,
  ownEmail,
  canLogin,
  pending,
  onSave,
  onClose,
}: {
  title: string;
  initial: { name: string; color: string; emails: string[] };
  /** Email de l'utilisateur connecté : non retirable (on ne s'enferme pas dehors). */
  ownEmail: string;
  /** true pour les membres a/b : leurs emails permettent la connexion Google. */
  canLogin: boolean;
  pending?: boolean;
  onSave: (v: { name: string; color: string; emails: string[] }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);
  const [emails, setEmails] = useState<string[]>(initial.emails);
  const [newEmail, setNewEmail] = useState("");

  const addEmail = () => {
    const e = newEmail.trim().toLowerCase();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || emails.includes(e)) return;
    setEmails([...emails, e]);
    setNewEmail("");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onSave({ name: name.trim(), color, emails });
          }}
          className="space-y-3"
        >
          <label className="block text-xs text-slate-400">
            Prénom
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
          </label>
          <label className="block text-xs text-slate-400">
            Couleur
            <span className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-slate-300 bg-transparent dark:border-slate-700"
              />
              <span
                className="inline-flex h-8 w-8 items-center justify-center rounded-full font-semibold text-white"
                style={{ backgroundColor: color }}
              >
                {(name[0] ?? "?").toUpperCase()}
              </span>
            </span>
          </label>
          <div className="text-xs text-slate-400">
            Adresses email {canLogin ? "(peuvent se connecter à l'application)" : "(informatif)"}
            <ul className="mt-1 space-y-1">
              {emails.map((e) => (
                <li key={e} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <span className="text-slate-400">✉️</span>
                  <span className="min-w-0 flex-1 truncate">{e}</span>
                  {e === ownEmail.toLowerCase() ? (
                    <span className="shrink-0 text-xs text-slate-300" title="Impossible de retirer son propre email">
                      (toi)
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEmails(emails.filter((x) => x !== e))}
                      className="shrink-0 text-slate-300 transition hover:text-red-500"
                      title="Retirer cet email"
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <span className="mt-1 flex items-center gap-2">
              <Input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addEmail();
                  }
                }}
                placeholder="email@gmail.com"
                className="flex-1"
              />
              <button type="button" onClick={addEmail} className="btn shrink-0" disabled={!newEmail.trim()}>
                +
              </button>
            </span>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost">
              Annuler
            </button>
            <button className="btn-primary" disabled={pending || !name.trim()}>
              {pending ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Icône crayon (édition). */
function PencilEditIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

/**
 * Membres du foyer : prénoms/couleurs, statut du compte Google, emails autorisés
 * (portés par chaque personne) et personnes supplémentaires. Chaque modification
 * passe par la modale et est enregistrée immédiatement.
 */
function MembersConfigCard() {
  const me = useMe();
  const qc = useQueryClient();
  const members = me.household.members;
  const extras = me.household.extraPersons;
  const googleMembers = useMembers(); // slot -> compte Google connecté (photo, email)

  const [editing, setEditing] = useState<
    | { kind: "member"; slot: "a" | "b" }
    | { kind: "extra"; index: number }
    | { kind: "new" }
    | null
  >(null);

  const { data: access } = useQuery({
    queryKey: ["access"],
    queryFn: () =>
      api.get<{ emails: { email: string; personId: string | null }[] }>("/api/household/access"),
  });
  const emailsOf = (personId: string) =>
    (access?.emails ?? []).filter((e) => e.personId === personId).map((e) => e.email);
  const legacyEmails = (access?.emails ?? []).filter((e) => e.personId === null);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["me"] });
    qc.invalidateQueries({ queryKey: ["members"] });
    qc.invalidateQueries({ queryKey: ["access"] });
  };

  /* Enregistre config (noms/couleurs/extras) + emails de la personne éditée. */
  const save = useMutation({
    mutationFn: async (v: {
      members: typeof members;
      extraPersons: typeof extras;
      personId?: string;
      emails?: string[];
    }) => {
      await api.patch("/api/household/members-config", {
        members: v.members,
        extraPersons: v.extraPersons,
      });
      if (v.personId && v.emails) {
        await api.put("/api/household/access/person", { personId: v.personId, emails: v.emails });
      }
    },
    onSuccess: () => {
      invalidateAll();
      setEditing(null);
    },
  });
  const removeLegacyEmail = useMutation({
    mutationFn: (email: string) => api.del(`/api/household/access/${encodeURIComponent(email)}`),
    onSuccess: invalidateAll,
  });

  const saveMember = (slot: "a" | "b", v: { name: string; color: string; emails: string[] }) =>
    save.mutate({
      members: { ...members, [slot]: { name: v.name, color: v.color } },
      extraPersons: extras,
      personId: slot,
      emails: v.emails,
    });
  const saveExtra = (index: number, v: { name: string; color: string; emails: string[] }) =>
    save.mutate({
      members,
      extraPersons: extras.map((p, i) => (i === index ? { ...p, name: v.name, color: v.color } : p)),
      personId: extras[index].id,
      emails: v.emails,
    });
  const createExtra = (v: { name: string; color: string; emails: string[] }) => {
    const id = v.name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!id || id === "a" || id === "b" || id === "famille" || extras.some((p) => p.id === id)) return;
    save.mutate({
      members,
      extraPersons: [...extras, { id, name: v.name, color: v.color }],
      personId: id,
      emails: v.emails,
    });
  };
  const removeExtra = (index: number) =>
    save.mutate({
      members,
      extraPersons: extras.filter((_, i) => i !== index),
      personId: extras[index].id,
      emails: [], // purge les emails rattachés, sinon ils resteraient orphelins
    });

  const emailLine = (personId: string) => {
    const list = emailsOf(personId);
    return list.length > 0 ? list.join(", ") : null;
  };

  const memberRow = (slot: "a" | "b") => {
    const google = googleMembers[slot];
    return (
      <div key={slot} className="flex items-center gap-2">
        <span
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-semibold text-white"
          style={{ backgroundColor: members[slot].color }}
        >
          {(members[slot].name[0] ?? "?").toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            {members[slot].name}
            {google ? (
              <>
                <span
                  title={`Compte Google connecté (${google.email})`}
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-2.5 w-2.5">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                {google.avatarUrl && (
                  <img
                    src={google.avatarUrl}
                    alt={google.displayName}
                    title={`Photo Google de ${google.displayName}`}
                    referrerPolicy="no-referrer"
                    className="h-5 w-5 shrink-0 rounded-full object-cover"
                  />
                )}
              </>
            ) : (
              <span
                title="Aucun compte Google connecté pour ce membre"
                className="rounded-full bg-slate-100 px-1.5 py-0.5 text-2xs text-slate-400 dark:bg-slate-800"
              >
                non connecté
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-slate-400">
            {emailLine(slot) ?? "aucun email autorisé"}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setEditing({ kind: "member", slot })}
          className="shrink-0 text-slate-300 transition hover:text-brand-600"
          title={`Modifier ${members[slot].name} (prénom, couleur, emails)`}
        >
          <PencilEditIcon />
        </button>
      </div>
    );
  };

  return (
    <div className="card">
      <div className="text-sm font-semibold">👥 Membres du foyer</div>
      <p className="mb-3 mt-1 text-xs text-slate-400">
        Prénoms, couleurs et emails autorisés à se connecter — la coche verte indique un compte
        Google déjà connecté. Modification via le crayon.
      </p>
      <div className="space-y-2">
        {memberRow("a")}
        {memberRow("b")}
      </div>

      <div className="mt-4 text-xs font-medium text-slate-500">Personnes supplémentaires</div>
      <p className="mb-1 mt-0.5 text-xs text-slate-400">
        Proposées dans les listes d'affaires de voyage (enfants…) ; leurs emails sont informatifs.
      </p>
      <div className="space-y-2">
        {extras.map((p, i) => (
          <div key={p.id} className="flex items-center gap-2">
            <span
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-semibold text-white"
              style={{ backgroundColor: p.color }}
            >
              {(p.name[0] ?? "?").toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{p.name}</span>
              {emailLine(p.id) && (
                <span className="block truncate text-xs text-slate-400">{emailLine(p.id)}</span>
              )}
            </span>
            <button
              type="button"
              onClick={() => setEditing({ kind: "extra", index: i })}
              className="shrink-0 text-slate-300 transition hover:text-brand-600"
              title={`Modifier ${p.name} (prénom, couleur, emails)`}
            >
              <PencilEditIcon />
            </button>
            <button
              type="button"
              onClick={() => removeExtra(i)}
              disabled={save.isPending}
              className="shrink-0 text-slate-300 transition hover:text-red-500"
              title="Retirer"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setEditing({ kind: "new" })}
          className="btn-primary"
        >
          + Ajouter une personne
        </button>
      </div>

      {/* Emails hérités du secret env, non rattachés à une personne. */}
      {legacyEmails.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
          <div className="text-xs font-medium text-slate-500">Emails non rattachés</div>
          <p className="mb-1 mt-0.5 text-xs text-slate-400">
            Autorisés à se connecter (premier slot libre). Rattache-les à un membre via son
            crayon, ou retire-les.
          </p>
          <ul className="space-y-1">
            {legacyEmails.map((e) => (
              <li key={e.email} className="flex items-center gap-2 text-sm">
                <span className="text-slate-400">✉️</span>
                <span className="min-w-0 flex-1 truncate">{e.email}</span>
                {e.email.toLowerCase() === me.email.toLowerCase() ? (
                  <span className="shrink-0 text-xs text-slate-300" title="Impossible de retirer son propre email">
                    (toi)
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => removeLegacyEmail.mutate(e.email)}
                    disabled={removeLegacyEmail.isPending}
                    className="shrink-0 text-slate-300 transition hover:text-red-500"
                    title="Retirer l'accès"
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing?.kind === "member" && (
        <PersonEditModal
          title={`Modifier ${members[editing.slot].name}`}
          initial={{ ...members[editing.slot], emails: emailsOf(editing.slot) }}
          ownEmail={me.email}
          canLogin
          pending={save.isPending}
          onSave={(v) => saveMember(editing.slot, v)}
          onClose={() => setEditing(null)}
        />
      )}
      {editing?.kind === "extra" && extras[editing.index] && (
        <PersonEditModal
          title={`Modifier ${extras[editing.index].name}`}
          initial={{ ...extras[editing.index], emails: emailsOf(extras[editing.index].id) }}
          ownEmail={me.email}
          canLogin={false}
          pending={save.isPending}
          onSave={(v) => saveExtra(editing.index, v)}
          onClose={() => setEditing(null)}
        />
      )}
      {editing?.kind === "new" && (
        <PersonEditModal
          title="Nouvelle personne"
          initial={{ name: "", color: "#f59e0b", emails: [] }}
          ownEmail={me.email}
          canLogin={false}
          pending={save.isPending}
          onSave={createExtra}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

export default function Settings() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const logout = async () => {
    await api.post("/auth/logout");
    await qc.invalidateQueries();
    navigate("/login");
  };
  const [splitJ, setSplitJ] = useState(me.household.defaultSplitA);
  const [theme, setThemeState] = useState<Theme>(getStoredTheme());
  const [newCity, setNewCity] = useState("");

  const { data: cities } = useQuery({
    queryKey: ["cities"],
    queryFn: () => api.get<FollowedCity[]>("/api/household/cities"),
  });
  const invalidateCities = () => {
    qc.invalidateQueries({ queryKey: ["cities"] });
    qc.invalidateQueries({ queryKey: ["activities"] });
  };
  const addCity = useMutation({
    mutationFn: (name: string) => api.post("/api/household/cities", { name }),
    onSuccess: () => {
      setNewCity("");
      invalidateCities();
    },
  });
  const removeCity = useMutation({
    mutationFn: (id: string) => api.del(`/api/household/cities/${id}`),
    onSuccess: invalidateCities,
  });

  // Flux RSS d'agendas (activités) — complète OpenAgenda pour les villes qui n'y publient pas.
  const [newFeed, setNewFeed] = useState({ name: "", url: "" });
  const { data: activityFeeds } = useQuery({
    queryKey: ["activity-feeds"],
    queryFn: () => api.get<ActivityFeed[]>("/api/household/activity-feeds"),
  });
  const invalidateFeeds = () => {
    qc.invalidateQueries({ queryKey: ["activity-feeds"] });
    qc.invalidateQueries({ queryKey: ["activities"] });
  };
  const addFeed = useMutation({
    mutationFn: (f: { name: string; url: string }) => api.post("/api/household/activity-feeds", f),
    onSuccess: () => {
      setNewFeed({ name: "", url: "" });
      invalidateFeeds();
    },
  });
  const removeFeed = useMutation({
    mutationFn: (id: string) => api.del(`/api/household/activity-feeds/${id}`),
    onSuccess: invalidateFeeds,
  });

  // Lignes de transport
  const [lineId, setLineId] = useState(IDF_LINES[0].id);
  const [stationA, setStationA] = useState("");
  const [stationB, setStationB] = useState("");
  const [lineKind, setLineKind] = useState<TransitKind>("principal");
  const { data: transitLines } = useQuery({
    queryKey: ["transit-lines"],
    queryFn: () => api.get<TransitLineConfig[]>("/api/household/transit-lines"),
  });
  const invalidateTransit = () => {
    qc.invalidateQueries({ queryKey: ["transit-lines"] });
    qc.invalidateQueries({ queryKey: ["transit"] });
  };
  const [editingId, setEditingId] = useState<string | null>(null);
  const resetLineForm = () => {
    setEditingId(null);
    setStationA("");
    setStationB("");
  };
  const saveLine = useMutation({
    mutationFn: () => {
      const cat = IDF_LINES.find((l) => l.id === lineId)!;
      const payload = {
        lineCode: cat.code,
        label: cat.label,
        color: cat.color,
        stationA: stationA.trim(),
        stationB: stationB.trim(),
        kind: lineKind,
      };
      return editingId
        ? api.patch(`/api/household/transit-lines/${editingId}`, payload)
        : api.post("/api/household/transit-lines", payload);
    },
    onSuccess: () => {
      resetLineForm();
      invalidateTransit();
    },
  });
  const startEditLine = (l: TransitLineConfig) => {
    setEditingId(l.id);
    setLineId(IDF_LINES.find((c) => c.code === l.lineCode)?.id ?? IDF_LINES[0].id);
    setLineKind(l.kind);
    setStationA(l.stationA);
    setStationB(l.stationB);
  };
  const setLineKindMut = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: TransitKind }) =>
      api.patch(`/api/household/transit-lines/${id}`, { kind }),
    onSuccess: invalidateTransit,
  });
  const removeLine = useMutation({
    mutationFn: (id: string) => api.del(`/api/household/transit-lines/${id}`),
    onSuccess: invalidateTransit,
  });
  const reorderLines = useMutation({
    mutationFn: (order: string[]) => api.post("/api/household/transit-lines/reorder", { order }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["transit"] }),
  });
  const transitSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const onTransitDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const cur = transitLines ?? [];
    const oldI = cur.findIndex((l) => l.id === active.id);
    const newI = cur.findIndex((l) => l.id === over.id);
    if (oldI < 0 || newI < 0) return;
    const next = arrayMove(cur, oldI, newI);
    qc.setQueryData(["transit-lines"], next); // optimiste
    reorderLines.mutate(next.map((l) => l.id));
  };
  const moveLine = (index: number, dir: -1 | 1) => {
    const cur = transitLines ?? [];
    const target = index + dir;
    if (target < 0 || target >= cur.length) return;
    const next = arrayMove(cur, index, target);
    qc.setQueryData(["transit-lines"], next); // optimiste
    reorderLines.mutate(next.map((l) => l.id));
  };

  // Stations de la ligne sélectionnée (pour les sélecteurs de gares)
  const selectedCode = IDF_LINES.find((l) => l.id === lineId)?.code;
  const { data: stationData } = useQuery({
    queryKey: ["transit-stations", selectedCode],
    queryFn: () =>
      api.get<{ stations: string[] }>(`/api/transit/stations?code=${encodeURIComponent(selectedCode!)}`),
    enabled: !!selectedCode,
    staleTime: 5 * 60 * 1000,
  });
  const stationOpts = (stationData?.stations ?? []).map((s) => ({ value: s, label: s }));

  const { data: providers } = useQuery({
    queryKey: ["providers"],
    queryFn: () => api.get<StreamingProvider[]>("/api/household/providers"),
  });
  const { data: config } = useQuery({
    queryKey: ["household-config"],
    queryFn: () => api.get<HouseholdConfig>("/api/household/config"),
  });
  const invalidateFilms = () => {
    qc.invalidateQueries({ queryKey: ["films"] });
    qc.invalidateQueries({ queryKey: ["film-favorites"] });
  };
  const toggleProvider = useMutation({
    mutationFn: (p: StreamingProvider) =>
      api.patch(`/api/household/providers/${p.id}`, { enabled: !p.enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["providers"] });
      invalidateFilms();
    },
  });
  const setKidsCert = useMutation({
    mutationFn: (cert: string) => api.patch("/api/household", { kidsMaxCert: cert }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["household-config"] });
      invalidateFilms();
    },
  });

  const chooseTheme = (t: Theme) => {
    setTheme(t);
    setThemeState(t);
  };

  const updateSplit = useMutation({
    mutationFn: () =>
      api.patch("/api/household", {
        defaultSplitA: splitJ,
        defaultSplitB: 100 - splitJ,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });

  const SECTIONS = ["generale", "argent", "accueil", "outils", "courses", "repas", "parametre"] as const;
  type Section = (typeof SECTIONS)[number];
  const { section } = useParams();
  const tab: Section = (SECTIONS as readonly string[]).includes(section ?? "")
    ? (section as Section)
    : "generale";
  const TABS = [
    { value: "generale", label: "Générale", icon: "⚙️" },
    { value: "argent", label: "Argent", icon: "💶" },
    { value: "accueil", label: "Accueil", icon: "🏠" },
    { value: "outils", label: "Activités", icon: "🏖️" },
    { value: "courses", label: "Courses", icon: "🛒" },
    { value: "repas", label: "Repas", icon: "🍽️" },
    { value: "parametre", label: "Paramètre", icon: "🔧" },
  ];

  usePageHeader("Réglages");
  usePageTabs(tab, TABS, (v) => navigate(`/settings/${v}`));

  return (
    <div className="flex flex-1 flex-col gap-4">
      <h1 className="hidden text-2xl font-bold md:block">Réglages</h1>
      <SubNav
        value={tab}
        onChange={(v) => navigate(`/settings/${v}`)}
        items={TABS}
        className="hidden md:block"
      />

      {/* ============================ GÉNÉRALE ============================ */}
      {tab === "generale" && (
        <div className="space-y-4">
      {/* Foyer (60%) + Apparence (40%) — tout sur une ligne dans chaque carte */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="card lg:col-span-3">
          {/* Mobile : bouton de déconnexion sur la ligne du dessous (sinon l'email
              déborde et crée un scroll latéral). */}
          <div className="flex flex-col items-start gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex w-full min-w-0 items-center gap-3 md:w-auto">
              {me.avatarUrl && (
                <img
                  src={me.avatarUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-10 w-10 shrink-0 rounded-full object-cover"
                />
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  👨‍👩‍👧 Foyer — {me.household.name}
                </div>
                <div className="truncate text-xs text-slate-400">Connecté : {me.email}</div>
              </div>
            </div>
            <button onClick={logout} className="btn-ghost shrink-0 gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Déconnexion
            </button>
          </div>
        </div>

        <div className="card lg:col-span-2">
          {/* Même logique : les deux thèmes passent sous le titre sur mobile. */}
          <div className="flex flex-col items-start gap-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm font-semibold">🎨 Apparence</div>
            <div className="flex gap-2">
              {([
                { id: "light", label: "☀️ Clair" },
                { id: "dark", label: "🌙 Sombre" },
              ] as const).map((t) => (
                <button
                  key={t.id}
                  onClick={() => chooseTheme(t.id)}
                  className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                    theme === t.id
                      ? "border-brand-600 bg-brand-600 text-on-brand"
                      : "border-slate-300 bg-white text-slate-600 hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Colonne gauche : membres, puis Argent et loaders. Colonne droite : menus. */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <MembersConfigCard />
          <LoaderDelayCard />
        </div>

        {/* Menus de navigation (ordre + visibilité) */}
        <MenuOrderCard />
      </div>
        </div>
      )}

      {/* Activités + Films (menu Activités) */}
      {tab === "outils" && (
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="text-sm font-semibold">🎲 Activités</div>
          <p className="mb-3 mt-1 text-xs text-slate-400">
            Villes suivies pour les activités (Activités → Activités).
          </p>
          <div className="mb-3 flex flex-wrap gap-2">
            {(cities ?? []).map((c) => (
              <span
                key={c.id}
                className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                {c.name}
                <button
                  onClick={() => removeCity.mutate(c.id)}
                  className="text-slate-300 hover:text-red-500"
                  title="Retirer"
                >
                  ✕
                </button>
              </span>
            ))}
            {(cities ?? []).length === 0 && (
              <span className="text-sm text-slate-400">Aucune ville suivie.</span>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newCity.trim()) addCity.mutate(newCity.trim());
            }}
            className="flex gap-2"
          >
            <input
              value={newCity}
              onChange={(e) => setNewCity(e.target.value)}
              placeholder="Ajouter une ville…"
              className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            <button
              className="btn-primary shrink-0"
              disabled={addCity.isPending || !newCity.trim()}
            >
              Ajouter
            </button>
          </form>

          <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
            <div className="text-sm font-semibold">Flux RSS d'agendas</div>
            {/* `break-words` : l'URL d'exemple est un mot insécable qui poussait
                la carte au-delà de l'écran sur mobile (scroll latéral). */}
            <p className="mb-3 mt-1 break-words text-xs text-slate-400">
              Pour les villes absentes d'OpenAgenda : ajoute le flux RSS des événements de leur
              site (ex. <code className="break-all">https://www.ma-ville.fr/evenement/feed/</code>).
            </p>
            <div className="mb-3 space-y-1.5">
              {(activityFeeds ?? []).map((f) => (
                <div
                  key={f.id}
                  className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
                >
                  <span className="max-w-[40%] truncate font-medium">{f.name}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-400">{f.url}</span>
                  <button
                    onClick={() => removeFeed.mutate(f.id)}
                    className="shrink-0 text-slate-300 hover:text-red-500"
                    title="Retirer"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {(activityFeeds ?? []).length === 0 && (
                <span className="text-sm text-slate-400">Aucun flux suivi.</span>
              )}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newFeed.name.trim() && newFeed.url.trim()) addFeed.mutate(newFeed);
              }}
              className="flex flex-col gap-2 sm:flex-row"
            >
              <input
                value={newFeed.name}
                onChange={(e) => setNewFeed({ ...newFeed, name: e.target.value })}
                placeholder="Ville"
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:w-44"
              />
              <input
                type="url"
                value={newFeed.url}
                onChange={(e) => setNewFeed({ ...newFeed, url: e.target.value })}
                placeholder="URL du flux RSS…"
                className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <button
                className="btn-primary"
                disabled={addFeed.isPending || !newFeed.name.trim() || !newFeed.url.trim()}
              >
                Ajouter
              </button>
            </form>
          </div>
        </div>

        <div className="card">
          <div className="text-sm font-semibold">🎬 Films</div>
          <p className="mb-3 mt-1 text-xs text-slate-400">
            Plateformes utilisées pour proposer des films (Activités → Films).
          </p>
          <div className="flex flex-wrap gap-3">
            {(providers ?? []).map((p) => (
              <button
                key={p.id}
                onClick={() => toggleProvider.mutate(p)}
                title={`${PROVIDER_LABEL[p.name] ?? p.name}${p.enabled ? "" : " (désactivé)"}`}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 transition ${
                  p.enabled
                    ? "border-brand-600 bg-brand-50 dark:bg-brand-600/15"
                    : "border-slate-200 opacity-45 grayscale dark:border-slate-700"
                }`}
              >
                {p.logo ? (
                  <img src={p.logo} alt={p.name} className="h-7 w-7 rounded-md object-cover" />
                ) : (
                  <span className="text-sm font-medium">{PROVIDER_LABEL[p.name] ?? p.name}</span>
                )}
              </button>
            ))}
          </div>

          <div className="mt-4 text-sm font-medium">Âge max pour les films enfants</div>
          <p className="mb-2 text-xs text-slate-400">
            Certification cinéma française maximale (« Tous publics » convient pour ≤ 7 ans).
          </p>
          <div className="w-48">
            <Select
              value={config?.kidsMaxCert ?? "U"}
              onChange={(v) => setKidsCert.mutate(v)}
              options={FR_CERTS.map((c) => ({ value: c, label: CERT_LABEL[c] }))}
            />
          </div>
        </div>
      </div>
      )}

      {/* Transports (Accueil) */}
      {tab === "accueil" && (
      <div className="card">
        <div className="text-sm font-semibold">🚆 Transports</div>
        <p className="mb-3 mt-1 text-xs text-slate-400">
          Lignes suivies dans le widget de l'accueil (<b>Île-de-France uniquement</b> — API PRIM).
          Les lignes « secondaires » sont regroupées et repliées par défaut (comme les métros).
        </p>
        <div className="mb-3">
          <DndContext sensors={transitSensors} collisionDetection={closestCenter} onDragEnd={onTransitDragEnd}>
            <SortableContext
              items={(transitLines ?? []).map((l) => l.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {(transitLines ?? []).map((l, i) => (
                  <SortableTransitRow
                    key={l.id}
                    line={l}
                    onToggleKind={() =>
                      setLineKindMut.mutate({
                        id: l.id,
                        kind: l.kind === "principal" ? "secondary" : "principal",
                      })
                    }
                    onEdit={() => startEditLine(l)}
                    onRemove={() => removeLine.mutate(l.id)}
                    onUp={() => moveLine(i, -1)}
                    onDown={() => moveLine(i, 1)}
                    isFirst={i === 0}
                    isLast={i === (transitLines ?? []).length - 1}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          {(transitLines ?? []).length === 0 && (
            <span className="text-sm text-slate-400">Aucune ligne configurée.</span>
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (stationA.trim() && stationB.trim()) saveLine.mutate();
          }}
          className="space-y-2"
        >
          {editingId && (
            <div className="text-xs font-medium text-brand-600">Modification d'une ligne</div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <SearchSelect
              value={lineId}
              onChange={(v) => {
                setLineId(v);
                setStationA("");
                setStationB("");
              }}
              options={IDF_LINES.map((l) => ({ value: l.id, label: l.label }))}
              placeholder="Choisir une ligne…"
            />
            <Select
              value={lineKind}
              onChange={(v) => setLineKind(v as TransitKind)}
              options={TRANSIT_KINDS.map((k) => ({
                value: k,
                label: k === "principal" ? "Principale" : "Secondaire",
              }))}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <SearchSelect
              value={stationA}
              onChange={setStationA}
              options={stationOpts}
              allowCustom
              placeholder="Gare / station 1"
            />
            <SearchSelect
              value={stationB}
              onChange={setStationB}
              options={stationOpts}
              allowCustom
              placeholder="Gare / station 2"
            />
          </div>
          <div className="flex gap-2">
            <button
              className="btn-primary"
              disabled={saveLine.isPending || !stationA.trim() || !stationB.trim()}
            >
              {editingId ? "Enregistrer" : "Ajouter la ligne"}
            </button>
            {editingId && (
              <button type="button" onClick={resetLineForm} className="btn-ghost">
                Annuler
              </button>
            )}
          </div>
        </form>
      </div>
      )}

      {/* ============================ ARGENT ============================ */}
      {tab === "argent" && (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <div className="card">
            <div className="text-sm font-semibold">💶 Argent</div>
            <div className="mt-2 text-sm font-medium">Clé de répartition par défaut</div>
            <p className="mb-2 text-xs text-slate-400">
              Appliquée par défaut aux charges et aux dépenses partagées. Modifiable à tout moment.
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="flex items-center gap-1.5">
                <MemberAvatar id="a" className="h-5 w-5 text-2xs" />
                {me.household.members.a.name}
              </span>
              <input
                type="number"
                min={0}
                max={100}
                value={splitJ}
                onChange={(e) => setSplitJ(Math.max(0, Math.min(100, Number(e.target.value))))}
                className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-1 text-center text-sm text-slate-900 outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <span>%</span>
              <span className="text-slate-300">/</span>
              <span className="flex items-center gap-1.5">
                <MemberAvatar id="b" className="h-5 w-5 text-2xs" />
                {me.household.members.b.name} <b>{100 - splitJ}%</b>
              </span>
              <button
                onClick={() => updateSplit.mutate()}
                disabled={updateSplit.isPending || splitJ === me.household.defaultSplitA}
                className="btn-primary ml-2"
              >
                {updateSplit.isPending ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Météo (Accueil) — demi-largeur */}
      {tab === "accueil" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <WeatherCitiesCard />
        </div>
      )}

      {/* Réglages des voyages : catégories de dépenses + affaires à prendre */}
      {tab === "outils" && (
        <div className="card">
          <div className="text-base font-bold">✈️ Voyage</div>
          <p className="mt-1 text-xs text-slate-400">
            Réglages utilisés par Activités → Vacances.
          </p>
          <div className="mt-4 space-y-4">
            <ExpenseCategoriesCard />
            <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
              <DefaultPackingCard />
            </div>
          </div>
        </div>
      )}

      {/* Repas : ingrédients exclus des idées */}
      {/* ============================ COURSES ============================ */}
      {tab === "courses" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ShoppingCategoriesCard />
        </div>
      )}

      {tab === "repas" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <MealExclusionsCard />
        </div>
      )}

      {/* Clés API (Paramètre) — deux cartes par ligne, hauteurs égales */}
      {tab === "parametre" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <AnthropicKeyCard />
          <LunchflowKeyCard />
          <MobiliteKeysCard />
          <TmdbKeyCard />
        </div>
      )}

      {/* Toujours en bas : fin du contenu s'il y a du scroll, bas de l'écran sinon. */}
      <div className="mt-auto pt-2 text-center text-xs text-slate-400">Version {APP_VERSION}</div>
    </div>
  );
}
