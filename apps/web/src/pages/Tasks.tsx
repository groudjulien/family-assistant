import { useState } from "react";
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
import { IconChevronDown } from "../components/icons";
import { dateFr, todayIso } from "../lib/format";
import {
  Checkbox,
  DateInput,
  FilterChips,
  MobileActionBar,
  OverflowMenu,
  type OverflowItem,
} from "../components/ui";
import { MemberAvatar, usePersonMeta } from "../components/MemberAvatar";
import { usePageHeader } from "../components/PageHeader";
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
  3: "bg-warning-soft text-warning",
  4: "bg-danger-soft text-danger",
};

/**
 * Couleur de criticité — tokens du design system, en style inline car
 * `.card` (défini hors `@layer`) écrase une classe utilitaire de bordure.
 * Sur mobile c'est une pastille dans la ligne de contexte, sur ordinateur la
 * bordure gauche de la carte.
 */
const PRIORITY_COLOR: Record<number, string> = {
  1: "rgb(var(--c-slate-400))",
  2: "rgb(var(--brand-600))",
  3: "rgb(var(--c-warning))",
  4: "rgb(var(--c-danger))",
};

function useTasks() {
  return useQuery({ queryKey: ["tasks"], queryFn: () => api.get<TaskWithSubtasks[]>("/api/tasks") });
}

/**
 * Mutations d'une tâche et de ses sous-tâches. Partagées par les deux rendus
 * (mobile et ordinateur) : la logique ne doit exister qu'une fois.
 */
function useTaskMutations(task: TaskWithSubtasks) {
  const qc = useQueryClient();
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
    mutationFn: (title: string) => api.post("/api/tasks", { title, parentTaskId: task.id }),
    onSuccess: invalidate,
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
  return { toggle, toggleSub, addSub, remove, update, reorderSub };
}

/** Cible tactile de 44 px autour d'une case de 28 px (règle 6). */
function TapCheckbox({
  checked,
  onChange,
  pending,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  pending?: boolean;
  label: string;
}) {
  return (
    <div className="-ml-2 flex h-tap w-tap shrink-0 items-center justify-center">
      {pending ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : (
        <span aria-label={label}>
          <Checkbox size="lg" checked={checked} onChange={onChange} />
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mobile                                                              */
/* ------------------------------------------------------------------ */

/** Ligne de contexte d'une tâche : responsable · échéance. */
function useTaskMeta(task: Task) {
  const personMeta = usePersonMeta();
  const who = personMeta(task.assigneeId)?.name ?? null;
  return [who, task.dueDate ? dateFr(task.dueDate) : null].filter(Boolean).join(" · ");
}

function MobileTaskRow({
  task,
  onEdit,
  last,
}: {
  task: TaskWithSubtasks;
  onEdit: (t: Task) => void;
  last: boolean;
}) {
  const { toggle, remove } = useTaskMutations(task);
  const meta = useTaskMeta(task);
  const done = task.status === "done";
  const actions: OverflowItem[] = [
    { label: "Modifier", onClick: () => onEdit(task) },
    { label: done ? "Marquer à faire" : "Marquer faite", onClick: () => toggle.mutate(task) },
    { label: "Supprimer", onClick: () => remove.mutate(task.id), danger: true },
  ];
  return (
    <div
      className={`flex min-h-[60px] items-center gap-3 ${
        last ? "" : "border-b border-hairline"
      } ${remove.isPending ? "opacity-50" : ""}`}
    >
      <TapCheckbox
        checked={done}
        pending={toggle.isPending}
        onChange={() => toggle.mutate(task)}
        label={done ? "Marquer à faire" : "Marquer faite"}
      />
      <div className="min-w-0 flex-1 py-2">
        <div className={`font-medium ${done ? "text-ink-3 line-through" : ""}`}>{task.title}</div>
        <div className="mt-0.5 flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-[7px] w-[7px] shrink-0 rounded-full"
            style={{ background: PRIORITY_COLOR[task.priority] }}
          />
          <span className="truncate text-xs text-ink-2">{meta || PRIORITY_LABELS[task.priority]}</span>
        </div>
      </div>
      <OverflowMenu items={actions} label={`Actions sur ${task.title}`} />
    </div>
  );
}

/**
 * Tâche à étapes : sa propre carte, **repliée par défaut**. La jauge et le
 * « 2/5 étapes faites » disent où en est la tâche sans dérouler ses étapes ;
 * on ouvre celles-ci d'une touche quand on s'y met vraiment.
 */
function MobileSubtaskCard({ task, onEdit }: { task: TaskWithSubtasks; onEdit: (t: Task) => void }) {
  const { toggle, toggleSub, addSub, remove } = useTaskMutations(task);
  const meta = useTaskMeta(task);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const done = task.subtasks.filter((s) => s.status === "done").length;
  const actions: OverflowItem[] = [
    { label: "Modifier", onClick: () => onEdit(task) },
    {
      label: task.status === "done" ? "Marquer à faire" : "Marquer faite",
      onClick: () => toggle.mutate(task),
    },
    { label: "Supprimer", onClick: () => remove.mutate(task.id), danger: true },
  ];

  const submit = () => {
    const title = draft.trim();
    if (!title) return setAdding(false);
    addSub.mutate(title);
    setDraft("");
  };

  return (
    <div className={`card px-4 pt-4 ${open ? "pb-2" : "pb-4"}`}>
      <div className="flex items-start gap-3">
        {/* Toucher la tâche ouvre ses étapes : elles ne prennent l'écran que
            quand on les demande. */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="min-w-0 flex-1 text-left"
        >
          <span
            className={`block text-lg font-semibold ${task.status === "done" ? "text-ink-3" : ""}`}
          >
            {task.title}
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-2">
            {[meta, `${done}/${task.subtasks.length} étapes faites`].filter(Boolean).join(" · ")}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Replier les étapes" : "Déplier les étapes"}
          className="flex h-tap w-8 shrink-0 items-center justify-center text-slate-400"
        >
          <IconChevronDown
            size={20}
            className={`transition-transform ${open ? "" : "-rotate-90"}`}
          />
        </button>
        <OverflowMenu items={actions} label={`Actions sur ${task.title}`} />
      </div>

      {/* La jauge reste visible replié : c'est le résumé de la tâche. */}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-brand-600 transition-[width]"
          style={{ width: `${(done / task.subtasks.length) * 100}%` }}
        />
      </div>

      {open && task.subtasks.map((s) => (
        <div key={s.id} className="flex min-h-[52px] items-center gap-3 border-t border-hairline">
          <TapCheckbox
            checked={s.status === "done"}
            onChange={() => toggleSub.mutate(s)}
            label={s.title}
          />
          <button
            type="button"
            onClick={() => onEdit(s)}
            className={`min-w-0 flex-1 py-2 text-left ${
              s.status === "done" ? "text-ink-3 line-through" : ""
            }`}
          >
            {s.title}
          </button>
        </div>
      ))}

      <div className={`min-h-[56px] items-center gap-3 border-t border-hairline ${open ? "flex" : "hidden"}`}>
        {adding ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="flex w-full items-center gap-2 py-2"
          >
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={submit}
              placeholder="Nom de l'étape…"
              className="input"
            />
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex h-tap w-full items-center gap-3 text-left"
          >
            <span
              aria-hidden="true"
              className="h-[26px] w-[26px] shrink-0 rounded-lg border-2 border-dashed border-slate-700"
            />
            <span className="font-medium text-brand-600">Ajouter une étape</span>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Liste mobile. Les tâches simples consécutives sont regroupées dans une seule
 * carte à filets : une carte par ligne ferait dix cadres pour dix lignes.
 * Une tâche à étapes garde sa propre carte.
 */
function MobileList({
  tasks,
  onEdit,
}: {
  tasks: TaskWithSubtasks[];
  onEdit: (t: Task) => void;
}) {
  type Group =
    | { kind: "simple"; items: TaskWithSubtasks[] }
    | { kind: "steps"; task: TaskWithSubtasks };
  const groups: Group[] = [];
  for (const t of tasks) {
    if (t.subtasks.length > 0) {
      groups.push({ kind: "steps", task: t });
      continue;
    }
    const last = groups[groups.length - 1];
    if (last && last.kind === "simple") last.items.push(t);
    else groups.push({ kind: "simple", items: [t] });
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((g, i) =>
        g.kind === "steps" ? (
          <MobileSubtaskCard key={g.task.id} task={g.task} onEdit={onEdit} />
        ) : (
          <div key={`s${i}`} className="card px-4 py-0">
            {g.items.map((t, j) => (
              <MobileTaskRow
                key={t.id}
                task={t}
                onEdit={onEdit}
                last={j === g.items.length - 1}
              />
            ))}
          </div>
        ),
      )}
    </div>
  );
}

/**
 * Mode réorganisation (mobile) : liste à plat. Flèches ↑ / ↓ en plus du drag &
 * drop — au tactile, le glisser-déposer seul n'est pas fiable.
 */
function MobileReorderList({
  tasks,
  onMove,
}: {
  tasks: TaskWithSubtasks[];
  onMove: (index: number, dir: -1 | 1) => void;
}) {
  return (
    <div className="card px-4 py-0">
      {tasks.map((t, i) => (
        <div
          key={t.id}
          className={`flex min-h-[56px] items-center gap-2 ${
            i === tasks.length - 1 ? "" : "border-b border-hairline"
          }`}
        >
          <span className="min-w-0 flex-1 truncate font-medium">{t.title}</span>
          <button
            type="button"
            onClick={() => onMove(i, -1)}
            disabled={i === 0}
            aria-label="Monter"
            className="flex h-tap w-9 items-center justify-center rounded-lg text-ink-2 disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(i, 1)}
            disabled={i === tasks.length - 1}
            aria-label="Descendre"
            className="flex h-tap w-9 items-center justify-center rounded-lg text-ink-2 disabled:opacity-30"
          >
            ↓
          </button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ordinateur                                                          */
/* ------------------------------------------------------------------ */

// Sous-tâche affichée en mode réorganisation : toute la ligne est dragable.
function SubtaskRow({ subtask }: { subtask: Task }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: subtask.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, touchAction: "pan-y" }}
      className={`relative flex items-center gap-2 rounded-lg bg-surface-2 px-2 py-2 text-base ${
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
      <span className={subtask.status === "done" ? "text-ink-3 line-through" : ""}>
        {subtask.title}
      </span>
    </div>
  );
}

function TaskRow({
  task,
  reorderMode,
  onEdit,
}: {
  task: TaskWithSubtasks;
  reorderMode: boolean;
  onEdit: (t: Task) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState("");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  const { toggle, toggleSub, addSub, remove, reorderSub } = useTaskMutations(task);

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

  const actions: OverflowItem[] = [
    { label: "Modifier", onClick: () => onEdit(task) },
    {
      label: task.status === "done" ? "Marquer à faire" : "Marquer faite",
      onClick: () => toggle.mutate(task),
    },
    { label: "Supprimer", onClick: () => remove.mutate(task.id), danger: true },
  ];

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "opacity-60" : ""}
    >
      <div
        className="card"
        style={{
          borderLeftWidth: "4px",
          borderLeftStyle: "solid",
          borderLeftColor: PRIORITY_COLOR[task.priority],
        }}
      >
        <div className="relative flex items-center gap-3">
          {reorderMode && (
            <>
              <div
                {...attributes}
                {...listeners}
                className="absolute inset-y-0 left-0 z-10 w-[70%] cursor-grab"
                style={{ touchAction: "none" }}
                aria-label="Glisser pour déplacer la tâche"
              />
              <span className="text-slate-400" title="Glisser pour déplacer" aria-hidden="true">
                ⠿
              </span>
            </>
          )}
          {toggle.isPending ? (
            <Spinner className="h-7 w-7 text-brand-600" />
          ) : (
            <Checkbox size="lg" checked={task.status === "done"} onChange={() => toggle.mutate(task)} />
          )}
          <div className="flex-1 cursor-pointer" onClick={() => setOpen((o) => !o)}>
            <div className="flex items-center gap-2">
              <MemberAvatar id={task.assigneeId} className="h-5 w-5 shrink-0 text-2xs" />
              <span className={`font-medium ${task.status === "done" ? "text-ink-3 line-through" : ""}`}>
                {task.title}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-ink-2">
              {task.dueDate && <span>{dateFr(task.dueDate)}</span>}
              {task.subtasks.length > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="h-1 w-8 overflow-hidden rounded-full bg-surface-2">
                    <span
                      className="block h-full rounded-full bg-brand-600"
                      style={{ width: `${(done / task.subtasks.length) * 100}%` }}
                    />
                  </span>
                  {done}/{task.subtasks.length}
                </span>
              )}
            </div>
          </div>
          {remove.isPending ? (
            <Spinner className="h-4 w-4 text-slate-400" />
          ) : (
            <OverflowMenu items={actions} label={`Actions sur ${task.title}`} />
          )}
        </div>

        {open && (
          <div className="mt-3 space-y-0.5 border-t border-hairline pt-3">
            {reorderMode ? (
              task.subtasks.length > 0 ? (
                <DndContext sensors={subSensors} collisionDetection={closestCenter} onDragEnd={onSubDragEnd}>
                  <SortableContext
                    items={task.subtasks.map((s) => s.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-1">
                      {task.subtasks.map((s) => (
                        <SubtaskRow key={s.id} subtask={s} />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              ) : (
                <div className="text-xs text-ink-2">Aucune sous-tâche à réorganiser.</div>
              )
            ) : (
              <>
                {task.subtasks.map((s) => (
                  <div key={s.id} className="group/sub flex items-center gap-2.5 py-0.5 text-base">
                    {/* Le libellé fait partie du bouton : cliquer le nom coche aussi. */}
                    <Checkbox
                      size="lg"
                      checked={s.status === "done"}
                      onChange={() => toggleSub.mutate(s)}
                      label={
                        <span className={`text-base ${s.status === "done" ? "text-ink-3 line-through" : ""}`}>
                          {s.title}
                        </span>
                      }
                    />
                    <div className="ml-auto opacity-0 transition group-hover/sub:opacity-100">
                      <OverflowMenu
                        label={`Actions sur ${s.title}`}
                        items={[
                          { label: "Modifier", onClick: () => onEdit(s) },
                          { label: "Supprimer", onClick: () => remove.mutate(s.id), danger: true },
                        ]}
                      />
                    </div>
                  </div>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (sub.trim()) {
                      addSub.mutate(sub.trim());
                      setSub("");
                    }
                  }}
                  className="flex gap-2 pt-2"
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modales                                                             */
/* ------------------------------------------------------------------ */

function PriorityPicker({ value, onChange }: { value: number; onChange: (p: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4].map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          className={`min-h-tap rounded-full px-3 text-xs font-medium transition ${
            value === p
              ? PRIORITY_STYLE[p] + " ring-2 ring-brand-500"
              : "border border-line bg-surface text-ink-2 hover:bg-surface-2"
          }`}
        >
          {PRIORITY_LABELS[p]}
        </button>
      ))}
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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {isSubtask ? "Modifier l'étape" : "Modifier la tâche"}
          </h2>
          <button onClick={onClose} aria-label="Fermer" className="text-ink-2 hover:text-ink">
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
                <div className="mb-1 text-xs text-ink-2">Criticité</div>
                <PriorityPicker value={priority} onChange={setPriority} />
              </div>
              <div>
                <div className="mb-1 text-xs text-ink-2">Échéance (optionnel)</div>
                <DateInput value={dueDate} onChange={setDueDate} placeholder="Aucune" />
              </div>
              <div>
                <div className="mb-1 text-xs text-ink-2">Responsable (optionnel)</div>
                <AssigneePicker value={assigneeId} onChange={setAssigneeId} />
              </div>
            </>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            {task.status === "done" && (
              <button type="button" onClick={onReopen} className="btn-ghost mr-auto">
                Marquer à faire
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

/** Formulaire de création, affiché en modale (ordinateur et mobile). */
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
      <div>
        <div className="mb-1 text-xs text-ink-2">Criticité</div>
        <PriorityPicker value={priority} onChange={setPriority} />
      </div>
      <div>
        <div className="mb-1 text-xs text-ink-2">Échéance (optionnel)</div>
        <DateInput value={dueDate} onChange={setDueDate} placeholder="Aucune" />
      </div>
      <div>
        <div className="mb-1 text-xs text-ink-2">Responsable (optionnel)</div>
        <AssigneePicker value={assigneeId} onChange={setAssigneeId} />
      </div>
      <button className="btn-primary w-full">Ajouter</button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Tasks() {
  const qc = useQueryClient();
  const me = useMe();
  const { data: tasks } = useTasks();
  const [filter, setFilter] = useState<Filter>("all");
  const [reorderMode, setReorderMode] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const today = todayIso();
  const open = (tasks ?? []).filter((t) => t.status !== "done");
  const dueToday = open.filter((t) => t.dueDate && t.dueDate <= today).length;
  usePageHeader(
    "Tâches",
    [
      `${open.length} en cours`,
      dueToday > 0 ? `${dueToday} aujourd'hui` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  );

  const visibleTasks = (tasks ?? []).filter((t) => {
    if (filter === "done") return t.status === "done";
    if (t.status === "done") return false; // les autres filtres = tâches actives
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

  // Flèches ↑ / ↓ : réordonne dans la liste complète, pas dans la liste filtrée.
  const moveTask = (index: number, dir: -1 | 1) => {
    if (!tasks) return;
    const target = index + dir;
    if (target < 0 || target >= visibleTasks.length) return;
    const ids = tasks.map((t) => t.id);
    const from = ids.indexOf(visibleTasks[index].id);
    const to = ids.indexOf(visibleTasks[target].id);
    if (from < 0 || to < 0) return;
    reorder.mutate(arrayMove(ids, from, to));
  };

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
  const toggleStatus = useMutation({
    mutationFn: (t: Task) =>
      api.patch(`/api/tasks/${t.id}`, { status: t.status === "done" ? "todo" : "done" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  if (!tasks) return <PageLoader variant="taches" />;

  const empty =
    tasks.length === 0 ? "Aucune tâche pour l'instant." : "Aucune tâche dans ce filtre.";

  return (
    <div className="flex flex-col gap-4 pb-28 md:pb-0">
      <div className="flex items-center gap-2">
        <FilterChips
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          items={FILTERS.map((f) => ({ value: f.value, label: f.label }))}
          className="min-w-0 flex-1"
        />
        <button
          type="button"
          onClick={() => setReorderMode((v) => !v)}
          aria-pressed={reorderMode}
          className={`min-h-tap shrink-0 text-xs ${reorderMode ? "btn-primary" : "btn-ghost"}`}
        >
          <span aria-hidden="true">{reorderMode ? "✓" : "⠿"}</span>
          <span className="hidden md:inline">{reorderMode ? "Terminer" : "Réorganiser"}</span>
        </button>
        {/* Ordinateur : bouton ici. Mobile : barre d'action en bas. */}
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="btn-primary hidden shrink-0 md:inline-flex"
        >
          + Ajouter une tâche
        </button>
      </div>

      {visibleTasks.length === 0 ? (
        <div className="card text-center">
          <div className="font-semibold">{empty}</div>
          <button onClick={() => setCreateOpen(true)} className="btn-primary mt-3">
            Ajouter la première
          </button>
        </div>
      ) : (
        <>
          {/* Mobile */}
          <div className="md:hidden">
            {reorderMode ? (
              <MobileReorderList tasks={visibleTasks} onMove={moveTask} />
            ) : (
              <MobileList tasks={visibleTasks} onEdit={setEditing} />
            )}
          </div>

          {/* Ordinateur */}
          <div className="hidden md:block">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext
                items={visibleTasks.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {visibleTasks.map((t) => (
                    <TaskRow key={t.id} task={t} reorderMode={reorderMode} onEdit={setEditing} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        </>
      )}

      <MobileActionBar label="Nouvelle tâche" onClick={() => setCreateOpen(true)} />

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
            toggleStatus.mutate(editing);
            setEditing(null);
          }}
        />
      )}

      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
          onClick={() => setCreateOpen(false)}
        >
          <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Nouvelle tâche</h2>
              <button
                onClick={() => setCreateOpen(false)}
                aria-label="Fermer"
                className="text-ink-2 hover:text-ink"
              >
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
