import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
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
import {
  ACTIVITY_UNITS,
  ACTIVITY_UNIT_META,
  GOAL_KINDS,
  GOAL_KIND_META,
  GOAL_PERIODS,
  GOAL_PERIOD_META,
  type ActivityUnit,
  type GoalKind,
  type GoalPeriod,
  type GoalType,
  type WellnessActivity,
  type WellnessConfig,
  type WellnessGoal,
  type WellnessLog,
  type WellnessLoggedSession,
  type WellnessSession,
} from "@gfa/shared";
import { useMe } from "../auth";
import { api } from "../lib/api";
import { useLastView } from "../lib/lastView";
import PageLoader from "../components/PageLoader";
import { Select } from "../components/ui";

/* ---------------- constantes ---------------- */
const MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];
const DAYS = ["L", "M", "M", "J", "V", "S", "D"];
/** Jours de la semaine, index JS (0 = dimanche), affichés du lundi au dimanche. */
const WEEK_DAYS: { value: number; label: string }[] = [
  { value: 1, label: "L" },
  { value: 2, label: "M" },
  { value: 3, label: "M" },
  { value: 4, label: "J" },
  { value: 5, label: "V" },
  { value: 6, label: "S" },
  { value: 0, label: "D" },
];

const GREEN = "#5b8a4e";
const WARN = "#d4a843";
const FAIL = "#b8453a";
const VIOLET = "#7a4ca8";

/* ---------------- palettes d'emojis du sélecteur ---------------- */

type EmojiGroup = { label: string; emojis: string[] };

/** Activités et séances : sports, engins, animaux, parties du corps. */
const ACTIVITY_EMOJI_GROUPS: EmojiGroup[] = [
  {
    label: "Corps & muscu",
    emojis: ["💪", "🦵", "🦶", "👣", "✊", "🤲", "🫀", "🫁", "🧠", "🦴", "🏋️", "🤼", "🤸", "🧘", "🧎", "🪑", "🪢", "🪜", "🧗"],
  },
  {
    label: "Course & marche",
    emojis: ["🏃", "🚶", "🥾", "👟", "🎽", "🧦", "⏱️", "⏳", "🔥", "🥇", "🏅", "🏆"],
  },
  {
    label: "Raquette & ballon",
    emojis: ["🎾", "🏓", "🏸", "🥍", "🏑", "🏒", "🥏", "🏐", "🏀", "⚽", "🏈", "🏉", "⚾", "🥎", "🎱", "⛳", "🎳", "🏹", "🎯", "🥊", "🥋", "🤺"],
  },
  {
    label: "Eau & bateau",
    emojis: ["🏊", "🤽", "🏄", "🤿", "🥽", "🛟", "🚣", "⛵", "🛶", "🚤", "🛥️", "⛴️", "🚢", "🎣", "🌊", "🚿"],
  },
  {
    label: "Air & glisse",
    emojis: ["🪂", "🪁", "🎈", "🛩️", "✈️", "🚁", "🎿", "🏂", "⛷️", "🛷", "⛸️", "🥌"],
  },
  {
    label: "Roues & véhicules",
    emojis: ["🚴", "🚵", "🚲", "🛴", "🛹", "🛼", "🏍️", "🛵", "🏎️", "🚗", "🚙", "🚕", "🚐", "🚌", "🚚", "🚜", "🚂", "🚆"],
  },
  {
    label: "Animaux & cheval",
    emojis: ["🐴", "🏇", "🐎", "🦄", "🐕", "🐈", "🐐", "🦙", "🐫", "🐘"],
  },
  {
    label: "Santé & bien-être",
    emojis: ["❤️", "🩺", "⚖️", "📏", "💧", "🥤", "🍎", "🥗", "😴", "🛌", "🧴", "🧊", "☀️", "🌙"],
  },
];

/** Objectifs : habitudes du quotidien, puis toute la palette d'activités. */
const GOAL_EMOJI_GROUPS: EmojiGroup[] = [
  {
    label: "Habitudes",
    emojis: ["🎯", "🍷", "🍺", "🥂", "🍰", "🍪", "🥐", "🍫", "🍟", "🍕", "☕", "🚬", "🚭", "📱", "📺", "🎮", "📖", "🌙", "😴", "💧", "🥗", "🧹", "💸", "🧘"],
  },
  ...ACTIVITY_EMOJI_GROUPS,
];

/**
 * Premier emoji d'une saisie libre. `Intl.Segmenter` découpe par grappe, ce qui
 * garde intactes les séquences composées (variantes, jointures ZWJ) qu'un
 * découpage par point de code casserait.
 */
function firstEmoji(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const it = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)[
      Symbol.iterator
    ]();
    const first = it.next();
    return first.done ? "" : first.value.segment;
  }
  return [...s].slice(0, 3).join("");
}

const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseDate = (s: string) => new Date(`${s}T00:00:00`);
const addDays = (d: Date, n: number) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};
function startOfWeek(d: Date) {
  const r = new Date(d);
  const day = (r.getDay() + 6) % 7;
  r.setDate(r.getDate() - day);
  return r;
}

/** Jours couverts par la période d'un objectif autour d'une date donnée. */
function periodDates(period: GoalPeriod, date: string): string[] {
  if (period === "daily") return [date];
  const d = parseDate(date);
  if (period === "weekly") {
    const ws = startOfWeek(d);
    return Array.from({ length: 7 }, (_, i) => fmtDate(addDays(ws, i)));
  }
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return Array.from({ length: days }, (_, i) => fmtDate(new Date(d.getFullYear(), d.getMonth(), i + 1)));
}

/** « 12 rép. » / « 60 s » — libellé court d'une quantité d'activité. */
const amountLabel = (unit: ActivityUnit, amount: number) =>
  unit === "reps" ? `${amount}×` : `${amount} ${ACTIVITY_UNIT_META[unit].short}`;

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec} s`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m} min${s ? " " + s + " s" : ""}`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h} h${m ? " " + m + " min" : ""}`;
}

type DayStatus = "future" | "empty" | "perfect" | "almost" | "failed";
type View = "quotidien" | "stats" | "objectifs";
const VIEWS: View[] = ["quotidien", "stats", "objectifs"];

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */

export default function Sport() {
  const me = useMe();
  const { member: param, view: viewParam, sub: subParam } = useParams();

  // Chacun ne voit que ses propres objectifs : l'URL est toujours réalignée sur
  // le membre connecté (l'API refuse de toute façon la lecture d'un autre membre).
  if (param !== me.member) return <Navigate to={`/sport/${me.member}`} replace />;

  return (
    <div className="space-y-4 pb-24 md:pb-0">
      <Tracker key={me.member} member={me.member} canEdit view={viewParam} sub={subParam} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modèle de données partagé par les onglets                           */
/* ------------------------------------------------------------------ */

type Model = {
  member: string;
  canEdit: boolean;
  goals: WellnessGoal[];
  sessions: WellnessSession[];
  activities: WellnessActivity[];
  /** Valeur saisie (0 si aucune ligne). */
  value: (date: string, goalId: string) => number;
  /** Séances réalisées ce jour-là pour cet objectif. */
  logged: (date: string, goalId: string) => WellnessLoggedSession[];
  /** Une journée est « saisie » dès qu'un objectif y a une ligne. */
  entered: (date: string) => boolean;
  applicable: (goal: WellnessGoal, date: string) => boolean;
  /** Cumul de l'objectif sur sa période autour de `date`. */
  periodTotal: (goal: WellnessGoal, date: string) => number;
  failing: (goal: WellnessGoal, date: string) => boolean;
  dayStatus: (date: string) => DayStatus;
  dates: string[];
  firstDate: string | null;
  save: (date: string, goalId: string, value: number, sessions?: WellnessLoggedSession[]) => void;
};

function Tracker({
  member,
  canEdit,
  view: viewParam,
  sub,
}: {
  member: string;
  canEdit: boolean;
  view?: string;
  sub?: string;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const view = useLastView("sport:view", VIEWS, "quotidien", viewParam, `/sport/${member}`) as View;
  const [selected, setSelected] = useState(fmtDate(new Date()));
  const [statsMode, setStatsMode] = useState<"wellness" | "sport">(() =>
    localStorage.getItem("sport:statsMode") === "sport" ? "sport" : "wellness",
  );
  useEffect(() => {
    localStorage.setItem("sport:statsMode", statsMode);
  }, [statsMode]);

  const configQ = useQuery({
    queryKey: ["wellness-config", member],
    queryFn: () => api.get<WellnessConfig>(`/api/sport/${member}/config`),
  });
  const logsQ = useQuery({
    queryKey: ["wellness-logs", member],
    queryFn: () => api.get<WellnessLog[]>(`/api/sport/${member}/logs`),
  });

  const save = useMutation({
    mutationFn: (v: { date: string; goalId: string; value: number; sessions: WellnessLoggedSession[] }) =>
      api.put(`/api/sport/${member}/logs/${v.date}/${v.goalId}`, {
        value: v.value,
        sessions: v.sessions,
      }),
    // Saisie optimiste : les compteurs et bascules répondent immédiatement.
    onMutate: (v) => {
      qc.setQueryData<WellnessLog[]>(["wellness-logs", member], (prev) => {
        const rest = (prev ?? []).filter((l) => !(l.date === v.date && l.goalId === v.goalId));
        if (v.value === 0 && v.sessions.length === 0) return rest;
        return [...rest, { date: v.date, goalId: v.goalId, value: v.value, sessions: v.sessions }];
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["wellness-logs", member] }),
  });

  const model = useMemo<Model | null>(() => {
    if (!configQ.data || !logsQ.data) return null;
    const { goals, sessions, activities } = configQ.data;
    const byDate = new Map<string, Map<string, WellnessLog>>();
    for (const l of logsQ.data) {
      const m = byDate.get(l.date) ?? new Map<string, WellnessLog>();
      m.set(l.goalId, l);
      byDate.set(l.date, m);
    }
    const dates = [...byDate.keys()].sort();
    const value = (date: string, goalId: string) => byDate.get(date)?.get(goalId)?.value ?? 0;
    const logged = (date: string, goalId: string) => byDate.get(date)?.get(goalId)?.sessions ?? [];
    const entered = (date: string) => (byDate.get(date)?.size ?? 0) > 0;
    const applicable = (goal: WellnessGoal, date: string) =>
      !goal.days || goal.days.length === 0 || goal.days.includes(parseDate(date).getDay());
    const periodTotal = (goal: WellnessGoal, date: string) =>
      periodDates(goal.period, date).reduce((sum, d) => sum + value(d, goal.id), 0);
    /** Cumul du début de période jusqu'à `date` incluse. */
    const cumulThrough = (goal: WellnessGoal, date: string) => {
      let sum = 0;
      for (const d of periodDates(goal.period, date)) {
        sum += value(d, goal.id);
        if (d === date) break;
      }
      return sum;
    };
    const failing = (goal: WellnessGoal, date: string): boolean => {
      if (!applicable(goal, date)) return false;
      if (goal.period === "daily") {
        const v = value(date, goal.id);
        if (goal.kind === "max") return v > (goal.target ?? 0);
        if (goal.kind === "min") return v < (goal.target ?? 0);
        if (goal.kind === "todo") return v <= 0;
        return v > 0; // « à ne pas faire » : toute saisie est un échec
      }
      // Sur une période, seul le dépassement d'un max est imputable à un jour :
      // c'est le jour qui fait franchir la limite qui porte l'échec.
      if (goal.kind !== "max") return false;
      if (value(date, goal.id) <= 0) return false;
      return cumulThrough(goal, date) > (goal.target ?? 0);
    };
    const today = fmtDate(new Date());
    const dayStatus = (date: string): DayStatus => {
      if (date > today) return "future";
      if (!entered(date)) return "empty";
      const failures = goals.filter((g) => failing(g, date)).length;
      if (failures === 0) return "perfect";
      if (failures === 1) return "almost";
      return "failed";
    };
    return {
      member,
      canEdit,
      goals,
      sessions,
      activities,
      value,
      logged,
      entered,
      applicable,
      periodTotal,
      failing,
      dayStatus,
      dates,
      firstDate: dates[0] ?? null,
      save: (date, goalId, v, sessions = []) =>
        save.mutate({ date, goalId, value: v, sessions }),
    };
  }, [configQ.data, logsQ.data, member, canEdit, save]);

  if (!model) return <PageLoader variant="bienetre" />;

  const TABS: { id: View; label: string; icon: string }[] = [
    { id: "quotidien", label: "Quotidien", icon: "📆" },
    { id: "stats", label: "Stats", icon: "📊" },
    { id: "objectifs", label: "Objectifs", icon: "🎯" },
  ];
  const go = (v: string) => navigate(`/sport/${member}/${v}`);

  return (
    <div className="sport-theme">
      <div className="mb-5">
        <div className="sm:hidden">
          <Select
            value={view}
            onChange={go}
            options={TABS.map((t) => ({ value: t.id, label: `${t.icon} ${t.label}` }))}
          />
        </div>
        <div className="hidden sm:block">
          <div className="s-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => go(t.id)}
                className={`s-tab ${view === t.id ? "active" : ""}`}
              >
                <span className="mr-1">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "quotidien" && (
        <DailyView model={model} selected={selected} onSelect={setSelected} />
      )}
      {view === "stats" && (
        <StatsView
          model={model}
          mode={statsMode}
          onModeChange={setStatsMode}
          selected={selected}
          onSelectDate={(d) => {
            setSelected(d);
            go("quotidien");
          }}
        />
      )}
      {view === "objectifs" && <GoalsView model={model} sub={sub} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Onglet Quotidien                                                    */
/* ------------------------------------------------------------------ */

const STATUS_LABEL: Record<DayStatus, string> = {
  future: "À venir",
  empty: "Non saisi",
  perfect: "Parfait",
  almost: "Presque parfait",
  failed: "Raté",
};
const statusColor = (s: DayStatus) =>
  s === "perfect" ? GREEN : s === "almost" ? WARN : s === "failed" ? FAIL : "var(--pmuted)";

/**
 * Les quatre familles d'objectifs, dans l'ordre d'affichage du Quotidien :
 * séances de sport, objectifs de la semaine/du mois, puis les lignes
 * journalières (compteurs avant les cases à cocher). L'ordre personnalisé des
 * objectifs s'applique à l'intérieur de chaque famille — c'est aussi le
 * découpage utilisé par l'onglet Objectifs pour le tri.
 */
function splitGoals(goals: WellnessGoal[]) {
  const sport = goals.filter((g) => g.goalType === "sport");
  const rest = goals.filter((g) => g.goalType !== "sport");
  const daily = rest.filter((g) => g.period === "daily");
  return {
    sport,
    cards: rest.filter((g) => g.period !== "daily"),
    dailyCounters: daily.filter((g) => GOAL_KIND_META[g.kind].counter),
    dailyChecks: daily.filter((g) => !GOAL_KIND_META[g.kind].counter),
  };
}

/** Familles affichées dans l'onglet Objectifs (libellé + clé de `splitGoals`). */
const GOAL_GROUPS = [
  { key: "sport", label: "Séances de sport" },
  { key: "cards", label: "Min / max sur la semaine ou le mois" },
  { key: "dailyCounters", label: "Min / max du jour" },
  { key: "dailyChecks", label: "À faire / à ne pas faire" },
] as const;
type GoalGroupKey = (typeof GOAL_GROUPS)[number]["key"];

function DailyView({
  model,
  selected,
  onSelect,
}: {
  model: Model;
  selected: string;
  onSelect: (d: string) => void;
}) {
  const today = fmtDate(new Date());
  const locked = selected > today;
  const editable = model.canEdit && !locked;
  const { sport, cards, dailyCounters, dailyChecks } = splitGoals(model.goals);
  const status = model.dayStatus(selected);

  const visible = (g: WellnessGoal) => model.applicable(g, selected);

  return (
    <div className="space-y-4">
      <div className="s-card">
        <div className="mb-4 flex items-center justify-between gap-3">
          <IconBtn onClick={() => onSelect(fmtDate(addDays(parseDate(selected), -1)))}>‹</IconBtn>
          <div className="text-center">
            <div className="text-lg font-medium capitalize">
              {selected === today
                ? "aujourd'hui"
                : parseDate(selected).toLocaleDateString("fr-FR", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
            </div>
            <div className="mono mt-0.5 text-[10px]" style={{ color: statusColor(status) }}>
              {STATUS_LABEL[status]}
            </div>
          </div>
          <IconBtn disabled={selected >= today} onClick={() => onSelect(fmtDate(addDays(parseDate(selected), 1)))}>
            ›
          </IconBtn>
        </div>

        {model.goals.length === 0 ? (
          <EmptyGoals />
        ) : locked ? (
          <div className="mono text-center text-xs text-[color:var(--pmuted)]">Jour à venir</div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Blocs de séances : demi-largeur sur ordinateur, pleine largeur sur mobile. */}
            {sport.filter(visible).length > 0 && (
              <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
                {sport.filter(visible).map((g) => (
                  <SportGoalBlock key={g.id} model={model} goal={g} date={selected} editable={editable} />
                ))}
              </div>
            )}

            {/* Une carte par ligne sur mobile (le libellé était tronqué en 2 colonnes). */}
            {cards.filter(visible).length > 0 && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {cards.filter(visible).map((g) => (
                  <GoalCard key={g.id} model={model} goal={g} date={selected} editable={editable} />
                ))}
              </div>
            )}

            {dailyCounters.filter(visible).length > 0 && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {dailyCounters.filter(visible).map((g) => (
                  <GoalCard key={g.id} model={model} goal={g} date={selected} editable={editable} />
                ))}
              </div>
            )}

            {dailyChecks.filter(visible).length > 0 && (
              <div className="space-y-2">
                {dailyChecks.filter(visible).map((g) => (
                  <CheckRow key={g.id} model={model} goal={g} date={selected} editable={editable} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyGoals() {
  return (
    <div className="space-y-1 text-center">
      <div className="text-sm">Aucun objectif pour l'instant.</div>
      <div className="mono text-[10px] text-[color:var(--pmuted)]">
        Crée-les dans l'onglet Objectifs
      </div>
    </div>
  );
}

/** Progression d'un objectif sur sa période : « 2/4 séances cette semaine ». */
function periodHint(model: Model, goal: WellnessGoal, date: string, noun?: string) {
  const total = model.periodTotal(goal, date);
  const target = goal.target ?? 0;
  const scope =
    goal.period === "daily" ? "aujourd'hui" : goal.period === "weekly" ? "cette semaine" : "ce mois";
  if (!GOAL_KIND_META[goal.kind].counter) {
    return {
      text: goal.period === "daily" ? "" : `${total} ${noun ?? "fois"} ${scope}`,
      bad: false,
    };
  }
  const bad = goal.kind === "max" ? total > target : false;
  const reached = goal.kind === "min" && total >= target;
  return {
    text: `${total}/${target} ${noun ? noun + " " : ""}${scope}`,
    bad,
    reached,
  };
}

/** Objectif « typé sport » : la séance associée + les séances déjà faites. */
function SportGoalBlock({
  model,
  goal,
  date,
  editable,
}: {
  model: Model;
  goal: WellnessGoal;
  date: string;
  editable: boolean;
}) {
  const done = model.logged(date, goal.id);
  const hint = periodHint(model, goal, date, "séances");
  const linked = model.sessions.find((s) => s.id === goal.sessionId) ?? null;
  const [pick, setPick] = useState<string>(linked?.id ?? model.sessions[0]?.id ?? "");
  const chosen = linked ?? model.sessions.find((s) => s.id === pick) ?? null;

  const push = (next: WellnessLoggedSession[]) => model.save(date, goal.id, next.length, next);

  const add = () => {
    if (!chosen) return;
    push([...done, snapshot(chosen, model.activities)]);
  };

  return (
    <div className="rounded-xl border p-3" style={{ borderColor: done.length ? GREEN : "var(--pline)" }}>
      {/* 1re ligne : titre + bouton d'ajout compact à droite. */}
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium">
          {goal.emoji} {goal.name}
        </span>
        {model.sessions.length > 0 && (
          <button
            disabled={!editable || !chosen}
            onClick={add}
            className="shrink-0 rounded-lg border px-2.5 py-1 text-xs disabled:opacity-50"
            style={{ borderColor: "var(--pline)", color: "var(--pink)" }}
          >
            ＋ {done.length > 0 ? "Une autre séance" : `Séance ${chosen ? chosen.name : ""}`.trim()}
          </button>
        )}
      </div>

      {/* 2e ligne : progression de la période, alignée à gauche. */}
      <div
        className="mono mt-1 text-[10px]"
        style={{ color: hint.reached ? GREEN : hint.bad ? FAIL : "var(--pmuted)" }}
      >
        {hint.text}
      </div>

      {done.length > 0 && (
        <div className="mt-2 space-y-2">
          {done.map((s, i) => (
            <LoggedSessionRow
              key={i}
              session={s}
              editable={editable}
              onChange={(next) => push(done.map((x, j) => (j === i ? next : x)))}
              onRemove={() => push(done.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      )}

      {model.sessions.length === 0 ? (
        <div className="mono mt-2 text-[10px] text-[color:var(--pmuted)]">
          Crée une séance dans Objectifs → Séances
        </div>
      ) : (
        // Choix de la séance seulement si l'objectif n'en impose pas une.
        !linked && (
          <div className="mt-2">
            <Select
              value={pick}
              onChange={setPick}
              options={model.sessions.map((s) => ({ value: s.id, label: `${s.emoji} ${s.name}` }))}
            />
          </div>
        )
      )}
    </div>
  );
}

/** Copie figée d'une séance au moment où elle est réalisée. */
function snapshot(session: WellnessSession, activities: WellnessActivity[]): WellnessLoggedSession {
  return {
    sessionId: session.id,
    name: session.name,
    emoji: session.emoji,
    series: session.series,
    items: session.items.flatMap((it) => {
      const a = activities.find((x) => x.id === it.activityId);
      return a ? [{ name: a.name, icon: a.icon, unit: a.unit, amount: it.amount }] : [];
    }),
  };
}

function LoggedSessionRow({
  session,
  editable,
  onChange,
  onRemove,
}: {
  session: WellnessLoggedSession;
  editable: boolean;
  onChange: (s: WellnessLoggedSession) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl px-3 py-2" style={{ background: "rgba(91,138,78,0.12)" }}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">
          {session.emoji} {session.name}
        </span>
        <span className="mono text-[10px] text-[color:var(--pmuted)]">
          {session.series} série{session.series > 1 ? "s" : ""}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            disabled={!editable}
            onClick={() => setOpen((o) => !o)}
            className="px-1.5 text-sm text-[color:var(--pmuted)] disabled:opacity-30"
            title="Ajuster la séance"
          >
            ✎
          </button>
          <button
            disabled={!editable}
            onClick={onRemove}
            className="px-1.5 text-sm text-[color:var(--pmuted)] disabled:opacity-30"
            title="Retirer la séance"
          >
            ✕
          </button>
        </div>
      </div>
      {open ? (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <NumField
            label="Séries"
            value={session.series}
            min={1}
            onChange={(v) => onChange({ ...session, series: Math.max(1, v) })}
          />
          {session.items.map((it, i) => (
            <NumField
              key={i}
              label={`${it.icon} ${it.name}`}
              value={it.amount}
              suffix={ACTIVITY_UNIT_META[it.unit].short}
              onChange={(v) =>
                onChange({
                  ...session,
                  items: session.items.map((x, j) => (j === i ? { ...x, amount: Math.max(0, v) } : x)),
                })
              }
            />
          ))}
        </div>
      ) : (
        <div className="mono mt-1 flex flex-wrap gap-x-3 text-[10px] text-[color:var(--pmuted)]">
          {session.items.map((it, i) => (
            <span key={i}>
              {it.icon} {amountLabel(it.unit, it.amount)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Carte d'objectif : compteur ± ou bascule, avec la progression de période. */
function GoalCard({
  model,
  goal,
  date,
  editable,
}: {
  model: Model;
  goal: WellnessGoal;
  date: string;
  editable: boolean;
}) {
  const v = model.value(date, goal.id);
  const counter = GOAL_KIND_META[goal.kind].counter;
  const hint = periodHint(model, goal, date);
  const failed = model.failing(goal, date);

  return (
    <div className="rounded-xl border p-3" style={{ borderColor: failed ? FAIL : "var(--pline)" }}>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium">
          {goal.emoji} {goal.name}
        </span>
        {counter ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              disabled={!editable || v <= 0}
              onClick={() => model.save(date, goal.id, Math.max(0, v - 1))}
              className="h-8 w-8 rounded-full bg-[color:var(--paper-2)] text-lg disabled:opacity-30"
            >
              −
            </button>
            <span className="w-5 text-center text-lg font-semibold">{v}</span>
            <button
              disabled={!editable}
              onClick={() => model.save(date, goal.id, v + 1)}
              className="h-8 w-8 rounded-full bg-[color:var(--paper-2)] text-lg disabled:opacity-30"
            >
              +
            </button>
          </div>
        ) : (
          <button
            disabled={!editable}
            onClick={() => model.save(date, goal.id, v > 0 ? 0 : 1)}
            className="mono shrink-0 rounded-full px-2.5 py-1 text-[10px] disabled:opacity-50"
            style={checkStyle(goal.kind, v > 0)}
          >
            {checkLabel(goal.kind, v > 0)}
          </button>
        )}
      </div>
      {hint.text && (
        <div
          className="mono mt-1 text-[10px]"
          style={{ color: hint.reached ? GREEN : hint.bad ? FAIL : "#7a7770" }}
        >
          {hint.text}
        </div>
      )}
    </div>
  );
}

/** « À faire » → validé quand c'est fait ; « à ne pas faire » → OK par défaut. */
const checkLabel = (kind: GoalKind, on: boolean) =>
  kind === "todo" ? (on ? "Fait" : "À faire") : on ? "Raté" : "OK";

function checkStyle(kind: GoalKind, on: boolean): React.CSSProperties {
  const ok = kind === "todo" ? on : !on;
  return ok
    ? { background: "rgba(91,138,78,0.18)", color: GREEN }
    : kind === "todo"
      ? { background: "var(--paper-2)", color: "var(--pmuted)" }
      : { background: "rgba(184,69,58,0.18)", color: FAIL };
}

function CheckRow({
  model,
  goal,
  date,
  editable,
}: {
  model: Model;
  goal: WellnessGoal;
  date: string;
  editable: boolean;
}) {
  const on = model.value(date, goal.id) > 0;
  const ok = goal.kind === "todo" ? on : !on;
  return (
    <button
      disabled={!editable}
      onClick={() => model.save(date, goal.id, on ? 0 : 1)}
      className="flex w-full items-center justify-between rounded-xl border px-3 py-2 text-sm disabled:opacity-60"
      style={{
        borderColor: ok ? GREEN : goal.kind === "todo" ? "var(--pline)" : FAIL,
        background: ok
          ? "rgba(91,138,78,0.16)"
          : goal.kind === "todo"
            ? "transparent"
            : "rgba(184,69,58,0.16)",
        color: "var(--pink)",
      }}
    >
      <span>
        {goal.emoji} {goal.name}
      </span>
      <span className="mono text-xs" style={{ color: ok ? GREEN : goal.kind === "todo" ? "var(--pmuted)" : FAIL }}>
        {checkLabel(goal.kind, on)}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Onglet Stats — calendrier (affiché sous les statistiques)           */
/* ------------------------------------------------------------------ */

function CalendarView({
  model,
  selected,
  onSelect,
  mode,
}: {
  model: Model;
  selected: string;
  onSelect: (d: string) => void;
  mode: "wellness" | "sport";
}) {
  const [cal, setCal] = useState(() => {
    const d = parseDate(selected);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const sportGoals = model.goals.filter((g) => g.goalType === "sport");
  const sportCount = (d: string) =>
    sportGoals.reduce((n, g) => n + model.logged(d, g.id).length, 0);

  const first = new Date(cal.year, cal.month, 1);
  const gridStart = startOfWeek(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = fmtDate(new Date());
  const wellnessBg = (s: DayStatus) =>
    s === "perfect" ? GREEN : s === "almost" ? WARN : s === "failed" ? FAIL : "transparent";

  return (
    <div className="s-card">
      <div className="mb-3 flex items-center justify-between">
        <IconBtn
          onClick={() =>
            setCal((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { ...c, month: c.month - 1 }))
          }
        >
          ‹
        </IconBtn>
        <div className="text-center">
          <div className="text-lg font-medium capitalize">
            {MONTHS[cal.month]} {cal.year}
          </div>
          <div className="mono text-[10px] text-[color:var(--pmuted)]">Clique un jour pour l'éditer</div>
        </div>
        <IconBtn
          onClick={() =>
            setCal((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { ...c, month: c.month + 1 }))
          }
        >
          ›
        </IconBtn>
      </div>
      <div className="mono mb-1 grid grid-cols-7 gap-1 text-center text-[10px] text-[color:var(--pmuted)]">
        {DAYS.map((d, i) => (
          <div key={i}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d) => {
          const ds = fmtDate(d);
          const inMonth = d.getMonth() === cal.month;
          const st = model.dayStatus(ds);
          let bg = "transparent";
          let fg = "var(--pink)";
          if (inMonth && st !== "future") {
            if (mode === "wellness") {
              if (st !== "empty") {
                bg = wellnessBg(st);
                fg = st === "almost" ? "#1a1a18" : "#fff";
              }
            } else if (sportCount(ds) > 0) {
              bg = GREEN;
              fg = "#fff";
            }
          }
          return (
            <button
              key={ds}
              onClick={() => onSelect(ds)}
              className="flex aspect-square items-center justify-center rounded-lg text-sm sm:aspect-auto sm:h-14"
              style={{
                background: bg,
                color: inMonth ? fg : "var(--pmuted)",
                border: ds === selected ? `2px solid ${VIOLET}` : "1px solid transparent",
                fontWeight: ds === today ? 700 : 400,
              }}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      <div className="mono mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[color:var(--pmuted)]">
        {mode === "wellness" ? (
          <>
            <Legend color={GREEN} label="Parfait" />
            <Legend color={WARN} label="Presque" />
            <Legend color={FAIL} label="Raté" />
            <Legend color="var(--pcard)" label="Non saisi" border />
          </>
        ) : (
          <>
            <Legend color={GREEN} label="Séance effectuée" />
            <Legend color="var(--pcard)" label="Aucune séance" border />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Bascule segmentée centrée (pastille) : sert au choix bien-être / sport des
 * stats comme aux sous-onglets de la page Objectifs.
 */
function PillTabs({
  value,
  onChange,
  items,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  items: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <div className={`flex justify-center ${className}`}>
      <div className="inline-flex overflow-hidden rounded-xl border border-[color:var(--pline)]">
        {items.map((it) => (
          <button
            key={it.value}
            onClick={() => onChange(it.value)}
            className="mono px-4 py-1.5 text-xs"
            style={
              value === it.value
                ? { background: GREEN, color: "#fff" }
                : { color: "var(--pmuted)" }
            }
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Onglet Stats — statistiques puis calendrier                         */
/* ------------------------------------------------------------------ */

function StatsView({
  model,
  mode,
  onModeChange,
  selected,
  onSelectDate,
}: {
  model: Model;
  mode: "wellness" | "sport";
  onModeChange: (m: "wellness" | "sport") => void;
  selected: string;
  onSelectDate: (d: string) => void;
}) {
  const today = fmtDate(new Date());
  let perfect = 0,
    almost = 0,
    failed = 0,
    totalPast = 0;
  for (const date of model.dates) {
    if (date > today) continue;
    totalPast++;
    const s = model.dayStatus(date);
    if (s === "perfect") perfect++;
    else if (s === "almost") almost++;
    else if (s === "failed") failed++;
  }
  const pct = (n: number) => (totalPast ? Math.round((n / totalPast) * 100) : 0);

  // Série en cours : on remonte tant que la journée est parfaite ou presque.
  let streak = 0;
  {
    const cursor = new Date();
    for (;;) {
      const ds = fmtDate(cursor);
      if (model.firstDate && ds < model.firstDate) break;
      const s = model.dayStatus(ds);
      if (ds === today && s === "empty") {
        cursor.setDate(cursor.getDate() - 1);
        continue;
      }
      if (s === "perfect" || s === "almost") {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      } else break;
    }
  }

  const counters = model.goals.filter((g) => GOAL_KIND_META[g.kind].counter);
  const weekDates = periodDates("weekly", today).filter((d) => d <= today);
  const checks = model.goals.filter((g) => g.period === "daily" && !GOAL_KIND_META[g.kind].counter);
  const failRates = checks.map((g) => {
    const applicable = weekDates.filter((d) => model.applicable(g, d) && model.entered(d));
    const fails = applicable.filter((d) => model.failing(g, d)).length;
    return { goal: g, fails, total: applicable.length };
  });

  /* ---- stats sport ---- */
  const sportGoals = model.goals.filter((g) => g.goalType === "sport");
  const sportDates = model.dates
    .filter((d) => d <= today && sportGoals.some((g) => model.logged(d, g.id).length > 0))
    .sort();
  let bestSport = 0,
    run = 0;
  let prev: string | null = null;
  for (const d of sportDates) {
    run = prev && fmtDate(addDays(parseDate(prev), 1)) === d ? run + 1 : 1;
    if (run > bestSport) bestSport = run;
    prev = d;
  }
  let sportStreak = 0;
  {
    const cursor = new Date();
    const isSportDay = (d: string) => sportGoals.some((g) => model.logged(d, g.id).length > 0);
    if (!isSportDay(fmtDate(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (isSportDay(fmtDate(cursor))) {
      sportStreak++;
      cursor.setDate(cursor.getDate() - 1);
    }
  }
  // Totaux à vie, cumulés par nom d'activité (deux séances qui contiennent
  // « Pompes » alimentent le même indicateur).
  const totals = new Map<string, { icon: string; unit: ActivityUnit; total: number }>();
  let totalSessions = 0;
  for (const d of model.dates) {
    for (const g of sportGoals) {
      for (const s of model.logged(d, g.id)) {
        totalSessions++;
        for (const it of s.items) {
          const cur = totals.get(it.name) ?? { icon: it.icon, unit: it.unit, total: 0 };
          const secs = ACTIVITY_UNIT_META[it.unit].seconds;
          // Les unités de temps sont normalisées en secondes avant cumul.
          cur.total += it.amount * s.series * (secs ?? 1);
          totals.set(it.name, cur);
        }
      }
    }
  }

  return (
    <div className="space-y-4">
      <PillTabs
        className="mb-3"
        value={mode}
        onChange={(v) => onModeChange(v as "wellness" | "sport")}
        items={[
          { value: "wellness", label: "Bien-être" },
          { value: "sport", label: "Sport" },
        ]}
      />

      {mode === "wellness" ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatBox label="🔥 Série" value={streak} />
            <StatBox label="🏆 Parfaits" value={perfect} color={GREEN} sub={`${pct(perfect)}%`} />
            <StatBox label="Presque" value={almost} color={WARN} sub={`${pct(almost)}%`} />
            <StatBox label="Ratés" value={failed} color={FAIL} sub={`${pct(failed)}%`} />
          </div>

          {counters.length > 0 && (
            <div className="s-card space-y-3">
              <div className="mono text-xs text-[color:var(--pmuted)]">Objectifs chiffrés en cours</div>
              {counters.map((g) => (
                <Bar
                  key={g.id}
                  label={`${g.emoji} ${g.name}`}
                  scope={GOAL_PERIOD_META[g.period].short}
                  value={model.periodTotal(g, today)}
                  target={g.target ?? 0}
                  higherIsBetter={g.kind === "min"}
                />
              ))}
            </div>
          )}

          <div className="s-card space-y-3">
            <div className="mono text-xs text-[color:var(--pmuted)]">
              Taux d'échec — {weekDates.length} jour{weekDates.length > 1 ? "s" : ""} cette semaine
            </div>
            {failRates.filter((f) => f.total > 0).length === 0 ? (
              <div className="text-sm text-[color:var(--pmuted)]">Aucune donnée cette semaine.</div>
            ) : (
              failRates
                .filter((f) => f.total > 0)
                .map((f) => (
                  <div key={f.goal.id}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>
                        {f.goal.emoji} {f.goal.name}
                      </span>
                      <span className="mono text-[10px] text-[color:var(--pmuted)]">
                        {Math.round((f.fails / f.total) * 100)}% · {f.fails}/{f.total}j
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-[color:var(--paper-2)]">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${(f.fails / f.total) * 100}%`, background: FAIL }}
                      />
                    </div>
                  </div>
                ))
            )}
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <StatBox label="🔥 Série actuelle" value={sportStreak} color={GREEN} sub="jours" />
            <StatBox label="🏆 Meilleure série" value={bestSport} sub="record" />
            <StatBox label="Séances" value={totalSessions} sub={`${sportDates.length} j`} />
          </div>
          <div className="s-card">
            <div className="mono mb-3 text-xs text-[color:var(--pmuted)]">Totaux à vie</div>
            {totals.size === 0 ? (
              <div className="text-sm text-[color:var(--pmuted)]">Aucune séance enregistrée.</div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[...totals.entries()].map(([name, t]) => (
                  <TotalCard
                    key={name}
                    icon={t.icon}
                    label={name}
                    value={
                      ACTIVITY_UNIT_META[t.unit].seconds ? fmtDuration(t.total) : `${t.total}`
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Le calendrier ferme la page : même bascule bien-être / sport que les stats. */}
      <CalendarView model={model} selected={selected} onSelect={onSelectDate} mode={mode} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Onglet Objectifs (objectifs / séances / activités)                  */
/* ------------------------------------------------------------------ */

const GOAL_SUBS = ["objectifs", "seances"] as const;

function GoalsView({ model, sub }: { model: Model; sub?: string }) {
  const navigate = useNavigate();
  const base = `/sport/${model.member}/objectifs`;
  const current = useLastView("sport:objectifs", GOAL_SUBS, "objectifs", sub, base);
  return (
    <div className="flex flex-col gap-4">
      <PillTabs
        value={current}
        onChange={(v) => navigate(`${base}/${v}`)}
        items={[
          { value: "objectifs", label: "Objectifs" },
          { value: "seances", label: "Sport" },
        ]}
      />
      {current === "seances" ? <SessionsTab model={model} /> : <GoalsTab model={model} />}
    </div>
  );
}

/* ---- Objectifs ---- */

type GoalDraft = {
  name: string;
  emoji: string;
  period: GoalPeriod;
  kind: GoalKind;
  target: number;
  goalType: GoalType;
  sessionId: string | null;
  days: number[];
};

const emptyGoal = (): GoalDraft => ({
  name: "",
  emoji: "🎯",
  period: "daily",
  kind: "todo",
  target: 1,
  goalType: "simple",
  sessionId: null,
  days: [],
});

function GoalsTab({ model }: { model: Model }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<WellnessGoal | "new" | null>(null);
  const [order, setOrder] = useState<WellnessGoal[]>(model.goals);
  useEffect(() => setOrder(model.goals), [model.goals]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const invalidate = () => qc.invalidateQueries({ queryKey: ["wellness-config", model.member] });

  const create = useMutation({
    mutationFn: (d: GoalDraft) => api.post(`/api/sport/${model.member}/goals`, toGoalBody(d)),
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
  });
  const update = useMutation({
    mutationFn: (v: { id: string; draft: GoalDraft }) =>
      api.patch(`/api/sport/${model.member}/goals/${v.id}`, toGoalBody(v.draft)),
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/sport/${model.member}/goals/${id}`),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["wellness-logs", model.member] });
    },
  });
  const reorder = useMutation({
    mutationFn: (orderedIds: string[]) =>
      api.put(`/api/sport/${model.member}/goals/reorder`, { orderedIds }),
    onSuccess: invalidate,
  });

  // Le tri se fait DANS une famille (c'est ce que le Quotidien affiche) : on
  // recompose ensuite l'ordre global famille par famille.
  const groups = useMemo(() => {
    const split = splitGoals(order);
    return GOAL_GROUPS.map((g) => ({ ...g, items: split[g.key] })).filter(
      (g) => g.items.length > 0,
    );
  }, [order]);

  const commit = (key: GoalGroupKey, items: WellnessGoal[]) => {
    setOrder((prev) => {
      const split = splitGoals(prev);
      const next = GOAL_GROUPS.flatMap((g) => (g.key === key ? items : split[g.key]));
      reorder.mutate(next.map((g) => g.id));
      return next;
    });
  };

  const move = (key: GoalGroupKey, items: WellnessGoal[], index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    commit(key, arrayMove(items, index, target));
  };
  const onDragEnd = (key: GoalGroupKey, items: WellnessGoal[]) => (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((g) => g.id === active.id);
    const to = items.findIndex((g) => g.id === over.id);
    if (from < 0 || to < 0) return;
    commit(key, arrayMove(items, from, to));
  };

  const form = editing && (
    <GoalForm
      model={model}
      initial={editing === "new" ? emptyGoal() : toDraft(editing)}
      pending={create.isPending || update.isPending}
      onCancel={() => setEditing(null)}
      onSubmit={(d) =>
        editing === "new" ? create.mutate(d) : update.mutate({ id: editing.id, draft: d })
      }
    />
  );

  return (
    <>
      <EditorHost
        title={editing === "new" ? "Nouvel objectif" : "Modifier l'objectif"}
        open={!!editing}
        onClose={() => setEditing(null)}
      >
        {form}
      </EditorHost>

      <div className="s-card">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="mono text-xs text-[color:var(--pmuted)]">Mes objectifs</div>
          {model.canEdit && (
            <button
              onClick={() => setEditing("new")}
              className="btn-primary hidden md:inline-flex"
              disabled={!!editing}
            >
              ＋ Nouvel objectif
            </button>
          )}
        </div>
        {order.length === 0 ? (
          <div className="text-sm text-[color:var(--pmuted)]">
            Aucun objectif. Crée-en un pour commencer le suivi.
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map(({ key, label, items }) => (
              <div key={key}>
                <div className="mono mb-1.5 text-[10px] uppercase tracking-wide text-[color:var(--pmuted)]">
                  {label}
                </div>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={onDragEnd(key, items)}
                >
                  <SortableContext
                    items={items.map((g) => g.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-1.5">
                      {items.map((g, i) => (
                        <SortableRow
                          key={g.id}
                          id={g.id}
                          canEdit={model.canEdit}
                          onEdit={() => setEditing(g)}
                          onRemove={() => {
                            if (confirm(`Supprimer « ${g.name} » et son historique ?`))
                              remove.mutate(g.id);
                          }}
                          onUp={() => move(key, items, i, -1)}
                          onDown={() => move(key, items, i, 1)}
                          isFirst={i === 0}
                          isLast={i === items.length - 1}
                        >
                          <span>{g.emoji}</span>
                          <span className="min-w-0 truncate font-medium">{g.name}</span>
                          <span className="mono text-[10px] text-[color:var(--pmuted)]">
                            {GOAL_PERIOD_META[g.period].label} ·{" "}
                            {GOAL_KIND_META[g.kind].counter
                              ? `${GOAL_KIND_META[g.kind].label} ${g.target ?? 0}`
                              : GOAL_KIND_META[g.kind].label}
                          </span>
                          {g.goalType === "sport" && (
                            <span
                              className="mono rounded-full px-2 py-0.5 text-[10px]"
                              style={{ background: "rgba(91,138,78,0.18)", color: GREEN }}
                            >
                              🏋️{" "}
                              {model.sessions.find((s) => s.id === g.sessionId)?.name ??
                                "sans séance"}
                            </span>
                          )}
                        </SortableRow>
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              </div>
            ))}
          </div>
        )}
      </div>

      {model.canEdit && !editing && (
        <FabButton label="Nouvel objectif" onClick={() => setEditing("new")} />
      )}
    </>
  );
}

const toDraft = (g: WellnessGoal): GoalDraft => ({
  name: g.name,
  emoji: g.emoji,
  period: g.period,
  kind: g.kind,
  target: g.target ?? 1,
  goalType: g.goalType,
  sessionId: g.sessionId,
  days: g.days ?? [],
});

const toGoalBody = (d: GoalDraft) => ({
  name: d.name.trim(),
  emoji: d.emoji || "🎯",
  period: d.period,
  kind: d.kind,
  target: GOAL_KIND_META[d.kind].counter ? d.target : null,
  goalType: d.goalType,
  sessionId: d.goalType === "sport" ? d.sessionId : null,
  days: d.days.length > 0 && d.days.length < 7 ? d.days : null,
});

function GoalForm({
  model,
  initial,
  pending,
  onSubmit,
  onCancel,
}: {
  model: Model;
  initial: GoalDraft;
  pending: boolean;
  onSubmit: (d: GoalDraft) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<GoalDraft>(initial);
  const counter = GOAL_KIND_META[d.kind].counter;
  const set = <K extends keyof GoalDraft>(k: K, v: GoalDraft[K]) => setD((p) => ({ ...p, [k]: v }));

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (d.name.trim()) onSubmit(d);
      }}
    >
      <EmojiNameRow
        emoji={d.emoji}
        onEmoji={(v) => set("emoji", v)}
        name={d.name}
        onName={(v) => set("name", v)}
        placeholder="Boissons, Sport, Grignotage…"
        groups={GOAL_EMOJI_GROUPS}
      />

      <div className="grid grid-cols-2 gap-2">
        <Field label="Périodicité">
          <Select
            value={d.period}
            onChange={(v) => set("period", v as GoalPeriod)}
            options={GOAL_PERIODS.map((p) => ({ value: p, label: GOAL_PERIOD_META[p].label }))}
          />
        </Field>
        <Field label="Nature">
          <Select
            value={d.kind}
            onChange={(v) => set("kind", v as GoalKind)}
            options={GOAL_KINDS.map((k) => ({ value: k, label: GOAL_KIND_META[k].label }))}
          />
        </Field>
      </div>

      {counter && (
        <Field label={`Cible (${GOAL_KIND_META[d.kind].label.toLowerCase()} par ${GOAL_PERIOD_META[d.period].short})`}>
          <input
            type="number"
            min={0}
            value={d.target}
            onChange={(e) => set("target", Math.max(0, Number(e.target.value) || 0))}
            className={fieldClass}
          />
        </Field>
      )}

      {d.period === "daily" && (
        <Field label="Jours concernés (aucun = tous)">
          <div className="flex gap-1.5">
            {WEEK_DAYS.map((wd) => {
              const on = d.days.includes(wd.value);
              return (
                <button
                  key={wd.value}
                  type="button"
                  onClick={() =>
                    set("days", on ? d.days.filter((x) => x !== wd.value) : [...d.days, wd.value])
                  }
                  className="mono h-8 w-8 rounded-full text-xs"
                  style={
                    on
                      ? { background: GREEN, color: "#fff" }
                      : { background: "var(--paper-2)", color: "var(--pmuted)" }
                  }
                >
                  {wd.label}
                </button>
              );
            })}
          </div>
        </Field>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={d.goalType === "sport"}
          onChange={(e) => set("goalType", e.target.checked ? "sport" : "simple")}
          className="h-4 w-4 accent-[color:var(--pgreen)]"
        />
        Objectif de sport (associé à une séance)
      </label>

      {d.goalType === "sport" && (
        <Field label="Séance associée">
          {model.sessions.length === 0 ? (
            <div className="mono text-[10px] text-[color:var(--pmuted)]">
              Aucune séance : crée-la dans l'onglet Séances.
            </div>
          ) : (
            <Select
              value={d.sessionId ?? ""}
              onChange={(v) => set("sessionId", v || null)}
              placeholder="Choisir une séance…"
              options={model.sessions.map((s) => ({ value: s.id, label: `${s.emoji} ${s.name}` }))}
            />
          )}
        </Field>
      )}

      <FormActions onCancel={onCancel} pending={pending} />
    </form>
  );
}

/* ---- Séances ---- */

type SessionDraft = { name: string; emoji: string; series: number; items: { activityId: string; amount: number }[] };

function SessionsTab({ model }: { model: Model }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<WellnessSession | "new" | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["wellness-config", model.member] });

  const create = useMutation({
    mutationFn: (d: SessionDraft) => api.post(`/api/sport/${model.member}/sessions`, d),
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
  });
  const update = useMutation({
    mutationFn: (v: { id: string; draft: SessionDraft }) =>
      api.patch(`/api/sport/${model.member}/sessions/${v.id}`, v.draft),
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/sport/${model.member}/sessions/${id}`),
    onSuccess: invalidate,
  });

  return (
    <>
      <EditorHost
        wide
        title={editing === "new" ? "Nouvelle séance" : "Modifier la séance"}
        open={!!editing}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <SessionForm
            model={model}
            initial={
              editing === "new"
                ? { name: "", emoji: "🏋️", series: 3, items: [] }
                : {
                    name: editing.name,
                    emoji: editing.emoji,
                    series: editing.series,
                    items: editing.items,
                  }
            }
            pending={create.isPending || update.isPending}
            onCancel={() => setEditing(null)}
            onSubmit={(d) =>
              editing === "new" ? create.mutate(d) : update.mutate({ id: editing.id, draft: d })
            }
          />
        )}
      </EditorHost>

      <div className="s-card">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="mono text-xs text-[color:var(--pmuted)]">Mes séances</div>
          {/* Deux listes sur la page : chaque carte porte son bouton, y compris
              sur mobile, pour qu'on ne confonde pas avec le bouton flottant. */}
          {model.canEdit && (
            <button onClick={() => setEditing("new")} className="btn-primary" disabled={!!editing}>
              ＋ Séance
            </button>
          )}
        </div>
        {model.sessions.length === 0 ? (
          <div className="text-sm text-[color:var(--pmuted)]">
            Aucune séance. Une séance = un nombre de séries + une liste d'activités.
          </div>
        ) : (
          <div className="space-y-2">
            {model.sessions.map((s) => (
              <div key={s.id} className="rounded-xl border border-[color:var(--pline)] px-3 py-2">
                <div className="flex items-center gap-2">
                  <span>{s.emoji}</span>
                  <span className="min-w-0 truncate text-sm font-medium">{s.name}</span>
                  <span className="mono text-[10px] text-[color:var(--pmuted)]">
                    {s.series} série{s.series > 1 ? "s" : ""}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    <RowBtn label="Modifier" disabled={!model.canEdit} onClick={() => setEditing(s)}>
                      ✎
                    </RowBtn>
                    <RowBtn
                      label="Supprimer"
                      disabled={!model.canEdit}
                      onClick={() => {
                        if (confirm(`Supprimer la séance « ${s.name} » ?`)) remove.mutate(s.id);
                      }}
                    >
                      ✕
                    </RowBtn>
                  </div>
                </div>
                <div className="mono mt-1 flex flex-wrap gap-x-3 text-[10px] text-[color:var(--pmuted)]">
                  {s.items.length === 0 ? (
                    <span>Aucune activité</span>
                  ) : (
                    s.items.map((it, i) => {
                      const a = model.activities.find((x) => x.id === it.activityId);
                      if (!a) return null;
                      return (
                        <span key={i}>
                          {a.icon} {a.name} {amountLabel(a.unit, it.amount)}
                        </span>
                      );
                    })
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Les activités vivent sous les séances : ce sont leurs briques. */}
      <ActivitiesCard model={model} />

      {model.canEdit && !editing && (
        <FabButton label="Nouvelle séance" onClick={() => setEditing("new")} />
      )}
    </>
  );
}

/** Quantité proposée par défaut selon l'unité de l'activité. */
const defaultAmount = (a: WellnessActivity | null) => (!a || a.unit === "reps" ? 10 : 30);

function SessionForm({
  model,
  initial,
  pending,
  onSubmit,
  onCancel,
}: {
  model: Model;
  initial: SessionDraft;
  pending: boolean;
  onSubmit: (d: SessionDraft) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<SessionDraft>(initial);
  const set = <K extends keyof SessionDraft>(k: K, v: SessionDraft[K]) =>
    setD((p) => ({ ...p, [k]: v }));

  // Ligne d'ajout : on choisit l'activité ET sa quantité avant de cliquer « Ajouter ».
  const available = model.activities.filter((a) => !d.items.some((it) => it.activityId === a.id));
  const [pick, setPick] = useState(available[0]?.id ?? "");
  // Repli sur la première activité libre : retirer une ligne rend le choix valide.
  const picked = available.find((a) => a.id === pick) ?? available[0] ?? null;
  const [amount, setAmount] = useState(() => defaultAmount(picked));

  const choose = (id: string) => {
    setPick(id);
    setAmount(defaultAmount(model.activities.find((a) => a.id === id) ?? null));
  };
  const addItem = () => {
    if (!picked) return;
    set("items", [...d.items, { activityId: picked.id, amount }]);
    choose(available.find((a) => a.id !== picked.id)?.id ?? "");
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (d.name.trim()) onSubmit({ ...d, name: d.name.trim() });
      }}
    >
      <EmojiNameRow
        emoji={d.emoji}
        onEmoji={(v) => set("emoji", v)}
        name={d.name}
        onName={(v) => set("name", v)}
        placeholder="Séance type, Haut du corps…"
        groups={ACTIVITY_EMOJI_GROUPS}
      />

      <Field label="Nombre de séries">
        <input
          type="number"
          min={1}
          value={d.series}
          onChange={(e) => set("series", Math.max(1, Number(e.target.value) || 1))}
          className={`${inputBase} w-24`}
        />
      </Field>

      <div className="space-y-2">
        <div className="mono text-[10px] text-[color:var(--pmuted)]">Activités de la séance</div>

        {d.items.map((it, i) => {
          const a = model.activities.find((x) => x.id === it.activityId);
          if (!a) return null;
          return (
            <div
              key={it.activityId}
              className="flex items-center gap-2 rounded-xl border border-[color:var(--pline)] px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm">
                {a.icon} {a.name}
              </span>
              <input
                type="number"
                min={0}
                value={it.amount}
                onChange={(e) =>
                  set(
                    "items",
                    d.items.map((x, j) =>
                      j === i ? { ...x, amount: Math.max(0, Number(e.target.value) || 0) } : x,
                    ),
                  )
                }
                className={`${inputBase} w-20 shrink-0 px-2 text-center`}
              />
              <span className="mono w-9 shrink-0 text-[10px] text-[color:var(--pmuted)]">
                {ACTIVITY_UNIT_META[a.unit].short}
              </span>
              <RowBtn label="Retirer" onClick={() => set("items", d.items.filter((_, j) => j !== i))}>
                ✕
              </RowBtn>
            </div>
          );
        })}

        {model.activities.length === 0 ? (
          <div className="mono text-[10px] text-[color:var(--pmuted)]">
            Ajoute d'abord une activité (carte « Mes activités », sous les séances).
          </div>
        ) : available.length === 0 ? (
          <div className="mono text-[10px] text-[color:var(--pmuted)]">
            Toutes tes activités sont dans la séance.
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              className="min-w-[8rem] flex-1"
              value={picked?.id ?? ""}
              onChange={choose}
              options={available.map((a) => ({ value: a.id, label: `${a.icon} ${a.name}` }))}
              placeholder="Choisir une activité…"
            />
            <input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
              className={`${inputBase} w-20 shrink-0 px-2 text-center`}
            />
            <span className="mono w-9 shrink-0 text-[10px] text-[color:var(--pmuted)]">
              {picked ? ACTIVITY_UNIT_META[picked.unit].short : ""}
            </span>
            <button type="button" onClick={addItem} disabled={!picked} className="btn-ghost shrink-0">
              Ajouter
            </button>
          </div>
        )}
      </div>

      <FormActions onCancel={onCancel} pending={pending} />
    </form>
  );
}

/* ---- Activités ---- */

type ActivityDraft = { name: string; icon: string; unit: ActivityUnit };

/** Catalogue d'activités, affiché sous les séances (ce sont leurs briques). */
function ActivitiesCard({ model }: { model: Model }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<WellnessActivity | "new" | null>(null);
  const [order, setOrder] = useState<WellnessActivity[]>(model.activities);
  useEffect(() => setOrder(model.activities), [model.activities]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const invalidate = () => qc.invalidateQueries({ queryKey: ["wellness-config", model.member] });

  const create = useMutation({
    mutationFn: (d: ActivityDraft) => api.post(`/api/sport/${model.member}/activities`, d),
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
  });
  const update = useMutation({
    mutationFn: (v: { id: string; draft: ActivityDraft }) =>
      api.patch(`/api/sport/${model.member}/activities/${v.id}`, v.draft),
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/sport/${model.member}/activities/${id}`),
    onSuccess: invalidate,
  });
  const reorder = useMutation({
    mutationFn: (orderedIds: string[]) =>
      api.put(`/api/sport/${model.member}/activities/reorder`, { orderedIds }),
    onSuccess: invalidate,
  });

  const move = (index: number, dir: -1 | 1) => {
    setOrder((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = arrayMove(prev, index, target);
      reorder.mutate(next.map((a) => a.id));
      return next;
    });
  };
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setOrder((prev) => {
      const from = prev.findIndex((a) => a.id === active.id);
      const to = prev.findIndex((a) => a.id === over.id);
      if (from < 0 || to < 0) return prev;
      const next = arrayMove(prev, from, to);
      reorder.mutate(next.map((a) => a.id));
      return next;
    });
  };

  return (
    <>
      <EditorHost
        title={editing === "new" ? "Nouvelle activité" : "Modifier l'activité"}
        open={!!editing}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <ActivityForm
            initial={
              editing === "new"
                ? { name: "", icon: "💪", unit: "reps" }
                : { name: editing.name, icon: editing.icon, unit: editing.unit }
            }
            pending={create.isPending || update.isPending}
            onCancel={() => setEditing(null)}
            onSubmit={(d) =>
              editing === "new" ? create.mutate(d) : update.mutate({ id: editing.id, draft: d })
            }
          />
        )}
      </EditorHost>

      <div className="s-card">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="mono text-xs text-[color:var(--pmuted)]">Mes activités</div>
          {/* Section secondaire : bouton visible aussi sur mobile (le FAB crée une séance). */}
          {model.canEdit && (
            <button onClick={() => setEditing("new")} className="btn-ghost" disabled={!!editing}>
              ＋ Activité
            </button>
          )}
        </div>
        {order.length === 0 ? (
          <div className="text-sm text-[color:var(--pmuted)]">
            Aucune activité. Une activité = un nom, une icône et une unité (répétitions ou temps).
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={order.map((a) => a.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1.5">
                {order.map((a, i) => (
                  <SortableRow
                    key={a.id}
                    id={a.id}
                    canEdit={model.canEdit}
                    onEdit={() => setEditing(a)}
                    onRemove={() => {
                      if (confirm(`Supprimer l'activité « ${a.name} » ?`)) remove.mutate(a.id);
                    }}
                    onUp={() => move(i, -1)}
                    onDown={() => move(i, 1)}
                    isFirst={i === 0}
                    isLast={i === order.length - 1}
                  >
                    <span>{a.icon}</span>
                    <span className="min-w-0 truncate font-medium">{a.name}</span>
                    <span className="mono text-[10px] text-[color:var(--pmuted)]">
                      {ACTIVITY_UNIT_META[a.unit].label}
                    </span>
                  </SortableRow>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </>
  );
}

function ActivityForm({
  initial,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: ActivityDraft;
  pending: boolean;
  onSubmit: (d: ActivityDraft) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<ActivityDraft>(initial);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (d.name.trim()) onSubmit({ ...d, name: d.name.trim() });
      }}
    >
      <EmojiNameRow
        emoji={d.icon}
        onEmoji={(v) => setD((p) => ({ ...p, icon: v }))}
        name={d.name}
        onName={(v) => setD((p) => ({ ...p, name: v }))}
        placeholder="Pompes, Gainage…"
        groups={ACTIVITY_EMOJI_GROUPS}
      />
      <Field label="Type de mesure">
        <Select
          value={d.unit}
          onChange={(v) => setD((p) => ({ ...p, unit: v as ActivityUnit }))}
          options={ACTIVITY_UNITS.map((u) => ({ value: u, label: ACTIVITY_UNIT_META[u].label }))}
        />
      </Field>
      <FormActions onCancel={onCancel} pending={pending} />
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Primitives locales                                                  */
/* ------------------------------------------------------------------ */

/**
 * Champ de saisie du thème bien-être. `inputBase` ne porte **pas** de largeur :
 * la composer avec `w-20`/`w-24` reste possible (un `w-full` intégré gagnerait
 * sur l'utilitaire ajouté après, l'ordre du CSS primant sur celui des classes).
 */
const inputBase =
  "rounded-xl border border-[color:var(--pline)] bg-[color:var(--pcard)] px-3 py-2 text-sm text-[color:var(--pink)] outline-none";
const fieldClass = `mt-1 w-full ${inputBase}`;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mono mb-1 text-[10px] text-[color:var(--pmuted)]">{label}</div>
      {children}
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  min = 0,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  suffix?: string;
}) {
  return (
    <label className="mono text-[10px] text-[color:var(--pmuted)]">
      {label} {suffix ? `(${suffix})` : ""}
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className={fieldClass}
      />
    </label>
  );
}

/**
 * Ligne « emoji + nom », commune aux trois formulaires. Le sélecteur d'emoji
 * s'ouvre **dans le flux**, sous la ligne et sur toute la largeur : en
 * surimpression il était rogné par le défilement de la modale.
 */
function EmojiNameRow({
  emoji,
  onEmoji,
  name,
  onName,
  placeholder,
  groups,
}: {
  emoji: string;
  onEmoji: (v: string) => void;
  name: string;
  onName: (v: string) => void;
  placeholder: string;
  groups: EmojiGroup[];
}) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  // À l'ouverture, on amène le sélecteur dans la zone visible de la modale.
  useEffect(() => {
    if (open) panel.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div>
          <div className="mono text-[10px] text-[color:var(--pmuted)]">Emoji</div>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            title="Choisir un emoji"
            className="mt-1 h-[38px] w-14 rounded-xl border bg-[color:var(--pcard)] text-xl"
            style={{ borderColor: open ? GREEN : "var(--pline)" }}
          >
            {emoji || "🎯"}
          </button>
        </div>
        <label className="mono min-w-0 flex-1 text-[10px] text-[color:var(--pmuted)]">
          Nom
          <input
            autoFocus
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder={placeholder}
            className={fieldClass}
          />
        </label>
      </div>

      {open && (
        <div
          ref={panel}
          className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-[color:var(--pline)] p-2"
        >
          <div className="flex items-center gap-2">
            <input
              value={emoji}
              onChange={(e) => onEmoji(firstEmoji(e.target.value))}
              placeholder="Coller un autre emoji…"
              className={`${inputBase} min-w-0 flex-1 py-1 text-center`}
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn-ghost shrink-0 px-2 py-1 text-xs"
            >
              Fermer
            </button>
          </div>
          {groups.map((g) => (
            <div key={g.label}>
              <div className="mono mb-1 text-[9px] text-[color:var(--pmuted)]">{g.label}</div>
              <div className="grid grid-cols-8 gap-1">
                {g.emojis.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => {
                      onEmoji(e);
                      setOpen(false);
                    }}
                    className="rounded-lg py-1 text-lg hover:bg-[color:var(--paper-2)]"
                    style={emoji === e ? { background: "rgba(91,138,78,0.18)" } : undefined}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FormActions({ onCancel, pending }: { onCancel: () => void; pending: boolean }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button type="button" onClick={onCancel} className="btn-ghost">
        Annuler
      </button>
      <button className="btn-primary" disabled={pending}>
        {pending ? "Enregistrement…" : "Enregistrer"}
      </button>
    </div>
  );
}

/**
 * Formulaire d'édition en modale, alignée en haut sur mobile (là où le clavier
 * laisse la place) et centrée sur ordinateur.
 */
function EditorHost({
  title,
  open,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className={`s-card sport-theme max-h-[85vh] w-full overflow-y-auto ${
          wide ? "max-w-lg" : "max-w-md"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-[color:var(--pmuted)]">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Bouton flottant de création (mobile uniquement). */
function FabButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="btn-primary fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full p-0 shadow-lg md:hidden"
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 5v14M5 12h14" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/** Ligne réordonnable : poignée de glissement (ordinateur) + flèches ↑ ↓. */
function SortableRow({
  id,
  canEdit,
  children,
  onEdit,
  onRemove,
  onUp,
  onDown,
  isFirst,
  isLast,
}: {
  id: string;
  canEdit: boolean;
  children: ReactNode;
  onEdit: () => void;
  onRemove: () => void;
  onUp: () => void;
  onDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
        isDragging ? "border-brand-400" : "border-[color:var(--pline)]"
      }`}
    >
      {canEdit && (
        <button
          {...attributes}
          {...listeners}
          className="hidden cursor-grab text-[color:var(--pmuted)] sm:block"
          title="Glisser pour réordonner"
        >
          ⠿
        </button>
      )}
      {children}
      <div className="ml-auto flex items-center gap-1">
        <RowBtn label="Modifier" disabled={!canEdit} onClick={onEdit}>
          ✎
        </RowBtn>
        <RowBtn label="Supprimer" disabled={!canEdit} onClick={onRemove}>
          ✕
        </RowBtn>
        <RowBtn label="Monter" disabled={!canEdit || isFirst} onClick={onUp}>
          ↑
        </RowBtn>
        <RowBtn label="Descendre" disabled={!canEdit || isLast} onClick={onDown}>
          ↓
        </RowBtn>
      </div>
    </div>
  );
}

function RowBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded-lg px-2 py-1 text-[color:var(--pmuted)] transition hover:text-brand-600 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function StatBox({
  label,
  value,
  color,
  sub,
}: {
  label: string;
  value: number;
  color?: string;
  sub?: string;
}) {
  return (
    <div className="s-card text-center">
      <div className="mono text-[10px] text-[color:var(--pmuted)]">{label}</div>
      <div className="mt-1 text-3xl font-semibold" style={{ color: color ?? "var(--pink)" }}>
        {value}
      </div>
      {sub && <div className="mono text-[10px] text-[color:var(--pmuted)]">{sub}</div>}
    </div>
  );
}

function TotalCard({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="rounded-xl border border-[color:var(--pline)] p-3 text-center">
      <div className="text-2xl">{icon}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      <div className="mono text-[10px] text-[color:var(--pmuted)]">{label}</div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex h-9 w-9 items-center justify-center rounded-xl border border-[color:var(--pline)] bg-[color:var(--pcard)] text-lg text-[color:var(--pink)] disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Bar({
  label,
  value,
  target,
  scope,
  higherIsBetter,
}: {
  label: string;
  value: number;
  target: number;
  scope: string;
  higherIsBetter?: boolean;
}) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : value > 0 ? 100 : 0;
  const over = value > target;
  const color = higherIsBetter
    ? value >= target
      ? value >= target + 3
        ? VIOLET
        : GREEN
      : WARN
    : over
      ? FAIL
      : value === target
        ? WARN
        : GREEN;
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span>
          {label} · {value}/{target} par {scope}
        </span>
        <span className="mono text-[10px] text-[color:var(--pmuted)]">
          {higherIsBetter ? (value >= target ? "Atteint" : "En cours") : over ? "Dépassé" : "OK"}
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-[color:var(--paper-2)]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function Legend({ color, label, border }: { color: string; label: string; border?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block h-3 w-3 rounded"
        style={{ background: color, border: border ? "1px solid var(--pline)" : "none" }}
      />
      {label}
    </span>
  );
}
