import { useState, useRef } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  MouseSensor,
  PointerSensor,
  TouchSensor,
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
import type { CustomList, CustomListItem, ListFolder, ListScope } from "@gfa/shared";
import { LIST_EMOJIS } from "@gfa/shared";
import { api } from "../lib/api";
import { relativeFr } from "../lib/format";
import { useMe } from "../auth";
import type { OverflowItem } from "../components/ui";
import {
  SubNav,
  Input,
  Checkbox,
  MobileActionBar,
  OverflowMenu,
  SearchField,
  SectionLabel,
} from "../components/ui";
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconFolder,
  IconList,
} from "../components/icons";
import { MemberAvatar } from "../components/MemberAvatar";
import WishList from "../components/WishList";
import { usePageHeader, usePageTabs, usePageChrome } from "../components/PageHeader";
import PageLoader from "../components/PageLoader";

type Tab = "wishlist" | "partagees" | "perso";
/** L'ordre de cette liste est celui des onglets, et le premier est l'onglet par défaut. */
const TABS: { id: Tab; label: string }[] = [
  { id: "perso", label: "Listes perso" },
  { id: "partagees", label: "Listes partagées" },
  { id: "wishlist", label: "WishList" },
];

const SCOPE_OF: Record<string, ListScope> = { partagees: "shared", perso: "personal" };

/** Segment qui annonce un dossier : `/listes/perso/d/<id>`. Les ids sont des
 *  UUID, il ne peut donc pas être confondu avec l'id d'une liste. */
const FOLDER_SEGMENT = "d";

export default function Listes() {
  const navigate = useNavigate();
  const { tab: tabParam, view, sub } = useParams();
  const tab: Tab = TABS.some((t) => t.id === tabParam) ? (tabParam as Tab) : TABS[0].id;
  const scope = SCOPE_OF[tab];
  // Troisième segment : un id de liste, ou `d/<id>` pour le contenu d'un
  // dossier. Contrairement à un sous-menu, ce n'est pas un ensemble fixe :
  // rien à mémoriser avec `useLastView`, on ne veut pas rouvrir le dernier
  // enregistrement consulté en revenant sur l'onglet.
  const openFolderId = scope && view === FOLDER_SEGMENT ? sub : undefined;
  const openListId = scope && view !== FOLDER_SEGMENT ? view : undefined;
  const basePath = `/listes/${tab}`;

  // Une liste ouverte — ou un dossier ouvert — est une sous-page : elle prend
  // toute la barre du haut (retour + nom), donc plus d'onglets.
  usePageTabs(
    tab,
    openListId || openFolderId ? [] : TABS.map((t) => ({ value: t.id, label: t.label })),
    (v) => navigate(`/listes/${v}`),
  );

  return (
    <div className="flex flex-col gap-4">
      <SubNav
        value={tab}
        onChange={(v) => navigate(`/listes/${v}`)}
        items={TABS.map((t) => ({ value: t.id, label: t.label }))}
        className="hidden md:block"
      />
      {tab === "wishlist" && <WishList />}
      {scope &&
        (openListId ? (
          <ListDetail scope={scope} listId={openListId} basePath={basePath} />
        ) : (
          <CustomLists scope={scope} basePath={basePath} folderId={openFolderId} />
        ))}
    </div>
  );
}

/* ---------------- Briques communes ---------------- */

const listQueryKey = (scope: ListScope) => ["lists", scope];

/** Réponse de `GET /api/lists` : les dossiers d'un onglet et toutes ses listes. */
type ListsPayload = { folders: ListFolder[]; lists: CustomList[] };

/** Pastille de tête d'une liste : son emoji, ou une icône neutre s'il manque. */
function ListEmoji({
  emoji,
  size = "md",
  folder = false,
}: {
  emoji: string | null;
  size?: "sm" | "md";
  /** Repli sur l'icône dossier au lieu de l'icône liste. */
  folder?: boolean;
}) {
  const dim = size === "sm" ? "h-9 w-9 text-lg" : "h-11 w-11 text-xl";
  const Fallback = folder ? IconFolder : IconList;
  return (
    <span
      aria-hidden="true"
      className={`flex ${dim} shrink-0 items-center justify-center rounded-xl bg-surface-2 leading-none`}
    >
      {emoji || <Fallback size={20} className="text-ink-2" />}
    </span>
  );
}

/** Jauge d'avancement : la même barre en tête de liste et dans la sous-page. */
function Progress({ done, total, className = "" }: { done: number; total: number; className?: string }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <span className={`inline-block h-1.5 overflow-hidden rounded-full bg-surface-2 ${className}`}>
      <span className="block h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
    </span>
  );
}

/**
 * Création / renommage d'une liste : un seul formulaire pour les deux, parce
 * qu'ils demandent exactement la même chose (un nom, un emoji).
 */
function ListFormModal({
  title,
  submitLabel,
  initialName = "",
  initialEmoji = null,
  placeholder = "Nom de la liste…",
  folder = false,
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  initialName?: string;
  initialEmoji?: string | null;
  placeholder?: string;
  /** Formulaire de dossier : le « sans icône » montre un dossier, pas une liste. */
  folder?: boolean;
  onSubmit: (v: { name: string; emoji: string | null }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [emoji, setEmoji] = useState<string | null>(initialEmoji);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          const value = name.trim();
          if (!value) return;
          onSubmit({ name: value, emoji });
          onClose();
        }}
        className="card w-full max-w-sm space-y-3"
      >
        <div className="font-semibold">{title}</div>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={placeholder}
        />
        <div className="space-y-1.5">
          <div className="eyebrow">Icône</div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setEmoji(null)}
              aria-label="Aucune icône"
              aria-pressed={emoji === null}
              className={`flex h-tap w-tap items-center justify-center rounded-xl border ${
                emoji === null ? "border-brand-600 bg-surface-2" : "border-line"
              }`}
            >
              {folder ? (
                <IconFolder size={20} className="text-ink-2" />
              ) : (
                <IconList size={20} className="text-ink-2" />
              )}
            </button>
            {LIST_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEmoji(e)}
                aria-pressed={emoji === e}
                className={`flex h-tap w-tap items-center justify-center rounded-xl border text-xl leading-none ${
                  emoji === e ? "border-brand-600 bg-surface-2" : "border-line"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Annuler
          </button>
          <button type="submit" className="btn-primary">
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------------- Dossiers ---------------- */

/**
 * Rangée de dossier (mobile). Même grammaire qu'une rangée de liste : on entre
 * d'une touche, le compte tient lieu d'avancement. Renommer / supprimer vivent
 * dans le « ⋯ » de la sous-page du dossier.
 */
function FolderRow({ folder, to, last }: { folder: ListFolder; to: string; last: boolean }) {
  return (
    <div className={last ? "" : "border-b border-hairline"}>
      <Link to={to} className="flex min-h-[64px] items-center gap-3 py-2.5">
        <ListEmoji emoji={folder.emoji} folder />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold">{folder.name}</span>
          <span className="block text-xs text-slate-400">
            {folder.listCount === 0
              ? "Dossier vide"
              : `${folder.listCount} liste${folder.listCount > 1 ? "s" : ""}`}
          </span>
        </span>
        <IconChevronRight size={20} className="shrink-0 text-slate-400" />
      </Link>
    </div>
  );
}

/**
 * Tuile de dossier (ordinateur). Compacte, à l'inverse des cartes de listes
 * qui sont dépliées : un dossier n'a rien à montrer tant qu'on ne l'ouvre pas.
 */
function FolderCard({ folder, to }: { folder: ListFolder; to: string }) {
  return (
    <Link
      to={to}
      className="card flex min-h-[64px] items-center gap-3 transition hover:border-brand-500"
    >
      <ListEmoji emoji={folder.emoji} size="sm" folder />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{folder.name}</span>
        <span className="block text-xs text-slate-400">
          {folder.listCount === 0
            ? "Vide"
            : `${folder.listCount} liste${folder.listCount > 1 ? "s" : ""}`}
        </span>
      </span>
      <IconChevronRight size={20} className="shrink-0 text-slate-400" />
    </Link>
  );
}

/** Choix du dossier d'une liste. La racine est une option comme une autre. */
function MoveToFolderModal({
  folders,
  current,
  onPick,
  onClose,
}: {
  folders: ListFolder[];
  current: string | null;
  onPick: (folderId: string | null) => void;
  onClose: () => void;
}) {
  const options: { id: string | null; name: string; emoji: string | null }[] = [
    { id: null, name: "Aucun dossier (racine)", emoji: null },
    ...folders.map((f) => ({ id: f.id, name: f.name, emoji: f.emoji })),
  ];
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm space-y-3">
        <div className="font-semibold">Déplacer vers un dossier</div>
        {folders.length === 0 && (
          <p className="text-sm text-slate-400">
            Aucun dossier dans cet onglet — crée-en un depuis l'index des listes.
          </p>
        )}
        <div className="flex flex-col">
          {options.map((o, i) => (
            <button
              key={o.id ?? "root"}
              type="button"
              onClick={() => {
                onPick(o.id);
                onClose();
              }}
              aria-pressed={current === o.id}
              className={`flex min-h-[52px] items-center gap-3 text-left ${
                i === options.length - 1 ? "" : "border-b border-hairline"
              }`}
            >
              <ListEmoji emoji={o.emoji} size="sm" folder={o.id !== null} />
              <span className="min-w-0 flex-1 truncate text-base">{o.name}</span>
              {current === o.id && (
                <span aria-hidden="true" className="shrink-0 text-brand-600">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="btn-ghost">
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Libellés de la bascule perso ↔ partagée. La conséquence est écrite : passer
 * une liste en perso la retire de la vue de l'autre membre.
 */
const SCOPE_SWITCH: Record<ListScope, { to: ListScope; label: string; confirm: string }> = {
  personal: {
    to: "shared",
    label: "Rendre partagée",
    confirm: "Rendre cette liste partagée ? Tout le foyer pourra la voir et la modifier.",
  },
  shared: {
    to: "personal",
    label: "Rendre perso",
    confirm: "Rendre cette liste perso ? Elle ne sera plus visible que par toi.",
  },
};

/* ---------------- Index : la liste des listes ---------------- */

/**
 * Rangée d'index (mobile) : l'emoji, le nom, l'avancement, un chevron. Aucune
 * autre action — renommer / supprimer vivent dans le « ⋯ » de la sous-page.
 * On y entre d'une touche, on la déplace d'un appui long.
 */
function ListRow({
  list,
  to,
  last,
  onOpen,
  match,
  folderName,
  disabled = false,
}: {
  list: CustomList;
  to: string;
  last: boolean;
  onOpen: (e: React.MouseEvent) => void;
  /** Élément qui a fait ressortir la liste dans une recherche : sans lui, la
   *  rangée aurait l'air de ne pas correspondre (le nom, lui, ne matche pas). */
  match?: string;
  /** Dossier qui la range : la recherche traverse les dossiers, il faut dire
   *  d'où vient un résultat. */
  folderName?: string;
  /** Une recherche filtre l'index : déplacer une rangée y renumérote à côté. */
  disabled?: boolean;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: list.id,
    disabled,
  });
  const done = list.items.filter((i) => i.done).length;
  const total = list.items.length;
  const finished = total > 0 && done === total;

  return (
    // Les écouteurs de glissé vivent sur l'enveloppe, pas sur le lien : posés
    // sur le `<a>`, ils avalent le clic. On laisse de côté les `attributes` de
    // dnd-kit (`role="button"`, `tabIndex`) : ils feraient d'une rangée-lien un
    // bouton pour les lecteurs d'écran. Le déplacement au clavier passe par les
    // entrées « Déplacer » du menu « ⋯ » de la liste.
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...listeners}
      className={`${last ? "" : "border-b border-hairline"} ${
        isDragging ? "rounded-xl bg-surface-2" : ""
      }`}
    >
      <Link to={to} onClick={onOpen} className="flex min-h-[64px] items-center gap-3 py-2.5">
        <ListEmoji emoji={list.emoji} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold">{list.name}</span>
          {total === 0 ? (
            <span className="block text-xs text-slate-400">Vide — touche pour commencer</span>
          ) : (
            <span className="mt-1 flex items-center gap-2">
              <Progress done={done} total={total} className="w-20" />
              <span className={`text-xs ${finished ? "text-brand-600" : "text-slate-400"}`}>
                {finished ? "Terminée" : `${done} / ${total}`}
              </span>
            </span>
          )}
          {(match || folderName) && (
            <span className="mt-1 block truncate text-xs text-slate-400">
              {[folderName && `Dans « ${folderName} »`, match && `contient « ${match} »`]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </span>
        <IconChevronRight size={20} className="shrink-0 text-slate-400" />
      </Link>
    </div>
  );
}

/**
 * Index d'un onglet (racine) **ou** contenu d'un dossier : c'est le même écran,
 * seul le périmètre change. `folderId` renseigné = sous-page du dossier, avec
 * retour vers la racine dans la barre du haut.
 */
function CustomLists({
  scope,
  basePath,
  folderId,
}: {
  scope: ListScope;
  basePath: string;
  folderId?: string;
}) {
  const pageTitle = scope === "shared" ? "Listes partagées" : "Listes perso";
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState(false);
  const [search, setSearch] = useState("");
  // Les poignées de glisser-déposer n'apparaissent qu'en mode réorganisation
  // (ordinateur) ; sur mobile, l'appui long suffit.
  const [reorderMode, setReorderMode] = useState(false);
  const deskSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  // Mobile : la rangée est un lien, donc pas de glissé au premier contact —
  // l'appui long (250 ms) départage. Avec un `delay`, dnd-kit laisse le
  // navigateur défiler tant que le seuil n'est pas franchi.
  const rowSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  // Un glissé se termine par un clic sur le lien : on l'avale.
  const dragged = useRef(false);

  const { data, isLoading } = useQuery({
    queryKey: listQueryKey(scope),
    queryFn: () => api.get<ListsPayload>(`/api/lists?scope=${scope}`),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["lists"] });
  const create = useMutation({
    mutationFn: (v: { name: string; emoji: string | null }) =>
      api.post("/api/lists", { scope, name: v.name, emoji: v.emoji, folderId: folderId ?? null }),
    onSuccess: invalidate,
  });
  const createFolder = useMutation({
    mutationFn: (v: { name: string; emoji: string | null }) =>
      api.post("/api/lists/folders", { scope, name: v.name, emoji: v.emoji }),
    onSuccess: invalidate,
  });
  const patchFolder = useMutation({
    mutationFn: (v: { name?: string; emoji?: string | null }) =>
      api.patch(`/api/lists/folders/${folderId}`, v),
    onSuccess: invalidate,
  });
  const removeFolder = useMutation({
    mutationFn: () => api.del(`/api/lists/folders/${folderId}`),
    onSuccess: () => {
      invalidate();
      navigate(basePath, { replace: true });
    },
  });
  const reorder = useMutation({
    mutationFn: (orderedIds: string[]) => api.patch("/api/lists/reorder", { orderedIds }),
    onSuccess: invalidate,
  });

  const allLists = data?.lists ?? [];
  const allFolders = data?.folders ?? [];
  const folder = folderId ? allFolders.find((f) => f.id === folderId) : undefined;

  // La recherche porte aussi sur le contenu : avec dix listes « Idées cadeaux »,
  // on retrouve la bonne par ce qu'il y a dedans, pas par son nom.
  const q = search.trim().toLowerCase();
  const searching = q.length > 0;
  const matchOf = (l: CustomList) => l.items.find((i) => i.label.toLowerCase().includes(q));

  // À la racine, chercher c'est vouloir retrouver une liste où qu'elle soit :
  // la recherche traverse les dossiers (et les dossiers eux-mêmes s'effacent,
  // ils ne sont pas des résultats). Dans un dossier, on reste dans le dossier —
  // son nom est écrit en haut de l'écran, en sortir sans le dire mentirait.
  const scoped = folderId
    ? allLists.filter((l) => l.folderId === folderId)
    : allLists.filter((l) => !l.folderId);
  const haystack = folderId ? scoped : allLists;
  const lists = searching
    ? haystack.filter((l) => l.name.toLowerCase().includes(q) || !!matchOf(l))
    : scoped;
  const folders = searching || folderId ? [] : allFolders;
  const folderNameOf = (l: CustomList) =>
    l.folderId ? allFolders.find((f) => f.id === l.folderId)?.name : undefined;

  const openItems = lists.reduce((n, l) => n + l.items.filter((i) => !i.done).length, 0);
  const countLabel = `${lists.length} liste${lists.length > 1 ? "s" : ""} · ${openItems} à faire`;

  // Un dossier ouvert est une sous-page : titre du dossier, retour vers la
  // racine, et ses actions dans le « ⋯ » de la barre du haut.
  const folderActions: OverflowItem[] = [
    { label: "Modifier", onClick: () => setRenamingFolder(true) },
    {
      label: "Supprimer le dossier",
      danger: true,
      onClick: () => {
        if (
          folder &&
          confirm(
            `Supprimer le dossier « ${folder.name} » ? Ses listes ne sont pas supprimées : elles reviennent à la racine.`,
          )
        )
          removeFolder.mutate();
      },
    },
  ];
  // Déclarés avant tout retour anticipé : ce sont des hooks.
  usePageHeader(folderId ? (folder?.name ?? "Dossier") : pageTitle, countLabel, folder?.emoji);
  usePageChrome(folderId ? basePath : null, folderActions);

  const onDragEnd = (e: DragEndEvent) => {
    window.setTimeout(() => (dragged.current = false), 250);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = lists.findIndex((l) => l.id === active.id);
    const to = lists.findIndex((l) => l.id === over.id);
    if (from < 0 || to < 0) return;
    reorder.mutate(arrayMove(lists, from, to).map((l) => l.id));
  };

  if (isLoading) return <PageLoader variant="taches" />;

  if (folderId && !folder) {
    return (
      <div className="card flex flex-col items-start gap-3 text-sm text-slate-400">
        <p>Ce dossier n'existe plus.</p>
        <Link to={basePath} className="btn-primary">
          Revenir aux listes
        </Link>
      </div>
    );
  }

  const hint = folderId
    ? "Les listes de ce dossier. Les autres sont restées à la racine."
    : scope === "shared"
      ? "Listes partagées avec tout le foyer."
      : "Listes personnelles : personne d'autre ne les voit.";
  // Vide se juge sur les données, pas sur le résultat filtré : sans ça, une
  // recherche sans réponse afficherait « aucune liste pour l'instant ».
  const empty = folderId ? scoped.length === 0 : allLists.length === 0 && allFolders.length === 0;
  const searchable = !empty;

  const searchField = searchable ? (
    <SearchField value={search} onChange={setSearch} placeholder="Nom de liste ou élément…" />
  ) : null;

  const noResult = (
    <div className="card flex flex-col items-start gap-3 text-sm text-slate-400">
      <p>Aucune liste ne correspond à « {search.trim()} ».</p>
      <button type="button" onClick={() => setSearch("")} className="btn-ghost">
        Effacer la recherche
      </button>
    </div>
  );

  return (
    <>
      {/* ---- Mobile : un index de rangées, une carte, une action ---- */}
      <div className="flex flex-col gap-3 pb-28 md:hidden">
        {searchField}
        {empty ? (
          <div className="card flex flex-col items-start gap-3 text-sm text-slate-400">
            <p>{folderId ? "Ce dossier est vide." : "Aucune liste pour l'instant."}</p>
            <button type="button" onClick={() => setCreating(true)} className="btn-primary">
              Créer la première
            </button>
          </div>
        ) : lists.length === 0 && searching ? (
          noResult
        ) : (
          <>
            {folders.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <SectionLabel
                  right={
                    <button
                      type="button"
                      onClick={() => setCreatingFolder(true)}
                      className="btn-ghost text-xs"
                    >
                      + Dossier
                    </button>
                  }
                >
                  Dossiers · {folders.length}
                </SectionLabel>
                <div className="card">
                  {folders.map((f, i) => (
                    <FolderRow
                      key={f.id}
                      folder={f}
                      to={`${basePath}/${FOLDER_SEGMENT}/${f.id}`}
                      last={i === folders.length - 1}
                    />
                  ))}
                </div>
              </div>
            )}
            {lists.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {folders.length > 0 && <SectionLabel>Listes · {lists.length}</SectionLabel>}
                <div className="card">
                  <DndContext
                    sensors={rowSensors}
                    collisionDetection={closestCenter}
                    onDragStart={() => (dragged.current = true)}
                    onDragEnd={onDragEnd}
                  >
                    <SortableContext
                      items={lists.map((l) => l.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {lists.map((l, i) => (
                        <ListRow
                          key={l.id}
                          list={l}
                          to={`${basePath}/${l.id}`}
                          last={i === lists.length - 1}
                          disabled={searching}
                          match={
                            searching && !l.name.toLowerCase().includes(q)
                              ? matchOf(l)?.label
                              : undefined
                          }
                          folderName={searching ? folderNameOf(l) : undefined}
                          onOpen={(e) => {
                            if (dragged.current) e.preventDefault();
                          }}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                </div>
              </div>
            )}
            {folders.length === 0 && !searching && !folderId && (
              <button
                type="button"
                onClick={() => setCreatingFolder(true)}
                className="btn-ghost self-start text-sm"
              >
                + Nouveau dossier
              </button>
            )}
            <p className="px-1 text-xs text-slate-400">{hint}</p>
          </>
        )}
        <MobileActionBar label="Nouvelle liste" onClick={() => setCreating(true)} />
      </div>

      {/* ---- Ordinateur : les listes dépliées côte à côte ---- */}
      <div className="hidden flex-col gap-4 md:flex">
        {folder && (
          <div className="flex items-center gap-3">
            <Link
              to={basePath}
              aria-label="Retour aux listes"
              className="flex h-tap w-tap shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink"
            >
              <IconChevronLeft />
            </Link>
            <ListEmoji emoji={folder.emoji} folder />
            <div className="min-w-0 flex-1">
              <div className="eyebrow">{pageTitle}</div>
              <div className="truncate text-xl font-semibold">{folder.name}</div>
            </div>
            <OverflowMenu label="Actions du dossier" items={folderActions} />
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-slate-400">{hint}</p>
          <div className="flex shrink-0 items-center gap-2">
            {/* Réorganiser et filtrer se contredisent : le bouton s'efface. */}
            {lists.length > 0 && !searching && (
              <button
                type="button"
                onClick={() => setReorderMode((v) => !v)}
                aria-pressed={reorderMode}
                className={`text-xs ${reorderMode ? "btn-primary" : "btn-ghost"}`}
              >
                <span aria-hidden="true">{reorderMode ? "✓" : "⠿"}</span>
                {reorderMode ? "Terminer" : "Réorganiser"}
              </button>
            )}
            {!folderId && (
              <button type="button" onClick={() => setCreatingFolder(true)} className="btn-ghost">
                Nouveau dossier
              </button>
            )}
            <button type="button" onClick={() => setCreating(true)} className="btn-primary">
              Nouvelle liste
            </button>
          </div>
        </div>

        {searchField}

        {folders.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {folders.map((f) => (
              <FolderCard key={f.id} folder={f} to={`${basePath}/${FOLDER_SEGMENT}/${f.id}`} />
            ))}
          </div>
        )}

        {empty ? (
          <div className="card text-sm text-slate-400">
            {folderId
              ? "Ce dossier est vide — crée une liste dedans."
              : "Aucune liste pour l'instant — crée-en une pour commencer."}
          </div>
        ) : lists.length === 0 && searching ? (
          noResult
        ) : (
          lists.length > 0 && (
            <DndContext
              sensors={deskSensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext items={lists.map((l) => l.id)} strategy={verticalListSortingStrategy}>
                {/* Colonnes CSS plutôt qu'une grille : une carte courte ne laisse
                    pas un trou sous elle en attendant la carte haute d'à côté.
                    L'espacement vertical vient du `mb-4` de chaque carte. */}
                <div className="lg:columns-2 lg:gap-4">
                  {lists.map((l) => (
                    <SortableListCard
                      key={l.id}
                      list={l}
                      folders={allFolders}
                      folderName={searching ? folderNameOf(l) : undefined}
                      reorderMode={reorderMode && !searching}
                      onChanged={invalidate}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )
        )}
      </div>

      {creating && (
        <ListFormModal
          title={folder ? `Nouvelle liste dans « ${folder.name} »` : "Nouvelle liste"}
          submitLabel="Créer"
          onSubmit={(v) => create.mutate(v)}
          onClose={() => setCreating(false)}
        />
      )}
      {creatingFolder && (
        <ListFormModal
          title="Nouveau dossier"
          submitLabel="Créer"
          placeholder="Nom du dossier…"
          folder
          onSubmit={(v) => createFolder.mutate(v)}
          onClose={() => setCreatingFolder(false)}
        />
      )}
      {renamingFolder && folder && (
        <ListFormModal
          title="Renommer le dossier"
          submitLabel="Enregistrer"
          initialName={folder.name}
          initialEmoji={folder.emoji}
          placeholder="Nom du dossier…"
          folder
          onSubmit={(v) => patchFolder.mutate(v)}
          onClose={() => setRenamingFolder(false)}
        />
      )}
    </>
  );
}

/* ---------------- Sous-page : une liste ---------------- */

/** Ligne d'élément : la case à cocher est la seule action visible (règle 1). */
function DetailItemRow({
  item,
  last,
  onToggle,
  actions,
}: {
  item: CustomListItem;
  last: boolean;
  onToggle: () => void;
  actions: OverflowItem[];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex min-h-[56px] items-center gap-3 ${last ? "" : "border-b border-hairline"} ${
        isDragging ? "rounded-xl bg-surface-2" : ""
      }`}
      {...attributes}
      {...listeners}
    >
      <Checkbox size="lg" checked={item.done} onChange={onToggle} />
      <button
        type="button"
        onClick={onToggle}
        className={`min-w-0 flex-1 break-words py-2 text-left text-base ${
          item.done ? "text-slate-400 line-through" : ""
        }`}
      >
        {item.label}
      </button>
      <OverflowMenu items={actions} label={`Actions sur « ${item.label} »`} />
    </div>
  );
}

function ListDetail({
  scope,
  listId,
  basePath,
}: {
  scope: ListScope;
  listId: string;
  /** Racine de l'onglet ; le retour vise le dossier de la liste s'il y en a un. */
  basePath: string;
}) {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [newItem, setNewItem] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [showDone, setShowDone] = useState(true);
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const { data, isLoading } = useQuery({
    queryKey: listQueryKey(scope),
    queryFn: () => api.get<ListsPayload>(`/api/lists?scope=${scope}`),
  });
  const folders = data?.folders ?? [];
  const list = (data?.lists ?? []).find((l) => l.id === listId);
  // Le voisinage d'une liste, c'est son dossier : « déplacer vers le haut »
  // doit la faire monter parmi ses sœurs, pas parmi toutes les listes.
  const siblings = (data?.lists ?? []).filter((l) => l.folderId === (list?.folderId ?? null));
  const index = siblings.findIndex((l) => l.id === listId);
  // Une liste rangée dans un dossier revient au dossier, pas à la racine.
  const backTo = list?.folderId ? `${basePath}/${FOLDER_SEGMENT}/${list.folderId}` : basePath;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["lists"] });
  const reorder = useMutation({
    mutationFn: (orderedIds: string[]) => api.patch("/api/lists/reorder", { orderedIds }),
    onSuccess: invalidate,
  });
  const patchList = useMutation({
    mutationFn: (v: {
      name?: string;
      emoji?: string | null;
      folderId?: string | null;
      scope?: ListScope;
    }) => api.patch(`/api/lists/${listId}`, v),
    onSuccess: invalidate,
  });
  // Changer de portée sort la liste de l'onglet courant : on la rouvre là où
  // elle a atterri, sinon l'écran se vide sur une liste « qui n'existe plus ».
  const switchScope = useMutation({
    mutationFn: (target: ListScope) => api.patch(`/api/lists/${listId}`, { scope: target }),
    onSuccess: (_r, target) => {
      invalidate();
      navigate(`/listes/${target === "shared" ? "partagees" : "perso"}/${listId}`, {
        replace: true,
      });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/lists/${listId}`),
    onSuccess: () => {
      invalidate();
      navigate(backTo, { replace: true });
    },
  });
  const addItem = useMutation({
    mutationFn: (label: string) => api.post(`/api/lists/${listId}/items`, { label }),
    onSuccess: invalidate,
  });
  const updateItem = useMutation({
    mutationFn: (v: { id: string; label?: string; done?: boolean }) =>
      api.patch(`/api/lists/${listId}/items/${v.id}`, { label: v.label, done: v.done }),
    onSuccess: invalidate,
  });
  const removeItem = useMutation({
    mutationFn: (id: string) => api.del(`/api/lists/${listId}/items/${id}`),
    onSuccess: invalidate,
  });
  const reorderItems = useMutation({
    mutationFn: (orderedIds: string[]) =>
      api.patch(`/api/lists/${listId}/items/reorder`, { orderedIds }),
    onSuccess: invalidate,
  });

  const members = me.household.members;
  const folderName = list?.folderId
    ? folders.find((f) => f.id === list.folderId)?.name
    : undefined;
  const eyebrow =
    (scope === "shared"
      ? `Partagée · ${members.a.name} & ${members.b.name}`
      : `Perso · ${members[me.member].name}`) + (folderName ? ` · ${folderName}` : "");

  /**
   * Actions de la liste. Le déplacement figure ici parce que l'index mobile ne
   * porte aucun bouton : le glisser (appui long) est le geste rapide, ces deux
   * entrées sont la voie au clic — indispensable au tactile.
   */
  const move = (dir: -1 | 1) =>
    reorder.mutate(arrayMove(siblings, index, index + dir).map((l) => l.id));
  const scopeSwitch = SCOPE_SWITCH[scope];
  const listActions: OverflowItem[] = [
    { label: "Modifier", onClick: () => setRenaming(true) },
    { label: "Déplacer", onClick: () => setMoving(true) },
    {
      label: scopeSwitch.label,
      onClick: () => {
        if (confirm(scopeSwitch.confirm)) switchScope.mutate(scopeSwitch.to);
      },
    },
    ...(index > 0 ? [{ label: "Déplacer vers le haut", onClick: () => move(-1) }] : []),
    ...(index >= 0 && index < siblings.length - 1
      ? [{ label: "Déplacer vers le bas", onClick: () => move(1) }]
      : []),
    {
      label: "Supprimer la liste",
      danger: true,
      onClick: () => {
        if (list && confirm(`Supprimer la liste « ${list.name} » ?`)) remove.mutate();
      },
    },
  ];

  // Déclarés avant tout retour anticipé : ce sont des hooks.
  usePageHeader(list?.name ?? "Liste", eyebrow, list?.emoji);
  usePageChrome(backTo, listActions);

  if (isLoading) return <PageLoader variant="taches" />;
  if (!list) {
    return (
      <div className="card flex flex-col items-start gap-3 text-sm text-slate-400">
        <p>Cette liste n'existe plus.</p>
        <Link to={backTo} className="btn-primary">
          Revenir aux listes
        </Link>
      </div>
    );
  }

  const pending = list.items.filter((i) => !i.done);
  const done = list.items.filter((i) => i.done);
  const submitItem = () => {
    const value = newItem.trim();
    if (!value) return;
    addItem.mutate(value);
    setNewItem("");
  };
  const onItemDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = list.items.findIndex((i) => i.id === active.id);
    const to = list.items.findIndex((i) => i.id === over.id);
    if (from < 0 || to < 0) return;
    reorderItems.mutate(arrayMove(list.items, from, to).map((i) => i.id));
  };
  // `updatedBy` est un slot membre venu de l'API : on ne le croit pas sur parole.
  const updatedByName =
    list.updatedBy === "a" || list.updatedBy === "b" ? members[list.updatedBy].name : null;
  const itemActions = (item: CustomListItem): OverflowItem[] => [
    { label: "Renommer", onClick: () => setEditing({ id: item.id, label: item.label }) },
    { label: "Supprimer", danger: true, onClick: () => removeItem.mutate(item.id) },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* Ordinateur : la barre du haut est masquée, l'en-tête revient ici. */}
      <div className="hidden items-center gap-3 md:flex">
        <Link
          to={backTo}
          aria-label="Retour aux listes"
          className="flex h-tap w-tap shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink"
        >
          <IconChevronLeft />
        </Link>
        <ListEmoji emoji={list.emoji} />
        <div className="min-w-0 flex-1">
          <div className="eyebrow">{eyebrow}</div>
          <div className="truncate text-xl font-semibold">{list.name}</div>
        </div>
        <OverflowMenu label="Actions de la liste" items={listActions} />
      </div>

      {/* L'ajout est en tête : c'est ce qu'on vient faire le plus souvent. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitItem();
        }}
        className="flex gap-2"
      >
        <Input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder="Ajouter un élément…"
          className="flex-1"
        />
        <button
          type="submit"
          className="btn-primary shrink-0"
          aria-label="Ajouter l'élément"
          disabled={!newItem.trim()}
        >
          +
        </button>
      </form>

      {list.items.length > 0 && (
        <div className="flex items-center gap-3">
          <Progress done={done.length} total={list.items.length} className="flex-1" />
          <span className="shrink-0 text-xs text-slate-400">
            {done.length} / {list.items.length}
          </span>
        </div>
      )}

      {list.items.length === 0 && (
        <div className="card text-sm text-slate-400">
          Liste vide — ajoute un premier élément ci-dessus.
        </div>
      )}

      {pending.length > 0 && (
        <div className="card">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onItemDragEnd}>
            <SortableContext items={pending.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              {pending.map((item, i) => (
                <DetailItemRow
                  key={item.id}
                  item={item}
                  last={i === pending.length - 1}
                  onToggle={() => updateItem.mutate({ id: item.id, done: true })}
                  actions={itemActions(item)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}

      {done.length > 0 && (
        <div className="card">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            aria-expanded={showDone}
            className={`flex min-h-[52px] w-full items-center gap-2 text-left text-sm text-ink-2 ${
              showDone ? "border-b border-hairline" : ""
            }`}
          >
            <span aria-hidden="true" className="text-brand-600">
              ✓
            </span>
            <span className="flex-1">
              {done.length} élément{done.length > 1 ? "s" : ""} fait
              {done.length > 1 ? "s" : ""}
            </span>
            <IconChevronDown
              size={20}
              className={`shrink-0 transition-transform ${showDone ? "" : "-rotate-90"}`}
            />
          </button>
          {showDone &&
            done.map((item, i) => (
              <div
                key={item.id}
                className={`flex min-h-[56px] items-center gap-3 ${
                  i === done.length - 1 ? "" : "border-b border-hairline"
                }`}
              >
                <Checkbox
                  size="lg"
                  checked
                  onChange={() => updateItem.mutate({ id: item.id, done: false })}
                />
                <button
                  type="button"
                  onClick={() => updateItem.mutate({ id: item.id, done: false })}
                  className="min-w-0 flex-1 break-words py-2 text-left text-base text-slate-400 line-through"
                >
                  {item.label}
                </button>
                <OverflowMenu items={itemActions(item)} label={`Actions sur « ${item.label} »`} />
              </div>
            ))}
        </div>
      )}

      {list.updatedAt && (
        <div className="flex items-center gap-2 px-1 text-xs text-slate-400">
          {scope === "shared" ? (
            <span className="flex -space-x-2">
              <MemberAvatar id="a" className="h-6 w-6 text-2xs ring-2 ring-[color:var(--paper)]" />
              <MemberAvatar id="b" className="h-6 w-6 text-2xs ring-2 ring-[color:var(--paper)]" />
            </span>
          ) : (
            <MemberAvatar id={me.member} className="h-6 w-6 text-2xs" />
          )}
          <span>
            Modifiée{updatedByName ? ` par ${updatedByName}` : ""} {relativeFr(list.updatedAt)}
          </span>
        </div>
      )}

      {moving && (
        <MoveToFolderModal
          folders={folders}
          current={list.folderId}
          onPick={(fid) => patchList.mutate({ folderId: fid })}
          onClose={() => setMoving(false)}
        />
      )}
      {renaming && (
        <ListFormModal
          title="Modifier la liste"
          submitLabel="Enregistrer"
          initialName={list.name}
          initialEmoji={list.emoji}
          onSubmit={(v) => patchList.mutate(v)}
          onClose={() => setRenaming(false)}
        />
      )}

      {editing && (
        <ItemRenameModal
          initial={editing.label}
          onSubmit={(label) => updateItem.mutate({ id: editing.id, label })}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ItemRenameModal({
  initial,
  onSubmit,
  onClose,
}: {
  initial: string;
  onSubmit: (label: string) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(initial);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          const value = label.trim();
          if (value && value !== initial) onSubmit(value);
          onClose();
        }}
        className="card w-full max-w-sm space-y-3"
      >
        <div className="font-semibold">Renommer l'élément</div>
        <Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Annuler
          </button>
          <button type="submit" className="btn-primary">
            Enregistrer
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------------- Carte dépliée (ordinateur) ---------------- */

type SortableHandle = Pick<ReturnType<typeof useSortable>, "attributes" | "listeners">;

/** Poignée de réorganisation, visible seulement en mode réorganisation. */
function DragHandle({ attributes, listeners }: SortableHandle) {
  return (
    <button
      {...attributes}
      {...listeners}
      style={{ touchAction: "none" }}
      className="cursor-grab px-1 text-slate-300 hover:text-slate-500"
      title="Glisser pour réordonner"
    >
      ⠿
    </button>
  );
}

function SortableItemRow({
  item,
  reorderMode,
  onToggle,
  onRename,
  onRemove,
}: {
  item: CustomListItem;
  reorderMode: boolean;
  onToggle: () => void;
  onRename: (label: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.label);

  const commit = () => {
    setEditing(false);
    const value = draft.trim();
    if (value && value !== item.label) onRename(value);
    else setDraft(item.label);
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group/item flex items-center gap-2.5 rounded-xl px-1 py-0.5 ${
        isDragging ? "bg-brand-50 dark:bg-slate-800" : ""
      }`}
    >
      {reorderMode && <DragHandle attributes={attributes} listeners={listeners} />}
      <Checkbox size="lg" checked={item.done} onChange={onToggle} />
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(item.label);
              setEditing(false);
            }
          }}
          className="input flex-1 py-1"
        />
      ) : (
        <button
          onClick={onToggle}
          className={`min-w-0 break-words text-left ${
            item.done ? "text-slate-400 line-through" : ""
          }`}
        >
          {item.label}
        </button>
      )}
      <OverflowMenu
        className="ml-auto"
        label={`Actions sur « ${item.label} »`}
        items={[
          { label: "Renommer", onClick: () => setEditing(true) },
          { label: "Supprimer", danger: true, onClick: onRemove },
        ]}
      />
    </div>
  );
}

function SortableListCard({
  list,
  folders,
  folderName,
  reorderMode,
  onChanged,
}: {
  list: CustomList;
  /** Destinations possibles pour « Déplacer ». */
  folders: ListFolder[];
  /** Dossier d'origine, affiché seulement quand la recherche les traverse. */
  folderName?: string;
  reorderMode: boolean;
  onChanged: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: list.id,
  });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [editingList, setEditingList] = useState(false);
  const [moving, setMoving] = useState(false);
  const [newItem, setNewItem] = useState("");

  const patchList = useMutation({
    mutationFn: (v: {
      name?: string;
      emoji?: string | null;
      folderId?: string | null;
      scope?: ListScope;
    }) => api.patch(`/api/lists/${list.id}`, v),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/lists/${list.id}`),
    onSuccess: onChanged,
  });
  const addItem = useMutation({
    mutationFn: (label: string) => api.post(`/api/lists/${list.id}/items`, { label }),
    onSuccess: onChanged,
  });
  const updateItem = useMutation({
    mutationFn: (v: { id: string; label?: string; done?: boolean }) =>
      api.patch(`/api/lists/${list.id}/items/${v.id}`, { label: v.label, done: v.done }),
    onSuccess: onChanged,
  });
  const removeItem = useMutation({
    mutationFn: (id: string) => api.del(`/api/lists/${list.id}/items/${id}`),
    onSuccess: onChanged,
  });
  const reorderItems = useMutation({
    mutationFn: (orderedIds: string[]) =>
      api.patch(`/api/lists/${list.id}/items/reorder`, { orderedIds }),
    onSuccess: onChanged,
  });

  const onItemDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = list.items.findIndex((i) => i.id === active.id);
    const to = list.items.findIndex((i) => i.id === over.id);
    if (from < 0 || to < 0) return;
    reorderItems.mutate(arrayMove(list.items, from, to).map((i) => i.id));
  };

  const submitItem = () => {
    const value = newItem.trim();
    if (!value) return;
    addItem.mutate(value);
    setNewItem("");
  };

  const done = list.items.filter((i) => i.done).length;

  const scopeSwitch = SCOPE_SWITCH[list.scope];

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`card mb-4 flex break-inside-avoid flex-col gap-2 ${isDragging ? "ring-2 ring-brand-400" : ""}`}
    >
      <div className="flex items-center gap-2">
        {reorderMode && <DragHandle attributes={attributes} listeners={listeners} />}
        <ListEmoji emoji={list.emoji} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block break-words font-semibold">{list.name}</span>
          {folderName && (
            <span className="block truncate text-xs text-slate-400">Dans « {folderName} »</span>
          )}
        </span>
        <span className="shrink-0 text-xs text-slate-400">
          {done}/{list.items.length}
        </span>
        <OverflowMenu
          label={`Actions sur « ${list.name} »`}
          items={[
            { label: "Modifier", onClick: () => setEditingList(true) },
            { label: "Déplacer", onClick: () => setMoving(true) },
            {
              label: scopeSwitch.label,
              onClick: () => {
                if (confirm(scopeSwitch.confirm)) patchList.mutate({ scope: scopeSwitch.to });
              },
            },
            {
              label: "Supprimer la liste",
              danger: true,
              onClick: () => {
                if (confirm(`Supprimer la liste « ${list.name} » ?`)) remove.mutate();
              },
            },
          ]}
        />
      </div>

      {list.items.length === 0 ? (
        <p className="px-2 text-xs text-slate-400">Liste vide — ajoute un premier élément.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onItemDragEnd}>
          <SortableContext
            items={list.items.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col">
              {list.items.map((item) => (
                <SortableItemRow
                  key={item.id}
                  item={item}
                  reorderMode={reorderMode}
                  onToggle={() => updateItem.mutate({ id: item.id, done: !item.done })}
                  onRename={(label) => updateItem.mutate({ id: item.id, label })}
                  onRemove={() => removeItem.mutate(item.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitItem();
        }}
        className="flex gap-2"
      >
        <Input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder="Ajouter un élément…"
          className="flex-1"
        />
        <button type="submit" className="btn-primary shrink-0" aria-label="Ajouter">
          +
        </button>
      </form>

      {editingList && (
        <ListFormModal
          title="Modifier la liste"
          submitLabel="Enregistrer"
          initialName={list.name}
          initialEmoji={list.emoji}
          onSubmit={(v) => patchList.mutate(v)}
          onClose={() => setEditingList(false)}
        />
      )}
      {moving && (
        <MoveToFolderModal
          folders={folders}
          current={list.folderId}
          onPick={(folderId) => patchList.mutate({ folderId })}
          onClose={() => setMoving(false)}
        />
      )}
    </div>
  );
}
