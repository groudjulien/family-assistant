import { useState, useRef, useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Recipe, RecipeIdea, MeatType, StarchType, CourseType } from "@gfa/shared";
import { MEAT_TYPES, MEAT_META, STARCH_TYPES, STARCH_META, COURSE_TYPES, COURSE_META } from "@gfa/shared";
import { api, ApiError } from "../lib/api";
import { dateFr } from "../lib/format";
import PageLoader from "../components/PageLoader";
import { Input, Checkbox, Select, SearchSelect, SubNav, GestureHelp } from "../components/ui";
import { useToast } from "../components/Toast";

/**
 * Trois menus de même niveau (plus de sous-menu sous « Idées repas »). Les URLs
 * des deux derniers restent celles d'origine (`/repas/idees/…`) : liens
 * partagés et chemins mémorisés continuent de fonctionner.
 */
type Tab = "recettes" | "semaine" | "nouvelles";
const TABS: { id: Tab; label: string; icon: string; path: string }[] = [
  { id: "recettes", label: "Mes recettes", icon: "📖", path: "/repas/recettes" },
  { id: "semaine", label: "Menu", icon: "📅", path: "/repas/idees/semaine" },
  { id: "nouvelles", label: "Idées repas", icon: "💡", path: "/repas/idees/nouvelles" },
];

export default function Repas() {
  const navigate = useNavigate();
  const { tab: tabParam, view: viewParam } = useParams();
  const tab: Tab =
    tabParam === "idees" ? (viewParam === "nouvelles" ? "nouvelles" : "semaine") : "recettes";

  return (
    <div className="space-y-4">
      <SubNav
        value={tab}
        onChange={(v) => navigate(TABS.find((t) => t.id === v)?.path ?? "/repas/recettes")}
        items={TABS.map((t) => ({ value: t.id, label: t.label, icon: t.icon }))}
      />
      {tab === "recettes" && <Recipes />}
      {tab === "semaine" && <WeekMealPlan />}
      {tab === "nouvelles" && <MealIdeas />}
    </div>
  );
}

/* ---------------- Recettes ---------------- */

function fmtDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

// Spécification du JSON d'import en masse — copiable telle quelle pour demander
// à Claude (ou autre) de générer un lot de recettes à coller dans l'onglet JSON.
const RECIPES_JSON_SPEC = `Génère un tableau JSON de recettes. Réponds UNIQUEMENT avec le JSON (pas de texte autour, pas de balises markdown). Chaque recette suit EXACTEMENT ce format :

[
  {
    "title": "Lasagnes à la bolognaise",
    "course": "plat",
    "servings": 4,
    "prepMinutes": 30,
    "totalMinutes": 90,
    "vegetarian": false,
    "meat": "boeuf",
    "starch": "pates",
    "vegetables": true,
    "ingredients": ["500 g de bœuf haché", "12 feuilles de lasagne", "70 cl de sauce tomate"],
    "steps": ["Préchauffer le four à 180 °C.", "Préparer la bolognaise…", "Monter les lasagnes et enfourner 45 min."]
  }
]

Règles :
- "course" : "entree", "plat" ou "dessert".
- "servings" : toujours 4 — adapte toutes les quantités des ingrédients pour 4 personnes.
- "prepMinutes" / "totalMinutes" : durées en minutes (nombre entier), ou null si inconnues.
- "meat" : "poulet", "veau", "porc", "boeuf", "agneau", "canard", "poisson", ou null (végétarien ou sans viande principale).
- "starch" : "pates", "riz", "patate", "semoule" ou "aucun".
- "vegetarian" : true si ni viande ni poisson. "vegetables" : true si le plat contient des légumes.
- "ingredients" : une ligne par ingrédient, avec la quantité (ex. "200 g de farine"). Ne pas lister sel et poivre.
- "steps" : des phrases d'instruction claires, dans l'ordre.
- Optionnel : "imageUrl" (URL publique d'une photo du plat) OU "imageBase64" (photo encodée en base64, format "data:image/jpeg;base64,…", idéalement ≤ 200 Ko — elle sera stockée et hébergée automatiquement). Omettre les deux si pas de photo.
- Tout est en français.`;

// Création de recette : import depuis une URL, un texte collé, ou un JSON de
// recettes complètes (import en masse, sans LLM). Affiché en modale.
// Recette vierge pour la création manuelle (une ligne d'ingrédient et d'étape prêtes).
const BLANK_RECIPE: Recipe = {
  id: "",
  title: "",
  sourceUrl: null,
  imageUrl: null,
  servings: 4,
  prepMinutes: null,
  totalMinutes: null,
  vegetarian: false,
  meat: null,
  starch: "aucun",
  vegetables: false,
  course: "plat",
  ingredients: [""],
  steps: [""],
  createdAt: "",
};

function RecipeImportForm({ onDone }: { onDone?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<"url" | "text" | "manual" | "json">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [json, setJson] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const importRecipe = useMutation({
    mutationFn: (payload: { url?: string; text?: string }) =>
      api.post("/api/courses/recipes/import", payload),
    onSuccess: () => {
      setUrl("");
      setText("");
      qc.invalidateQueries({ queryKey: ["recipes"] });
      onDone?.();
    },
  });
  const importBulk = useMutation({
    mutationFn: (recipes: unknown[]) =>
      api.post<{ inserted: number }>("/api/courses/recipes/bulk", { recipes }),
    onSuccess: (res) => {
      setJson("");
      qc.invalidateQueries({ queryKey: ["recipes"] });
      toast.success(`${res.inserted} recette${res.inserted > 1 ? "s" : ""} importée${res.inserted > 1 ? "s" : ""} !`);
      onDone?.();
    },
  });

  const importError =
    mode === "json"
      ? (jsonError ??
        (importBulk.error instanceof ApiError
          ? "Le JSON ne respecte pas le schéma attendu (utilise « Copier le schéma » pour le format exact)."
          : null))
      : importRecipe.error instanceof ApiError
        ? importRecipe.error.message.includes("no_recipe")
          ? mode === "url"
            ? "Cette publication ne contient pas la recette dans sa légende. Colle sa description via l'onglet « Texte »."
            : "Ce texte ne semble pas contenir de recette (ingrédients + instructions)."
          : "Impossible d'extraire cette recette. Tu peux coller sa description via l'onglet « Texte »."
        : null;
  const canSubmit =
    mode === "url" ? !!url.trim() : mode === "text" ? text.trim().length >= 20 : json.trim().length > 2;
  const pending = importRecipe.isPending || importBulk.isPending;

  const submitJson = () => {
    setJsonError(null);
    // Tolère les balises ```json``` autour (sortie brute d'un LLM).
    const raw = json.trim().match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? json.trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setJsonError("JSON invalide : vérifie la syntaxe (virgules, guillemets…).");
      return;
    }
    const recipes = Array.isArray(parsed)
      ? parsed
      : (parsed as { recipes?: unknown[] })?.recipes;
    if (!Array.isArray(recipes) || recipes.length === 0) {
      setJsonError("Le JSON doit être un tableau de recettes (ou { \"recipes\": [...] }).");
      return;
    }
    importBulk.mutate(recipes);
  };

  const copySpec = async () => {
    await navigator.clipboard.writeText(RECIPES_JSON_SPEC);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode("url")}
          className={`subtab ${mode === "url" ? "active" : ""}`}
        >
          🔗 Lien
        </button>
        <button
          type="button"
          onClick={() => setMode("text")}
          className={`subtab ${mode === "text" ? "active" : ""}`}
        >
          📋 Texte
        </button>
        <button
          type="button"
          onClick={() => setMode("manual")}
          className={`subtab ${mode === "manual" ? "active" : ""}`}
        >
          ✍️ Manuellement
        </button>
        <button
          type="button"
          onClick={() => setMode("json")}
          className={`subtab ${mode === "json" ? "active" : ""}`}
        >
          🧾 JSON
        </button>
      </div>

      {mode === "manual" ? (
        <RecipeEditor
          create
          recipe={BLANK_RECIPE}
          onClose={() => onDone?.()}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["recipes"] });
            toast.success("Recette créée !");
            onDone?.();
          }}
        />
      ) : (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit || pending) return;
        if (mode === "json") submitJson();
        else importRecipe.mutate(mode === "url" ? { url: url.trim() } : { text: text.trim() });
      }}
      className="space-y-3"
    >
      {mode === "url" && (
        <>
          <Input
            type="url"
            autoFocus
            placeholder="URL de recette, post Instagram ou TikTok…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <div className="text-xs text-slate-400">
            Site de recettes, ou lien Instagram / TikTok (recette dans la légende). La recette est
            analysée automatiquement : quantités pour 4, catégorie, durées…
          </div>
        </>
      )}
      {mode === "text" && (
        <>
          <textarea
            autoFocus
            rows={8}
            placeholder="Colle ici la description complète de la recette (ingrédients + étapes)…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
          <div className="text-xs text-slate-400">
            Pour les liens qui ne fonctionnent pas : copie le texte de la recette (description
            Instagram, page web…) et colle-le ici. Analyse automatique comme pour un lien.
          </div>
        </>
      )}
      {mode === "json" && (
        <>
          <textarea
            autoFocus
            rows={10}
            placeholder='Colle ici un JSON de recettes : [{"title": "…", "ingredients": […], "steps": […], …}]'
            value={json}
            onChange={(e) => setJson(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-slate-400">
              Import en masse, sans analyse : les recettes sont ajoutées telles quelles. Demande à
              Claude de générer le JSON avec le schéma ci-contre.
            </div>
            <button
              type="button"
              onClick={copySpec}
              className="btn-ghost shrink-0 whitespace-nowrap text-xs"
            >
              {copied ? "✓ Copié !" : "Copier le schéma"}
            </button>
          </div>
        </>
      )}

      {importError && <div className="text-sm text-red-600">{importError}</div>}
      <div className="flex justify-end">
        <button className="btn-primary" disabled={pending || !canSubmit}>
          {pending ? (mode === "json" ? "Import…" : "Extraction…") : "Importer"}
        </button>
      </div>
    </form>
      )}
    </div>
  );
}

function Recipes() {
  const qc = useQueryClient();
  const toast = useToast();
  // Recette ouverte en modale (edit = ouvre directement en mode édition).
  const [modal, setModal] = useState<{ id: string; edit: boolean } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Ingrédients décochés par recette (par défaut tout est coché)
  const [unchecked, setUnchecked] = useState<Record<string, Set<number>>>({});
  const isChecked = (rid: string, i: number) => !(unchecked[rid]?.has(i));
  const toggleIng = (rid: string, i: number) =>
    setUnchecked((prev) => {
      const cur = new Set(prev[rid] ?? []);
      cur.has(i) ? cur.delete(i) : cur.add(i);
      return { ...prev, [rid]: cur };
    });
  const selectedIngredients = (r: Recipe) => r.ingredients.filter((_, i) => isChecked(r.id, i));

  // Filtres + recherche
  const [fVeg, setFVeg] = useState(false);
  const [fVegetables, setFVegetables] = useState(false);
  const [fMeat, setFMeat] = useState("");
  const [fStarch, setFStarch] = useState("");
  // Durées maximales (en minutes ; "" = peu importe).
  const [fPrepMax, setFPrepMax] = useState("");
  const [fTotalMax, setFTotalMax] = useState("");
  // Ingrédients requis : ne garde que les recettes qui les contiennent tous.
  const [fIngredients, setFIngredients] = useState<string[]>([]);
  // Types de plat sélectionnés (multi-sélection ; vide = tous).
  const [fCourses, setFCourses] = useState<CourseType[]>([]);
  const toggleCourse = (ct: CourseType) =>
    setFCourses((prev) => (prev.includes(ct) ? prev.filter((c) => c !== ct) : [...prev, ct]));
  const [search, setSearch] = useState("");
  // Recherche insensible à la casse et aux accents, sur le titre et les ingrédients.
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");

  const { data } = useQuery({
    queryKey: ["recipes"],
    queryFn: () => api.get<Recipe[]>("/api/courses/recipes"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/courses/recipes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recipes"] }),
  });
  const addToList = useMutation({
    mutationFn: (names: string[]) => api.post("/api/courses/items/bulk", { names }),
    onSuccess: (_data, names) => {
      qc.invalidateQueries({ queryKey: ["shopping-items"] });
      toast.success(`${names.length} ingrédient${names.length > 1 ? "s" : ""} ajouté${names.length > 1 ? "s" : ""} à la liste`);
    },
    onError: () => toast.error("Impossible d'ajouter les ingrédients."),
  });

  // Filtres portés par la modale « Filtres » (les types de plat sont dans la barre).
  const moreFilters =
    fVeg ||
    fVegetables ||
    !!fMeat ||
    !!fStarch ||
    !!fPrepMax ||
    !!fTotalMax ||
    fIngredients.length > 0;

  if (!data) return <PageLoader variant="repas" />;

  const q = norm(search.trim());
  const filtered = data.filter(
    (r) =>
      (!fVeg || r.vegetarian) &&
      (!fVegetables || r.vegetables) &&
      (!fMeat || r.meat === fMeat) &&
      (!fStarch || r.starch === fStarch) &&
      (fCourses.length === 0 || fCourses.includes(r.course)) &&
      (!fPrepMax || (r.prepMinutes != null && r.prepMinutes <= Number(fPrepMax))) &&
      (!fTotalMax || (r.totalMinutes != null && r.totalMinutes <= Number(fTotalMax))) &&
      fIngredients.every((sel) => r.ingredients.some((ing) => norm(ing).includes(norm(sel)))) &&
      (!q || norm(r.title).includes(q) || r.ingredients.some((ing) => norm(ing).includes(q))),
  );

  // Noms d'ingrédients distincts de toutes les recettes (pour le sélecteur du filtre).
  const ingredientOptions = [
    ...new Set(
      data.flatMap((r) =>
        r.ingredients.map((l) => splitIngredient(l).name.toLowerCase()).filter(Boolean),
      ),
    ),
  ]
    .sort((a, b) => a.localeCompare(b, "fr"))
    .map((n) => ({ value: n, label: n }));

  return (
    <div className="flex flex-col gap-4 pb-24 md:pb-0">
      {/* Barre unique : recherche · types de plat · bouton Filtres (modale) · ajout. */}
      <div className="flex flex-wrap items-center gap-2">
        {(data ?? []).length > 0 && (
          <>
            {/* Mobile : recherche + Filtres sur la 1re ligne ; types de plat centrés dessous. */}
            <div className="relative order-1 min-w-0 flex-1">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher une recette ou un ingrédient…"
                className="input"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Effacer la recherche"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-brand-600"
                >
                  ✕
                </button>
              )}
            </div>
            {/* Types de plat : groupe encadré (multi-sélection), même hauteur que l'input.
                Padding en inline : .subtab (hors layer) n'est pas surchargeable par une utilitaire. */}
            <div className="order-3 mt-1 flex w-full justify-center md:order-2 md:mt-0 md:w-auto">
              <div className="flex items-center gap-1 rounded-xl border border-slate-200 px-1 py-0.5 dark:border-slate-700">
                {COURSE_TYPES.map((ct) => (
                  <button
                    key={ct}
                    type="button"
                    onClick={() => toggleCourse(ct)}
                    style={{ padding: "5px 10px" }}
                    className={`subtab whitespace-nowrap ${fCourses.includes(ct) ? "active" : ""}`}
                  >
                    {COURSE_META[ct].icon} {COURSE_META[ct].label}
                  </button>
                ))}
              </div>
            </div>
            {/* Le reste des filtres vit dans une modale. */}
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className={`btn-ghost order-2 shrink-0 text-xs md:order-3 ${moreFilters ? "ring-1 ring-brand-500" : ""}`}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M3 4h18l-7 8v6l-4 2v-8z" />
              </svg>
              Filtres{moreFilters ? " ·" : ""}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="btn-primary order-4 ml-auto hidden whitespace-nowrap md:inline-flex"
        >
          + Ajouter une recette
        </button>
      </div>

      {filtersOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
          onClick={() => setFiltersOpen(false)}
        >
          <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Filtres</h2>
              <button
                onClick={() => setFiltersOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setFVeg((v) => !v)}
                  className={`subtab ${fVeg ? "active" : ""}`}
                >
                  🌱 Végé
                </button>
                <button
                  type="button"
                  onClick={() => setFVegetables((v) => !v)}
                  className={`subtab ${fVegetables ? "active" : ""}`}
                >
                  🥦 Avec légumes
                </button>
              </div>
              <Select
                value={fMeat}
                onChange={setFMeat}
                placeholder="Toutes viandes"
                options={[
                  { value: "", label: "Toutes viandes" },
                  ...MEAT_TYPES.map((m) => ({
                    value: m,
                    label: `${MEAT_META[m].icon} ${MEAT_META[m].label}`,
                  })),
                ]}
              />
              <Select
                value={fStarch}
                onChange={setFStarch}
                placeholder="Tous féculents"
                options={[
                  { value: "", label: "Tous féculents" },
                  ...STARCH_TYPES.filter((s) => s !== "aucun").map((s) => ({
                    value: s,
                    label: `${STARCH_META[s].icon} ${STARCH_META[s].label}`,
                  })),
                  { value: "aucun", label: "Sans féculent" },
                ]}
              />
              <div className="text-xs text-slate-400">
                🥕 Contient les ingrédients
                <div className="mt-1">
                  {/* Pas de `allowCustom` : il propagerait chaque frappe au onChange
                      (une chip par lettre). Seule la sélection d'une option ajoute. */}
                  <SearchSelect
                    value=""
                    onChange={(v) => {
                      const val = v.trim().toLowerCase();
                      if (val && !fIngredients.includes(val))
                        setFIngredients([...fIngredients, val]);
                    }}
                    options={ingredientOptions}
                    placeholder="Ajouter un ingrédient…"
                  />
                </div>
                {fIngredients.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {fIngredients.map((ing) => (
                      <span
                        key={ing}
                        className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      >
                        {ing}
                        <button
                          type="button"
                          onClick={() => setFIngredients(fIngredients.filter((i) => i !== ing))}
                          className="text-slate-300 hover:text-red-500"
                          title="Retirer"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-slate-400">
                  🔪 Préparation
                  <div className="mt-1">
                    <Select
                      value={fPrepMax}
                      onChange={setFPrepMax}
                      placeholder="Peu importe"
                      options={[
                        { value: "", label: "Peu importe" },
                        { value: "15", label: "≤ 15 min" },
                        { value: "30", label: "≤ 30 min" },
                        { value: "45", label: "≤ 45 min" },
                        { value: "60", label: "≤ 1 h" },
                      ]}
                    />
                  </div>
                </label>
                <label className="text-xs text-slate-400">
                  ⏱️ Temps total
                  <div className="mt-1">
                    <Select
                      value={fTotalMax}
                      onChange={setFTotalMax}
                      placeholder="Peu importe"
                      options={[
                        { value: "", label: "Peu importe" },
                        { value: "20", label: "≤ 20 min" },
                        { value: "30", label: "≤ 30 min" },
                        { value: "45", label: "≤ 45 min" },
                        { value: "60", label: "≤ 1 h" },
                        { value: "120", label: "≤ 2 h" },
                      ]}
                    />
                  </div>
                </label>
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
                {moreFilters ? (
                  <button
                    type="button"
                    onClick={() => {
                      setFVeg(false);
                      setFVegetables(false);
                      setFMeat("");
                      setFStarch("");
                      setFPrepMax("");
                      setFTotalMax("");
                      setFIngredients([]);
                    }}
                    className="text-xs text-slate-400 underline hover:text-slate-600"
                  >
                    Réinitialiser
                  </button>
                ) : (
                  <span />
                )}
                <div className="whitespace-nowrap text-xs text-slate-400">
                  {filtered.length} / {data.length} recette{data.length > 1 ? "s" : ""}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {(() => {
        if ((data ?? []).length === 0)
          return <div className="card text-sm text-slate-400">Aucune recette enregistrée.</div>;
        if (filtered.length === 0)
          return (
            <div className="card text-sm text-slate-400">
              Aucune recette ne correspond {q ? "à la recherche" : "aux filtres"}.
            </div>
          );
        return (
        <div className="grid items-stretch gap-4 md:grid-cols-3">
          {filtered.map((r) => (
            <RecipeCard
              key={r.id}
              r={r}
              onOpen={() => setModal({ id: r.id, edit: false })}
              onEdit={() => setModal({ id: r.id, edit: true })}
              onAddToList={() => {
                const sel = selectedIngredients(r);
                if (sel.length === 0) {
                  toast.error("Aucun ingrédient sélectionné.");
                  return;
                }
                addToList.mutate(sel);
              }}
            />
          ))}
        </div>
        );
      })()}

      {modal &&
        (() => {
          const r = (data ?? []).find((x) => x.id === modal.id);
          if (!r) return null;
          return (
            <RecipeDetailModal
              r={r}
              edit={modal.edit}
              setEdit={(e) => setModal({ id: r.id, edit: e })}
              onClose={() => setModal(null)}
              onDelete={() => {
                if (confirm(`Supprimer « ${r.title} » ?`)) {
                  remove.mutate(r.id);
                  setModal(null);
                }
              }}
              isChecked={(i) => isChecked(r.id, i)}
              toggleIng={(i) => toggleIng(r.id, i)}
              onAddToList={() => {
                const sel = selectedIngredients(r);
                if (sel.length === 0) {
                  toast.error("Aucun ingrédient sélectionné.");
                  return;
                }
                addToList.mutate(sel);
              }}
              onSaved={() => {
                setModal({ id: r.id, edit: false });
                qc.invalidateQueries({ queryKey: ["recipes"] });
              }}
            />
          );
        })()}

      <GestureHelp
        title="Gestes sur une recette"
        items={[
          "👆 Tap : ouvrir la recette",
          "👉 Glisser à droite : + liste de course",
          "👈 Glisser à gauche : modifier",
        ]}
      />

      {/* Bouton flottant de création (mobile uniquement). */}
      <button
        type="button"
        onClick={() => setCreateOpen(true)}
        aria-label="Nouvelle recette"
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

      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
          onClick={() => setCreateOpen(false)}
        >
          <div className="card my-4 w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Ajouter une recette</h2>
              <button onClick={() => setCreateOpen(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            <RecipeImportForm onDone={() => setCreateOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Carte recette (swipeable) ---------------- */

/**
 * Carte compacte d'une recette. Clic = ouvrir la modale de détail.
 * Glissement (mobile, comme les tâches) : vers la droite = ajouter les
 * ingrédients à la liste de course ; vers la gauche = ouvrir en édition.
 */
function RecipeCard({
  r,
  onOpen,
  onEdit,
  onAddToList,
}: {
  r: Recipe;
  onOpen: () => void;
  onEdit: () => void;
  onAddToList: () => void;
}) {
  const [swipeX, setSwipeX] = useState(0);
  const swipeXRef = useRef(0);
  const swiping = useRef(false);
  const swiped = useRef(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const setSwipe = (x: number) => {
    swipeXRef.current = x;
    setSwipeX(x);
  };
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
    swiping.current = false;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    if (!swiping.current && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      swiping.current = true;
      swiped.current = true; // empêche le clic d'ouverture qui suit le glissement
    }
    if (swiping.current) setSwipe(Math.max(-140, Math.min(140, dx)));
  };
  const onTouchEnd = () => {
    touchStart.current = null;
    if (swipeXRef.current >= 96) {
      onAddToList(); // glissement droite = liste de course
    } else if (swipeXRef.current <= -96) {
      onEdit(); // glissement gauche = édition
    }
    swiping.current = false;
    setSwipe(0);
  };
  const handleClick = () => {
    if (swiped.current) {
      swiped.current = false;
      return;
    }
    onOpen();
  };

  return (
    <div className="relative h-full">
      {/* Fond vert révélé par le glissement vers la droite = liste de course (mobile). */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-start rounded-2xl bg-green-600 pl-6 md:hidden"
        style={{ opacity: swipeX > 8 ? 1 : 0, transition: "opacity 0.15s" }}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5 text-white"
        >
          <circle cx="9" cy="21" r="1" />
          <circle cx="20" cy="21" r="1" />
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
        </svg>
      </div>

      {/* Fond gris révélé par le glissement vers la gauche = édition (mobile). */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-end rounded-2xl bg-slate-500 pr-6 md:hidden"
        style={{ opacity: swipeX < -8 ? 1 : 0, transition: "opacity 0.15s" }}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5 text-white"
        >
          <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        </svg>
      </div>

      <div
        className="card relative flex h-full cursor-pointer flex-col"
        style={{
          transform: `translateX(${swipeX}px)`,
          transition: swiping.current ? "none" : "transform 0.2s",
          touchAction: "pan-y",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={handleClick}
      >
        {/* Photo en grand + colonne d'indicateurs à droite. */}
        <div className="flex gap-3">
          {r.imageUrl ? (
            <img
              src={r.imageUrl}
              alt=""
              loading="lazy"
              className="h-32 min-w-0 flex-1 rounded-lg object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div className="flex h-32 min-w-0 flex-1 items-center justify-center rounded-lg bg-slate-100 text-4xl dark:bg-slate-800">
              {COURSE_META[r.course].icon}
            </div>
          )}
          <div className="flex w-20 shrink-0 flex-col justify-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span title={COURSE_META[r.course].label}>
              {COURSE_META[r.course].icon} {COURSE_META[r.course].label}
            </span>
            <span title="Personnes">👤 {r.servings} pers</span>
            {r.prepMinutes != null && (
              <span title="Préparation">🔪 {fmtDuration(r.prepMinutes)}</span>
            )}
            {r.totalMinutes != null && (
              <span title="Temps total (avec cuisson)">⏱️ {fmtDuration(r.totalMinutes)}</span>
            )}
          </div>
        </div>

        {/* Nom sur 2 lignes maximum (coupé ensuite). */}
        <div className="mt-2 line-clamp-2 font-semibold leading-snug" title={r.title}>
          {r.title}
        </div>

        {/* Autres indicateurs (calés en bas de la carte). */}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-xs text-slate-400">
          <span title="Ingrédients">🥕 {r.ingredients.length} ingr.</span>
          <span className="text-sm">
            {r.vegetarian && <span title="Végétarien">🌱</span>}
            {r.meat && <span title={MEAT_META[r.meat].label}>{MEAT_META[r.meat].icon}</span>}
            {r.starch !== "aucun" && (
              <span title={STARCH_META[r.starch].label}>{STARCH_META[r.starch].icon}</span>
            )}
            {r.vegetables && <span title="Avec légumes">🥦</span>}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Modale de détail d'une recette ---------------- */

function RecipeDetailModal({
  r,
  edit,
  setEdit,
  onClose,
  onDelete,
  isChecked,
  toggleIng,
  onAddToList,
  onSaved,
}: {
  r: Recipe;
  edit: boolean;
  setEdit: (e: boolean) => void;
  onClose: () => void;
  onDelete: () => void;
  isChecked: (i: number) => boolean;
  toggleIng: (i: number) => void;
  onAddToList: () => void;
  onSaved: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      {/* Hauteur bornée : le titre et les actions restent visibles, seul le
          contenu défile (sinon l'image du haut sort de l'écran sur une longue recette). */}
      <div
        className="card my-4 flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex shrink-0 items-start justify-between gap-2">
          <h2 className="text-lg font-bold leading-snug">{r.title}</h2>
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              ✕
            </button>
          </div>
        </div>

        {edit ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <RecipeEditor key={r.id} recipe={r} onClose={() => setEdit(false)} onSaved={onSaved} />
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
            {r.imageUrl && (
              <img
                src={r.imageUrl}
                alt=""
                className="mb-3 h-44 w-full rounded-xl object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            )}
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
              <span title={COURSE_META[r.course].label}>
                {COURSE_META[r.course].icon} {COURSE_META[r.course].label}
              </span>
              <span title="Personnes">👤 {r.servings} pers</span>
              {r.prepMinutes != null && <span title="Préparation">🔪 {fmtDuration(r.prepMinutes)}</span>}
              {r.totalMinutes != null && <span title="Temps total">⏱️ {fmtDuration(r.totalMinutes)}</span>}
              <span className="text-sm">
                {r.vegetarian && <span title="Végétarien">🌱</span>}
                {r.meat && <span title={MEAT_META[r.meat].label}>{MEAT_META[r.meat].icon}</span>}
                {r.starch !== "aucun" && (
                  <span title={STARCH_META[r.starch].label}>{STARCH_META[r.starch].icon}</span>
                )}
                {r.vegetables && <span title="Avec légumes">🥦</span>}
              </span>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1 text-sm font-semibold">Ingrédients</div>
                <ul className="space-y-1 text-sm">
                  {r.ingredients.map((ing, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-0.5">
                        <Checkbox size="sm" checked={isChecked(i)} onChange={() => toggleIng(i)} />
                      </span>
                      <span className={isChecked(i) ? "" : "text-slate-400 line-through"}>{ing}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="mb-1 text-sm font-semibold">Étapes</div>
                <ol className="space-y-1.5 text-sm">
                  {r.steps.map((st, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="font-semibold text-brand-600">{i + 1}.</span>
                      {st}
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            {r.sourceUrl && (
              <a
                href={r.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block text-xs text-brand-600 underline"
              >
                Voir la recette originale
              </a>
            )}
            </div>

            <div className="mt-4 flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button onClick={onDelete} className="text-sm text-red-500 hover:underline">
                Supprimer
              </button>
              <div className="flex items-center gap-2">
                <button onClick={() => setEdit(true)} className="btn">
                  Modifier
                </button>
                <button onClick={onAddToList} className="btn-primary">
                  + Liste de course
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- Repas de la semaine (plan figé, partagé au foyer) ---------------- */

interface MealPlanData {
  count: number;
  maxPrepMinutes: number | null;
  maxTotalMinutes: number | null;
  createdAt: string;
  recipes: Recipe[];
}

function WeekMealPlan() {
  const qc = useQueryClient();
  const toast = useToast();
  const [modal, setModal] = useState<{ id: string; edit: boolean } | null>(null);
  // Ingrédients décochés par recette (pour la modale et l'ajout à la liste).
  const [unchecked, setUnchecked] = useState<Record<string, Set<number>>>({});
  const isChecked = (rid: string, i: number) => !(unchecked[rid]?.has(i));
  const toggleIng = (rid: string, i: number) =>
    setUnchecked((prev) => {
      const cur = new Set(prev[rid] ?? []);
      cur.has(i) ? cur.delete(i) : cur.add(i);
      return { ...prev, [rid]: cur };
    });
  const selectedIngredients = (r: Recipe) => r.ingredients.filter((_, i) => isChecked(r.id, i));

  // Paramètres de génération (synchronisés sur le plan stocké).
  const [count, setCount] = useState("5");
  const [maxPrep, setMaxPrep] = useState("");
  const [maxTotal, setMaxTotal] = useState("45");

  const { data: plan, isLoading } = useQuery({
    queryKey: ["meal-plan"],
    queryFn: () => api.get<MealPlanData | null>("/api/courses/meal-plan"),
  });
  useEffect(() => {
    if (plan) {
      setCount(String(plan.count));
      setMaxPrep(plan.maxPrepMinutes != null ? String(plan.maxPrepMinutes) : "");
      setMaxTotal(plan.maxTotalMinutes != null ? String(plan.maxTotalMinutes) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.createdAt]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["meal-plan"] });
  const generate = useMutation({
    mutationFn: () =>
      api.post("/api/courses/meal-plan/generate", {
        count: Math.max(1, Math.min(14, Number(count) || 5)),
        maxPrepMinutes: maxPrep ? Number(maxPrep) : null,
        maxTotalMinutes: maxTotal ? Number(maxTotal) : null,
      }),
    onSuccess: invalidate,
    onError: (e) =>
      toast.error(
        e instanceof ApiError && e.message.includes("no_candidates")
          ? "Aucun plat de « Mes recettes » ne respecte ces contraintes de temps."
          : "Impossible de générer la semaine.",
      ),
  });
  const replace = useMutation({
    mutationFn: (id: string) => api.post("/api/courses/meal-plan/replace", { recipeId: id }),
    onSuccess: invalidate,
    onError: () => toast.error("Pas d'autre plat compatible pour remplacer celui-ci."),
  });
  const removeRecipe = useMutation({
    mutationFn: (id: string) => api.del(`/api/courses/recipes/${id}`),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["recipes"] });
    },
  });
  const addToList = useMutation({
    mutationFn: (names: string[]) => api.post("/api/courses/items/bulk", { names }),
    onSuccess: (_d, names) => {
      qc.invalidateQueries({ queryKey: ["shopping-items"] });
      toast.success(`${names.length} ingrédient${names.length > 1 ? "s" : ""} ajouté${names.length > 1 ? "s" : ""} à la liste`);
    },
    onError: () => toast.error("Impossible d'ajouter les ingrédients."),
  });

  if (isLoading) return <PageLoader variant="repas" />;
  const recipes = plan?.recipes ?? [];

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        Une sélection variée piochée dans Mes recettes (jamais deux fois la même viande ni le même
        féculent), figée et partagée avec tout le foyer jusqu'à la prochaine génération.
      </p>

      {/* Paramètres + génération */}
      <div className="card flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-400">
          Nombre de repas
          <input
            type="number"
            min={1}
            max={14}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className="input mt-1 w-24"
          />
        </label>
        <label className="text-xs text-slate-400">
          🔪 Préparation max
          <div className="mt-1">
            <Select
              className="w-36"
              value={maxPrep}
              onChange={setMaxPrep}
              placeholder="Peu importe"
              options={[
                { value: "", label: "Peu importe" },
                { value: "15", label: "≤ 15 min" },
                { value: "30", label: "≤ 30 min" },
                { value: "45", label: "≤ 45 min" },
                { value: "60", label: "≤ 1 h" },
              ]}
            />
          </div>
        </label>
        <label className="text-xs text-slate-400">
          ⏱️ Temps total max
          <div className="mt-1">
            <Select
              className="w-36"
              value={maxTotal}
              onChange={setMaxTotal}
              placeholder="Peu importe"
              options={[
                { value: "", label: "Peu importe" },
                { value: "20", label: "≤ 20 min" },
                { value: "30", label: "≤ 30 min" },
                { value: "45", label: "≤ 45 min" },
                { value: "60", label: "≤ 1 h" },
                { value: "120", label: "≤ 2 h" },
              ]}
            />
          </div>
        </label>
        <button
          type="button"
          onClick={() => generate.mutate()}
          disabled={generate.isPending}
          className="btn-primary"
        >
          {generate.isPending ? "Génération…" : plan ? "🔄 Regénérer la semaine" : "✨ Générer la semaine"}
        </button>
      </div>

      {!plan ? (
        <div className="card text-sm text-slate-400">
          Aucune semaine générée pour le moment. Choisis tes paramètres et clique sur « Générer la
          semaine ».
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-slate-400">
              Semaine générée le {dateFr(plan.createdAt)} — {recipes.length} repas
              {recipes.length < plan.count
                ? ` (pas assez de plats compatibles pour en proposer ${plan.count})`
                : ""}
              .
            </div>
            <button
              type="button"
              onClick={() => {
                const all = recipes.flatMap((r) => selectedIngredients(r));
                if (all.length === 0) {
                  toast.error("Aucun ingrédient à ajouter.");
                  return;
                }
                addToList.mutate(all);
              }}
              disabled={addToList.isPending}
              className="btn-primary"
            >
              + Liste de course
            </button>
          </div>

          <div className="grid items-stretch gap-4 md:grid-cols-3">
            {recipes.map((r) => (
              <div key={r.id} className="card flex h-full flex-col">
                <div
                  className="flex cursor-pointer gap-3"
                  onClick={() => setModal({ id: r.id, edit: false })}
                >
                  {r.imageUrl ? (
                    <img
                      src={r.imageUrl}
                      alt=""
                      loading="lazy"
                      className="h-32 min-w-0 flex-1 rounded-lg object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="flex h-32 min-w-0 flex-1 items-center justify-center rounded-lg bg-slate-100 text-4xl dark:bg-slate-800">
                      {COURSE_META[r.course].icon}
                    </div>
                  )}
                  <div className="flex w-20 shrink-0 flex-col justify-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <span title="Personnes">👤 {r.servings} pers</span>
                    {r.prepMinutes != null && (
                      <span title="Préparation">🔪 {fmtDuration(r.prepMinutes)}</span>
                    )}
                    {r.totalMinutes != null && (
                      <span title="Temps total">⏱️ {fmtDuration(r.totalMinutes)}</span>
                    )}
                  </div>
                </div>
                <div
                  className="mt-2 line-clamp-2 cursor-pointer font-semibold leading-snug"
                  title={r.title}
                  onClick={() => setModal({ id: r.id, edit: false })}
                >
                  {r.title}
                </div>
                <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                  <span className="text-sm">
                    {r.vegetarian && <span title="Végétarien">🌱</span>}
                    {r.meat && <span title={MEAT_META[r.meat].label}>{MEAT_META[r.meat].icon}</span>}
                    {r.starch !== "aucun" && (
                      <span title={STARCH_META[r.starch].label}>{STARCH_META[r.starch].icon}</span>
                    )}
                    {r.vegetables && <span title="Avec légumes">🥦</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => replace.mutate(r.id)}
                    disabled={replace.isPending}
                    className="btn-ghost whitespace-nowrap text-xs"
                    title="Remplacer par un autre plat"
                  >
                    🔄 Remplacer
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {modal &&
        (() => {
          const r = recipes.find((x) => x.id === modal.id);
          if (!r) return null;
          return (
            <RecipeDetailModal
              r={r}
              edit={modal.edit}
              setEdit={(e) => setModal({ id: r.id, edit: e })}
              onClose={() => setModal(null)}
              onDelete={() => {
                if (confirm(`Supprimer « ${r.title} » ?`)) {
                  removeRecipe.mutate(r.id);
                  setModal(null);
                }
              }}
              isChecked={(i) => isChecked(r.id, i)}
              toggleIng={(i) => toggleIng(r.id, i)}
              onAddToList={() => {
                const sel = selectedIngredients(r);
                if (sel.length === 0) {
                  toast.error("Aucun ingrédient sélectionné.");
                  return;
                }
                addToList.mutate(sel);
              }}
              onSaved={() => {
                setModal({ id: r.id, edit: false });
                qc.invalidateQueries({ queryKey: ["recipes"] });
                invalidate();
              }}
            />
          );
        })()}
    </div>
  );
}

/* ---------------- Idées repas (suggestions générées) ---------------- */

/**
 * Photo d'une idée repas, ou état vide (émoji de la catégorie sur fond neutre)
 * si absente ou en erreur — même hauteur pour toutes les cartes (cf. Activités).
 */
function IdeaImage({ src, course }: { src: string | null; course: CourseType }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="flex h-40 w-full items-center justify-center bg-slate-100 text-4xl dark:bg-slate-800">
        {COURSE_META[course].icon}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className="h-40 w-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function MealIdeas() {
  const qc = useQueryClient();
  const toast = useToast();
  // Catégorie affichée (et ciblée par la génération) — « Plat » par défaut.
  const [fCourse, setFCourse] = useState<CourseType>("plat");

  const { data } = useQuery({
    queryKey: ["meal-ideas"],
    queryFn: () => api.get<{ ideas: RecipeIdea[]; exclusions: string[] }>("/api/courses/ideas"),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["meal-ideas"] });

  const generate = useMutation({
    mutationFn: (course: CourseType) => api.post("/api/courses/ideas/generate", { course }),
    onSuccess: invalidate,
    onError: () => toast.error("Impossible de générer des idées."),
  });
  const hide = useMutation({
    mutationFn: (id: string) => api.post(`/api/courses/ideas/${id}/hide`, {}),
    onSuccess: invalidate,
  });
  const add = useMutation({
    mutationFn: (id: string) => api.post(`/api/courses/ideas/${id}/add`, {}),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["recipes"] });
      toast.success("Recette ajoutée à Mes recettes !");
    },
    onError: () => toast.error("Impossible d'ajouter cette recette."),
  });
  if (!data) return <PageLoader variant="repas" />;
  const { ideas, exclusions } = data;
  const visible = ideas.filter((i) => i.course === fCourse);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-slate-400">
          Des idées de repas générées pour vous, en évitant vos recettes existantes et vos
          ingrédients exclus. 🚫 = ne plus proposer · + = ajouter à Mes recettes.{" "}
          <Link to="/settings/repas" className="text-brand-600 underline hover:text-brand-700">
            Gérer les ingrédients exclus{exclusions.length > 0 ? ` (${exclusions.length})` : ""}
          </Link>
        </p>
        <button
          type="button"
          onClick={() => generate.mutate(fCourse)}
          disabled={generate.isPending}
          className="btn-primary whitespace-nowrap"
        >
          {generate.isPending ? "Génération…" : "✨ Proposer des idées"}
        </button>
      </div>

      {/* Filtre par type de plat (génération ciblée sur l'onglet actif) */}
      <div className="flex justify-center gap-2">
        {COURSE_TYPES.map((ct) => (
          <button
            key={ct}
            type="button"
            onClick={() => setFCourse(ct)}
            className={`subtab ${fCourse === ct ? "active" : ""}`}
          >
            {COURSE_META[ct].icon} {COURSE_META[ct].label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="card text-sm text-slate-400">
          {generate.isPending
            ? "Génération des idées en cours…"
            : `Aucune idée de type « ${COURSE_META[fCourse].label.toLowerCase()} ». Clique sur « Proposer des idées » pour en générer.`}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visible.map((idea) => (
            <div key={idea.id} className="card flex flex-col overflow-hidden p-0">
              <IdeaImage src={idea.imageUrl} course={idea.course} />
              <div className="flex flex-1 flex-col gap-1.5 p-4">
              <div className="text-xs font-medium text-brand-600">
                {COURSE_META[idea.course].icon} {COURSE_META[idea.course].label}
              </div>
              <div className="font-semibold leading-tight">{idea.title}</div>
              <p className="text-sm text-slate-600 dark:text-slate-300">{idea.description}</p>
              {idea.ingredients.length > 0 && (
                <div className="text-xs text-slate-400">🥕 {idea.ingredients.join(" · ")}</div>
              )}
              <div className="mt-auto flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={() => hide.mutate(idea.id)}
                  title="Ne plus me proposer"
                  className="text-lg leading-none text-slate-300 transition hover:text-red-500"
                >
                  🚫
                </button>
                <button
                  onClick={() => add.mutate(idea.id)}
                  disabled={add.isPending}
                  title="Ajouter à Mes recettes"
                  className="flex items-center text-slate-300 transition hover:text-brand-600 disabled:opacity-50"
                >
                  {add.isPending && add.variables === idea.id ? (
                    <span className="text-xs">…</span>
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      className="h-5 w-5"
                      aria-hidden="true"
                    >
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  )}
                </button>
              </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Édition d'une recette ---------------- */

// Sépare "200 g de farine" -> { qty: "200 g", name: "farine" } (heuristique, sans perte).
function splitIngredient(line: string): { qty: string; name: string } {
  const m = line
    .trim()
    .match(
      /^([\d.,/]+\s*(?:g|kg|mg|ml|cl|l|cs|cc|càs|càc|cuillères?(?:\s?à\s?(?:soupe|café))?|pincées?|sachets?|gousses?|tranches?|pièces?|verres?|tasses?|bottes?|boîtes?|c\.?\s?à\.?\s?[sc]\.?)?\.?)\s+(?:de\s+|d['’])?(.+)$/i,
    );
  if (m && /\d/.test(m[1])) return { qty: m[1].trim(), name: m[2].trim() };
  return { qty: "", name: line.trim() };
}
const joinIngredient = (qty: string, name: string) =>
  [qty.trim(), name.trim()].filter(Boolean).join(" ");

function RecipeEditor({
  recipe,
  onClose,
  onSaved,
  create = false,
}: {
  recipe: Recipe;
  onClose: () => void;
  onSaved: () => void;
  /** Mode création : POST d'une nouvelle recette au lieu du PATCH d'édition. */
  create?: boolean;
}) {
  const [title, setTitle] = useState(recipe.title);
  const [sourceUrl, setSourceUrl] = useState(recipe.sourceUrl ?? "");
  const [imageUrl, setImageUrl] = useState(recipe.imageUrl ?? "");
  const [prep, setPrep] = useState(recipe.prepMinutes != null ? String(recipe.prepMinutes) : "");
  const [total, setTotal] = useState(recipe.totalMinutes != null ? String(recipe.totalMinutes) : "");
  const [vegetarian, setVegetarian] = useState(recipe.vegetarian);
  const [meat, setMeat] = useState<string>(recipe.meat ?? "");
  const [starch, setStarch] = useState<StarchType>(recipe.starch);
  const [vegetables, setVegetables] = useState(recipe.vegetables);
  const [course, setCourse] = useState<CourseType>(recipe.course);
  const [ingredients, setIngredients] = useState(recipe.ingredients.map(splitIngredient));
  const [steps, setSteps] = useState(recipe.steps);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        title: title.trim() || "Recette",
        sourceUrl: sourceUrl.trim() || null,
        imageUrl: imageUrl.trim() || null,
        prepMinutes: prep.trim() === "" ? null : Number(prep),
        totalMinutes: total.trim() === "" ? null : Number(total),
        vegetarian,
        meat: vegetarian || meat === "" ? null : (meat as MeatType),
        starch,
        vegetables,
        course,
        ingredients: ingredients.map((i) => joinIngredient(i.qty, i.name)).filter(Boolean),
        steps: steps.map((s) => s.trim()).filter(Boolean),
      };
      return create
        ? api.post("/api/courses/recipes/bulk", { recipes: [payload] })
        : api.patch(`/api/courses/recipes/${recipe.id}`, payload);
    },
    onSuccess: onSaved,
  });
  // En création, l'API exige un titre, au moins un ingrédient et une étape.
  const createInvalid =
    create &&
    (!title.trim() ||
      ingredients.every((i) => !joinIngredient(i.qty, i.name)) ||
      steps.every((s) => !s.trim()));

  const fieldBase =
    "rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
  const fieldCls = `w-full ${fieldBase}`;

  return (
    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3 dark:border-slate-800">
      {/* Type de plat — sélection simple, sur une seule ligne. */}
      <div className="flex gap-2">
        {COURSE_TYPES.map((ct) => (
          <button
            key={ct}
            type="button"
            onClick={() => setCourse(ct)}
            className={`subtab whitespace-nowrap ${course === ct ? "active" : ""}`}
          >
            {COURSE_META[ct].icon} {COURSE_META[ct].label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate-400 sm:col-span-2">
          Nom de la recette
          <input className={`mt-1 ${fieldCls}`} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="text-xs text-slate-400">
          Temps de préparation (min)
          <input
            type="number"
            min="0"
            className={`mt-1 ${fieldCls}`}
            value={prep}
            onChange={(e) => setPrep(e.target.value)}
          />
        </label>
        <label className="text-xs text-slate-400">
          Temps total avec cuisson (min)
          <input
            type="number"
            min="0"
            className={`mt-1 ${fieldCls}`}
            value={total}
            onChange={(e) => setTotal(e.target.value)}
          />
        </label>
        <label className="text-xs text-slate-400 sm:col-span-2">
          Photo (URL)
          <input className={`mt-1 ${fieldCls}`} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
        </label>
        {imageUrl.trim() && (
          <img
            src={imageUrl}
            alt=""
            className="h-20 w-20 rounded-lg object-cover sm:col-span-2"
            onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
          />
        )}
        <label className="text-xs text-slate-400 sm:col-span-2">
          Lien de la recette
          <input className={`mt-1 ${fieldCls}`} value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
        </label>

        <div className="flex items-center gap-4 sm:col-span-2">
          <Checkbox
            checked={vegetarian}
            onChange={() => setVegetarian((v) => !v)}
            label="🌱 Végétarien"
          />
          <Checkbox
            checked={vegetables}
            onChange={() => setVegetables((v) => !v)}
            label="🥦 Contient des légumes"
          />
        </div>
        <label className="text-xs text-slate-400">
          Viande / poisson
          <div className="mt-1">
            <Select
              value={meat}
              onChange={setMeat}
              placeholder="Aucune"
              options={[
                { value: "", label: "Aucune" },
                ...MEAT_TYPES.map((m) => ({ value: m, label: `${MEAT_META[m].icon} ${MEAT_META[m].label}` })),
              ]}
            />
          </div>
        </label>
        <label className="text-xs text-slate-400">
          Féculent
          <div className="mt-1">
            <Select
              value={starch}
              onChange={(v) => setStarch(v as StarchType)}
              options={STARCH_TYPES.map((s) => ({
                value: s,
                label: s === "aucun" ? "Aucun" : `${STARCH_META[s].icon} ${STARCH_META[s].label}`,
              }))}
            />
          </div>
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1 text-sm font-semibold">Ingrédients</div>
          <div className="space-y-1.5">
            {ingredients.map((ing, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  placeholder="Qté"
                  className={`w-16 shrink-0 ${fieldBase}`}
                  value={ing.qty}
                  onChange={(e) => {
                    const next = [...ingredients];
                    next[i] = { ...next[i], qty: e.target.value };
                    setIngredients(next);
                  }}
                />
                <input
                  placeholder="Ingrédient"
                  className={`min-w-0 flex-1 ${fieldBase}`}
                  value={ing.name}
                  onChange={(e) => {
                    const next = [...ingredients];
                    next[i] = { ...next[i], name: e.target.value };
                    setIngredients(next);
                  }}
                />
                <button
                  type="button"
                  onClick={() => setIngredients(ingredients.filter((_, j) => j !== i))}
                  className="shrink-0 px-1 text-slate-300 hover:text-red-500"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setIngredients([...ingredients, { qty: "", name: "" }])}
            className="mt-2 text-xs font-medium text-brand-600 hover:text-brand-700"
          >
            + Ajouter un ingrédient
          </button>
        </div>

        <div>
          <div className="mb-1 text-sm font-semibold">Étapes</div>
          <div className="space-y-1.5">
            {steps.map((st, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="mt-1.5 text-xs font-semibold text-brand-600">{i + 1}.</span>
                <textarea
                  rows={2}
                  className={`min-w-0 flex-1 ${fieldBase}`}
                  value={st}
                  onChange={(e) => {
                    const next = [...steps];
                    next[i] = e.target.value;
                    setSteps(next);
                  }}
                />
                <button
                  type="button"
                  onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                  className="mt-1 shrink-0 px-1 text-slate-300 hover:text-red-500"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setSteps([...steps, ""])}
            className="mt-2 text-xs font-medium text-brand-600 hover:text-brand-700"
          >
            + Ajouter une étape
          </button>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-ghost">
          Annuler
        </button>
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending || createInvalid}
          className="btn-primary"
        >
          {save.isPending ? "Enregistrement…" : create ? "Créer la recette" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}
