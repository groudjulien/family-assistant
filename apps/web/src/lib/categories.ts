import { DEFAULT_EXPENSE_CATEGORIES, type ExpenseCategory } from "@gfa/shared";
import { useMe } from "../auth";

/** Catégories de dépenses du foyer (config perso, sinon les défauts). */
export function useExpenseCategories(): ExpenseCategory[] {
  const me = useMe();
  return me.expenseCategories ?? DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c }));
}

/** Icône + libellé d'une clé de catégorie (repli générique si clé inconnue). */
export function categoryMeta(
  cats: ExpenseCategory[],
  key: string | null,
): { name: string; icon: string } | null {
  if (!key) return null;
  const c = cats.find((x) => x.key === key);
  return c ? { name: c.name, icon: c.icon } : { name: key, icon: "🏷️" };
}
