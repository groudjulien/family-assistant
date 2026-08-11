import type { ReactNode } from "react";
import { eur0 } from "../lib/format";

export type IndicatorTone = "default" | "green" | "orange" | "red";

// Carte indicateur : nom (1re ligne) + valeur alignée en bas à droite (2e ligne).
// `money` formate un nombre de centimes en euros. `tone` colore la carte.
const TONES: Record<IndicatorTone, { card: string; value: string }> = {
  default: {
    card: "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900",
    value: "text-slate-900 dark:text-slate-100",
  },
  green: {
    card: "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/40",
    value: "text-green-700 dark:text-green-300",
  },
  orange: {
    card: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40",
    value: "text-amber-700 dark:text-amber-300",
  },
  red: {
    card: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40",
    value: "text-red-700 dark:text-red-300",
  },
};

export function Indicator({
  label,
  value,
  tone = "default",
  money = false,
}: {
  label: string;
  value: ReactNode;
  tone?: IndicatorTone;
  /** true = `value` est un montant en centimes, affiché en euros. */
  money?: boolean;
}) {
  const t = TONES[tone];
  const display = money && typeof value === "number" ? eur0(value) : value;
  return (
    <div className={`flex h-full flex-col rounded-2xl border p-4 shadow-sm ${t.card}`}>
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-auto pt-1 text-right text-xl font-bold ${t.value}`}>{display}</div>
    </div>
  );
}
