import { useState, type FormEvent, type ReactNode } from "react";
import type { ExpenseCategory } from "@gfa/shared";
import { Select, Input, DateInput } from "./ui";
import { MemberAvatar, usePersonMeta } from "./MemberAvatar";
import { eurToCents, todayIso } from "../lib/format";

// Valeurs calculées d'une dépense partagée (centimes signés, négatif = dépense).
export type ExpenseFormValues = {
  label: string;
  paidBy: "a" | "b";
  amount: number;
  shareA: number;
  shareB: number;
  date: string;
  category?: string | null;
};

/**
 * Clé de répartition : clé du foyer, moitié-moitié, ou 100 % à la charge d'un
 * membre (achat avancé pour l'autre — la dépense part alors entièrement en dette).
 */
type SplitMode = "key" | "50" | "a" | "b";

// Formulaire réutilisable de dépense partagée (équilibrage + dépenses de voyage).
export function ExpenseFormModal({
  title,
  initial,
  splitA,
  splitB,
  categories,
  initialCategory,
  pending,
  switcher,
  onClose,
  onSave,
}: {
  title: string;
  initial?: { paidBy: "a" | "b"; label: string; amount: number; date: string };
  splitA: number;
  splitB: number;
  categories?: ExpenseCategory[]; // catégories sélectionnables (voyage). Absent = pas de sélecteur.
  // undefined = nouvelle dépense (défaut) ; null = sans catégorie ; sinon la clé.
  initialCategory?: string | null;
  pending?: boolean;
  /** Bascule posée sous le titre (dépense partagée ↔ remboursement). */
  switcher?: ReactNode;
  onClose: () => void;
  onSave: (v: ExpenseFormValues) => void;
}) {
  const personMeta = usePersonMeta();
  const defaultCategory =
    categories && categories.length
      ? categories.find((c) => c.key === "nourriture")?.key ?? categories[0].key
      : null;
  const [form, setForm] = useState({
    paidBy: initial?.paidBy ?? ("a" as "a" | "b"),
    label: initial?.label ?? "",
    amount: initial?.amount ?? 0,
    date: initial?.date ?? todayIso(),
    // key = clé du foyer, 50 = moitié-moitié, a/b = 100 % à charge de ce membre
    split: "key" as SplitMode,
    category: (initialCategory !== undefined ? initialCategory : defaultCategory) as string | null,
  });
  // Champs obligatoires manquants après une tentative d'envoi (bordure rouge).
  const [errors, setErrors] = useState<{ label?: boolean; amount?: boolean }>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const missing = { label: !form.label.trim(), amount: !(form.amount > 0) };
    if (missing.label || missing.amount) {
      setErrors(missing);
      return;
    }
    const cents = eurToCents(form.amount);
    const aShare =
      form.split === "50"
        ? Math.round(cents / 2)
        : form.split === "a"
          ? cents
          : form.split === "b"
            ? 0
            : Math.round((cents * splitA) / 100);
    const bShare = cents - aShare;
    onSave({
      label: form.label,
      paidBy: form.paidBy,
      amount: -cents,
      shareA: -aShare,
      shareB: -bShare,
      date: form.date,
      ...(categories && { category: form.category }),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        {switcher && <div className="mb-3">{switcher}</div>}
        <form onSubmit={submit} className="space-y-3">
          <div className="text-xs text-slate-400">
            Qui a payé ?
            <div className="mt-1 flex gap-3">
              {(["a", "b"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setForm({ ...form, paidBy: m })}
                  aria-label={personMeta(m)?.name ?? m}
                  aria-pressed={form.paidBy === m}
                  className={`rounded-full p-0.5 transition ${
                    form.paidBy === m
                      ? "ring-2 ring-brand-500"
                      : "opacity-40 hover:opacity-100"
                  }`}
                >
                  <MemberAvatar id={m} className="h-10 w-10 text-sm" />
                </button>
              ))}
            </div>
          </div>
          {categories && categories.length > 0 && (
            <div className="text-xs text-slate-400">
              Catégorie
              <div className="mt-1 flex flex-wrap gap-2">
                {categories.map((c) => {
                  const active = form.category === c.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setForm({ ...form, category: active ? null : c.key })}
                      aria-pressed={active}
                      title={c.name}
                      className={`flex h-10 w-10 items-center justify-center rounded-full text-lg transition ${
                        active
                          ? "bg-brand-100 ring-2 ring-brand-500 dark:bg-brand-600/20"
                          : "bg-slate-100 opacity-50 hover:opacity-100 dark:bg-slate-800"
                      }`}
                    >
                      {c.icon}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <Input
            autoFocus
            placeholder="Description"
            value={form.label}
            onChange={(e) => {
              setForm({ ...form, label: e.target.value });
              if (errors.label) setErrors({ ...errors, label: false });
            }}
            // style inline : la classe .input (hors layer) écraserait une utilité border-*
            style={errors.label ? { borderColor: "#ef4444" } : undefined}
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-400">
              Montant (€)
              <Input
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => {
                  setForm({ ...form, amount: Number(e.target.value) });
                  if (errors.amount) setErrors({ ...errors, amount: false });
                }}
                style={errors.amount ? { borderColor: "#ef4444" } : undefined}
              />
            </label>
            <div className="text-xs text-slate-400">
              Date
              <DateInput value={form.date} onChange={(d) => setForm({ ...form, date: d })} />
            </div>
          </div>
          <div className="text-xs text-slate-400">
            Répartition
            <Select
              value={form.split}
              onChange={(v) => setForm({ ...form, split: v as SplitMode })}
              options={[
                { value: "key", label: `Clé du foyer (${splitA}/${splitB})` },
                { value: "50", label: "50 / 50" },
                { value: "a", label: `100 % pour ${personMeta("a")?.name ?? "A"}` },
                { value: "b", label: `100 % pour ${personMeta("b")?.name ?? "B"}` },
              ]}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost">
              Annuler
            </button>
            <button className="btn-primary" disabled={pending}>
              {pending ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
