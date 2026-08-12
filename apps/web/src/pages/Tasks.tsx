import { useRef, useState, type TouchEvent } from "react";
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
import { PRIORITY_LABELS, type Task, type TaskWithSubtasks } from "@gfa/shared";
import { api } from "../lib/api";
import PageLoader from "../components/PageLoader";
import { dateFr } from "../lib/format";
import { Checkbox, DateInput, GestureHelp } from "../components/ui";
import { MemberAvatar } from "../components/MemberAvatar";
import { useMe } from "../auth";

// Responsable = membre du foyer. Sélecteur par avatars (aucun par défaut, re-clic = désélection).
function AssigneePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const members = useMe().household.members;
  return (
    <div className="flex gap-3">
      {(["a", "b"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(value === m ? "" : m)}
          aria-label={members[m].name}
          aria-pressed={value === m}
          className={`rounded-full p-0.5 transition ${
            value === m ? "ring-2 ring-brand-500" : "opacity-40 hover:opacity-100"
          }`}
        >
          <MemberAvatar id={m} className="h-9 w-9 text-sm" />
        </button>
      ))}
    </div>
  );
}

// Petit indicateur de chargement (validation / suppression d'une tâche).
function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`animate-spin ${className}`} aria-label="Chargement">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

const FILTERS = [
  { value: "all", label: "Toutes" },
  { value: "mine", label: "À moi" },
  { value: "done", label: "Faites" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

const PRIORITY_STYLE: Record<number, string> = {
  1: "bg-slate-100 text-slate-600 dark:bg-slate-800",
  2: "bg-brand-100 text-brand-700",
  3: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  4: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

// Bordure gauche de couleur indiquant la priorité (mobile + ordinateur).
// Appliquée en style inline car `.dark .card` (2 classes) écrase une classe
// utilitaire `border-l-*` en mode sombre.
const PRIORITY_BORDER_COLOR: Record<number, string> = {
  1: "#94a3b8", // slate-400
  2: "#6fa15f", // brand-500
  3: "#f59e0b", // amber-500
  4: "#ef4444", // red-500
};

function useTasks() {
  return useQuery({ queryKey: ["tasks"], queryFn: () => api.get<TaskWithSubtasks[]>("/api/tasks") });
}

// Sous-tâche affichée en mode réorganisation : toute la ligne est dragable.
function SubtaskRow({ subtask }: { subtask: Task }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: subtask.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, touchAction: "pan-y" }}
      className={`relative flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-2 text-base dark:bg-slate-800/60 ${
        isDragging ? "opacity-60" : ""
      }`}
    >
      {/* Zone de drag : 70% gauche déplace, 30% droite reste scrollable. */}
      <div
        {...attributes}
        {...listeners}
        className="absolute inset-y-0 left-0 z-10 w-[70%] cursor-grab"
        style={{ touchAction: "none" }}
        aria-label="Glisser pour déplacer la sous-tâche"
      />
      <span className="text-slate-400" aria-hidden="true">
        ⠿
      </span>
      <span className={subtask.status === "done" ? "text-slate-400 line-through" : ""}>
        {subtask.title}
      </span>
    </div>
  );
}

function TaskRow({ task, reorderMode }: { task: TaskWithSubtasks; reorderMode: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState("");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["tasks"] });

  const toggle = useMutation({
    mutationFn: (t: Task) =>
      api.patch(`/api/tasks/${t.id}`, { status: t.status === "done" ? "todo" : "done" }),
    onSuccess: invalidate,
  });
  // Cocher/décocher une sous-tâche : si toutes sont cochées, la tâche parente est cochée.
  const toggleSub = useMutation({
    mutationFn: async (s: Task) => {
      const newStatus = s.status === "done" ? "todo" : "done";
      await api.patch(`/api/tasks/${s.id}`, { status: newStatus });
      const allDone = task.subtasks.every((x) =>
        x.id === s.id ? newStatus === "done" : x.status === "done",
      );
      if (allDone && task.status !== "done") await api.patch(`/api/tasks/${task.id}`, { status: "done" });
      if (!allDone && task.status === "done") await api.patch(`/api/tasks/${task.id}`, { status: "todo" });
    },
    onSuccess: invalidate,
  });
  const addSub = useMutation({
    mutationFn: () => api.post("/api/tasks", { title: sub, parentTaskId: task.id }),
    onSuccess: () => {
      setSub("");
      invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/tasks/${id}`),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: (t: {
      id: string;
      title: string;
      priority?: number;
      dueDate?: string | null;
      assigneeId?: string | null;
    }) =>
      api.patch(`/api/tasks/${t.id}`, {
        title: t.title,
        ...(t.priority !== undefined && { priority: t.priority }),
        ...(t.dueDate !== undefined && { dueDate: t.dueDate }),
        ...(t.assigneeId !== undefined && { assigneeId: t.assigneeId }),
      }),
    onSuccess: invalidate,
  });
  const reorderSub = useMutation({
    mutationFn: (orderedIds: string[]) => api.patch("/api/tasks/reorder", { orderedIds }),
    onSuccess: invalidate,
  });
  const [editing, setEditing] = useState<Task | null>(null);

  const done = task.subtasks.filter((s) => s.status === "done").length;

  // Réorganisation des sous-tâches (contexte dnd imbriqué, propre à cette tâche).
  const subSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const onSubDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = task.subtasks.map((s) => s.id);
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    reorderSub.mutate(arrayMove(ids, from, to));
  };

  // Glissement vers la gauche (mobile) = supprimer la tâche.
  const [swipeX, setSwipeX] = useState(0);
  const swipeXRef = useRef(0);
  const swiping = useRef(false);
  const swiped = useRef(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const setSwipe = (x: number) => {
    swipeXRef.current = x;
    setSwipeX(x);
  };
  const onTouchStart = (e: TouchEvent) => {
    if (reorderMode) return; // en réorganisation, on laisse le drag & drop
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
    swiping.current = false;
  };
  const onTouchMove = (e: TouchEvent) => {
    if (!touchStart.current) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    if (!swiping.current && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      swiping.current = true;
      swiped.current = true; // empêche le clic d'ouverture qui suit le glissement
    }
    if (swiping.current) setSwipe(Math.max(-140, Math.min(140, dx)));
  };
  const onTouchEnd = () => {
    touchStart.current = null;
    if (swipeXRef.current <= -96) {
      remove.mutate(task.id); // glissement gauche = supprimer
      return;
    }
    if (swipeXRef.current >= 96) {
      toggle.mutate(task); // glissement droite = valider / dévalider
    }
    swiping.current = false;
    setSwipe(0);
  };

  // Simple clic = ouvrir/fermer ; double clic = passer en édition (mobile + ordinateur).
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRowClick = () => {
    if (swiped.current) {
      swiped.current = false;
      return;
    }
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
      setEditing(task);
      return;
    }
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      setOpen((o) => !o);
    }, 250);
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative ${isDragging ? "opacity-60" : ""}`}
    >
      {/* Fond vert révélé par le glissement vers la droite = valider (mobile). */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-start rounded-2xl bg-green-600 pl-6 md:hidden"
        style={{ opacity: swipeX > 8 ? 1 : 0, transition: "opacity 0.15s" }}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5 text-white"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>

      {/* Fond rouge révélé par le glissement vers la gauche = supprimer (mobile). */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-end rounded-2xl bg-red-500 pr-6 md:hidden"
        style={{ opacity: swipeX < -8 ? 1 : 0, transition: "opacity 0.15s" }}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5 text-white"
        >
          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
        </svg>
      </div>

      <div
        className="relative card group/task"
        style={{
          borderLeftWidth: "4px",
          borderLeftStyle: "solid",
          borderLeftColor: PRIORITY_BORDER_COLOR[task.priority],
          transform: `translateX(${swipeX}px)`,
          transition: swiping.current ? "none" : "transform 0.2s",
          touchAction: "pan-y",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
      {/* Loader mobile (validation / suppression par glissement) */}
      {(toggle.isPending || remove.isPending) && (
        <span className="absolute right-3 top-3 z-10 text-slate-400 md:hidden">
          <Spinner className="h-4 w-4" />
        </span>
      )}
      <div className="relative flex items-center gap-3">
        {reorderMode && (
          <>
            {/* Zone de drag : 70% gauche déplace la tâche, 30% droite reste scrollable. */}
            <div
              {...attributes}
              {...listeners}
              onClick={handleRowClick}
              className="absolute inset-y-0 left-0 z-10 w-[70%] cursor-grab"
              style={{ touchAction: "none" }}
              aria-label="Glisser pour déplacer la tâche"
            />
            <span className="text-slate-400" title="Glisser pour déplacer" aria-hidden="true">
              ⠿
            </span>
          </>
        )}
        <div className="hidden md:block">
          {toggle.isPending ? (
            <Spinner className="h-5 w-5 text-brand-600" />
          ) : (
            <Checkbox checked={task.status === "done"} onChange={() => toggle.mutate(task)} />
          )}
        </div>
        <div className="flex-1 cursor-pointer" onClick={handleRowClick}>
          <div className="flex items-center gap-2">
            <MemberAvatar id={task.assigneeId} className="h-5 w-5 shrink-0 text-[10px]" />
            <span className="font-medium">{task.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditing(task);
              }}
              title="Modifier"
              className="hidden text-slate-400 opacity-0 transition hover:text-brand-600 group-hover/task:opacity-100 md:inline-block"
            >
              ✎
            </button>
            {task.status === "done" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  remove.mutate(task.id);
                }}
                disabled={remove.isPending}
                className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-60 dark:bg-red-950 dark:text-red-300"
              >
                {remove.isPending && <Spinner className="h-3 w-3" />}
                Supprimer
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            {task.dueDate && <span>{dateFr(task.dueDate)}</span>}
            {task.subtasks.length > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="h-1 w-8 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <span
                    className="block h-full rounded-full bg-slate-400"
                    style={{ width: `${(done / task.subtasks.length) * 100}%` }}
                  />
                </span>
                {done}/{task.subtasks.length}
              </span>
            )}
          </div>
        </div>
        {remove.isPending ? (
          <span className="hidden text-slate-400 md:inline">
            <Spinner className="h-4 w-4" />
          </span>
        ) : (
          <button
            onClick={() => remove.mutate(task.id)}
            className="hidden text-slate-300 hover:text-red-500 md:inline"
          >
            ✕
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          {reorderMode ? (
            task.subtasks.length > 0 ? (
              <DndContext sensors={subSensors} collisionDetection={closestCenter} onDragEnd={onSubDragEnd}>
                <SortableContext
                  items={task.subtasks.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {task.subtasks.map((s) => (
                      <SubtaskRow key={s.id} subtask={s} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <div className="text-xs text-slate-400">Aucune sous-tâche à réorganiser.</div>
            )
          ) : (
            <>
              {/* Case et libellé agrandis + `py-1` : cible de clic plus large. */}
              {task.subtasks.map((s) => (
                <div key={s.id} className="group/sub flex items-center gap-3 py-1 text-base">
                  {/* Le libellé fait partie du bouton : cliquer le nom coche aussi. */}
                  <Checkbox
                    checked={s.status === "done"}
                    onChange={() => toggleSub.mutate(s)}
                    label={
                      <span
                        className={`text-base ${
                          s.status === "done" ? "text-slate-400 line-through" : ""
                        }`}
                      >
                        {s.title}
                      </span>
                    }
                  />
                  <button
                    onClick={() => setEditing(s)}
                    className="text-slate-300 opacity-0 transition hover:text-brand-600 group-hover/sub:opacity-100"
                    title="Modifier"
                  >
                    ✎
                  </button>
                  <div className="ml-auto flex items-center gap-1">
                    <button onClick={() => remove.mutate(s.id)} className="text-slate-300 hover:text-red-500">
                      ✕
                    </button>
                  </div>
                </div>
              ))}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (sub.trim()) addSub.mutate();
                }}
                className="flex gap-2 pt-1"
              >
                <input
                  value={sub}
                  onChange={(e) => setSub(e.target.value)}
                  placeholder="Ajouter une sous-tâche…"
                  className="input"
                />
                <button className="btn-primary shrink-0" aria-label="Ajouter la sous-tâche">
                  +
                </button>
              </form>
            </>
          )}
        </div>
      )}
      </div>

      {editing && (
        <TaskEditModal
          key={editing.id}
          task={editing}
          isSubtask={!!editing.parentTaskId}
          onClose={() => setEditing(null)}
          onSave={(vals) => {
            update.mutate({ id: editing.id, ...vals });
            setEditing(null);
          }}
          onReopen={() => {
            if (editing.parentTaskId) toggleSub.mutate(editing);
            else toggle.mutate(editing);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function TaskEditModal({
  task,
  isSubtask,
  onClose,
  onSave,
  onReopen,
}: {
  task: Task;
  isSubtask: boolean;
  onClose: () => void;
  onSave: (vals: {
    title: string;
    priority?: number;
    dueDate?: string | null;
    assigneeId?: string | null;
  }) => void;
  onReopen: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [priority, setPriority] = useState(task.priority);
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? "");

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{isSubtask ? "Modifier la sous-tâche" : "Modifier la tâche"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim())
              onSave(
                isSubtask
                  ? { title: title.trim() }
                  : { title: title.trim(), priority, dueDate: dueDate || null, assigneeId: assigneeId || null },
              );
          }}
          className="space-y-3"
        >
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Titre"
            className="input"
          />
          {!isSubtask && (
            <>
              <div>
                <div className="mb-1 text-xs text-slate-400">Criticité</div>
                <div className="flex gap-1">
                  {[1, 2, 3, 4].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPriority(p)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                        priority === p
                          ? PRIORITY_STYLE[p] + " ring-2 ring-brand-500"
                          : "border border-[#e2dccd] bg-white text-slate-500 hover:bg-[#f1ede4] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                      }`}
                    >
                      {PRIORITY_LABELS[p]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs text-slate-400">Échéance (optionnel)</div>
                <DateInput value={dueDate} onChange={setDueDate} placeholder="Aucune" />
              </div>
              <div>
                <div className="mb-1 text-xs text-slate-400">Responsable (optionnel)</div>
                <AssigneePicker value={assigneeId} onChange={setAssigneeId} />
              </div>
            </>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            {task.status === "done" && (
              <button type="button" onClick={onReopen} className="btn-ghost mr-auto">
                ↩︎ Marquer à faire
              </button>
            )}
            <button type="button" onClick={onClose} className="btn-ghost">
              Annuler
            </button>
            <button className="btn-primary">Enregistrer</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Formulaire de création réutilisable : disposition en ligne (carte, ordinateur)
// ou empilée (modale, mobile). Gère son propre état et se réinitialise après ajout.
/** Formulaire de création, affiché uniquement en modale (ordinateur et mobile). */
function TaskForm({ onCreated }: { onCreated?: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState(2);
  const [dueDate, setDueDate] = useState("");
  const [assigneeId, setAssigneeId] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/tasks", {
        title,
        priority,
        dueDate: dueDate || null,
        assigneeId: assigneeId || null,
      }),
    onSuccess: () => {
      setTitle("");
      setDueDate("");
      setAssigneeId("");
      setPriority(2);
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onCreated?.();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) create.mutate();
      }}
      className="space-y-3"
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Nouvelle tâche…"
        className="input"
      />
      <div className="space-y-3">
        <div>
          <div className="mb-1 text-xs text-slate-400">Criticité</div>
          <div className="flex gap-1">
            {[1, 2, 3, 4].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  priority === p
                    ? PRIORITY_STYLE[p] + " ring-2 ring-brand-500"
                    : "border border-[#e2dccd] bg-white text-slate-500 hover:bg-[#f1ede4] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                {PRIORITY_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs text-slate-400">Échéance (optionnel)</div>
          <DateInput value={dueDate} onChange={setDueDate} placeholder="Aucune" />
        </div>
        <div>
          <div className="mb-1 text-xs text-slate-400">Responsable (optionnel)</div>
          <AssigneePicker value={assigneeId} onChange={setAssigneeId} />
        </div>
        <button className="btn-primary w-full">Ajouter</button>
      </div>
    </form>
  );
}

export default function Tasks() {
  const qc = useQueryClient();
  const me = useMe();
  const { data: tasks } = useTasks();
  const [filter, setFilter] = useState<Filter>("all");
  const [reorderMode, setReorderMode] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const tasksLoading = !tasks;

  const visibleTasks = (tasks ?? []).filter((t) => {
    if (filter === "done") return t.status === "done";
    if (t.status === "done") return false; // "Toutes" et "À moi" = tâches actives
    if (filter === "mine") return t.assigneeId === me.member;
    return true;
  });
  // Onglet « Faites » : les plus récemment terminées en haut (ailleurs : priorité).
  if (filter === "done") {
    visibleTasks.sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt));
  }

  const reorder = useMutation({
    mutationFn: (orderedIds: string[]) => api.patch("/api/tasks/reorder", { orderedIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const onDragEnd = (e: DragEndEvent) => {
    if (!tasks || !e.over || e.active.id === e.over.id) return;
    const ids = tasks.map((t) => t.id);
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    reorder.mutate(arrayMove(ids, from, to));
  };

  if (tasksLoading) return <PageLoader variant="taches" />;

  return (
    <div className="flex flex-col gap-4 pb-24 md:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                filter === f.value
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-100"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setReorderMode((v) => !v)}
            aria-label={reorderMode ? "Terminer" : "Réorganiser"}
            className={`text-xs ${reorderMode ? "btn-primary" : "btn-ghost"}`}
          >
            <span aria-hidden="true">{reorderMode ? "✓" : "⠿"}</span>
            <span className="hidden md:inline">{reorderMode ? "Terminer" : "Réorganiser"}</span>
          </button>
          {/* Ordinateur : bouton ici. Mobile : bouton + flottant en bas à droite. */}
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="btn-primary hidden md:inline-flex"
          >
            + Ajouter une tâche
          </button>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visibleTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {visibleTasks.map((t) => <TaskRow key={t.id} task={t} reorderMode={reorderMode} />)}
            {visibleTasks.length === 0 && (
              <div className="text-slate-400">
                {tasks?.length === 0 ? "Aucune tâche. 🎉" : "Aucune tâche à afficher."}
              </div>
            )}
          </div>
        </SortableContext>
      </DndContext>

      <GestureHelp
        title="Gestes sur une tâche"
        items={[
          "👉 Glisser à droite : valider",
          "👈 Glisser à gauche : supprimer",
          "👆 Double tap : modifier",
          "⠿ Bouton « Réorganiser » : changer l'ordre",
        ]}
      />

      {/* Bouton flottant de création (mobile uniquement). */}
      <button
        type="button"
        onClick={() => setCreateOpen(true)}
        aria-label="Nouvelle tâche"
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
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
          onClick={() => setCreateOpen(false)}
        >
          <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Nouvelle tâche</h2>
              <button onClick={() => setCreateOpen(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            <TaskForm onCreated={() => setCreateOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
