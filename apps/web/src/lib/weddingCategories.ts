import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WeddingCategory } from "@gfa/shared";
import { api } from "./api";

/**
 * Les catégories du mariage — une seule liste pour les tags de foyer et les
 * catégories de personne.
 *
 * Elle part vide et se remplit depuis n'importe quel sélecteur : `create`
 * ajoute la catégorie et rend son identifiant, à charge de l'appelant de la
 * poser où il voulait.
 *
 * À ne pas confondre avec `categories.ts`, qui porte les catégories de
 * **dépenses** du foyer organisateur.
 */
export const WEDDING_CATEGORIES_KEY = ["wedding-categories"] as const;

export function useWeddingCategories() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: WEDDING_CATEGORIES_KEY,
    queryFn: () => api.get<WeddingCategory[]>("/api/wedding/categories"),
  });

  const save = useMutation({
    mutationFn: (categories: WeddingCategory[]) =>
      api.put<WeddingCategory[]>("/api/wedding/categories", { categories }),
    onSuccess: (next) => qc.setQueryData(WEDDING_CATEGORIES_KEY, next),
  });

  /**
   * La liste est relue dans le cache au moment d'écrire, pas au rendu : deux
   * créations rapprochées repartiraient sinon de la même photo, et la seconde
   * effacerait la première.
   */
  const current = () => qc.getQueryData<WeddingCategory[]>(WEDDING_CATEGORIES_KEY) ?? [];

  const create = async (name: string): Promise<string> => {
    const clean = name.trim().slice(0, 40);
    if (!clean) return "";
    // Deux fois le même nom, c'est deux fois la même intention : on rend
    // l'existante plutôt que de créer un doublon indistinguable.
    const existing = current().find((c) => c.name.trim().toLowerCase() === clean.toLowerCase());
    if (existing) return existing.id;
    const id = crypto.randomUUID().slice(0, 8);
    await save.mutateAsync([...current(), { id, name: clean }]);
    return id;
  };

  const rename = (id: string, name: string) =>
    save.mutate(current().map((c) => (c.id === id ? { ...c, name: name.trim().slice(0, 40) } : c)));

  /**
   * Retirer une catégorie de la liste ne la retire pas des invités qui la
   * portent : elle cesse d'être proposée, et les conditions qui la citaient ne
   * trouvent plus personne. La recréer sous le même nom ne les retrouve pas
   * non plus — l'identifiant serait neuf. L'UI doit donc le dire.
   */
  const remove = (id: string) => save.mutate(current().filter((c) => c.id !== id));

  return {
    list: data ?? [],
    loading: data === undefined,
    create,
    rename,
    remove,
    saving: save.isPending,
  };
}
