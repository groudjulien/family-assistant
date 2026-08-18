import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_SHOPPING_CATEGORIES,
  FALLBACK_SHOPPING_CATEGORY,
  categoryFor,
  iconFor,
  searchProducts,
  type ShoppingCategory,
  type ShoppingItem,
} from "@gfa/shared";
import { api } from "../lib/api";
import PageLoader from "../components/PageLoader";
import { Input, MobileActionBar, Select, Switch } from "../components/ui";
import { usePageHeader } from "../components/PageHeader";
import { useMe } from "../auth";

/**
 * Courses : uniquement la liste à acheter (un seul écran, donc pas de
 * sous-menu). Recettes et idées repas vivent dans la page « Repas »
 * ([`Repas.tsx`](./Repas.tsx)).
 */
export default function Courses() {
  return <ShoppingList />;
}

// Affichage : une majuscule au début de chaque mot (sans toucher au stockage).
const titleCase = (s: string) =>
  s.replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());

/** Rayons du foyer (Réglages → Courses), sinon les rayons par défaut. */
function useShoppingCategories(): ShoppingCategory[] {
  const me = useMe();
  return useMemo(
    () => me.shoppingCategories ?? DEFAULT_SHOPPING_CATEGORIES.map((c) => ({ ...c })),
    [me.shoppingCategories],
  );
}

/**
 * Formulaire d'ajout. Le rayon est pré-rempli dès que le produit est reconnu du
 * catalogue ; sinon il reste sur le rayon de repli, et c'est à la saisie de le
 * corriger — d'où le sélecteur toujours visible.
 */
function AddArticleForm({
  onAdd,
  autoFocus,
}: {
  onAdd: (name: string, category: string) => void;
  autoFocus?: boolean;
}) {
  const categories = useShoppingCategories();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string | null>(null); // null = déduit du nom
  const suggestions = searchProducts(name);

  /** Rayon du catalogue, ramené au repli s'il a été supprimé des réglages. */
  const guessFor = (value: string) => {
    const key = value.trim() ? categoryFor(value) : FALLBACK_SHOPPING_CATEGORY;
    return categories.some((c) => c.key === key) ? key : FALLBACK_SHOPPING_CATEGORY;
  };
  // Ce que montre le sélecteur : le choix explicite, sinon le rayon déduit.
  const effective = category ?? guessFor(name);

  const submit = (value: string, cat?: string) => {
    const n = value.trim();
    if (!n) return;
    onAdd(n, cat ?? category ?? guessFor(n));
    setName("");
    setCategory(null);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(name);
      }}
      className="space-y-3"
    >
      <Input
        autoFocus={autoFocus}
        placeholder="Ajouter un article…"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => submit(p.name, guessFor(p.name))}
              className="flex min-h-tap items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-sm hover:bg-surface-2"
            >
              <span>{p.emoji}</span>
              {p.name}
            </button>
          ))}
        </div>
      )}
      <div>
        <div className="mb-1 text-xs text-ink-2">Rayon</div>
        <Select
          value={effective}
          onChange={setCategory}
          options={categories.map((c) => ({ value: c.key, label: c.name }))}
        />
      </div>
      <button className="btn-primary w-full">Ajouter</button>
    </form>
  );
}

/* ---------------- Liste mobile, par rayon ---------------- */

function AisleRow({
  item,
  pending,
  onCheck,
  onQty,
  last,
}: {
  item: ShoppingItem;
  /** Retrait en cours : la rangée s'estompe le temps de l'aller-retour réseau. */
  pending: boolean;
  onCheck: () => void;
  onQty: (quantity: number) => void;
  last: boolean;
}) {
  return (
    <div
      className={`flex min-h-16 items-center gap-3 ${last ? "" : "border-b border-hairline"} ${
        pending ? "opacity-40" : ""
      }`}
    >
      <button
        type="button"
        onClick={onCheck}
        disabled={pending}
        role="checkbox"
        aria-checked={false}
        aria-label={`${item.name} : pris`}
        className="-ml-2 flex h-tap w-tap shrink-0 items-center justify-center"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-base leading-none transition dark:border-slate-600 dark:bg-slate-800" />
      </button>
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-xl"
      >
        {iconFor(item.name)}
      </span>
      {/* Pas de `truncate` : un nom long doit rester lisible en rayon, quitte à
          passer sur deux lignes (la rangée grandit). */}
      <span className="min-w-0 flex-1 py-2 font-medium">{titleCase(item.name)}</span>
      <div className="flex shrink-0 items-center">
        <button
          type="button"
          onClick={() => onQty(item.quantity - 1)}
          aria-label="Diminuer la quantité"
          className="flex h-tap w-10 items-center justify-center text-xl font-semibold text-ink-2"
        >
          −
        </button>
        <span className="min-w-6 text-center font-semibold">{item.quantity}</span>
        <button
          type="button"
          onClick={() => onQty(item.quantity + 1)}
          aria-label="Augmenter la quantité"
          className="flex h-tap w-10 items-center justify-center text-xl font-semibold text-brand-600"
        >
          +
        </button>
      </div>
    </div>
  );
}

/* ---------------- Page ---------------- */

function ShoppingList() {
  const qc = useQueryClient();
  const categories = useShoppingCategories();
  const [addOpen, setAddOpen] = useState(false);
  /**
   * Mode recette (ordinateur) : on ajuste les quantités et une tuile ne se
   * supprime plus au clic. Sans objet sur mobile, dont la liste porte déjà des
   * boutons − / + permanents.
   */
  const [recipeMode, setRecipeMode] = useState(() => {
    try {
      return localStorage.getItem("courses:recipeMode") === "1";
    } catch {
      return false;
    }
  });
  const toggleRecipeMode = () =>
    setRecipeMode((v) => {
      const next = !v;
      try {
        localStorage.setItem("courses:recipeMode", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
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
  const invalidate = () => qc.invalidateQueries({ queryKey: ["shopping-items"] });

  const add = useMutation({
    mutationFn: ({ name, category }: { name: string; category: string }) =>
      api.post("/api/courses/items", { name, category }),
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

  const items = data ?? [];
  const remaining = items.length;
  usePageHeader(
    "Courses",
    remaining > 0 ? `Liste commune · ${remaining} article${remaining > 1 ? "s" : ""}` : "Liste commune",
  );

  // Un rayon inconnu (supprimé des réglages) retombe sur le rayon de repli.
  const known = new Set(categories.map((c) => c.key));
  const aisleOf = (it: ShoppingItem) =>
    it.category && known.has(it.category) ? it.category : FALLBACK_SHOPPING_CATEGORY;
  const aisles = categories
    .map((c) => ({ ...c, items: items.filter((it) => aisleOf(it) === c.key) }))
    .filter((a) => a.items.length > 0);

  if (listLoading) return <PageLoader variant="repas" />;

  return (
    <div className="flex flex-col gap-4 pb-28 md:pb-0">
      {/* Ordinateur : formulaire d'ajout inline. Mobile : barre d'action + modale. */}
      <div className="card hidden md:block">
        <AddArticleForm onAdd={(name, category) => add.mutate({ name, category })} />
      </div>

      {items.length === 0 ? (
        <div className="card text-center">
          <div className="font-semibold">Ta liste est vide. 🎉</div>
          <button onClick={() => setAddOpen(true)} className="btn-primary mt-3">
            Ajouter un produit
          </button>
        </div>
      ) : (
        <>
          {/* Mobile : liste par rayon. */}
          <div className="flex flex-col gap-5 md:hidden">
            {aisles.map((a) => {
              return (
                <div key={a.key}>
                  <div className="mb-2 flex items-baseline justify-between px-0.5">
                    <div className="eyebrow">{a.name}</div>
                    <div className="text-xs text-ink-2">
                      {a.items.length} à prendre
                    </div>
                  </div>
                  <div className="card px-4 py-0">
                    {a.items.map((it, i) => (
                      <AisleRow
                        key={it.id}
                        item={it}
                        pending={deletingIds.has(it.id)}
                        onCheck={() => deleteItem(it)}
                        onQty={(q) => (q <= 0 ? deleteItem(it) : setQty.mutate({ id: it.id, quantity: q }))}
                        last={i === a.items.length - 1}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Ordinateur : tuiles. */}
          <div className="card hidden md:block">
            <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
              <Switch checked={recipeMode} onChange={toggleRecipeMode} label="Activer le mode recette" />
              <span>
                {recipeMode
                  ? "· Touche à gauche / à droite d'un produit pour sa quantité."
                  : "· Touche un produit pour le retirer."}
              </span>
            </div>
            {aisles.map((a) => (
              <div key={a.key} className="mb-4 last:mb-0">
                <div className="eyebrow mb-2">{a.name}</div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                  {a.items.map((it) => {
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
                        {recipeMode ? (
                          <div className="flex flex-1 flex-col items-center justify-center gap-1 p-2 text-center">
                            <span className="text-4xl leading-none">{iconFor(it.name)}</span>
                            <span className="line-clamp-2 text-xs font-medium leading-tight text-brand-800 dark:text-brand-50">
                              {titleCase(it.name)}
                            </span>
                          </div>
                        ) : (
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
                        )}
                        {it.quantity > 1 && (
                          // `pointer-events-none` : la pastille ne doit pas absorber le clic
                          // de la moitié gauche en mode recette.
                          <span className="pointer-events-none absolute bottom-1 left-1 rounded-full bg-brand-600 px-1.5 py-0.5 text-2xs font-bold text-on-brand">
                            ×{it.quantity}
                          </span>
                        )}
                        {recipeMode && (
                          <>
                            <button
                              onClick={() => setQty.mutate({ id: it.id, quantity: it.quantity - 1 })}
                              className="group/qty absolute inset-y-0 left-0 flex w-1/2 items-center justify-start pl-1"
                              title={it.quantity > 1 ? "Diminuer" : "Retirer"}
                              aria-label="Diminuer la quantité"
                            >
                              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-ink-2">
                                −
                              </span>
                            </button>
                            <button
                              onClick={() => setQty.mutate({ id: it.id, quantity: it.quantity + 1 })}
                              className="group/qty absolute inset-y-0 right-0 flex w-1/2 items-center justify-end pr-1"
                              title="Augmenter"
                              aria-label="Augmenter la quantité"
                            >
                              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-brand-600">
                                +
                              </span>
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Notification d'annulation : un article coché part tout de suite, celle-ci
          laisse 4 s pour le remettre. Posée au-dessus de la barre d'action sur
          mobile (`bottom-24`) pour ne pas la recouvrir. */}
      {undo && (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-4 md:bottom-6"
        >
          <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-line bg-surface-2 py-1.5 pl-4 pr-1.5 text-sm shadow-xl">
            <span aria-hidden="true">{iconFor(undo.name)}</span>
            <span className="min-w-0 truncate">
              <b className="font-semibold">{titleCase(undo.name)}</b> retiré
            </span>
            <button
              onClick={undoDelete}
              className="flex min-h-tap shrink-0 items-center rounded-full px-3 font-semibold text-brand-600 hover:bg-surface"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      <MobileActionBar label="Ajouter un produit" onClick={() => setAddOpen(true)} />

      {addOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
          onClick={() => setAddOpen(false)}
        >
          <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Ajouter un produit</h2>
              <button
                onClick={() => setAddOpen(false)}
                aria-label="Fermer"
                className="text-ink-2 hover:text-ink"
              >
                ✕
              </button>
            </div>
            <AddArticleForm
              autoFocus
              onAdd={(name, category) => {
                add.mutate({ name, category });
                setAddOpen(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
