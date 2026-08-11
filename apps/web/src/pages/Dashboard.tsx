import { useState, type ReactNode } from "react";
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
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { InlineLoader } from "../components/ui";
import PageLoader from "../components/PageLoader";
import { Link } from "react-router-dom";
import type {
  Dashboard as DashboardData,
  CalendarEvent,
  TaskWithSubtasks,
  ShoppingItem,
  TripItem,
} from "@gfa/shared";
import { TRANSPORT_META } from "@gfa/shared";
import { useMe } from "../auth";
import { api, ApiError } from "../lib/api";
import { eur, eur0, dateFr } from "../lib/format";

function Stat({ label, value, sub, to }: { label: string; value: string; sub?: string; to?: string }) {
  const inner = (
    <div className="card h-full">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {sub && <div className="mt-1 text-sm text-slate-500">{sub}</div>}
    </div>
  );
  return to ? (
    <Link to={to} className="block h-full">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function AgendaCard() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(from);
  to.setDate(to.getDate() + 3); // aujourd'hui + 2 jours suivants

  const { data, isLoading, error } = useQuery({
    queryKey: ["calendar", "agenda-3j"],
    queryFn: () =>
      api.get<CalendarEvent[]>(`/api/calendar?from=${from.toISOString()}&to=${to.toISOString()}`),
    retry: false,
  });

  const needsGoogle = error instanceof ApiError && error.message.includes("no_google_token");

  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const days = [0, 1, 2].map((n) => {
    const d = new Date(from);
    d.setDate(d.getDate() + n);
    return d;
  });
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of data ?? []) {
    const k = e.start.slice(0, 10);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(e);
  }

  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">📅 Prochains jours</div>
        <Link to="/calendar" className="text-xs text-brand-600">
          Agenda →
        </Link>
      </div>
      {needsGoogle ? (
        <Link to="/calendar" className="text-sm text-slate-400">
          Connecter Google Calendar pour voir tes événements.
        </Link>
      ) : isLoading ? (
        <InlineLoader />
      ) : (
        <div className="space-y-2.5">
          {days.map((d, i) => {
            const evs = (byDay.get(ymd(d)) ?? []).sort((a, b) => a.start.localeCompare(b.start));
            return (
              <div key={i}>
                <div className="mb-0.5 text-xs font-medium capitalize text-slate-500">
                  {i === 0 ? "Aujourd'hui" : d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" })}
                </div>
                {evs.length === 0 ? (
                  <div className="pl-2 text-xs text-slate-300">—</div>
                ) : (
                  <ul className="space-y-1">
                    {evs.map((e) => (
                      <li key={`${e.calendarId}-${e.id}`} className="flex items-center gap-2 pl-2 text-sm">
                        <span className="w-12 shrink-0 text-xs text-slate-400">
                          {e.allDay
                            ? "Journée"
                            : new Date(e.start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <span className="truncate">{e.summary}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TopTasks() {
  const { data } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => api.get<TaskWithSubtasks[]>("/api/tasks"),
  });
  const top = (data ?? []).filter((t) => t.status !== "done").slice(0, 3);

  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">✅ Tes 3 prochaines tâches</div>
        <Link to="/tasks" className="text-xs text-brand-600">
          Tâches →
        </Link>
      </div>
      {top.length === 0 ? (
        <div className="text-sm text-slate-400">Aucune tâche en cours. 🎉</div>
      ) : (
        <ul className="space-y-1.5">
          {top.map((t) => (
            <li key={t.id} className="flex items-center gap-2 text-sm">
              <span className="text-slate-300">•</span>
              <span>{t.title}</span>
              {t.subtasks.length > 0 && (
                <span className="text-xs text-slate-400">
                  ({t.subtasks.filter((s) => s.status === "done").length}/{t.subtasks.length})
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface F1Race {
  name: string;
  circuit: string;
  locality: string;
  country: string;
  raceAt: string | null;
  qualifyingAt: string | null;
  sprintQualifyingAt: string | null;
  sprintAt: string | null;
}

function F1Card() {
  const { data } = useQuery({
    queryKey: ["f1-next"],
    queryFn: () => api.get<{ race: F1Race | null }>("/api/f1/next"),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  const race = data?.race;
  if (!race) return null;

  const fmt = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString("fr-FR", {
          weekday: "short",
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

  const sessions: { label: string; at: string | null }[] = [
    { label: "Sprint quali", at: race.sprintQualifyingAt },
    { label: "Sprint", at: race.sprintAt },
    { label: "Qualifications", at: race.qualifyingAt },
    { label: "Course", at: race.raceAt },
  ].filter((s) => s.at);

  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">🏎️ Prochain Grand Prix</div>
        <div className="text-xs text-slate-400">{race.country}</div>
      </div>
      <div className="font-medium">{race.name}</div>
      <div className="mb-2 text-xs text-slate-400">{race.circuit}</div>
      <ul className="space-y-1 text-sm">
        {sessions.map((s) => (
          <li key={s.label} className="flex justify-between gap-3">
            <span className="text-slate-500">{s.label}</span>
            <span className="font-medium capitalize">{fmt(s.at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface WeatherDay {
  date: string;
  tMax: number;
  tMin: number;
  code: number;
  rain: number;
}
interface WeatherLocation {
  name: string;
  lat: number;
  lon: number;
  days: WeatherDay[];
}
interface WeatherHour {
  time: string;
  temp: number;
  code: number;
  rain: number;
}

function weatherIcon(code: number): { emoji: string; label: string } {
  if (code === 0) return { emoji: "☀️", label: "Ensoleillé" };
  if (code <= 2) return { emoji: "⛅", label: "Éclaircies" };
  if (code === 3) return { emoji: "☁️", label: "Couvert" };
  if (code === 45 || code === 48) return { emoji: "🌫️", label: "Brouillard" };
  if (code >= 51 && code <= 57) return { emoji: "🌦️", label: "Bruine" };
  if (code >= 61 && code <= 67) return { emoji: "🌧️", label: "Pluie" };
  if (code >= 71 && code <= 77) return { emoji: "🌨️", label: "Neige" };
  if (code >= 80 && code <= 82) return { emoji: "🌦️", label: "Averses" };
  if (code >= 95) return { emoji: "⛈️", label: "Orages" };
  return { emoji: "🌡️", label: "—" };
}

interface NewsItem {
  title: string;
  link: string;
  date: string;
}

function F1NewsCard() {
  const { data } = useQuery({
    queryKey: ["f1-news"],
    queryFn: () => api.get<{ items: NewsItem[] }>("/api/f1/news"),
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  const items = data?.items ?? [];
  if (items.length === 0) return null;

  const ago = (d: string) => {
    const t = new Date(d).getTime();
    if (isNaN(t)) return "";
    const h = Math.round((Date.now() - t) / 3_600_000);
    if (h < 1) return "à l'instant";
    if (h < 24) return `il y a ${h} h`;
    return `il y a ${Math.round(h / 24)} j`;
  };

  return (
    <div className="card">
      <div className="mb-2 text-sm font-semibold">📰 Actus F1</div>
      <ul className="space-y-2">
        {items.map((n, i) => (
          <li key={i}>
            <a
              href={n.link}
              target="_blank"
              rel="noreferrer"
              className="block rounded-lg p-1.5 transition hover:bg-[color:var(--paper-2)]"
            >
              <div className="text-sm font-medium leading-snug">{n.title}</div>
              {n.date && <div className="text-xs text-slate-400">{ago(n.date)}</div>}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Météo heure par heure d'une ville pour un jour donné (modale).
function HourlyWeatherModal({
  loc,
  date,
  onClose,
}: {
  loc: WeatherLocation;
  date: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["weather-hourly", loc.lat, loc.lon, date],
    queryFn: () =>
      api.get<{ hours: WeatherHour[] }>(
        `/api/weather/hourly?lat=${loc.lat}&lon=${loc.lon}&date=${date}`,
      ),
    staleTime: 60 * 60 * 1000,
  });
  const title = new Date(`${date}T00:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-bold">
            {loc.name} · <span className="capitalize">{title}</span>
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        {isLoading ? (
          <InlineLoader />
        ) : !data || data.hours.length === 0 ? (
          <div className="text-sm text-slate-400">Prévisions horaires indisponibles.</div>
        ) : (
          <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto">
            {data.hours.map((h) => {
              const w = weatherIcon(h.code);
              return (
                <li
                  key={h.time}
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm odd:bg-[color:var(--paper-2)]"
                >
                  <span className="w-12 shrink-0 tabular-nums text-slate-500">{h.time.slice(11, 16)}</span>
                  <span className="text-xl" title={w.label}>
                    {w.emoji}
                  </span>
                  <span className="w-10 shrink-0 font-semibold tabular-nums">{h.temp}°</span>
                  <span className="ml-auto text-xs text-blue-500">💧 {h.rain}%</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function WeatherCard() {
  const { data } = useQuery({
    queryKey: ["weather"],
    queryFn: () => api.get<{ locations: WeatherLocation[] }>("/api/weather"),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const [sel, setSel] = useState<{ loc: WeatherLocation; date: string } | null>(null);

  const locations = (data?.locations ?? []).filter((l) => l.days.length > 0);
  if (locations.length === 0) return null;

  const dayLabel = (iso: string, i: number) =>
    i === 0
      ? "Auj."
      : new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR", { weekday: "short" });

  return (
    <div className="card space-y-3">
      <div className="text-sm font-semibold">🌤️ Météo</div>
      {locations.map((loc) => (
        <div key={loc.name}>
          <div className="mb-1.5 text-sm font-medium text-slate-500">{loc.name}</div>
          <div className="grid grid-cols-3 gap-2">
            {loc.days.map((d, i) => {
              const w = weatherIcon(d.code);
              return (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => setSel({ loc, date: d.date })}
                  className="rounded-xl bg-white p-3 text-center transition hover:ring-1 hover:ring-brand-400 dark:bg-slate-800"
                  title="Voir la météo heure par heure"
                >
                  <div className="text-sm capitalize text-slate-500">{dayLabel(d.date, i)}</div>
                  <div className="my-1 text-4xl" title={w.label}>
                    {w.emoji}
                  </div>
                  <div className="text-lg font-semibold">
                    {d.tMax}° <span className="font-normal text-slate-400">{d.tMin}°</span>
                  </div>
                  <div className="text-xs text-blue-500">💧 {d.rain}%</div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {sel && <HourlyWeatherModal loc={sel.loc} date={sel.date} onClose={() => setSel(null)} />}
    </div>
  );
}

type Status = "ok" | "perturbe" | "unknown";
interface TransitTrain {
  key: string;
  label?: string;
  color: string;
  status: Status;
  messages?: string[];
  dirs: { label: string; next: string[] }[];
}

const statusDot = (s: Status) =>
  s === "ok" ? "bg-green-500" : s === "perturbe" ? "bg-amber-500" : "bg-slate-300";

function Times({ next, status }: { next: string[]; status: Status }) {
  const [open, setOpen] = useState(false);
  if (!next.length)
    return (
      <span className="text-xs text-slate-400">{status === "unknown" ? "Indisponible" : "—"}</span>
    );
  const shown = open ? next : next.slice(0, 3);
  const hasMore = next.length > 3;
  return (
    <span className="flex items-start gap-1">
      <span className="grid w-fit grid-cols-3 gap-1">
        {shown.map((t, i) => (
          <span key={i} className="rounded-md bg-[color:var(--paper-2)] px-1.5 py-0.5 text-center text-xs font-medium tabular-nums">
            {t}
          </span>
        ))}
      </span>
      {hasMore && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Réduire les horaires" : "Voir plus d'horaires"}
          className="flex h-6 w-5 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-[color:var(--paper-2)] hover:text-brand-600"
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}
    </span>
  );
}

function TrainRow({ t }: { t: TransitTrain }) {
  const [openMsg, setOpenMsg] = useState(false);
  const hasDetail = !!(t.messages && t.messages.length);
  return (
    <div className="flex items-start gap-3 rounded-xl bg-white dark:bg-slate-800 p-2.5">
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
        style={{ backgroundColor: t.color }}
      >
        {t.key}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot(t.status)}`} />
          <span className="text-xs font-medium text-slate-400">{t.label ?? `Ligne ${t.key}`}</span>
          {t.status === "perturbe" &&
            (hasDetail ? (
              <button
                onClick={() => setOpenMsg((o) => !o)}
                className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400"
              >
                <span>⚠️ Trafic perturbé</span>
                <span>{openMsg ? "▾" : "▸"}</span>
              </button>
            ) : (
              <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                ⚠️ Trafic perturbé
              </span>
            ))}
        </div>
        {t.dirs.map((d, i) => (
          <div key={i} className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:gap-2">
            <span className="w-44 shrink-0 truncate text-xs text-slate-500 sm:py-0.5">{d.label}</span>
            <Times next={d.next} status={t.status} />
          </div>
        ))}
        {/* Détail de la perturbation : encadré ambre, première ligne = titre du message. */}
        {openMsg && hasDetail && (
          <div className="mt-1.5 space-y-1 rounded-lg border-l-2 border-amber-400 bg-amber-50 px-2.5 py-2 text-xs leading-relaxed text-slate-700 dark:border-amber-500 dark:bg-amber-500/10 dark:text-slate-200">
            {t.messages!.map((m, i) => (
              <div key={i} className={i === 0 ? "font-semibold text-amber-800 dark:text-amber-200" : ""}>
                {m}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TransitCard() {
  const [openSecondary, setOpenSecondary] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["transit"],
    queryFn: () => api.get<{ principal: TransitTrain[]; secondary: TransitTrain[] }>("/api/transit"),
    staleTime: 60 * 1000,
    retry: false,
  });

  const principal = data?.principal ?? [];
  const secondary = data?.secondary ?? [];

  if (isLoading) {
    return (
      <div className="card space-y-2">
        <div className="text-sm font-semibold">🚆 Transports</div>
        <InlineLoader />
      </div>
    );
  }
  if (principal.length === 0 && secondary.length === 0) return null;

  return (
    <div className="card space-y-2">
      <div className="text-sm font-semibold">🚆 Transports</div>
      <div className="space-y-2">
        {principal.map((t) => (
          <TrainRow key={t.key} t={t} />
        ))}
      </div>

      {/* Lignes secondaires : repliées par défaut, juste les pastilles de statut */}
      {secondary.length > 0 && (
        <div className="rounded-xl bg-white dark:bg-slate-800 p-2.5">
          <button
            onClick={() => setOpenSecondary((o) => !o)}
            className="flex w-full items-center justify-between gap-2"
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Autres lignes</span>
              {secondary.map((m) => (
                <span key={m.key} className="flex items-center gap-1">
                  <span
                    className="flex h-5 min-w-5 items-center justify-center rounded px-1 text-[10px] font-bold text-white"
                    style={{ backgroundColor: m.color }}
                  >
                    {m.key}
                  </span>
                  <span className={`h-2 w-2 rounded-full ${statusDot(m.status)}`} />
                </span>
              ))}
            </span>
            <span className="text-slate-400">{openSecondary ? "▾" : "▸"}</span>
          </button>
          {openSecondary && (
            <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2 dark:border-slate-700">
              {secondary.map((m) => (
                <TrainRow key={m.key} t={m} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type UpcomingTripItem = TripItem & { tripName: string };

function tripItemIcon(it: UpcomingTripItem): string {
  if (it.type === "transport") return it.mode ? TRANSPORT_META[it.mode].icon : "🚆";
  return it.type === "lodging" ? "🏠" : "🎯";
}
function tripItemTitle(it: UpcomingTripItem): string {
  if (it.type === "transport") {
    const label = it.mode ? TRANSPORT_META[it.mode].label : "Transport";
    return it.fromPlace || it.toPlace ? `${label} · ${it.fromPlace ?? "?"} → ${it.toPlace ?? "?"}` : label;
  }
  return it.title || (it.type === "lodging" ? "Logement" : "Activité");
}
function tripItemWhen(it: UpcomingTripItem): string {
  if (it.type === "lodging") {
    return `${dateFr(it.startAt ?? "")}${it.endAt ? ` → ${dateFr(it.endAt)}` : ""}`;
  }
  if (!it.startAt) return "";
  const time = it.startAt.length > 10 ? ` · ${it.startAt.slice(11, 16)}` : "";
  return `${dateFr(it.startAt)}${time}`;
}

// Étapes (transports, logements, activités) des voyages dans les 3 prochains jours.
function TripCard() {
  const now = new Date();
  const fromYmd = now.toLocaleDateString("sv-SE");
  const toDate = new Date(now);
  toDate.setDate(toDate.getDate() + 3);
  const toYmd = toDate.toLocaleDateString("sv-SE");
  const { data, isLoading } = useQuery({
    queryKey: ["trips-upcoming", fromYmd],
    queryFn: () => api.get<UpcomingTripItem[]>(`/api/trips/upcoming?from=${fromYmd}&to=${toYmd}`),
  });
  const tripId = data?.[0]?.tripId;
  return (
    <div className="card h-full">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">✈️ Voyage · 3 prochains jours</div>
        <Link
          to={`/tools/vacances${tripId ? `?trip=${tripId}` : ""}`}
          className="text-slate-400 transition hover:text-brand-600"
          title="Voir le voyage"
          aria-label="Voir le voyage"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d="M7 17 17 7M8 7h9v9" />
          </svg>
        </Link>
      </div>
      {isLoading ? (
        <InlineLoader />
      ) : !data || data.length === 0 ? (
        <div className="text-sm text-slate-400">Rien de prévu.</div>
      ) : (
        <ul className="space-y-2">
          {data.map((it) => (
            <li key={it.id} className="flex items-start gap-2 text-sm">
              <span className="shrink-0">{tripItemIcon(it)}</span>
              <div className="min-w-0">
                <div className="truncate font-medium">{tripItemTitle(it)}</div>
                <div className="text-xs text-slate-400">
                  {tripItemWhen(it)}
                  {it.tripName ? ` · ${it.tripName}` : ""}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Widgets de l'accueil — id stable + libellé pour l'écran de réorganisation.
const WIDGET_META: { id: string; label: string }[] = [
  { id: "transit", label: "🚆 Transports" },
  { id: "weather", label: "🌤️ Météo" },
  { id: "agenda", label: "📅 Planning" },
  { id: "tasks", label: "✅ Tâches" },
  { id: "trips", label: "✈️ Voyage" },
  { id: "wedding", label: "💍 Mariage" },
  { id: "shopping", label: "🛒 Courses" },
  { id: "balance", label: "⚖️ Équilibrage" },
  { id: "f1-race", label: "🏁 Grand Prix" },
  { id: "f1-news", label: "📰 Actus F1" },
];
const DEFAULT_WIDGET_ORDER = WIDGET_META.map((w) => w.id);

// Largeur d'un widget sur une ligne : "half" = 50%, "third" = 33%.
const WIDGET_SIZE: Record<string, "half" | "third"> = {
  transit: "half",
  weather: "half",
  agenda: "half",
  tasks: "half",
  trips: "half",
  wedding: "third",
  shopping: "third",
  balance: "third",
  "f1-race": "half",
  "f1-news": "half",
};
// Grille à 6 colonnes : 50% = 3 colonnes, 33% = 2 colonnes (pleine largeur sur mobile).
const sizeClassFor = (id: string) =>
  WIDGET_SIZE[id] === "third" ? "col-span-6 lg:col-span-2" : "col-span-6 lg:col-span-3";

/** Ordre personnalisé : ids connus dans l'ordre choisi, puis les nouveaux à la fin. */
function orderedWidgetIds(order: string[] | undefined): string[] {
  const known = new Set(DEFAULT_WIDGET_ORDER);
  const result: string[] = [];
  for (const id of order ?? []) if (known.has(id) && !result.includes(id)) result.push(id);
  for (const id of DEFAULT_WIDGET_ORDER) if (!result.includes(id)) result.push(id);
  return result;
}

const EyeIcon = ({ off }: { off: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-5 w-5"
    aria-hidden="true"
  >
    {off ? (
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
);

// Widget en mode réorganisation : poignée de déplacement + œil, directement sur la carte.
function SortableWidget({
  id,
  node,
  hidden,
  onToggle,
}: {
  id: string;
  node: ReactNode;
  hidden: boolean;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${sizeClassFor(id)} relative ${isDragging ? "z-10 opacity-70" : ""}`}
    >
      {/* Contenu réel du widget, non interactif (clics neutralisés, scroll préservé). */}
      <div className={`pointer-events-none h-full [&>*]:h-full ${hidden ? "opacity-40" : ""}`}>
        {node}
      </div>
      {/* Poignée de déplacement (haut-gauche). */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Déplacer le widget"
        style={{ touchAction: "none" }}
        className="absolute left-2 top-2 z-20 flex h-7 w-7 cursor-grab items-center justify-center rounded-lg bg-white/90 text-slate-500 shadow ring-1 ring-slate-200 dark:bg-slate-800/90 dark:text-slate-300 dark:ring-slate-700"
      >
        ⠿
      </button>
      {/* Œil afficher / masquer (haut-droite). */}
      <button
        type="button"
        onClick={onToggle}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={hidden ? "Afficher le widget" : "Masquer le widget"}
        title={hidden ? "Afficher" : "Masquer"}
        className={`absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-lg bg-white/90 shadow ring-1 ring-slate-200 dark:bg-slate-800/90 dark:ring-slate-700 ${
          hidden ? "text-slate-400" : "text-brand-600"
        }`}
      >
        <EyeIcon off={hidden} />
      </button>
    </div>
  );
}

export default function Dashboard() {
  const me = useMe();
  const members = me.household.members;
  const qc = useQueryClient();
  const firstName = me.displayName.split(" ")[0];
  const [reorg, setReorg] = useState(false);
  const [order, setOrder] = useState<string[]>(() => orderedWidgetIds(me.widgetPrefs?.order));
  const [hiddenList, setHiddenList] = useState<string[]>(() => me.widgetPrefs?.hidden ?? []);
  const hidden = new Set(hiddenList);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const save = useMutation({
    mutationFn: (prefs: { order: string[]; hidden: string[] }) =>
      api.patch("/api/household/widget-prefs", prefs),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });

  const onWidgetDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setOrder((prev) => {
      const next = arrayMove(prev, prev.indexOf(String(e.active.id)), prev.indexOf(String(e.over!.id)));
      save.mutate({ order: next, hidden: hiddenList });
      return next;
    });
  };

  const toggleHidden = (id: string) => {
    setHiddenList((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      save.mutate({ order, hidden: next });
      return next;
    });
  };

  const resetWidgets = () => {
    setOrder(DEFAULT_WIDGET_ORDER);
    setHiddenList([]);
    save.mutate({ order: DEFAULT_WIDGET_ORDER, hidden: [] });
  };
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardData>("/api/dashboard"),
  });
  const { data: shopping } = useQuery({
    queryKey: ["shopping-items"],
    queryFn: () => api.get<ShoppingItem[]>("/api/courses/items"),
  });

  if (isLoading || !data) return <PageLoader variant="accueil" />;

  const shoppingCount = shopping?.length ?? 0;

  const daysToWedding = Math.ceil(
    (new Date(data.wedding.targetDate).getTime() - Date.now()) / 86_400_000,
  );

  const balanceText =
    data.balance.amount === 0
      ? "Comptes équilibrés ✅"
      : `${members[data.balance.fromUser].name} doit ${eur(
          data.balance.amount,
        )} à ${members[data.balance.toUser].name}`;

  const widgetNodes: Record<string, ReactNode> = {
    transit: <TransitCard />,
    weather: <WeatherCard />,
    agenda: <AgendaCard />,
    tasks: <TopTasks />,
    trips: <TripCard />,
    wedding: (
      <Stat
        label="💍 Mariage"
        value={`J-${daysToWedding}`}
        sub={`${data.wedding.percentFunded}% · reste ${eur0(data.wedding.targetAmount - data.wedding.savedToDate)}`}
        to="/wedding"
      />
    ),
    shopping: (
      <Stat
        label="🛒 Courses"
        value={`${shoppingCount}`}
        sub={shoppingCount > 0 ? "articles à acheter" : "liste vide"}
        to="/courses"
      />
    ),
    balance: (
      <Link to="/money/equilibrage" className="card block h-full">
        <div className="text-xs uppercase tracking-wide text-slate-400">⚖️ Équilibrage</div>
        <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{balanceText}</div>
      </Link>
    ),
    "f1-race": <F1Card />,
    "f1-news": <F1NewsCard />,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Bonjour {firstName} 👋</h1>
        <button
          type="button"
          onClick={() => setReorg((v) => !v)}
          aria-label="Organiser les widgets"
          title="Organiser les widgets"
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${
            reorg ? "btn-primary" : "text-slate-400 hover:text-brand-600"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
            aria-hidden="true"
          >
            {reorg ? (
              <path d="M20 6 9 17l-5-5" />
            ) : (
              <>
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </>
            )}
          </svg>
        </button>
      </div>

      {reorg && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-brand-50 px-3 py-2 text-xs text-brand-700 dark:bg-brand-100/10 dark:text-brand-100">
          <span>Glisse ⠿ pour réordonner · l'œil pour afficher / masquer.</span>
          <button onClick={resetWidgets} className="font-medium hover:underline">
            Réinitialiser
          </button>
        </div>
      )}

      {reorg ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onWidgetDragEnd}>
          <SortableContext items={order} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-6 gap-4">
              {order.map((id) => (
                <SortableWidget
                  key={id}
                  id={id}
                  node={widgetNodes[id]}
                  hidden={hidden.has(id)}
                  onToggle={() => toggleHidden(id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="grid grid-cols-6 gap-4">
          {order
            .filter((id) => !hidden.has(id))
            .map((id) => (
              <div key={id} className={`${sizeClassFor(id)} [&>*]:h-full`}>
                {widgetNodes[id]}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
