import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ShoppingItem, ShoppingFavorite } from "@gfa/shared";
import { api } from "../lib/api";
import PageLoader from "../components/PageLoader";
import { Input } from "../components/ui";
import { searchProducts, iconFor } from "../lib/groceries";

/**
 * Courses : uniquement la liste à acheter (un seul écran, donc pas de
 * sous-menu). Recettes et idées repas vivent dans la page « Repas »
 * ([`Repas.tsx`](./Repas.tsx)).
 */
export default function Courses() {
  return <ShoppingList />;
}

/* ---------------- À acheter (style Bring!) ---------------- */

// Affichage : une majuscule au début de chaque mot (sans toucher au stockage).
const titleCase = (s: string) =>
  s.replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());

// Formulaire d'ajout d'un article (réutilisé inline sur ordinateur et en modale
// sur mobile). Gère sa propre saisie + suggestions ; se vide après ajout.
function AddArticleForm({
  onAdd,
  onFavorite,
  autoFocus,
}: {
  onAdd: (name: string) => void;
  onFavorite: (name: string) => void;
  autoFocus?: boolean;
}) {
  const [name, setName] = useState("");
  const suggestions = searchProducts(name);
  const submit = (n: string) => {
    if (n.trim()) {
      onAdd(n.trim());
      setName("");
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(name);
      }}
      className="space-y-2"
    >
      <div className="flex gap-2">
        <Input
          autoFocus={autoFocus}
          placeholder="Ajouter un article…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="flex shrink-0 gap-2">
          <button className="btn-primary">Ajouter</button>
          <button
            type="button"
            disabled={!name.trim()}
            onClick={() => {
              if (name.trim()) {
                onFavorite(name.trim());
                setName("");
              }
            }}
            className="flex items-center rounded-xl border border-brand-600 bg-white px-3 text-brand-600 transition hover:bg-brand-600 hover:text-white disabled:opacity-40 dark:bg-slate-900"
            title="Mettre en favoris"
          >
            ★
          </button>
        </div>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => submit(p.name)}
              className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm hover:border-brand-400 hover:bg-brand-50 dark:border-slate-700 dark:bg-slate-800"
            >
              <span>{p.emoji}</span>
              {p.name}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}

function ShoppingList() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  // Snackbar « annuler » après suppression d'un article (4 s).
  const [undo, setUndo] = useState<{ name: string; quantity: number } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>();
  // Articles en cours de suppression → loader dans la tuile (feedback mobile).
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const { data } = useQuery({
    queryKey: ["shopping-items"],
    queryFn: () => api.get<ShoppingItem[]>("/api/courses/items"),
  });
  const listLoading = !data;
  const { data: favorites } = useQuery({
    queryKey: ["shopping-favorites"],
    queryFn: () => api.get<ShoppingFavorite[]>("/api/courses/favorites"),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["shopping-items"] });
  const invalidateFav = () => qc.invalidateQueries({ queryKey: ["shopping-favorites"] });

  const add = useMutation({
    mutationFn: (n: string) => api.post("/api/courses/items", { name: n }),
    onSuccess: invalidate,
  });
  const setQty = useMutation({
    mutationFn: ({ id, quantity }: { id: string; quantity: number }) =>
      api.patch(`/api/courses/items/${id}`, { quantity }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/courses/items/${id}`),
    onSuccess: invalidate,
  });
  // Restaure un article supprimé (répète le nom pour retrouver sa quantité).
  const restore = useMutation({
    mutationFn: ({ name, quantity }: { name: string; quantity: number }) =>
      api.post("/api/courses/items/bulk", { names: Array(Math.max(1, quantity)).fill(name) }),
    onSuccess: invalidate,
  });

  const clearUndo = () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(null);
  };
  // Supprime un article et propose l'annulation pendant 4 s.
  const deleteItem = (it: ShoppingItem) => {
    setDeletingIds((prev) => new Set(prev).add(it.id));
    remove.mutate(it.id, {
      onSettled: () =>
        setDeletingIds((prev) => {
          const next = new Set(prev);
          next.delete(it.id);
          return next;
        }),
    });
    setUndo({ name: it.name, quantity: it.quantity });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 4000);
  };
  const undoDelete = () => {
    if (undo) restore.mutate(undo);
    clearUndo();
  };
  const addFavorite = useMutation({
    mutationFn: (n: string) => api.post("/api/courses/favorites", { name: n }),
    onSuccess: invalidateFav,
  });
  const removeFavorite = useMutation({
    mutationFn: (id: string) => api.del(`/api/courses/favorites/${id}`),
    onSuccess: invalidateFav,
  });

  const sortedFavorites = [...(favorites ?? [])].sort((a, b) => a.name.localeCompare(b.name, "fr"));

  if (listLoading) return <PageLoader variant="repas" />;

  return (
    <div className="space-y-4 pb-24 md:pb-0">
      {/* Ordinateur : formulaire d'ajout inline. Mobile : FAB + modale (ci-dessous). */}
      <div className="card hidden md:block">
        <AddArticleForm
          onAdd={(n) => add.mutate(n)}
          onFavorite={(n) => addFavorite.mutate(n)}
        />
      </div>

      <div className="card">
        <div className="mb-3 text-xs text-slate-400">
          Touche un produit pour le retirer · − / + pour la quantité.
        </div>
        {(data ?? []).length === 0 ? (
          <div className="text-sm text-slate-400">Ta liste est vide. 🎉</div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {data!.map((it) => {
              const deleting = deletingIds.has(it.id);
              return (
              <div
                key={it.id}
                className="relative flex aspect-square flex-col rounded-2xl bg-brand-100 dark:bg-brand-600/20"
              >
                {deleting && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-brand-100/80 dark:bg-brand-600/40">
                    <svg
                      className="h-7 w-7 animate-spin text-brand-600 dark:text-brand-200"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-label="Suppression…"
                    >
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
                    </svg>
                  </div>
                )}
                <button
                  onClick={() => deleteItem(it)}
                  disabled={deleting}
                  className="flex flex-1 flex-col items-center justify-center gap-1 p-2 text-center"
                  title="Retirer de la liste"
                >
                  <span className="text-4xl leading-none">{iconFor(it.name)}</span>
                  <span className="line-clamp-2 text-xs font-medium leading-tight text-brand-800 dark:text-brand-50">
                    {titleCase(it.name)}
                  </span>
                </button>
                {it.quantity > 1 && (
                  <span className="absolute bottom-1 left-1 rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    ×{it.quantity}
                  </span>
                )}
                {/* − en haut à gauche, + en haut à droite */}
                <button
                  onClick={() => setQty.mutate({ id: it.id, quantity: it.quantity - 1 })}
                  className="absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-brand-300/60 bg-white/70 text-brand-700 hover:bg-brand-50 dark:border-brand-500/30 dark:bg-slate-900/70 dark:text-brand-100 dark:hover:bg-slate-800"
                  title={it.quantity > 1 ? "Diminuer" : "Retirer"}
                >
                  −
                </button>
                <button
                  onClick={() => setQty.mutate({ id: it.id, quantity: it.quantity + 1 })}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-brand-300/60 bg-white/70 text-brand-700 hover:bg-brand-50 dark:border-brand-500/30 dark:bg-slate-900/70 dark:text-brand-100 dark:hover:bg-slate-800"
                  title="Augmenter"
                >
                  +
                </button>
              </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card">
        <div className="mb-2 text-sm font-semibold">
          Favoris <span className="text-xs font-normal text-slate-400">— touche pour ajouter à la liste</span>
        </div>
        {sortedFavorites.length === 0 ? (
          <div className="text-sm text-slate-400">
            Aucun favori. Tape un produit puis touche ★.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sortedFavorites.map((f) => (
              <div
                key={f.id}
                className="group flex items-center gap-1.5 rounded-full border border-slate-200 bg-white py-1 pl-3 pr-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <button
                  onClick={() => add.mutate(f.name)}
                  className="flex items-center gap-1.5"
                  title="Ajouter à la liste"
                >
                  <span className="text-base">{iconFor(f.name)}</span>
                  {titleCase(f.name)}
                </button>
                <button
                  onClick={() => removeFavorite.mutate(f.id)}
                  className="ml-0.5 text-slate-300 opacity-0 transition group-hover:opacity-100 hover:text-red-500"
                  title="Retirer des favoris"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Snackbar d'annulation après suppression. */}
      {undo && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-3 rounded-xl bg-slate-900 px-4 py-2.5 text-sm text-white shadow-lg dark:bg-slate-700">
            <span>« {titleCase(undo.name)} » supprimé</span>
            <button
              onClick={undoDelete}
              className="font-semibold text-brand-300 hover:text-brand-200"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Mobile : bouton flottant + modale d'ajout. */}
      <button
        type="button"
        onClick={() => setAddOpen(true)}
        aria-label="Ajouter un article"
        className="btn-primary fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full p-0 shadow-lg md:hidden"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="h-6 w-6"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      {addOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center md:hidden"
          onClick={() => setAddOpen(false)}
        >
          <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Ajouter un article</h2>
              <button onClick={() => setAddOpen(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            <AddArticleForm
              autoFocus
              onAdd={(n) => add.mutate(n)}
              onFavorite={(n) => addFavorite.mutate(n)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
