import { useState } from "react";
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
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CustomList, CustomListItem, ListScope } from "@gfa/shared";
import { api } from "../lib/api";
import { SubNav, Input, Checkbox } from "../components/ui";
import WishList from "../components/WishList";
import PageLoader from "../components/PageLoader";

type Tab = "wishlist" | "partagees" | "perso";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "wishlist", label: "WishList", icon: "⭐" },
  { id: "partagees", label: "Listes partagées", icon: "👨‍👩‍👧" },
  { id: "perso", label: "Listes perso", icon: "🔒" },
];

export default function Listes() {
  const navigate = useNavigate();
  const { tab: tabParam } = useParams();
  const tab: Tab = TABS.some((t) => t.id === tabParam) ? (tabParam as Tab) : "wishlist";

  return (
    <div className="space-y-4">
      <SubNav
        value={tab}
        onChange={(v) => navigate(`/listes/${v}`)}
        items={TABS.map((t) => ({ value: t.id, label: t.label, icon: t.icon }))}
      />
      {tab === "wishlist" && <WishList />}
      {tab === "partagees" && <CustomLists scope="shared" />}
      {tab === "perso" && <CustomLists scope="personal" />}
    </div>
  );
}

/* ---------------- Listes libres (partagées / personnelles) ---------------- */

type SortableHandle = Pick<ReturnType<typeof useSortable>, "attributes" | "listeners">;

/**
 * Poignée de réorganisation. Pas de flèches ↑/↓ ici (trop encombrantes sur des
 * listes denses) : la poignée reste donc visible sur mobile, avec
 * `touch-action: none` pour que le glisser tactile ne scrolle pas la page.
 */
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
  onToggle,
  onRename,
  onRemove,
}: {
  item: CustomListItem;
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
      className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${
        isDragging ? "bg-brand-50 dark:bg-slate-800" : ""
      }`}
    >
      <DragHandle attributes={attributes} listeners={listeners} />
      <Checkbox checked={item.done} onChange={onToggle} />
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
          className="input flex-1 py-1 text-sm"
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className={`flex-1 truncate text-left text-sm ${
            item.done ? "text-slate-400 line-through" : ""
          }`}
        >
          {item.label}
        </button>
      )}
      <button
        onClick={onRemove}
        aria-label="Supprimer l'élément"
        className="rounded-lg px-1.5 py-1 text-slate-300 transition hover:text-red-500"
      >
        ✕
      </button>
    </div>
  );
}

function SortableListCard({
  list,
  scope,
  onChanged,
}: {
  list: CustomList;
  scope: ListScope;
  onChanged: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: list.id,
  });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(list.name);
  const [newItem, setNewItem] = useState("");

  const rename = useMutation({
    mutationFn: (value: string) => api.patch(`/api/lists/${list.id}`, { name: value }),
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

  const commitName = () => {
    setRenaming(false);
    const value = name.trim();
    if (value && value !== list.name) rename.mutate(value);
    else setName(list.name);
  };
  const submitItem = () => {
    const value = newItem.trim();
    if (!value) return;
    addItem.mutate(value);
    setNewItem("");
  };

  const done = list.items.filter((i) => i.done).length;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`card flex flex-col gap-2 ${isDragging ? "ring-2 ring-brand-400" : ""}`}
    >
      <div className="flex items-center gap-2">
        <DragHandle attributes={attributes} listeners={listeners} />
        {renaming ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") {
                setName(list.name);
                setRenaming(false);
              }
            }}
            className="input flex-1 py-1"
          />
        ) : (
          <button onClick={() => setRenaming(true)} className="flex-1 truncate text-left font-semibold">
            {list.name}
          </button>
        )}
        <span className="shrink-0 text-xs text-slate-400">
          {done}/{list.items.length}
        </span>
        <button
          onClick={() => {
            if (confirm(`Supprimer la liste « ${list.name} » ?`)) remove.mutate();
          }}
          aria-label="Supprimer la liste"
          className="rounded-lg px-1.5 py-1 text-slate-300 transition hover:text-red-500"
        >
          🗑
        </button>
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
      {scope === "personal" && (
        <p className="text-[11px] text-slate-400">Visible uniquement par toi.</p>
      )}
    </div>
  );
}

function CustomLists({ scope }: { scope: ListScope }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const key = ["lists", scope];

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ lists: CustomList[] }>(`/api/lists?scope=${scope}`),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["lists"] });
  const create = useMutation({
    mutationFn: (value: string) => api.post("/api/lists", { scope, name: value }),
    onSuccess: invalidate,
  });
  const reorder = useMutation({
    mutationFn: (orderedIds: string[]) => api.patch("/api/lists/reorder", { orderedIds }),
    onSuccess: invalidate,
  });

  const lists = data?.lists ?? [];
  const submit = () => {
    const value = name.trim();
    if (!value) return;
    create.mutate(value);
    setName("");
    setModalOpen(false);
  };
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = lists.findIndex((l) => l.id === active.id);
    const to = lists.findIndex((l) => l.id === over.id);
    if (from < 0 || to < 0) return;
    reorder.mutate(arrayMove(lists, from, to).map((l) => l.id));
  };

  if (isLoading) return <PageLoader variant="taches" />;

  return (
    <div className="flex flex-col gap-4 pb-24 md:pb-0">
      {/* Création : inline sur ordinateur, bouton flottant + modale sur mobile */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="hidden gap-2 md:flex"
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nom de la nouvelle liste…"
          className="flex-1"
        />
        <button type="submit" className="btn-primary shrink-0">
          Créer la liste
        </button>
      </form>

      <p className="text-xs text-slate-400">
        {scope === "shared"
          ? "Listes partagées avec tout le foyer."
          : "Listes personnelles : personne d'autre ne les voit."}
      </p>

      {lists.length === 0 ? (
        <div className="card text-sm text-slate-400">
          Aucune liste pour l'instant — crée-en une pour commencer.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={lists.map((l) => l.id)} strategy={verticalListSortingStrategy}>
            <div className="grid items-start gap-4 lg:grid-cols-2">
              {lists.map((l) => (
                <SortableListCard key={l.id} list={l} scope={scope} onChanged={invalidate} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <button
        onClick={() => setModalOpen(true)}
        aria-label="Nouvelle liste"
        className="btn-primary fixed bottom-6 right-6 z-30 h-14 w-14 rounded-full p-0 shadow-lg md:hidden"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="h-6 w-6"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
          onClick={() => setModalOpen(false)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="card w-full max-w-sm space-y-3"
          >
            <div className="font-semibold">Nouvelle liste</div>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nom de la liste…"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModalOpen(false)} className="btn-ghost">
                Annuler
              </button>
              <button type="submit" className="btn-primary">
                Créer
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
