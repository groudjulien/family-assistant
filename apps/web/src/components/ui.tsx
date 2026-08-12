import { useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Listbox,
  ListboxButton,
  ListboxOptions,
  ListboxOption,
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOptions,
  ComboboxOption,
} from "@headlessui/react";
import { DayPicker, type MonthCaptionProps } from "react-day-picker";
import { fr } from "react-day-picker/locale";

/* ------------------------------------------------------------------ */
/* Select                                                              */
/* ------------------------------------------------------------------ */

export interface Option {
  value: string;
  label: string;
  icon?: ReactNode; // pastille/logo optionnel affiché devant le label (Select)
}

export function Select({
  value,
  onChange,
  options,
  className = "",
  placeholder = "Choisir…",
}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  className?: string;
  placeholder?: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <Listbox value={value} onChange={onChange}>
      <div className={`relative ${className}`}>
        <ListboxButton className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-900 outline-none transition hover:border-brand-400 focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
          <span className={`flex min-w-0 items-center gap-2 ${current ? "" : "text-slate-400"}`}>
            {current?.icon}
            <span className="truncate">{current?.label ?? placeholder}</span>
          </span>
          <span className="text-[10px] text-slate-400">▼</span>
        </ListboxButton>
        <ListboxOptions
          anchor="bottom start"
          className="z-50 mt-1 max-h-60 w-[var(--button-width)] overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg focus:outline-none dark:border-slate-700 dark:bg-slate-900"
        >
          {options.map((o) => (
            <ListboxOption
              key={o.value}
              value={o.value}
              className="flex cursor-pointer items-center justify-between rounded-lg px-3 py-1.5 text-sm text-slate-700 transition data-[focus]:bg-[#f1ede4] data-[selected]:font-semibold data-[selected]:text-brand-600 dark:text-slate-200 dark:data-[focus]:bg-slate-800"
            >
              <span className="flex min-w-0 items-center gap-2">
                {o.icon}
                <span className="truncate">{o.label}</span>
              </span>
              <span className="hidden text-brand-600 data-[selected]:inline">✓</span>
            </ListboxOption>
          ))}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}

/* ------------------------------------------------------------------ */
/* MultiSelect — sélection multiple (cases cochées dans un popover)    */
/* ------------------------------------------------------------------ */

export function MultiSelect({
  values,
  onChange,
  options,
  placeholder = "Tous",
  className = "",
}: {
  values: string[];
  onChange: (values: string[]) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
}) {
  const selected = options.filter((o) => values.includes(o.value));
  const label = selected.length === 0 ? placeholder : selected.map((o) => o.label).join(", ");
  return (
    <Listbox value={values} onChange={onChange} multiple>
      <div className={`relative ${className}`}>
        <ListboxButton className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-900 outline-none transition hover:border-brand-400 focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
          <span className={`truncate ${selected.length ? "" : "text-slate-400"}`}>{label}</span>
          <span className="text-[10px] text-slate-400">▼</span>
        </ListboxButton>
        <ListboxOptions
          anchor="bottom start"
          className="z-50 mt-1 max-h-60 w-[var(--button-width)] overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg focus:outline-none dark:border-slate-700 dark:bg-slate-900"
        >
          {options.map((o) => (
            <ListboxOption
              key={o.value}
              value={o.value}
              className="flex cursor-pointer items-center justify-between rounded-lg px-3 py-1.5 text-sm text-slate-700 transition data-[focus]:bg-[#f1ede4] data-[selected]:font-semibold data-[selected]:text-brand-600 dark:text-slate-200 dark:data-[focus]:bg-slate-800"
            >
              <span className="flex min-w-0 items-center gap-2">
                {o.icon}
                <span className="truncate">{o.label}</span>
              </span>
              <span className="hidden text-brand-600 data-[selected]:inline">✓</span>
            </ListboxOption>
          ))}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}

/* ------------------------------------------------------------------ */
/* SearchSelect — select avec barre de recherche (Combobox)            */
/* ------------------------------------------------------------------ */

export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = "Choisir…",
  allowCustom = false,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  allowCustom?: boolean; // autorise une valeur libre (saisie non listée)
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const current = options.find((o) => o.value === value);
  return (
    <Combobox
      value={value}
      onChange={(v: string | null) => {
        if (v != null) onChange(v);
      }}
    >
      <div className={`relative ${className}`}>
        <div className="flex w-full items-center rounded-xl border border-slate-300 bg-white transition focus-within:border-brand-500 hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900">
          <ComboboxInput
            className="w-full bg-transparent px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100"
            placeholder={placeholder}
            displayValue={() => (current ? current.label : allowCustom ? value : "")}
            onChange={(e) => {
              setQuery(e.target.value);
              if (allowCustom) onChange(e.target.value);
            }}
          />
          <ComboboxButton className="px-2 text-[10px] text-slate-400">▼</ComboboxButton>
        </div>
        <ComboboxOptions
          anchor="bottom start"
          className="z-50 mt-1 max-h-60 w-[var(--input-width)] min-w-48 overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg focus:outline-none dark:border-slate-700 dark:bg-slate-900"
        >
          {filtered.map((o) => (
            <ComboboxOption
              key={o.value}
              value={o.value}
              className="flex cursor-pointer items-center justify-between rounded-lg px-3 py-1.5 text-sm text-slate-700 transition data-[focus]:bg-[#f1ede4] data-[selected]:font-semibold data-[selected]:text-brand-600 dark:text-slate-200 dark:data-[focus]:bg-slate-800"
            >
              {o.label}
            </ComboboxOption>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-1.5 text-sm text-slate-400">Aucun résultat</div>
          )}
        </ComboboxOptions>
      </div>
    </Combobox>
  );
}

/* ------------------------------------------------------------------ */
/* Checkbox                                                            */
/* ------------------------------------------------------------------ */

export function Checkbox({
  checked,
  onChange,
  size = "md",
  label,
}: {
  checked: boolean;
  onChange: () => void;
  size?: "sm" | "md" | "lg";
  label?: ReactNode;
}) {
  const dim =
    size === "sm" ? "h-4 w-4 text-[10px]" : size === "lg" ? "h-7 w-7 text-base" : "h-5 w-5 text-xs";
  const boxEl = (
    <span
      className={`flex ${dim} shrink-0 items-center justify-center rounded-md border leading-none transition ${
        checked
          ? "border-brand-600 bg-brand-600 text-white"
          : "border-slate-300 bg-white hover:border-brand-400 dark:border-slate-600 dark:bg-slate-800"
      }`}
    >
      {checked && "✓"}
    </span>
  );
  return (
    <button
      type="button"
      onClick={onChange}
      role="checkbox"
      aria-checked={checked}
      className={label ? "flex items-center gap-2 text-left text-sm" : "inline-flex"}
    >
      {boxEl}
      {label && <span>{label}</span>}
    </button>
  );
}

/**
 * Interrupteur (on/off) : pastille qui glisse dans un rail, vert quand actif.
 * Pensé pour accompagner un libellé discret (taille d'un sous-titre).
 */
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className="inline-flex items-center gap-2 text-left"
    >
      {label && <span>{label}</span>}
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
          checked ? "bg-brand-600" : "bg-slate-300 dark:bg-slate-600"
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-[1.125rem]" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* SubNav — onglets de (sous-)menu : boutons sur desktop, select sur mobile */
/* ------------------------------------------------------------------ */

export interface SubNavItem {
  value: string;
  label: string;
  icon?: string;
}

/**
 * Bulle d'aide des gestes tactiles : petit « i » flottant en bas à gauche, qui
 * déplie la liste des gestes disponibles. Mobile uniquement (sur ordinateur les
 * actions sont visibles directement sur les lignes/cartes).
 */
export function GestureHelp({ title, items }: { title: string; items: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {open && <div className="fixed inset-0 z-30 md:hidden" onClick={() => setOpen(false)} />}
      <div className="fixed bottom-6 left-6 z-40 md:hidden">
        {open && (
          <div className="card absolute bottom-12 left-0 w-60 space-y-2 text-sm shadow-lg">
            <div className="font-semibold">{title}</div>
            <ul className="space-y-1.5 text-slate-500 dark:text-slate-400">
              {items.map((it) => (
                <li key={it}>{it}</li>
              ))}
            </ul>
          </div>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Aide sur les gestes"
          aria-expanded={open}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
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
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
        </button>
      </div>
    </>
  );
}

/**
 * Bascule segmentée (pilule) pour un sous-menu à 2–4 entrées : plus compact et
 * plus lisible qu'un `SubNav` quand les choix sont peu nombreux et exclusifs.
 * Centrée par défaut ; passer `align="start"`/`"end"` pour l'aligner dans une
 * ligne qui contient déjà un bouton d'action.
 */
export function PillToggle({
  value,
  onChange,
  items,
  align = "center",
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  items: { value: string; label: string; icon?: string }[];
  align?: "start" | "center" | "end";
  className?: string;
}) {
  const justify =
    align === "start" ? "justify-start" : align === "end" ? "justify-end" : "justify-center";
  return (
    <div className={`flex ${justify} ${className}`}>
      <div className="inline-flex overflow-hidden rounded-full border border-slate-300 dark:border-slate-700">
        {items.map((it) => (
          <button
            key={it.value}
            type="button"
            onClick={() => onChange(it.value)}
            aria-pressed={value === it.value}
            className={`whitespace-nowrap px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] transition sm:px-4 sm:text-xs ${
              value === it.value
                ? "bg-brand-600 text-white"
                : "text-slate-500 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400"
            }`}
          >
            {it.icon && <span className="mr-1">{it.icon}</span>}
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SubNav({
  value,
  onChange,
  items,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  items: SubNavItem[];
  className?: string;
}) {
  return (
    <>
      <div className={`sm:hidden ${className}`}>
        <Select
          value={value}
          onChange={onChange}
          options={items.map((it) => ({
            value: it.value,
            label: it.icon ? `${it.icon} ${it.label}` : it.label,
          }))}
        />
      </div>
      <div className={`hidden sm:block ${className}`}>
        <div className="subtabs">
          {items.map((it) => (
            <button
              key={it.value}
              onClick={() => onChange(it.value)}
              className={`subtab ${value === it.value ? "active" : ""}`}
            >
              {it.icon && <span className="mr-1">{it.icon}</span>}
              {it.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

/**
 * Loader en ligne (widgets, listes) : petite roue + libellé.
 * Pour le chargement initial de l'app, voir `AppLoader`.
 */
export function InlineLoader({
  label = "Chargement…",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 text-sm text-slate-400 ${className}`} role="status">
      <span
        aria-hidden="true"
        className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-200 border-t-brand-500 dark:border-slate-700 dark:border-t-brand-500"
      />
      {label}
    </div>
  );
}

export const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input className={`${inputClass} ${className}`} {...rest} />;
}

/* ------------------------------------------------------------------ */
/* Navigation mois / année du calendrier (partagée)                    */
/* ------------------------------------------------------------------ */

/** Vue courante du calendrier : jours → mois → années (clic sur le titre). */
type CalendarView = "days" | "months" | "years";

/** Nombre d'années affichées dans la vue « années » (la courante au milieu). */
const YEARS_PER_PAGE = 9;

const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const MONTHS_FR = Array.from({ length: 12 }, (_, i) =>
  capFirst(new Date(2020, i, 1).toLocaleDateString("fr-FR", { month: "short" })),
);

const calCellClass =
  "rounded-lg px-2 py-3 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800";
const calCellSelectedClass = "bg-brand-600 text-white hover:bg-brand-600 dark:text-white";
const calTitleClass =
  "rounded-lg px-1.5 py-0.5 transition hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800";

function CalNavButton({ dir, onClick }: { dir: "prev" | "next"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir === "prev" ? "Précédent" : "Suivant"}
      className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={dir === "prev" ? "M15 18 9 12l6-6" : "m9 18 6-6-6-6"} />
      </svg>
    </button>
  );
}

/**
 * Légende de mois cliquable : le nom du mois ouvre la vue « mois », l'année la
 * vue « années ». `displayIndex` sert d'ancre quand plusieurs mois sont affichés.
 */
function makeMonthCaption(onOpen: (view: CalendarView, displayIndex: number) => void) {
  return function ClickableMonthCaption({ calendarMonth, displayIndex, className = "", ...rest }: MonthCaptionProps) {
    const d = calendarMonth.date;
    return (
      <div className={`${className} gap-1`} {...rest}>
        <button type="button" onClick={() => onOpen("months", displayIndex)} className={calTitleClass}>
          {capFirst(d.toLocaleDateString("fr-FR", { month: "long" }))}
        </button>
        <button type="button" onClick={() => onOpen("years", displayIndex)} className={calTitleClass}>
          {d.getFullYear()}
        </button>
      </div>
    );
  };
}

/** Grille des 12 mois (vue « mois ») ou des 9 années (vue « années »). */
function MonthYearPanel({
  view,
  base,
  onViewChange,
  onBaseChange,
  onPick,
}: {
  view: "months" | "years";
  /** Mois de référence : donne l'année/le mois mis en évidence. */
  base: Date;
  onViewChange: (view: CalendarView) => void;
  /** Navigation par flèches (année précédente/suivante, page d'années). */
  onBaseChange: (d: Date) => void;
  /** Mois choisi → vue jours ; année choisie → vue mois. */
  onPick: (d: Date, next: CalendarView) => void;
}) {
  const year = base.getFullYear();
  const firstYear = year - Math.floor(YEARS_PER_PAGE / 2);
  const years = Array.from({ length: YEARS_PER_PAGE }, (_, i) => firstYear + i);
  const today = new Date();

  return (
    <div className="w-[16.5rem] px-1 pb-1">
      <div className="flex items-center justify-between">
        <CalNavButton
          dir="prev"
          onClick={() =>
            onBaseChange(addMonths(base, view === "months" ? -12 : -12 * YEARS_PER_PAGE))
          }
        />
        {view === "months" ? (
          <button
            type="button"
            onClick={() => onViewChange("years")}
            className={`text-base font-bold ${calTitleClass}`}
          >
            {year}
          </button>
        ) : (
          <span className="px-1.5 text-base font-bold">
            {firstYear} – {firstYear + YEARS_PER_PAGE - 1}
          </span>
        )}
        <CalNavButton
          dir="next"
          onClick={() =>
            onBaseChange(addMonths(base, view === "months" ? 12 : 12 * YEARS_PER_PAGE))
          }
        />
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1">
        {view === "months"
          ? MONTHS_FR.map((label, i) => {
              const selected = i === base.getMonth();
              const isToday = i === today.getMonth() && year === today.getFullYear();
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => onPick(new Date(year, i, 1), "days")}
                  className={`${calCellClass} ${selected ? calCellSelectedClass : isToday ? "font-bold text-brand-600" : ""}`}
                >
                  {label}
                </button>
              );
            })
          : years.map((y) => {
              const selected = y === year;
              const isToday = y === today.getFullYear();
              return (
                <button
                  key={y}
                  type="button"
                  onClick={() => onPick(new Date(y, base.getMonth(), 1), "months")}
                  className={`${calCellClass} ${selected ? calCellSelectedClass : isToday ? "font-bold text-brand-600" : ""}`}
                >
                  {y}
                </button>
              );
            })}
      </div>
    </div>
  );
}

/**
 * État partagé de la navigation d'un calendrier : mois affiché + vue courante.
 * `anchor` retient quel mois affiché a été cliqué (calendriers multi-mois).
 */
function useCalendarNav(initial?: Date) {
  const [view, setView] = useState<CalendarView>("days");
  const [anchor, setAnchor] = useState(0);
  const [month, setMonth] = useState<Date>(startOfMonth(initial ?? new Date()));

  /** Mois de référence des grilles mois/années (le mois cliqué). */
  const base = addMonths(month, anchor);

  // Le composant de légende doit garder une identité stable (sinon DayPicker
  // remonte la légende à chaque rendu) → ref sur le handler courant.
  const openRef = useRef((v: CalendarView, displayIndex: number) => {
    setAnchor(displayIndex);
    setView(v);
  });
  const MonthCaption = useMemo(() => makeMonthCaption((v, i) => openRef.current(v, i)), []);

  return {
    view,
    setView,
    month,
    setMonth,
    base,
    /** Légende cliquable à passer à `components` de DayPicker. */
    MonthCaption,
    /** Navigation par flèches dans les grilles mois/années. */
    setBase: (d: Date) => setMonth(addMonths(d, -anchor)),
    /** Sélection d'un mois (→ jours) ou d'une année (→ mois). */
    pick: (d: Date, next: CalendarView) => {
      setMonth(addMonths(d, -anchor));
      setView(next);
    },
    /** Remise à zéro à l'ouverture du calendrier. */
    reset: (d?: Date) => {
      setView("days");
      setAnchor(0);
      setMonth(startOfMonth(d ?? new Date()));
    },
  };
}

/* ------------------------------------------------------------------ */
/* DateInput (calendrier)                                              */
/* ------------------------------------------------------------------ */

const toYmd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const labelFr = (ymd: string) =>
  ymd
    ? new Date(`${ymd}T00:00:00`).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : "";

export function DateInput({
  value,
  onChange,
  placeholder = "Choisir une date",
  className = "",
  min,
}: {
  value: string;
  onChange: (ymd: string) => void;
  placeholder?: string;
  className?: string;
  min?: string; // "YYYY-MM-DD" — désactive les jours antérieurs
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const selected = value ? new Date(`${value}T00:00:00`) : undefined;
  const nav = useCalendarNav(selected);

  const CAL_W = 300;
  const CAL_H = 360;
  const openPicker = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const left = Math.max(8, Math.min(r.left, window.innerWidth - CAL_W - 8));
      const spaceBelow = window.innerHeight - r.bottom;
      const top = spaceBelow > CAL_H + 8 ? r.bottom + 4 : Math.max(8, r.top - CAL_H - 4);
      setPos({ left, top });
    }
    nav.reset(selected);
    setOpen(true);
  };

  return (
    <div className={`relative ${className}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPicker())}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-900 outline-none transition hover:border-brand-400 focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        <span className={value ? "" : "text-slate-400"}>{value ? labelFr(value) : placeholder}</span>
        <span className="text-sm">📅</span>
      </button>
      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
            <div
              className="fixed z-[61] rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900"
              style={{ left: pos.left, top: pos.top }}
            >
              {nav.view === "days" ? (
                <DayPicker
                  mode="single"
                  locale={fr}
                  weekStartsOn={1}
                  selected={selected}
                  month={nav.month}
                  onMonthChange={nav.setMonth}
                  components={{ MonthCaption: nav.MonthCaption }}
                  disabled={min ? { before: new Date(`${min}T00:00:00`) } : undefined}
                  onSelect={(d) => {
                    if (d) {
                      onChange(toYmd(d));
                      setOpen(false);
                    }
                  }}
                />
              ) : (
                <MonthYearPanel
                  view={nav.view}
                  base={nav.base}
                  onViewChange={nav.setView}
                  onBaseChange={nav.setBase}
                  onPick={nav.pick}
                />
              )}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* DateTimeInput — date (calendrier) + heure, deux champs séparés      */
/* ------------------------------------------------------------------ */

export function TimeInput({
  value,
  onChange,
  className = "",
}: {
  value: string; // "HH:mm"
  onChange: (value: string) => void;
  className?: string;
}) {
  const [h, m] = value && value.includes(":") ? value.split(":") : ["", ""];
  const set = (hh: string, mm: string) => {
    if (!hh && !mm) return onChange("");
    onChange(`${(hh || "00").padStart(2, "0")}:${(mm || "00").padStart(2, "0")}`);
  };
  const opts = (n: number) =>
    Array.from({ length: n }, (_, i) => {
      const v = String(i).padStart(2, "0");
      return { value: v, label: v };
    });
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <Select value={h} onChange={(v) => set(v, m)} options={opts(24)} placeholder="HH" className="w-[4.25rem]" />
      <span className="text-slate-400">:</span>
      <Select value={m} onChange={(v) => set(h, v)} options={opts(60)} placeholder="MM" className="w-[4.25rem]" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* DateRangeCalendar — calendrier 2 mois, sélection d'une période       */
/* ------------------------------------------------------------------ */

export function DateRangeCalendar({
  start,
  end,
  onChange,
  className = "",
  months = 2,
  bare = false,
}: {
  start: string; // "YYYY-MM-DD"
  end: string; // "YYYY-MM-DD"
  onChange: (start: string, end: string) => void;
  className?: string;
  months?: number; // nombre de mois affichés (défaut 2)
  bare?: boolean; // sans bordure/fond/padding (pour l'imbriquer dans un conteneur déjà stylé)
}) {
  const from = start ? new Date(`${start}T00:00:00`) : undefined;
  const to = end ? new Date(`${end}T00:00:00`) : undefined;
  const nav = useCalendarNav(from);
  // Couleurs et tailles du calendrier : variables `--rdp-*` dans index.css
  // (react-day-picker les déclare sur `.rdp-root`, une surcharge ici serait ignorée).
  return (
    <div
      className={`text-sm ${
        bare
          ? ""
          : "rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900"
      } ${className}`}
    >
      {nav.view === "days" ? (
        <DayPicker
          mode="range"
          numberOfMonths={months}
          locale={fr}
          weekStartsOn={1}
          selected={{ from, to }}
          month={nav.month}
          onMonthChange={nav.setMonth}
          components={{ MonthCaption: nav.MonthCaption }}
          // Mois empilés sur mobile (pas de scroll horizontal), côte à côte dès md.
          // On garde `rdp-months` : la classe par défaut porte le positionnement de la nav.
          classNames={{
            months:
              "rdp-months flex-col items-center gap-4 md:flex-row md:flex-nowrap md:items-start md:justify-center",
          }}
          onSelect={(range) =>
            onChange(range?.from ? toYmd(range.from) : "", range?.to ? toYmd(range.to) : "")
          }
        />
      ) : (
        <div className="flex justify-center">
          <MonthYearPanel
            view={nav.view}
            base={nav.base}
            onViewChange={nav.setView}
            onBaseChange={nav.setBase}
            onPick={nav.pick}
          />
        </div>
      )}
    </div>
  );
}

export function DateTimeInput({
  value,
  onChange,
  className = "",
  min,
}: {
  value: string; // "YYYY-MM-DD" ou "YYYY-MM-DDTHH:mm"
  onChange: (value: string) => void;
  className?: string;
  min?: string; // "YYYY-MM-DD" — désactive les jours antérieurs
}) {
  const [datePart, t] = value ? value.split("T") : ["", ""];
  const timePart = (t ?? "").slice(0, 5);
  const set = (d: string, time: string) => {
    if (!d) return onChange("");
    onChange(time ? `${d}T${time}` : d);
  };
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <DateInput value={datePart ?? ""} onChange={(d) => set(d, timePart)} className="min-w-[150px] flex-1" min={min} />
      <TimeInput value={timePart} onChange={(time) => set(datePart ?? "", time)} />
    </div>
  );
}
