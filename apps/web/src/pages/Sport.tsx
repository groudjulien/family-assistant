import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
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
import {
  ACTIVITY_UNITS,
  ACTIVITY_UNIT_META,
  GOAL_KIND_META,
  GOAL_PERIOD_META,
  type ActivityUnit,
  type GoalKind,
  type GoalPeriod,
  type GoalType,
  type WellnessActivity,
  type WellnessConfig,
  type WellnessGoal,
  type WellnessJournal,
  type WellnessLog,
  type WellnessLoggedSession,
  type WellnessSession,
} from "@gfa/shared";
import { useMe } from "../auth";
import { api } from "../lib/api";
import { useLastView } from "../lib/lastView";
import PageLoader from "../components/PageLoader";
import type { OverflowItem } from "../components/ui";
import {
  ActionSheet,
  Checkbox,
  Input,
  MobileActionBar,
  OverflowMenu,
  Sheet,
  SubNav,
} from "../components/ui";
import { usePageHeader, usePageTabs } from "../components/PageHeader";

/* ---------------- constantes ---------------- */
const MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];
const DAYS = ["L", "M", "M", "J", "V", "S", "D"];
/** Jours de la semaine, index JS (0 = dimanche), affichés du lundi au dimanche. */
const WEEK_DAYS: { value: number; label: string; long: string }[] = [
  { value: 1, label: "L", long: "lundi" },
  { value: 2, label: "M", long: "mardi" },
  { value: 3, label: "M", long: "mercredi" },
  { value: 4, label: "J", long: "jeudi" },
  { value: 5, label: "V", long: "vendredi" },
  { value: 6, label: "S", long: "samedi" },
  { value: 0, label: "D", long: "dimanche" },
];

/* Couleurs des graphiques : tokens du design system (voir index.css), pour
   suivre le thème clair/sombre au lieu de figer un hex. */
const GREEN = "rgb(var(--brand-600))";
const WARN = "rgb(var(--c-warning))";
const FAIL = "rgb(var(--c-danger))";
const VIOLET = "rgb(var(--c-info))";

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
  `${amount} ${ACTIVITY_UNIT_META[unit].short}`;

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

/** « cette semaine » / « ce mois » / « aujourd'hui » — portée d'une période. */
const scopeLabel = (period: GoalPeriod) =>
  period === "daily" ? "aujourd'hui" : period === "weekly" ? "cette semaine" : "ce mois";

/** Première lettre en capitale (début de phrase). */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Total d'une activité sur la séance complète : la valeur saisie est **par
 * série**, on la multiplie donc par le nombre de séries. « 23 SÉRIES · POMPES
 * 210 » ne disait pas lequel des deux chiffres était le total.
 */
function itemTotalLabel(a: WellnessActivity, amount: number, series: number): string {
  const total = amount * series;
  const secs = ACTIVITY_UNIT_META[a.unit].seconds;
  return secs
    ? `${fmtDuration(total * secs)} de ${a.name.toLowerCase()}`
    : `${total} ${a.name.toLowerCase()}`;
}

/** « soit 210 pompes · 630 s de gainage » — total réel de la séance. */
function sessionTotalLabel(
  session: { series: number; items: { activityId: string; amount: number }[] },
  activities: WellnessActivity[],
): string {
  const parts = session.items.flatMap((it) => {
    const a = activities.find((x) => x.id === it.activityId);
    return a ? [itemTotalLabel(a, it.amount, session.series)] : [];
  });
  return parts.join(" · ");
}

type DayStatus = "future" | "empty" | "perfect" | "almost" | "failed";

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */

/**
 * Quatre onglets à plat. Avant, trois onglets cachaient six écrans derrière un
 * second segment BIEN-ÊTRE / SPORT : rien n'annonçait ce deuxième niveau, et
 * « Sport » ne voulait pas dire la même chose dans Stats que dans Objectifs.
 */
const VIEWS = ["aujourdhui", "objectifs", "seances", "stats"] as const;
type View = (typeof VIEWS)[number];

const SPORT_TABS = [
  { value: "aujourdhui", label: "Aujourd'hui" },
  { value: "objectifs", label: "Objectifs" },
  { value: "seances", label: "Séances" },
  { value: "stats", label: "Stats" },
];

export default function Sport() {
  const me = useMe();
  const navigate = useNavigate();
  const { member: param, view: viewParam } = useParams();

  // Hooks avant tout `return` conditionnel : la redirection ci-dessous changerait
  // sinon le nombre de hooks entre deux rendus.
  // Même clé que `Tracker` : l'en-tête lit le cache, sans requête en plus.
  const { data: config } = useQuery({
    queryKey: ["wellness-config", me.member],
    queryFn: () => api.get<WellnessConfig>(`/api/sport/${me.member}/config`),
  });
  const view: View = (VIEWS as readonly string[]).includes(viewParam ?? "")
    ? (viewParam as View)
    : "aujourdhui";

  const nGoals = config?.goals.length ?? 0;
  const nSessions = config?.sessions.length ?? 0;
  const nActivities = config?.activities.length ?? 0;
  const plural = (n: number) => (n > 1 ? "s" : "");
  // `null` sur « Aujourd'hui » : c'est la vue qui connaît le jour affiché, donc
  // elle seule peut l'annoncer (et l'effet du parent passerait après le sien).
  usePageHeader(
    view === "aujourdhui" ? null : "Bien-être",
    view === "objectifs"
      ? `${nGoals} objectif${plural(nGoals)} actif${plural(nGoals)}`
      : view === "seances"
        ? `${nSessions} séance${plural(nSessions)} · ${nActivities} activité${plural(nActivities)}`
        : "Suivi et historique",
  );
  usePageTabs(view, SPORT_TABS, (v) => navigate(`/sport/${me.member}/${v}`));

  // Chacun ne voit que ses propres objectifs : l'URL est toujours réalignée sur
  // le membre connecté (l'API refuse de toute façon la lecture d'un autre membre).
  if (param !== me.member) return <Navigate to={`/sport/${me.member}`} replace />;

  return <Tracker key={me.member} member={me.member} canEdit view={viewParam} />;
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
  /** Vrai si l'objectif a une ligne ce jour-là — « zéro » n'est pas « non saisi ». */
  hasLog: (date: string, goalId: string) => boolean;
  /** Séances réalisées ce jour-là pour cet objectif. */
  logged: (date: string, goalId: string) => WellnessLoggedSession[];
  /** Une journée est « saisie » dès qu'un objectif y a une ligne, ou qu'elle est clôturée. */
  entered: (date: string) => boolean;
  /** Journée déclarée terminée. */
  closed: (date: string) => boolean;
  setClosed: (date: string, closed: boolean) => void;
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
}: {
  member: string;
  canEdit: boolean;
  view?: string;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const view = useLastView("sport:view", VIEWS, "aujourdhui", viewParam, `/sport/${member}`) as View;
  const [selected, setSelected] = useState(fmtDate(new Date()));

  const configQ = useQuery({
    queryKey: ["wellness-config", member],
    queryFn: () => api.get<WellnessConfig>(`/api/sport/${member}/config`),
  });
  const journalQ = useQuery({
    queryKey: ["wellness-logs", member],
    queryFn: () => api.get<WellnessJournal>(`/api/sport/${member}/logs`),
  });

  const save = useMutation({
    mutationFn: (v: { date: string; goalId: string; value: number; sessions: WellnessLoggedSession[] }) =>
      api.put(`/api/sport/${member}/logs/${v.date}/${v.goalId}`, {
        value: v.value,
        sessions: v.sessions,
      }),
    // Saisie optimiste : les compteurs et bascules répondent immédiatement.
    onMutate: (v) => {
      qc.setQueryData<WellnessJournal>(["wellness-logs", member], (prev) => {
        if (!prev) return prev;
        const rest = prev.logs.filter((l) => !(l.date === v.date && l.goalId === v.goalId));
        const logs =
          v.value === 0 && v.sessions.length === 0
            ? rest
            : [...rest, { date: v.date, goalId: v.goalId, value: v.value, sessions: v.sessions }];
        return { ...prev, logs };
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["wellness-logs", member] }),
  });

  const closeDay = useMutation({
    mutationFn: (v: { date: string; closed: boolean }) =>
      api.put(`/api/sport/${member}/logs/close/${v.date}`, { closed: v.closed }),
    onMutate: (v) => {
      qc.setQueryData<WellnessJournal>(["wellness-logs", member], (prev) =>
        prev
          ? {
              ...prev,
              closedDates: v.closed
                ? [...new Set([...prev.closedDates, v.date])]
                : prev.closedDates.filter((d) => d !== v.date),
            }
          : prev,
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["wellness-logs", member] }),
  });

  const model = useMemo<Model | null>(() => {
    if (!configQ.data || !journalQ.data) return null;
    const { goals, sessions, activities } = configQ.data;
    const closedSet = new Set(journalQ.data.closedDates);
    const byDate = new Map<string, Map<string, WellnessLog>>();
    for (const l of journalQ.data.logs) {
      const m = byDate.get(l.date) ?? new Map<string, WellnessLog>();
      m.set(l.goalId, l);
      byDate.set(l.date, m);
    }
    const dates = [...new Set([...byDate.keys(), ...closedSet])].sort();
    const value = (date: string, goalId: string) => byDate.get(date)?.get(goalId)?.value ?? 0;
    const hasLog = (date: string, goalId: string) => byDate.get(date)?.has(goalId) ?? false;
    const logged = (date: string, goalId: string) => byDate.get(date)?.get(goalId)?.sessions ?? [];
    // Clôturer une journée vide la déclare saisie : c'est le sens du bouton.
    const entered = (date: string) => (byDate.get(date)?.size ?? 0) > 0 || closedSet.has(date);
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
      hasLog,
      logged,
      entered,
      closed: (date) => closedSet.has(date),
      setClosed: (date, v) => closeDay.mutate({ date, closed: v }),
      applicable,
      periodTotal,
      failing,
      dayStatus,
      dates,
      firstDate: dates[0] ?? null,
      save: (date, goalId, v, sessions = []) => save.mutate({ date, goalId, value: v, sessions }),
    };
  }, [configQ.data, journalQ.data, member, canEdit, save, closeDay]);

  if (!model) return <PageLoader variant="bienetre" />;

  const go = (v: string) => navigate(`/sport/${member}/${v}`);

  return (
    <div className="sport-theme flex flex-col gap-4 pb-28 md:pb-0">
      {/* Onglets communs à toute l'app (dans la barre du haut sur mobile). */}
      <SubNav value={view} onChange={go} items={SPORT_TABS} className="hidden md:block" />

      {view === "aujourdhui" && (
        <DailyView model={model} selected={selected} onSelect={setSelected} />
      )}
      {view === "objectifs" && <GoalsTab model={model} />}
      {view === "seances" && <SessionsTab model={model} />}
      {view === "stats" && (
        <StatsView
          model={model}
          selected={selected}
          onSelectDate={(d) => {
            setSelected(d);
            go("aujourdhui");
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Onglet Aujourd'hui                                                  */
/* ------------------------------------------------------------------ */

/**
 * Les trois familles de l'écran du quotidien : les séances qu'on démarre, les
 * quantités qu'on compte, les habitudes qu'on coche. Les compteurs de la
 * semaine et ceux du jour se comptent pareil — ils vivent donc ensemble.
 */
function dailyGroups(goals: WellnessGoal[]) {
  const sport = goals.filter((g) => g.goalType === "sport");
  const rest = goals.filter((g) => g.goalType !== "sport");
  return {
    sport,
    counters: rest.filter((g) => GOAL_KIND_META[g.kind].counter),
    habits: rest.filter((g) => !GOAL_KIND_META[g.kind].counter),
  };
}

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
  const [picker, setPicker] = useState<WellnessGoal | null>(null);

  // La barre du haut porte le jour affiché : le savoir est ici, pas dans la page.
  usePageHeader(
    "Bien-être",
    selected === today
      ? cap(parseDate(selected).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }))
      : cap(parseDate(selected).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })),
  );

  const applicable = model.goals.filter((g) => model.applicable(g, selected));
  const held = applicable.filter((g) => !model.failing(g, selected)).length;
  const pending = applicable.filter((g) => !model.hasLog(selected, g.id)).length;
  const isClosed = model.closed(selected);
  const { sport, counters, habits } = dailyGroups(applicable);

  const step = (n: number) => onSelect(fmtDate(addDays(parseDate(selected), n)));

  return (
    <>
      <div className="flex flex-col gap-5">
        {/* Le chiffre qu'on vient chercher, et l'état de la journée en clair. */}
        <div className="card flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xl font-bold">
              {applicable.length === 0
                ? "Aucun objectif aujourd'hui"
                : `${held} objectif${held > 1 ? "s" : ""} sur ${applicable.length} tenu${held > 1 ? "s" : ""}`}
            </div>
            <div className="mt-0.5 text-xs text-slate-400">
              {locked
                ? "journée à venir"
                : isClosed
                  ? "journée clôturée"
                  : pending > 0
                    ? `journée en cours · ${pending} à saisir`
                    : "journée en cours · tout est saisi"}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <StepBtn label="Jour précédent" onClick={() => step(-1)}>
              ‹
            </StepBtn>
            <StepBtn label="Jour suivant" disabled={selected >= today} onClick={() => step(1)}>
              ›
            </StepBtn>
          </div>
        </div>

        {model.goals.length === 0 ? (
          <div className="card">
            <div className="text-sm text-ink-2">Aucun objectif pour l'instant.</div>
            <div className="mt-1 text-xs text-slate-400">
              Crée-les dans l'onglet Objectifs pour commencer le suivi.
            </div>
          </div>
        ) : applicable.length === 0 ? (
          <div className="card text-sm text-ink-2">
            Aucun objectif ne s'applique à ce jour de la semaine.
          </div>
        ) : (
          <>
            {sport.length > 0 && (
              <Group title="Séances de sport">
                {sport.map((g, i) => (
                  <SportRow
                    key={g.id}
                    model={model}
                    goal={g}
                    date={selected}
                    editable={editable}
                    last={i === sport.length - 1}
                    onPickSession={() => setPicker(g)}
                  />
                ))}
              </Group>
            )}

            {counters.length > 0 && (
              <Group title="À compter">
                {counters.map((g, i) => (
                  <CounterRow
                    key={g.id}
                    model={model}
                    goal={g}
                    date={selected}
                    editable={editable}
                    last={i === counters.length - 1}
                  />
                ))}
              </Group>
            )}

            {habits.length > 0 && (
              <Group title="Habitudes">
                {habits.map((g, i) => (
                  <HabitRow
                    key={g.id}
                    model={model}
                    goal={g}
                    date={selected}
                    editable={editable}
                    last={i === habits.length - 1}
                  />
                ))}
              </Group>
            )}
          </>
        )}

        {/* Une seule action, et elle dit ce qu'elle fait — au lieu d'un
            sous-titre « NON SAISI » qui ne faisait que décrire. */}
        {model.goals.length > 0 && (
          <button
            type="button"
            disabled={!editable}
            onClick={() => model.setClosed(selected, !isClosed)}
            className="btn-primary hidden self-start disabled:opacity-40 md:inline-flex"
          >
            {isClosed ? "Rouvrir la journée" : "Clôturer la journée"}
          </button>
        )}
      </div>

      {model.goals.length > 0 && editable && (
        <MobileActionBar
          label={isClosed ? "Rouvrir la journée" : "Clôturer la journée"}
          icon={
            isClosed ? (
              <UndoGlyph />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
                <path d="M4 12.5l5.5 5.5L20 7" />
              </svg>
            )
          }
          onClick={() => model.setClosed(selected, !isClosed)}
        />
      )}

      {/* Objectif de sport sans séance imposée : on choisit laquelle démarrer. */}
      {picker && (
        <ActionSheet
          title={`${picker.emoji} ${picker.name}`}
          subtitle="Quelle séance démarrer ?"
          items={model.sessions.map((s) => ({
            label: `${s.emoji} ${s.name}`,
            hint:
              s.items.length === 0
                ? "aucune activité"
                : `${s.series} série${s.series > 1 ? "s" : ""} · ${sessionTotalLabel(s, model.activities)}`,
            onClick: () => {
              const done = model.logged(selected, picker.id);
              model.save(selected, picker.id, done.length + 1, [
                ...done,
                snapshot(s, model.activities),
              ]);
            },
          }))}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );
}

/** Titre de groupe en texte + une carte plate : plus de carte dans une carte. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="eyebrow">{title}</div>
      <div className="card">{children}</div>
    </div>
  );
}

function StepBtn({
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
      className="flex h-tap w-9 items-center justify-center rounded-xl border border-line text-lg text-ink-2 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function UndoGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10H9" />
    </svg>
  );
}

/**
 * Jauge de séries : une barre par séance attendue, remplie pour celles faites.
 * « 0/2 SÉANCES CETTE SEMAINE » en capitales pâles ne se lisait pas d'un œil.
 */
function SeriesGauge({ done, target }: { done: number; target: number }) {
  if (target <= 0 || target > 10) {
    const pct = target > 0 ? Math.min(100, (done / target) * 100) : done > 0 ? 100 : 0;
    return (
      <span className="block h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
        <span className="block h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
      </span>
    );
  }
  return (
    <span className="flex shrink-0 gap-1" aria-hidden="true">
      {Array.from({ length: target }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 w-4 rounded-full ${i < done ? "bg-brand-600" : "bg-surface-2"}`}
        />
      ))}
    </span>
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

/**
 * Objectif de sport : le nom prime, l'action se dit « Démarrer ». Avant, un
 * bouton « + Séance Musculation » plus large que le nom répétait à droite un
 * mot déjà écrit à gauche.
 */
function SportRow({
  model,
  goal,
  date,
  editable,
  last,
  onPickSession,
}: {
  model: Model;
  goal: WellnessGoal;
  date: string;
  editable: boolean;
  last: boolean;
  onPickSession: () => void;
}) {
  const done = model.logged(date, goal.id);
  const total = model.periodTotal(goal, date);
  const target = goal.target ?? 0;
  const session = model.sessions.find((s) => s.id === goal.sessionId) ?? null;
  // Une séance vide ne peut pas être démarrée : il n'y aurait rien à compter.
  const blocked = session !== null && session.items.length === 0;
  const noSession = session === null && model.sessions.length === 0;

  const start = () => {
    if (session) model.save(date, goal.id, done.length + 1, [...done, snapshot(session, model.activities)]);
    else onPickSession();
  };

  return (
    <div className={last ? "" : "border-b border-hairline"}>
      <div className="flex items-center gap-3 py-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium">
            {goal.emoji} {goal.name}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <SeriesGauge done={total} target={target} />
            <span className="text-xs text-slate-400">
              {total} sur {target} {scopeLabel(goal.period)}
            </span>
          </span>
        </span>
        <button
          type="button"
          disabled={!editable || blocked || noSession}
          onClick={start}
          className="btn-primary shrink-0 disabled:opacity-40"
        >
          Démarrer
        </button>
      </div>

      {blocked && (
        <div className="mb-3 flex flex-col gap-2 rounded-xl bg-warning-soft px-3 py-2">
          <span className="text-xs text-warning">
            Aucune activité — la séance « {session?.name} » ne peut pas être démarrée.
          </span>
        </div>
      )}
      {noSession && (
        <div className="mb-3 rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning">
          Aucune séance créée — ouvre l'onglet Séances pour en ajouter une.
        </div>
      )}

      {done.length > 0 && (
        <div className="mb-3 flex flex-col gap-2">
          {done.map((s, i) => (
            <LoggedSessionRow
              key={i}
              session={s}
              editable={editable}
              onChange={(next) =>
                model.save(date, goal.id, done.length, done.map((x, j) => (j === i ? next : x)))
              }
              onRemove={() => {
                const next = done.filter((_, j) => j !== i);
                model.save(date, goal.id, next.length, next);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Séance réalisée : son total, et un « ⋯ » pour l'ajuster ou la retirer. */
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
  const totals = session.items
    .map((it) => {
      const total = it.amount * session.series;
      const secs = ACTIVITY_UNIT_META[it.unit].seconds;
      return secs
        ? `${fmtDuration(total * secs)} de ${it.name.toLowerCase()}`
        : `${total} ${it.name.toLowerCase()}`;
    })
    .join(" · ");

  return (
    <div className="rounded-xl bg-brand-50 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {session.emoji} {session.name}
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-2">
            {session.series} série{session.series > 1 ? "s" : ""}
            {totals && ` · ${totals}`}
          </span>
        </span>
        <OverflowMenu
          items={[
            { label: open ? "Masquer les valeurs" : "Ajuster les valeurs", onClick: () => setOpen((o) => !o) },
            { label: "Retirer cette séance", danger: true, onClick: onRemove },
          ].filter(() => editable)}
        />
      </div>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <SheetNumber
            label="Séries"
            value={session.series}
            min={1}
            onChange={(v) => onChange({ ...session, series: Math.max(1, v) })}
          />
          {session.items.map((it, i) => (
            <SheetNumber
              key={i}
              label={`${it.icon} ${it.name}`}
              suffix={ACTIVITY_UNIT_META[it.unit].short}
              value={it.amount}
              onChange={(v) =>
                onChange({
                  ...session,
                  items: session.items.map((x, j) => (j === i ? { ...x, amount: Math.max(0, v) } : x)),
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Compteur : trois cibles de 44 px, « + » vert, « − » grisé à zéro, et la
 * limite écrite en clair sous le nom au lieu d'un « MAX 2 » en capitales.
 */
function CounterRow({
  model,
  goal,
  date,
  editable,
  last,
}: {
  model: Model;
  goal: WellnessGoal;
  date: string;
  editable: boolean;
  last: boolean;
}) {
  const v = model.value(date, goal.id);
  const total = model.periodTotal(goal, date);
  const target = goal.target ?? 0;
  const over = goal.kind === "max" && total > target;
  const reached = goal.kind === "min" && total >= target;

  return (
    <div className={last ? "" : "border-b border-hairline"}>
      <div className="flex items-center gap-3 py-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium">
            {goal.emoji} {goal.name}
          </span>
          <span
            className={`mt-0.5 block text-xs ${
              over ? "text-danger" : reached ? "text-brand-600" : "text-slate-400"
            }`}
          >
            {total} {scopeLabel(goal.period)} · {target} au{" "}
            {goal.kind === "max" ? "maximum" : "minimum"}
          </span>
        </span>
        <Stepper
          value={v}
          disabled={!editable}
          onChange={(n) => model.save(date, goal.id, n)}
        />
      </div>
    </div>
  );
}

function Stepper({
  value,
  onChange,
  disabled = false,
  min = 0,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  min?: number;
}) {
  const tap = "flex h-tap w-tap shrink-0 items-center justify-center";
  const pill = "flex h-[34px] w-[34px] items-center justify-center rounded-full text-xl leading-none";
  const atMin = value <= min;
  return (
    <span className="flex shrink-0 items-center">
      <button
        type="button"
        disabled={disabled || atMin}
        onClick={() => onChange(value - 1)}
        aria-label="Retirer"
        className={tap}
      >
        <span className={`${pill} bg-surface-2 text-ink-2 ${atMin ? "opacity-40" : ""}`}>−</span>
      </button>
      <span className="w-6 text-center text-lg font-semibold">{value}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(value + 1)}
        aria-label="Ajouter"
        className={tap}
      >
        <span className={`${pill} bg-brand-600 text-on-brand ${disabled ? "opacity-40" : ""}`}>+</span>
      </button>
    </span>
  );
}

/**
 * Habitude : une case à cocher. Un mot vert « OK » aligné à droite ne se
 * touchait pas — on ne pouvait donc pas se corriger.
 */
function HabitRow({
  model,
  goal,
  date,
  editable,
  last,
}: {
  model: Model;
  goal: WellnessGoal;
  date: string;
  editable: boolean;
  last: boolean;
}) {
  const did = model.value(date, goal.id) > 0;
  // « À faire » : tenu quand c'est fait. « À éviter » : tenu quand ça ne l'est pas.
  const held = goal.kind === "todo" ? did : !did;
  const status = goal.kind === "todo" ? (held ? "tenu" : "à faire") : held ? "tenu" : "raté";

  return (
    <div className={last ? "" : "border-b border-hairline"}>
      <div className="flex min-h-[56px] items-center gap-3">
        <Checkbox
          size="lg"
          checked={held}
          onChange={() => editable && model.save(date, goal.id, did ? 0 : 1)}
        />
        <button
          type="button"
          disabled={!editable}
          onClick={() => model.save(date, goal.id, did ? 0 : 1)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span
            className={`min-w-0 flex-1 truncate text-base ${
              held ? "text-ink-2 line-through" : "font-medium"
            }`}
          >
            {goal.emoji} {goal.name}
          </span>
          <span className={`shrink-0 text-xs ${status === "raté" ? "text-danger" : "text-slate-400"}`}>
            {status}
          </span>
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Onglet Objectifs                                                    */
/* ------------------------------------------------------------------ */

/**
 * Familles d'objectifs, dans l'ordre d'affichage du quotidien. Le tri
 * personnalisé s'applique **à l'intérieur** d'une famille : c'est ce que
 * l'écran du quotidien montre.
 */
const GOAL_GROUPS = [
  { key: "sport", label: "Séances de sport" },
  { key: "periodCounters", label: "Quantités sur la semaine ou le mois" },
  { key: "dailyCounters", label: "Quantités du jour" },
  { key: "habits", label: "Habitudes quotidiennes" },
] as const;
type GoalGroupKey = (typeof GOAL_GROUPS)[number]["key"];

function splitGoals(goals: WellnessGoal[]): Record<GoalGroupKey, WellnessGoal[]> {
  const rest = goals.filter((g) => g.goalType !== "sport");
  const counters = rest.filter((g) => GOAL_KIND_META[g.kind].counter);
  return {
    sport: goals.filter((g) => g.goalType === "sport"),
    periodCounters: counters.filter((g) => g.period !== "daily"),
    dailyCounters: counters.filter((g) => g.period === "daily"),
    habits: rest.filter((g) => !GOAL_KIND_META[g.kind].counter),
  };
}

/** « tous les jours » · « du lundi au vendredi » · « lun, mer, ven ». */
function daysLabel(days: number[] | null): string {
  const list = days ?? [];
  if (list.length === 0 || list.length === 7) return "tous les jours";
  // Ordre d'affichage lundi → dimanche, pas l'ordre des index JS.
  const idx = WEEK_DAYS.map((wd, i) => (list.includes(wd.value) ? i : -1)).filter((i) => i >= 0);
  const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  if (contiguous && idx.length > 2)
    return `du ${WEEK_DAYS[idx[0]].long} au ${WEEK_DAYS[idx[idx.length - 1]].long}`;
  return idx.map((i) => WEEK_DAYS[i].long.slice(0, 3)).join(", ");
}

/**
 * Ce que fait l'objectif, en une phrase. « HEBDOMADAIRE · MIN 2 » sur deux
 * lignes de capitales espacées demandait une gymnastique mentale à chaque ligne.
 */
function goalSentence(g: WellnessGoal, sessions: WellnessSession[]): string {
  const per = `par ${GOAL_PERIOD_META[g.period].short}`;
  const days = daysLabel(g.days);
  if (g.goalType === "sport") {
    const s = sessions.find((x) => x.id === g.sessionId);
    const n = g.target ?? 0;
    return `${n} séance${n > 1 ? "s" : ""} ${per} · ${s ? `séance ${s.name}` : "aucune séance associée"}`;
  }
  if (GOAL_KIND_META[g.kind].counter) {
    const n = g.target ?? 0;
    const limit = `${n} au ${g.kind === "max" ? "maximum" : "minimum"} ${per}`;
    return days === "tous les jours" ? limit : `${limit} · ${days}`;
  }
  return `${g.kind === "todo" ? "à faire" : "à éviter"} · ${days}`;
}

type GoalNature = "sport" | "quantity" | "habit";

const natureOf = (g: { goalType: GoalType; kind: GoalKind }): GoalNature =>
  g.goalType === "sport" ? "sport" : GOAL_KIND_META[g.kind].counter ? "quantity" : "habit";

type GoalDraft = {
  nature: GoalNature;
  name: string;
  emoji: string;
  period: GoalPeriod;
  kind: GoalKind;
  target: number;
  sessionId: string | null;
  days: number[];
};

const emptyGoal = (sessions: WellnessSession[]): GoalDraft => ({
  nature: "sport",
  name: "",
  emoji: "🎯",
  period: "weekly",
  kind: "min",
  target: 2,
  sessionId: sessions[0]?.id ?? null,
  days: [],
});

const toDraft = (g: WellnessGoal): GoalDraft => ({
  nature: natureOf(g),
  name: g.name,
  emoji: g.emoji,
  period: g.period,
  kind: g.kind,
  target: g.target ?? 1,
  sessionId: g.sessionId,
  days: g.days ?? [],
});

const normDays = (days: number[]) => (days.length > 0 && days.length < 7 ? days : null);

function toGoalBody(d: GoalDraft, sessions: WellnessSession[]) {
  if (d.nature === "sport") {
    // Le nom et l'emoji viennent de la séance : les redemander ferait saisir
    // deux fois la même chose (et permettrait de les faire diverger).
    const s = sessions.find((x) => x.id === d.sessionId) ?? null;
    return {
      name: s?.name ?? "Séance",
      emoji: s?.emoji ?? "🏋️",
      period: d.period,
      kind: "min" as GoalKind,
      target: Math.max(1, d.target),
      goalType: "sport" as GoalType,
      sessionId: d.sessionId,
      days: normDays(d.days),
    };
  }
  const habit = d.nature === "habit";
  return {
    name: d.name.trim(),
    emoji: d.emoji || "🎯",
    period: habit ? ("daily" as GoalPeriod) : d.period,
    kind: habit ? d.kind : (d.kind === "min" ? "min" : "max") as GoalKind,
    target: habit ? null : Math.max(0, d.target),
    goalType: "simple" as GoalType,
    sessionId: null,
    days: normDays(d.days),
  };
}

function GoalsTab({ model }: { model: Model }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<WellnessGoal | "new" | null>(null);
  const [order, setOrder] = useState<WellnessGoal[]>(model.goals);
  useEffect(() => setOrder(model.goals), [model.goals]);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["wellness-config", model.member] });

  const create = useMutation({
    mutationFn: (d: GoalDraft) =>
      api.post(`/api/sport/${model.member}/goals`, toGoalBody(d, model.sessions)),
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
  });
  const update = useMutation({
    mutationFn: (v: { id: string; draft: GoalDraft }) =>
      api.patch(`/api/sport/${model.member}/goals/${v.id}`, toGoalBody(v.draft, model.sessions)),
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

  const groups = useMemo(() => {
    const split = splitGoals(order);
    return GOAL_GROUPS.map((g) => ({ ...g, items: split[g.key] })).filter((g) => g.items.length > 0);
  }, [order]);

  // Le tri se fait DANS une famille : on recompose ensuite l'ordre global.
  const commit = (key: GoalGroupKey, items: WellnessGoal[]) => {
    setOrder((prev) => {
      const split = splitGoals(prev);
      const next = GOAL_GROUPS.flatMap((g) => (g.key === key ? items : split[g.key]));
      reorder.mutate(next.map((g) => g.id));
      return next;
    });
  };

  return (
    <>
      <div className="flex flex-col gap-5">
        {order.length === 0 ? (
          <div className="card">
            <div className="text-sm text-ink-2">Aucun objectif pour l'instant.</div>
            <button type="button" onClick={() => setEditing("new")} className="btn-primary mt-3">
              Créer le premier
            </button>
          </div>
        ) : (
          groups.map(({ key, label, items }) => (
            <ReorderableGroup
              key={key}
              title={label}
              ids={items.map((g) => g.id)}
              onReorder={(ids) =>
                commit(key, ids.flatMap((id) => items.filter((g) => g.id === id)))
              }
            >
              {items.map((g, i) => (
                <SortableLine
                  key={g.id}
                  id={g.id}
                  canEdit={model.canEdit}
                  last={i === items.length - 1}
                  actions={[
                    { label: "Modifier l'objectif", onClick: () => setEditing(g) },
                    {
                      label: "Dupliquer l'objectif",
                      onClick: () => create.mutate({ ...toDraft(g), name: `${g.name} (copie)` }),
                    },
                    ...(i > 0
                      ? [{ label: "Déplacer vers le haut", onClick: () => commit(key, arrayMove(items, i, i - 1)) }]
                      : []),
                    ...(i < items.length - 1
                      ? [{ label: "Déplacer vers le bas", onClick: () => commit(key, arrayMove(items, i, i + 1)) }]
                      : []),
                    {
                      label: "Supprimer l'objectif",
                      danger: true,
                      onClick: () => remove.mutate(g.id),
                    },
                  ]}
                >
                  <span className="block truncate text-base font-medium">
                    {g.emoji} {g.name}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-400">
                    {goalSentence(g, model.sessions)}
                  </span>
                </SortableLine>
              ))}
            </ReorderableGroup>
          ))
        )}

        {model.canEdit && order.length > 0 && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="btn-primary hidden self-start md:inline-flex"
          >
            Nouvel objectif
          </button>
        )}
      </div>

      {model.canEdit && <MobileActionBar label="Nouvel objectif" onClick={() => setEditing("new")} />}

      {editing && (
        <GoalSheet
          model={model}
          initial={editing === "new" ? emptyGoal(model.sessions) : toDraft(editing)}
          isNew={editing === "new"}
          pending={create.isPending || update.isPending}
          onClose={() => setEditing(null)}
          onSubmit={(d) =>
            editing === "new" ? create.mutate(d) : update.mutate({ id: editing.id, draft: d })
          }
        />
      )}
    </>
  );
}

/**
 * Formulaire d'objectif : la **nature** d'abord, le reste s'adapte. La case
 * « Objectif de sport (associé à une séance) » était en bas, après la
 * périodicité et la nature — on remplissait donc le formulaire avant de
 * découvrir qu'il changeait de forme.
 */
function GoalSheet({
  model,
  initial,
  isNew,
  pending,
  onSubmit,
  onClose,
}: {
  model: Model;
  initial: GoalDraft;
  isNew: boolean;
  pending: boolean;
  onSubmit: (d: GoalDraft) => void;
  onClose: () => void;
}) {
  const [d, setD] = useState<GoalDraft>(initial);
  const [daysOpen, setDaysOpen] = useState((initial.days.length > 0 && initial.days.length < 7));
  const set = <K extends keyof GoalDraft>(k: K, v: GoalDraft[K]) => setD((p) => ({ ...p, [k]: v }));

  const chooseNature = (nature: GoalNature) =>
    setD((p) => ({
      ...p,
      nature,
      // Chaque nature a sa forme par défaut : on ne garde pas une périodicité
      // ou une cible qui n'a plus de sens.
      period: nature === "habit" ? "daily" : nature === "sport" ? "weekly" : p.period,
      kind: nature === "habit" ? (GOAL_KIND_META[p.kind].counter ? "todo" : p.kind) : nature === "sport" ? "min" : GOAL_KIND_META[p.kind].counter ? p.kind : "max",
      target: nature === "sport" ? Math.max(1, p.target) : p.target,
      sessionId: nature === "sport" ? (p.sessionId ?? model.sessions[0]?.id ?? null) : null,
    }));

  const valid =
    d.nature === "sport" ? !!d.sessionId : d.name.trim() !== "";

  return (
    <Sheet
      title={isNew ? "Nouvel objectif" : "Modifier l'objectif"}
      onClose={onClose}
      footer={
        <button
          type="button"
          disabled={!valid || pending}
          onClick={() => onSubmit(d)}
          className="btn-primary w-full justify-center disabled:opacity-40"
        >
          {pending ? "Enregistrement…" : isNew ? "Créer l'objectif" : "Enregistrer"}
        </button>
      }
    >
      <div className="flex flex-col gap-5 p-4">
        <Field label="De quel genre d'objectif s'agit-il ?">
          <div className="flex flex-col gap-2">
            <NatureOption
              active={d.nature === "sport"}
              label="Faire une séance de sport"
              hint="se coche en démarrant la séance"
              onClick={() => chooseNature("sport")}
            />
            <NatureOption
              active={d.nature === "quantity"}
              label="Compter une quantité"
              hint="boissons, desserts…"
              onClick={() => chooseNature("quantity")}
            />
            <NatureOption
              active={d.nature === "habit"}
              label="Tenir une habitude"
              hint="à faire ou à éviter, chaque jour"
              onClick={() => chooseNature("habit")}
            />
          </div>
        </Field>

        {d.nature === "sport" ? (
          <Field label="Quelle séance ?">
            {model.sessions.length === 0 ? (
              <div className="rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning">
                Aucune séance créée — ouvre l'onglet Séances pour en ajouter une.
              </div>
            ) : (
              <Pills
                value={d.sessionId ?? ""}
                onChange={(v) => set("sessionId", v)}
                items={model.sessions.map((s) => ({ value: s.id, label: `${s.emoji} ${s.name}` }))}
              />
            )}
          </Field>
        ) : (
          <EmojiNameRow
            emoji={d.emoji}
            onEmoji={(v) => set("emoji", v)}
            name={d.name}
            onName={(v) => set("name", v)}
            label={d.nature === "habit" ? "Nom de l'habitude" : "Nom de la quantité"}
            placeholder={d.nature === "habit" ? "Couché avant 23 h, Grignotage…" : "Boissons, Desserts…"}
            groups={GOAL_EMOJI_GROUPS}
          />
        )}

        {d.nature === "habit" && (
          <Field label="Il s'agit de…">
            <Pills
              value={d.kind}
              onChange={(v) => set("kind", v as GoalKind)}
              items={[
                { value: "todo", label: "À faire" },
                { value: "nottodo", label: "À éviter" },
              ]}
            />
          </Field>
        )}

        {d.nature === "quantity" && (
          <Field label="Cette quantité est…">
            <Pills
              value={d.kind}
              onChange={(v) => set("kind", v as GoalKind)}
              items={[
                { value: "max", label: "À ne pas dépasser" },
                { value: "min", label: "À atteindre" },
              ]}
            />
          </Field>
        )}

        {d.nature !== "habit" && (
          <>
            <Field
              label={
                d.nature === "sport"
                  ? "Combien de fois ?"
                  : d.kind === "max"
                    ? "Combien au maximum ?"
                    : "Combien au minimum ?"
              }
              hint={`par ${GOAL_PERIOD_META[d.period].short}`}
            >
              <div className="flex items-center justify-between gap-3">
                <Stepper
                  value={d.target}
                  min={d.nature === "sport" ? 1 : 0}
                  onChange={(v) => set("target", v)}
                />
                <Pills
                  value={d.period}
                  onChange={(v) => set("period", v as GoalPeriod)}
                  items={[
                    ...(d.nature === "quantity" ? [{ value: "daily", label: "par jour" }] : []),
                    { value: "weekly", label: "par semaine" },
                    { value: "monthly", label: "par mois" },
                  ]}
                />
              </div>
            </Field>
          </>
        )}

        {/* Jours imposés : replié par défaut, parce que « n'importe quel jour »
            est le cas courant. */}
        <div>
          <button
            type="button"
            onClick={() => setDaysOpen((o) => !o)}
            className="flex w-full items-center gap-3 text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Jours imposés</span>
              <span className="mt-0.5 block text-xs text-slate-400">
                {d.days.length === 0 || d.days.length === 7
                  ? "aucun — n'importe quel jour de la semaine"
                  : daysLabel(d.days)}
              </span>
            </span>
            <span className="shrink-0 text-slate-400">{daysOpen ? "▾" : "›"}</span>
          </button>
          {daysOpen && (
            <div className="mt-2 flex gap-1.5">
              {WEEK_DAYS.map((wd) => {
                const on = d.days.includes(wd.value);
                return (
                  <button
                    key={wd.value}
                    type="button"
                    aria-label={wd.long}
                    aria-pressed={on}
                    onClick={() =>
                      set("days", on ? d.days.filter((x) => x !== wd.value) : [...d.days, wd.value])
                    }
                    className={`h-10 flex-1 rounded-xl text-sm font-medium ${
                      on ? "bg-brand-600 text-on-brand" : "bg-surface-2 text-ink-2"
                    }`}
                  >
                    {wd.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}

/** Choix de nature : un pavé par genre, avec ce qu'il implique sous le libellé. */
function NatureOption({
  active,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-h-tap items-center gap-3 rounded-xl border px-3 py-2.5 text-left ${
        active ? "border-brand-600 bg-brand-50" : "border-line hover:bg-surface-2"
      }`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
          active ? "border-brand-600 bg-brand-600 text-on-brand" : "border-line"
        }`}
      >
        {active && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="h-3 w-3">
            <path d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-base font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-slate-400">{hint}</span>
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Onglet Séances (séances + activités)                                */
/* ------------------------------------------------------------------ */

type SessionDraft = {
  name: string;
  emoji: string;
  series: number;
  items: { activityId: string; amount: number }[];
};

type ActivityDraft = { name: string; icon: string; unit: ActivityUnit };

/** Quantité proposée par défaut selon l'unité de l'activité. */
const defaultAmount = (a: WellnessActivity | null) => (!a || a.unit === "reps" ? 10 : 30);

function SessionsTab({ model }: { model: Model }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<WellnessSession | "new" | null>(null);
  const [activity, setActivity] = useState<WellnessActivity | "new" | null>(null);
  const [order, setOrder] = useState<WellnessActivity[]>(model.activities);
  useEffect(() => setOrder(model.activities), [model.activities]);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["wellness-config", model.member] });

  const saveSession = useMutation({
    mutationFn: (v: { id: string | null; draft: SessionDraft }) =>
      v.id
        ? api.patch(`/api/sport/${model.member}/sessions/${v.id}`, v.draft)
        : api.post(`/api/sport/${model.member}/sessions`, v.draft),
    onSuccess: () => {
      invalidate();
      setSession(null);
    },
  });
  const removeSession = useMutation({
    mutationFn: (id: string) => api.del(`/api/sport/${model.member}/sessions/${id}`),
    onSuccess: invalidate,
  });

  const saveActivity = useMutation({
    mutationFn: (v: { id: string | null; draft: ActivityDraft }) =>
      v.id
        ? api.patch(`/api/sport/${model.member}/activities/${v.id}`, v.draft)
        : api.post(`/api/sport/${model.member}/activities`, v.draft),
    onSuccess: () => {
      invalidate();
      setActivity(null);
    },
  });
  const removeActivity = useMutation({
    mutationFn: (id: string) => api.del(`/api/sport/${model.member}/activities/${id}`),
    onSuccess: invalidate,
  });
  const reorderActivities = useMutation({
    mutationFn: (orderedIds: string[]) =>
      api.put(`/api/sport/${model.member}/activities/reorder`, { orderedIds }),
    onSuccess: invalidate,
  });

  const commitOrder = (next: WellnessActivity[]) => {
    setOrder(next);
    reorderActivities.mutate(next.map((a) => a.id));
  };

  return (
    <>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="eyebrow">Mes séances</div>
          {model.sessions.length === 0 ? (
            <div className="card">
              <div className="text-sm text-ink-2">Aucune séance pour l'instant.</div>
              <div className="mt-1 text-xs text-slate-400">
                Une séance = un nombre de séries et une liste d'activités.
              </div>
              <button type="button" onClick={() => setSession("new")} className="btn-primary mt-3">
                Créer la première
              </button>
            </div>
          ) : (
            <div className="card">
              {model.sessions.map((s, i) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  activities={model.activities}
                  last={i === model.sessions.length - 1}
                  canEdit={model.canEdit}
                  onEdit={() => setSession(s)}
                  onDuplicate={() =>
                    saveSession.mutate({
                      id: null,
                      draft: {
                        name: `${s.name} (copie)`,
                        emoji: s.emoji,
                        series: s.series,
                        items: s.items,
                      },
                    })
                  }
                  onRemove={() => removeSession.mutate(s.id)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <div className="eyebrow">Mes activités</div>
            {order.length > 1 && (
              <span className="text-xs text-slate-400">glisser pour réordonner</span>
            )}
          </div>
          <div className="card">
            {order.length === 0 ? (
              <div className="py-1 text-sm text-ink-2">
                Une activité = un nom, un emoji et une mesure (répétitions ou temps).
              </div>
            ) : (
              <ReorderableList
                ids={order.map((a) => a.id)}
                onReorder={(ids) => commitOrder(ids.flatMap((id) => order.filter((a) => a.id === id)))}
              >
                {order.map((a, i) => (
                  <SortableLine
                    key={a.id}
                    id={a.id}
                    canEdit={model.canEdit}
                    last={i === order.length - 1}
                    actions={[
                      { label: "Modifier l'activité", onClick: () => setActivity(a) },
                      {
                        label: "Dupliquer l'activité",
                        onClick: () =>
                          saveActivity.mutate({
                            id: null,
                            draft: { name: `${a.name} (copie)`, icon: a.icon, unit: a.unit },
                          }),
                      },
                      ...(i > 0
                        ? [{ label: "Déplacer vers le haut", onClick: () => commitOrder(arrayMove(order, i, i - 1)) }]
                        : []),
                      ...(i < order.length - 1
                        ? [{ label: "Déplacer vers le bas", onClick: () => commitOrder(arrayMove(order, i, i + 1)) }]
                        : []),
                      {
                        label: "Supprimer l'activité",
                        danger: true,
                        onClick: () => removeActivity.mutate(a.id),
                      },
                    ]}
                    trailing={
                      <span className="shrink-0 text-xs text-slate-400">
                        {ACTIVITY_UNIT_META[a.unit].label.toLowerCase()}
                      </span>
                    }
                  >
                    <span className="block truncate text-base font-medium">
                      {a.icon} {a.name}
                    </span>
                  </SortableLine>
                ))}
              </ReorderableList>
            )}
            {model.canEdit && (
              <button
                type="button"
                onClick={() => setActivity("new")}
                className="flex min-h-tap w-full items-center gap-2 border-t border-hairline pt-2 text-left text-sm font-medium text-brand-600"
              >
                <PlusGlyph /> Nouvelle activité
              </button>
            )}
          </div>
        </div>

        {model.canEdit && model.sessions.length > 0 && (
          <button
            type="button"
            onClick={() => setSession("new")}
            className="btn-primary hidden self-start md:inline-flex"
          >
            Nouvelle séance
          </button>
        )}
      </div>

      {model.canEdit && <MobileActionBar label="Nouvelle séance" onClick={() => setSession("new")} />}

      {session && (
        <SessionSheet
          model={model}
          isNew={session === "new"}
          initial={
            session === "new"
              ? { name: "", emoji: "🏋️", series: 3, items: [] }
              : { name: session.name, emoji: session.emoji, series: session.series, items: session.items }
          }
          pending={saveSession.isPending}
          onClose={() => setSession(null)}
          onSubmit={(d) => saveSession.mutate({ id: session === "new" ? null : session.id, draft: d })}
          onNewActivity={() => setActivity("new")}
        />
      )}

      {activity && (
        <ActivitySheet
          isNew={activity === "new"}
          initial={
            activity === "new"
              ? { name: "", icon: "💪", unit: "reps" }
              : { name: activity.name, icon: activity.icon, unit: activity.unit }
          }
          pending={saveActivity.isPending}
          onClose={() => setActivity(null)}
          onSubmit={(d) => saveActivity.mutate({ id: activity === "new" ? null : activity.id, draft: d })}
        />
      )}
    </>
  );
}

/**
 * Ligne d'une séance : ses activités par série, puis le **total réel** de la
 * séance complète. Une séance vide est signalée en ambre : elle n'est pas
 * neutre, elle est inutilisable.
 */
function SessionRow({
  session: s,
  activities,
  last,
  canEdit,
  onEdit,
  onDuplicate,
  onRemove,
}: {
  session: WellnessSession;
  activities: WellnessActivity[];
  last: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const empty = s.items.length === 0;
  return (
    <div className={last ? "" : "border-b border-hairline"}>
      <div className="flex items-start gap-3 py-3">
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 truncate text-base font-medium">
              {s.emoji} {s.name}
            </span>
            <span className="shrink-0 text-xs text-slate-400">
              {s.series} série{s.series > 1 ? "s" : ""}
            </span>
          </span>

          {empty ? (
            <span className="mt-2 flex flex-col items-start gap-2 rounded-xl bg-warning-soft px-3 py-2">
              <span className="text-xs text-warning">
                Aucune activité — la séance ne peut pas être démarrée.
              </span>
              <button
                type="button"
                onClick={onEdit}
                className="flex min-h-9 items-center gap-1.5 text-sm font-medium text-brand-600"
              >
                <PlusGlyph /> Ajouter une activité
              </button>
            </span>
          ) : (
            <>
              <span className="mt-2 flex flex-wrap gap-1.5">
                {s.items.map((it) => {
                  const a = activities.find((x) => x.id === it.activityId);
                  if (!a) return null;
                  return (
                    <span
                      key={it.activityId}
                      className="rounded-full bg-surface-2 px-2 py-1 text-xs text-ink-2"
                    >
                      {a.icon} {a.name} · {amountLabel(a.unit, it.amount)}
                    </span>
                  );
                })}
              </span>
              <span className="mt-2 block text-xs text-slate-400">
                soit {sessionTotalLabel(s, activities)} sur la séance complète
              </span>
            </>
          )}
        </span>
        <OverflowMenu
          items={
            canEdit
              ? [
                  { label: "Modifier la séance", onClick: onEdit },
                  { label: "Dupliquer la séance", onClick: onDuplicate },
                  { label: "Supprimer la séance", danger: true, onClick: onRemove },
                ]
              : []
          }
        />
      </div>
    </div>
  );
}

/**
 * Formulaire d'une séance. La valeur saisie est celle **d'une série** — le
 * total de la séance est calculé et affiché sous la liste, pour qu'on ne se
 * demande plus lequel des deux chiffres on lit.
 */
function SessionSheet({
  model,
  initial,
  isNew,
  pending,
  onSubmit,
  onClose,
  onNewActivity,
}: {
  model: Model;
  initial: SessionDraft;
  isNew: boolean;
  pending: boolean;
  onSubmit: (d: SessionDraft) => void;
  onClose: () => void;
  onNewActivity: () => void;
}) {
  const [d, setD] = useState<SessionDraft>(initial);
  const [adding, setAdding] = useState(false);
  const set = <K extends keyof SessionDraft>(k: K, v: SessionDraft[K]) =>
    setD((p) => ({ ...p, [k]: v }));

  const available = model.activities.filter((a) => !d.items.some((it) => it.activityId === a.id));
  const totals = sessionTotalLabel(d, model.activities);

  return (
    <Sheet
      title={isNew ? "Nouvelle séance" : "Modifier la séance"}
      onClose={onClose}
      footer={
        <button
          type="button"
          disabled={d.name.trim() === "" || pending}
          onClick={() => onSubmit({ ...d, name: d.name.trim() })}
          className="btn-primary w-full justify-center disabled:opacity-40"
        >
          {pending ? "Enregistrement…" : isNew ? "Créer la séance" : "Enregistrer"}
        </button>
      }
    >
      <div className="flex flex-col gap-5 p-4">
        <EmojiNameRow
          emoji={d.emoji}
          onEmoji={(v) => set("emoji", v)}
          name={d.name}
          onName={(v) => set("name", v)}
          label="Nom de la séance"
          placeholder="Haut du corps, Séance type…"
          groups={ACTIVITY_EMOJI_GROUPS}
        />

        <Field label="Nombre de séries" hint="la liste est répétée à chaque série">
          <Stepper value={d.series} min={1} onChange={(v) => set("series", v)} />
        </Field>

        <div>
          <div className="eyebrow">Activités par série</div>
          <div className="mt-2 flex flex-col divide-y divide-hairline">
            {d.items.map((it, i) => {
              const a = model.activities.find((x) => x.id === it.activityId);
              if (!a) return null;
              return (
                <div key={it.activityId} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate text-base">
                    {a.icon} {a.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="block w-[4.5rem] shrink-0">
                      <Input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={it.amount}
                        aria-label={`Quantité de ${a.name} par série`}
                        onChange={(e) =>
                          set(
                            "items",
                            d.items.map((x, j) =>
                              j === i ? { ...x, amount: Math.max(0, Number(e.target.value) || 0) } : x,
                            ),
                          )
                        }
                        className="text-center"
                      />
                    </span>
                    <span className="w-8 text-xs text-slate-400">
                      {ACTIVITY_UNIT_META[a.unit].short}
                    </span>
                  </span>
                  <OverflowMenu
                    items={[
                      {
                        label: "Retirer de la séance",
                        danger: true,
                        onClick: () => set("items", d.items.filter((_, j) => j !== i)),
                      },
                    ]}
                  />
                </div>
              );
            })}
          </div>

          {adding ? (
            <div className="mt-2 flex flex-col gap-2 rounded-xl bg-surface-2 p-2">
              {available.length === 0 ? (
                <div className="px-1 py-1 text-xs text-slate-400">
                  Toutes tes activités sont déjà dans la séance.
                </div>
              ) : (
                available.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      set("items", [...d.items, { activityId: a.id, amount: defaultAmount(a) }]);
                      setAdding(false);
                    }}
                    className="flex min-h-tap items-center gap-2 rounded-lg px-2 text-left text-base hover:bg-surface"
                  >
                    <span>{a.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{a.name}</span>
                    <span className="shrink-0 text-xs text-slate-400">
                      {ACTIVITY_UNIT_META[a.unit].label.toLowerCase()}
                    </span>
                  </button>
                ))
              )}
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  onNewActivity();
                }}
                className="flex min-h-tap items-center gap-1.5 rounded-lg px-2 text-left text-sm font-medium text-brand-600"
              >
                <PlusGlyph /> Créer une activité
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-2 flex min-h-tap items-center gap-1.5 text-sm font-medium text-brand-600"
            >
              <PlusGlyph /> Ajouter une activité
            </button>
          )}

          {totals && (
            <div className="mt-3 text-xs text-slate-400">Séance complète : {totals}</div>
          )}
        </div>
      </div>
    </Sheet>
  );
}

/**
 * Formulaire d'une activité. La mesure se choisit en un tap : quatre valeurs
 * n'ont pas besoin d'un menu déroulant qui les cache jusqu'à l'ouverture.
 */
function ActivitySheet({
  initial,
  isNew,
  pending,
  onSubmit,
  onClose,
}: {
  initial: ActivityDraft;
  isNew: boolean;
  pending: boolean;
  onSubmit: (d: ActivityDraft) => void;
  onClose: () => void;
}) {
  const [d, setD] = useState<ActivityDraft>(initial);
  const noun = d.name.trim() === "" ? "cette activité" : `« ${d.name.trim()} »`;

  return (
    <Sheet
      title={isNew ? "Nouvelle activité" : "Modifier l'activité"}
      onClose={onClose}
      footer={
        <button
          type="button"
          disabled={d.name.trim() === "" || pending}
          onClick={() => onSubmit({ ...d, name: d.name.trim() })}
          className="btn-primary w-full justify-center disabled:opacity-40"
        >
          {pending ? "Enregistrement…" : isNew ? "Créer l'activité" : "Enregistrer"}
        </button>
      }
    >
      <div className="flex flex-col gap-5 p-4">
        <EmojiNameRow
          emoji={d.icon}
          onEmoji={(v) => setD((p) => ({ ...p, icon: v }))}
          name={d.name}
          onName={(v) => setD((p) => ({ ...p, name: v }))}
          label="Nom de l'activité"
          placeholder="Pompes, Gainage…"
          groups={ACTIVITY_EMOJI_GROUPS}
        />

        <Field label="Comment se mesure-t-elle ?">
          <div className="grid grid-cols-2 gap-2">
            {ACTIVITY_UNITS.map((u) => {
              const active = d.unit === u;
              return (
                <button
                  key={u}
                  type="button"
                  onClick={() => setD((p) => ({ ...p, unit: u }))}
                  aria-pressed={active}
                  className={`flex h-14 items-center justify-center rounded-xl border text-base font-medium ${
                    active
                      ? "border-brand-600 bg-brand-600 text-on-brand"
                      : "border-line text-ink-2 hover:bg-surface-2"
                  }`}
                >
                  {ACTIVITY_UNIT_META[u].label}
                </button>
              );
            })}
          </div>
          <div className="mt-2 text-xs text-slate-400">
            {noun} se comptera en {ACTIVITY_UNIT_META[d.unit].label.toLowerCase()} dans les séances
            et dans les totaux.
          </div>
        </Field>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Onglet Stats                                                        */
/* ------------------------------------------------------------------ */

function StatsView({
  model,
  selected,
  onSelectDate,
}: {
  model: Model;
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
  const failRates = checks
    .map((g) => {
      const applicable = weekDates.filter((d) => model.applicable(g, d) && model.entered(d));
      return {
        goal: g,
        fails: applicable.filter((d) => model.failing(g, d)).length,
        total: applicable.length,
      };
    })
    .filter((f) => f.total > 0);

  /* ---- sport ---- */
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
    <div className="flex flex-col gap-5">
      {/* Deux sections titrées, plus un segment qui cachait l'une des deux. */}
      <div className="flex flex-col gap-2">
        <div className="eyebrow">Journées</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatBox label="Série en cours" value={streak} sub="jours" />
          <StatBox label="Parfaites" value={perfect} color={GREEN} sub={`${pct(perfect)} %`} />
          <StatBox label="Presque" value={almost} color={WARN} sub={`${pct(almost)} %`} />
          <StatBox label="Ratées" value={failed} color={FAIL} sub={`${pct(failed)} %`} />
        </div>
      </div>

      {counters.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="eyebrow">Quantités en cours</div>
          <div className="card flex flex-col gap-3">
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
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="eyebrow">
          Habitudes ratées · {weekDates.length} jour{weekDates.length > 1 ? "s" : ""} cette semaine
        </div>
        <div className="card flex flex-col gap-3">
          {failRates.length === 0 ? (
            <div className="text-sm text-ink-2">Aucune donnée cette semaine.</div>
          ) : (
            failRates.map((f) => (
              <div key={f.goal.id}>
                <div className="mb-1 flex justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    {f.goal.emoji} {f.goal.name}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {Math.round((f.fails / f.total) * 100)} % · {f.fails}/{f.total} j
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(f.fails / f.total) * 100}%`, background: FAIL }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="eyebrow">Sport</div>
        <div className="grid grid-cols-3 gap-3">
          <StatBox label="Série" value={sportStreak} color={GREEN} sub="jours" />
          <StatBox label="Record" value={bestSport} sub="jours" />
          <StatBox label="Séances" value={totalSessions} sub={`${sportDates.length} j`} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="eyebrow">Totaux à vie</div>
        <div className="card">
          {totals.size === 0 ? (
            <div className="text-sm text-ink-2">Aucune séance enregistrée.</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[...totals.entries()].map(([name, t]) => (
                <TotalCard
                  key={name}
                  icon={t.icon}
                  label={name}
                  value={ACTIVITY_UNIT_META[t.unit].seconds ? fmtDuration(t.total) : `${t.total}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <CalendarView model={model} selected={selected} onSelect={onSelectDate} />
    </div>
  );
}

/* ---------------- Calendrier ---------------- */

function CalendarView({
  model,
  selected,
  onSelect,
}: {
  model: Model;
  selected: string;
  onSelect: (d: string) => void;
}) {
  const [cal, setCal] = useState(() => {
    const d = parseDate(selected);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  // Filtre de lecture du calendrier (ce qu'il colore), pas un niveau de menu.
  const [mode, setMode] = useState<"journees" | "seances">("journees");
  const sportGoals = model.goals.filter((g) => g.goalType === "sport");
  const sportCount = (d: string) => sportGoals.reduce((n, g) => n + model.logged(d, g.id).length, 0);

  const first = new Date(cal.year, cal.month, 1);
  const gridStart = startOfWeek(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = fmtDate(new Date());
  const wellnessBg = (s: DayStatus) =>
    s === "perfect" ? GREEN : s === "almost" ? WARN : s === "failed" ? FAIL : "transparent";

  return (
    <div className="flex flex-col gap-2">
      <div className="eyebrow">Calendrier</div>
      <div className="card">
        <div className="mb-3 flex items-center justify-between gap-3">
          <StepBtn
            label="Mois précédent"
            onClick={() =>
              setCal((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { ...c, month: c.month - 1 }))
            }
          >
            ‹
          </StepBtn>
          <div className="text-base font-medium capitalize">
            {MONTHS[cal.month]} {cal.year}
          </div>
          <StepBtn
            label="Mois suivant"
            onClick={() =>
              setCal((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { ...c, month: c.month + 1 }))
            }
          >
            ›
          </StepBtn>
        </div>

        <div className="mb-3">
          <Pills
            value={mode}
            onChange={(v) => setMode(v as "journees" | "seances")}
            items={[
              { value: "journees", label: "Journées" },
              { value: "seances", label: "Séances" },
            ]}
          />
        </div>

        <div className="mb-1 grid grid-cols-7 gap-1 text-center text-2xs text-ink-3">
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
            let fg = "rgb(var(--c-ink))";
            if (inMonth && st !== "future") {
              if (mode === "journees") {
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
                  color: inMonth ? fg : "rgb(var(--c-ink-3))",
                  border: ds === selected ? `2px solid ${VIOLET}` : "1px solid transparent",
                  fontWeight: ds === today ? 700 : 400,
                }}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
          {mode === "journees" ? (
            <>
              <Legend color={GREEN} label="Parfaite" />
              <Legend color={WARN} label="Presque" />
              <Legend color={FAIL} label="Ratée" />
              <Legend color="transparent" label="Non saisie" border />
            </>
          ) : (
            <>
              <Legend color={GREEN} label="Séance effectuée" />
              <Legend color="transparent" label="Aucune séance" border />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Primitives locales                                                  */
/* ------------------------------------------------------------------ */

/** Libellé d'un champ de feuille, avec sa conséquence en sous-titre. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="text-sm font-medium">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** Rangée de pastilles à choix unique (dans une feuille, sans débord d'écran). */
function Pills({
  value,
  onChange,
  items,
}: {
  value: string;
  onChange: (v: string) => void;
  items: { value: string; label: string }[];
}) {
  return (
    <div className="-mx-1 flex flex-wrap gap-2 px-1">
      {items.map((it) => {
        const active = value === it.value;
        return (
          <button
            key={it.value}
            type="button"
            onClick={() => onChange(it.value)}
            aria-pressed={active}
            className={`flex min-h-10 items-center rounded-full px-3.5 text-sm font-medium ${
              active ? "bg-brand-600 text-on-brand" : "border border-line text-ink-2 hover:bg-surface-2"
            }`}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/** Petit champ nombre étiqueté (ajustement d'une séance réalisée). */
function SheetNumber({
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
    <label className="flex items-center gap-2 text-sm">
      <span className="min-w-0 flex-1 truncate text-ink-2">{label}</span>
      <span className="block w-[4.5rem] shrink-0">
        <Input
          type="number"
          min={min}
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="text-center"
        />
      </span>
      {suffix && <span className="w-8 shrink-0 text-xs text-slate-400">{suffix}</span>}
    </label>
  );
}

/**
 * Ligne « emoji + nom ». Le sélecteur d'emoji s'ouvre **dans le flux**, sous la
 * ligne : en surimpression il était rogné par le défilement de la feuille.
 */
function EmojiNameRow({
  emoji,
  onEmoji,
  name,
  onName,
  label,
  placeholder,
  groups,
}: {
  emoji: string;
  onEmoji: (v: string) => void;
  name: string;
  onName: (v: string) => void;
  label: string;
  placeholder: string;
  groups: EmojiGroup[];
}) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) panel.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  return (
    <div>
      <div className="text-sm font-medium">{label}</div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Choisir un emoji"
          className={`flex h-[42px] w-14 shrink-0 items-center justify-center rounded-xl border text-xl ${
            open ? "border-brand-600" : "border-line"
          }`}
        >
          {emoji || "🎯"}
        </button>
        <Input
          autoFocus
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1"
        />
      </div>

      {open && (
        <div ref={panel} className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-line p-2">
          <div className="mb-2 flex items-center gap-2">
            <Input
              value={emoji}
              onChange={(e) => onEmoji(firstEmoji(e.target.value))}
              placeholder="Coller un autre emoji…"
              className="min-w-0 flex-1 text-center"
            />
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost shrink-0">
              Fermer
            </button>
          </div>
          {groups.map((g) => (
            <div key={g.label} className="mb-2">
              <div className="eyebrow mb-1">{g.label}</div>
              <div className="grid grid-cols-8 gap-1">
                {g.emojis.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => {
                      onEmoji(e);
                      setOpen(false);
                    }}
                    className={`rounded-lg py-1.5 text-lg hover:bg-surface-2 ${
                      emoji === e ? "bg-brand-50" : ""
                    }`}
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

function PlusGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-4 w-4 shrink-0" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/**
 * Liste réordonnable. Deux capteurs : glissement immédiat à la souris, appui
 * long au doigt — sans quoi le geste tactile entrerait en conflit avec le
 * défilement de la page.
 */
function ReorderableList({
  ids,
  onReorder,
  children,
}: {
  ids: string[];
  onReorder: (ids: string[]) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col">{children}</div>
      </SortableContext>
    </DndContext>
  );
}

/** Groupe titré contenant une liste réordonnable, dans une seule carte plate. */
function ReorderableGroup({
  title,
  ids,
  onReorder,
  children,
}: {
  title: string;
  ids: string[];
  onReorder: (ids: string[]) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="eyebrow">{title}</div>
      <div className="card">
        <ReorderableList ids={ids} onReorder={onReorder}>
          {children}
        </ReorderableList>
      </div>
    </div>
  );
}

/**
 * Ligne réordonnable : une poignée pour déplacer, un « ⋯ » pour tout le reste.
 * Avant, quatre icônes de 20 px alignées au ras du bord droit mettaient la
 * suppression aussi près du doigt que le réordonnancement — et déplacer une
 * ligne de trois rangs demandait quatre taps.
 */
function SortableLine({
  id,
  canEdit,
  last,
  actions,
  trailing,
  children,
}: {
  id: string;
  canEdit: boolean;
  last: boolean;
  actions: OverflowItem[];
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${last ? "" : "border-b border-hairline"} ${isDragging ? "opacity-60" : ""}`}
    >
      <div className="flex min-h-[56px] items-center gap-2">
        {canEdit && (
          <button
            {...attributes}
            {...listeners}
            aria-label="Déplacer"
            // `touch-none` : sans ça le navigateur happe le geste pour défiler.
            className="flex h-tap w-6 shrink-0 cursor-grab touch-none items-center justify-center text-ink-3"
          >
            ⠿
          </button>
        )}
        <span className="min-w-0 flex-1">{children}</span>
        {trailing}
        <OverflowMenu items={canEdit ? actions : []} />
      </div>
    </div>
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
    <div className="card text-center">
      <div className="truncate text-xs text-slate-400">{label}</div>
      <div className="mt-1 text-3xl font-semibold" style={color ? { color } : undefined}>
        {value}
      </div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function TotalCard({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="rounded-xl border border-line p-3 text-center">
      <div className="text-2xl">{icon}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      <div className="truncate text-xs text-slate-400">{label}</div>
    </div>
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
      <div className="mb-1 flex justify-between gap-2 text-sm">
        <span className="min-w-0 truncate">
          {label} · {value}/{target} par {scope}
        </span>
        <span className="shrink-0 text-xs text-slate-400">
          {higherIsBetter ? (value >= target ? "Atteint" : "En cours") : over ? "Dépassé" : "OK"}
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
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
        style={{ background: color, border: border ? "1px solid rgb(var(--c-line))" : "none" }}
      />
      {label}
    </span>
  );
}
