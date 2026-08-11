import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CalendarEvent } from "@gfa/shared";
import { api, ApiError, loginUrl } from "../lib/api";
import PageLoader from "../components/PageLoader";
import { dateFr } from "../lib/format";
import { Select, Checkbox, DateInput, Input, SubNav } from "../components/ui";

interface CalEntry {
  id: string;
  summary: string;
}

type View = "today" | "week" | "month";

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};
/** Monday=0 … Sunday=6 */
const isoDow = (d: Date) => (d.getDay() + 6) % 7;
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const sameDay = (a: Date, b: Date) => ymd(a) === ymd(b);

function rangeFor(view: View, anchor: Date): { from: Date; to: Date } {
  if (view === "today") return { from: startOfDay(anchor), to: addDays(startOfDay(anchor), 1) };
  if (view === "week") {
    const monday = addDays(startOfDay(anchor), -isoDow(anchor));
    return { from: monday, to: addDays(monday, 7) };
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = addDays(first, -isoDow(first));
  return { from: gridStart, to: addDays(gridStart, 42) };
}

const eventDay = (e: CalendarEvent) => e.start.slice(0, 10);

const VIEWS: View[] = ["today", "week", "month"];

export default function Calendar() {
  const qc = useQueryClient();
  const routerNavigate = useNavigate();
  const { view: viewParam } = useParams();
  const view: View = VIEWS.includes(viewParam as View) ? (viewParam as View) : "today";
  const [anchor, setAnchor] = useState(new Date());
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDate, setModalDate] = useState<string | null>(null);

  const { from, to } = rangeFor(view, anchor);

  const eventsQ = useQuery({
    queryKey: ["calendar", view, ymd(anchor)],
    queryFn: () =>
      api.get<CalendarEvent[]>(`/api/calendar?from=${from.toISOString()}&to=${to.toISOString()}`),
    retry: false,
  });

  const needsGoogle =
    eventsQ.error instanceof ApiError && eventsQ.error.message.includes("no_google_token");

  if (needsGoogle) {
    return (
      <div className="card max-w-md">
        <h1 className="text-xl font-bold">Agenda</h1>
        <p className="mt-2 text-sm text-slate-500">
          Autorise l'accès à ton Google Calendar pour afficher ton agenda et le calendrier partagé.
        </p>
        <a href={loginUrl()} className="btn-primary mt-4">
          Connecter Google Calendar
        </a>
      </div>
    );
  }

  const events = eventsQ.data ?? [];
  const eventsByDay = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const k = eventDay(e);
    if (!eventsByDay.has(k)) eventsByDay.set(k, []);
    eventsByDay.get(k)!.push(e);
  }

  const shiftAnchor = (dir: -1 | 1) => {
    if (view === "today") setAnchor(addDays(anchor, dir));
    else if (view === "week") setAnchor(addDays(anchor, dir * 7));
    else setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1));
  };

  const title =
    view === "month"
      ? `${MONTHS_FR[anchor.getMonth()]} ${anchor.getFullYear()}`
      : view === "week"
        ? `Semaine du ${dateFr(ymd(rangeFor("week", anchor).from))}`
        : dateFr(ymd(anchor));

  const openModal = (date?: string) => {
    setModalDate(date ?? ymd(anchor));
    setModalOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Agenda</h1>
        <button onClick={() => openModal()} className="btn-primary !px-3" title="Nouvel événement">
          + <span className="hidden sm:inline">Événement</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SubNav
          value={view}
          onChange={(v) => routerNavigate(`/calendar/${v}`)}
          items={VIEWS.map((v) => ({
            value: v,
            label: v === "today" ? "Aujourd'hui" : v === "week" ? "Semaine" : "Mois",
            icon: v === "today" ? "☀️" : v === "week" ? "🗓️" : "📅",
          }))}
        />
        <div className="flex items-center gap-2">
          <button onClick={() => shiftAnchor(-1)} className="btn-ghost !px-3">
            ‹
          </button>
          <button onClick={() => setAnchor(new Date())} className="btn-ghost text-xs">
            Aujourd'hui
          </button>
          <button onClick={() => shiftAnchor(1)} className="btn-ghost !px-3">
            ›
          </button>
        </div>
      </div>

      <div className="text-sm font-medium capitalize text-slate-500">{title}</div>

      {eventsQ.isLoading && <PageLoader variant="agenda" />}

      {view === "today" && <DayList events={eventsByDay.get(ymd(anchor)) ?? []} />}
      {view === "week" && <WeekView anchor={anchor} eventsByDay={eventsByDay} onAdd={openModal} />}
      {view === "month" && <MonthView anchor={anchor} eventsByDay={eventsByDay} onAdd={openModal} />}

      {modalOpen && (
        <EventModal
          defaultDate={modalDate ?? ymd(anchor)}
          onClose={() => setModalOpen(false)}
          onCreated={() => {
            setModalOpen(false);
            qc.invalidateQueries({ queryKey: ["calendar"] });
          }}
        />
      )}
    </div>
  );
}

function EventChip({ e }: { e: CalendarEvent }) {
  return (
    <div className="truncate rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] text-brand-700 dark:bg-brand-600/20 dark:text-brand-50">
      {!e.allDay && (
        <span className="opacity-70">
          {new Date(e.start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}{" "}
        </span>
      )}
      {e.summary}
    </div>
  );
}

function DayList({ events }: { events: CalendarEvent[] }) {
  if (events.length === 0) return <div className="card text-slate-400">Rien de prévu.</div>;
  return (
    <div className="space-y-2">
      {events
        .slice()
        .sort((a, b) => a.start.localeCompare(b.start))
        .map((e) => (
          <div key={`${e.calendarId}-${e.id}`} className="card flex items-center justify-between">
            <div>
              <div className="font-medium">{e.summary}</div>
              <div className="text-xs text-slate-400">
                {e.allDay
                  ? "Toute la journée"
                  : new Date(e.start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                {e.calendarName ? ` · ${e.calendarName}` : ""}
              </div>
            </div>
          </div>
        ))}
    </div>
  );
}

function WeekView({
  anchor,
  eventsByDay,
  onAdd,
}: {
  anchor: Date;
  eventsByDay: Map<string, CalendarEvent[]>;
  onAdd: (date: string) => void;
}) {
  const monday = addDays(startOfDay(anchor), -isoDow(anchor));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  const DayCell = ({ d }: { d: Date }) => {
    const key = ymd(d);
    const evs = (eventsByDay.get(key) ?? []).sort((a, b) => a.start.localeCompare(b.start));
    const today = sameDay(d, new Date());
    return (
      <div
        className={`card flex min-h-[240px] flex-col ${today ? "ring-2 ring-brand-500" : ""}`}
      >
        <div className="mb-2 flex items-center justify-between">
          <div className={`text-sm font-semibold ${today ? "text-brand-600" : ""}`}>
            {WEEKDAYS[isoDow(d)]} {d.getDate()}
          </div>
          <button
            onClick={() => onAdd(key)}
            className="text-lg text-slate-300 hover:text-brand-600"
            title="Ajouter"
          >
            +
          </button>
        </div>
        <div className="space-y-1.5">
          {evs.length === 0 && <div className="text-xs text-slate-300">—</div>}
          {evs.map((e) => (
            <EventChip key={`${e.calendarId}-${e.id}`} e={e} />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Lundi → Vendredi */}
      <div className="grid gap-3 sm:grid-cols-5">
        {days.slice(0, 5).map((d) => (
          <DayCell key={ymd(d)} d={d} />
        ))}
      </div>
      {/* Samedi & Dimanche sur une seconde ligne */}
      <div className="grid gap-3 sm:grid-cols-2">
        {days.slice(5, 7).map((d) => (
          <DayCell key={ymd(d)} d={d} />
        ))}
      </div>
    </div>
  );
}

function MonthView({
  anchor,
  eventsByDay,
  onAdd,
}: {
  anchor: Date;
  eventsByDay: Map<string, CalendarEvent[]>;
  onAdd: (date: string) => void;
}) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = addDays(first, -isoDow(first));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  return (
    <div>
      <div className="mb-1 hidden grid-cols-7 gap-1 text-center text-xs text-slate-400 sm:grid">
        {WEEKDAYS.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d) => {
          const key = ymd(d);
          const evs = (eventsByDay.get(key) ?? []).sort((a, b) => a.start.localeCompare(b.start));
          const inMonth = d.getMonth() === anchor.getMonth();
          const today = sameDay(d, new Date());
          return (
            <div
              key={key}
              onClick={() => onAdd(key)}
              className={`min-h-[80px] cursor-pointer rounded-lg border p-1 text-xs transition hover:border-brand-400 ${
                inMonth
                  ? "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                  : "border-transparent bg-slate-50 text-slate-400 dark:bg-slate-950"
              } ${today ? "ring-2 ring-brand-500" : ""}`}
            >
              <div className="mb-0.5 font-semibold">{d.getDate()}</div>
              <div className="space-y-0.5">
                {evs.slice(0, 3).map((e) => (
                  <EventChip key={`${e.calendarId}-${e.id}`} e={e} />
                ))}
                {evs.length > 3 && (
                  <div className="text-[10px] text-slate-400">+{evs.length - 3}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventModal({
  defaultDate,
  onClose,
  onCreated,
}: {
  defaultDate: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    summary: "",
    date: defaultDate,
    start: "09:00",
    end: "10:00",
    allDay: false,
    calendarId: "primary",
  });

  const calsQ = useQuery({
    queryKey: ["calendars"],
    queryFn: () => api.get<CalEntry[]>("/api/calendar/list"),
    retry: false,
  });

  const create = useMutation({
    mutationFn: () => {
      const start = form.allDay ? form.date : new Date(`${form.date}T${form.start}`).toISOString();
      const end = form.allDay
        ? form.date
        : new Date(`${form.date}T${form.end || form.start}`).toISOString();
      return api.post("/api/calendar/events", {
        calendarId: form.calendarId,
        summary: form.summary,
        start,
        end,
        allDay: form.allDay,
      });
    },
    onSuccess: onCreated,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Nouvel événement</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (form.summary) create.mutate();
          }}
          className="space-y-3"
        >
          <Input
            autoFocus
            placeholder="Titre de l'événement"
            value={form.summary}
            onChange={(e) => setForm({ ...form, summary: e.target.value })}
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1">
              <div className="mb-1 text-xs text-slate-400">Date</div>
              <DateInput value={form.date} onChange={(d) => setForm({ ...form, date: d })} />
            </div>
            <div className="pt-5">
              <Checkbox
                checked={form.allDay}
                onChange={() => setForm({ ...form, allDay: !form.allDay })}
                label="Toute la journée"
              />
            </div>
          </div>
          {!form.allDay && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-400">
                Début
                <Input
                  type="time"
                  value={form.start}
                  onChange={(e) => setForm({ ...form, start: e.target.value })}
                />
              </label>
              <label className="text-xs text-slate-400">
                Fin
                <Input
                  type="time"
                  value={form.end}
                  onChange={(e) => setForm({ ...form, end: e.target.value })}
                />
              </label>
            </div>
          )}
          <Select
            value={form.calendarId}
            onChange={(v) => setForm({ ...form, calendarId: v })}
            options={[
              { value: "primary", label: "Mon agenda (principal)" },
              ...(calsQ.data?.map((c) => ({ value: c.id, label: c.summary })) ?? []),
            ]}
          />
          {create.isError && <div className="text-sm text-red-600">Erreur lors de la création.</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost">
              Annuler
            </button>
            <button className="btn-primary" disabled={create.isPending}>
              {create.isPending ? "Création…" : "Créer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
