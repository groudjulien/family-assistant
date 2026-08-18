import { useState, useEffect, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Recipe, RecipeIdea, MeatType, StarchType, CourseType } from "@gfa/shared";
import { MEAT_TYPES, MEAT_META, STARCH_TYPES, STARCH_META, COURSE_TYPES, COURSE_META } from "@gfa/shared";
import { api, ApiError } from "../lib/api";
import PageLoader from "../components/PageLoader";
import {
  Input,
  Checkbox,
  Select,
  SearchSelect,
  SubNav,
  SearchField,
  FilterChips,
  MobileActionBar,
  OverflowMenu,
  ActionSheet,
} from "../components/ui";
import {
  IconArrows,
  IconCart,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconClose,
  IconFilter,
  IconLines,
  IconMore,
  IconRefresh,
  IconSparkle,
  IconUser,
} from "../components/icons";
import { useToast } from "../components/Toast";
import { usePageHeader, usePageTabs, usePageChrome } from "../components/PageHeader";

/**
 * Trois menus de même niveau (plus de sous-menu sous « Idées repas »). Les URLs
 * des deux derniers restent celles d'origine (`/repas/idees/…`) : liens
 * partagés et chemins mémorisés continuent de fonctionner.
 */
type Tab = "recettes" | "semaine" | "nouvelles";
// Trois libellés courts : la rangée d'onglets tient sans défiler.
const TABS: { id: Tab; label: string; path: string }[] = [
  { id: "recettes", label: "Mes recettes", path: "/repas/recettes" },
  { id: "semaine", label: "Menu", path: "/repas/idees/semaine" },
  { id: "nouvelles", label: "Idées", path: "/repas/idees/nouvelles" },
];

export default function Repas() {
  const navigate = useNavigate();
  // Même clé que l'onglet Recettes : l'en-tête lit le cache, sans requête en plus.
  const { data: recipes } = useQuery({
    queryKey: ["recipes"],
    queryFn: () => api.get<Recipe[]>("/api/courses/recipes"),
  });
  const nRecipes = recipes?.length ?? 0;
  const { tab: tabParam, view: viewParam } = useParams();
  const tab: Tab =
    tabParam === "idees" ? (viewParam === "nouvelles" ? "nouvelles" : "semaine") : "recettes";
  // `/repas/recettes/<id>` : le 3ᵉ segment est l'identifiant d'une recette
  // ouverte, pas un sous-menu. Elle prend l'écran, donc plus d'onglets.
  const openRecipeId = tab === "recettes" ? viewParam : undefined;

  // Le sur-titre appartient à l'onglet quand il a mieux à dire (les idées
  // annoncent leurs exclusions) ou à la recette ouverte : dans ces cas le
  // parent passe `null` et laisse l'enfant déclarer.
  const ownHeader = !openRecipeId && tab === "recettes";
  usePageHeader(
    ownHeader ? "Repas" : null,
    ownHeader ? `${nRecipes} recette${nRecipes > 1 ? "s" : ""}` : undefined,
  );
  usePageTabs(
    tab,
    openRecipeId ? [] : TABS.map((t) => ({ value: t.id, label: t.label })),
    (v) => navigate(TABS.find((t) => t.id === v)?.path ?? "/repas/recettes"),
  );

  return (
    <div className="flex flex-col gap-4">
      <SubNav
        value={tab}
        onChange={(v) => navigate(TABS.find((t) => t.id === v)?.path ?? "/repas/recettes")}
        items={TABS.map((t) => ({ value: t.id, label: t.label }))}
        className="hidden md:block"
      />
      {tab === "recettes" && <Recipes openId={openRecipeId} />}
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

function Recipes({ openId }: { openId?: string }) {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

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
  // Type de plat : une rangée de pastilles, « » = tous.
  const [fCourse, setFCourse] = useState<"" | CourseType>("");
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

  // Une recette ouverte prend tout l'écran : c'est une sous-page, pas une modale.
  if (openId) {
    const r = data.find((x) => x.id === openId);
    return <RecipeDetail recipe={r} backTo="/repas/recettes" />;
  }

  const q = norm(search.trim());
  const filtered = data.filter(
    (r) =>
      (!fVeg || r.vegetarian) &&
      (!fVegetables || r.vegetables) &&
      (!fMeat || r.meat === fMeat) &&
      (!fStarch || r.starch === fStarch) &&
      (!fCourse || r.course === fCourse) &&
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
    <div className="flex flex-col gap-3 pb-28 md:pb-0">
      {/* Une seule barre de filtre : la recherche porte l'entonnoir, et les
          types de plat sont une rangée de pastilles — plus de conteneur dans
          un conteneur. */}
      {data.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <SearchField
              value={search}
              onChange={setSearch}
              placeholder="Recette ou ingrédient…"
              className="min-w-0 flex-1"
              trailing={
                <button
                  type="button"
                  onClick={() => setFiltersOpen(true)}
                  aria-label="Filtres"
                  aria-pressed={moreFilters}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition ${
                    moreFilters ? "bg-brand-600 text-on-brand" : "text-ink-2 hover:bg-surface-2"
                  }`}
                >
                  <IconFilter size={20} />
                </button>
              }
            />
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="btn-primary hidden shrink-0 whitespace-nowrap md:inline-flex"
            >
              + Ajouter une recette
            </button>
          </div>
          <FilterChips
            value={fCourse}
            onChange={(v) => setFCourse(v as "" | CourseType)}
            items={[
              { value: "", label: "Tout" },
              ...COURSE_TYPES.map((ct) => ({ value: ct, label: COURSE_META[ct].label })),
            ]}
          />
        </>
      )}

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

      {data.length === 0 ? (
        <div className="card flex flex-col items-start gap-3 text-sm text-slate-400">
          <p>Aucune recette enregistrée.</p>
          <button type="button" onClick={() => setCreateOpen(true)} className="btn-primary">
            Ajouter la première
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-sm text-slate-400">
          Aucune recette ne correspond {q ? "à la recherche" : "aux filtres"}.
        </div>
      ) : (
        <>
          {/* Mobile : une rangée par recette, vignette à gauche. Quatre recettes
              par écran au lieu d'une et demie. */}
          <div className="card md:hidden">
            {filtered.map((r, i) => (
              <RecipeRow
                key={r.id}
                r={r}
                to={`/repas/recettes/${r.id}`}
                last={i === filtered.length - 1}
              />
            ))}
          </div>

          {/* Ordinateur : la grille de cartes, la largeur le permet. */}
          <div className="hidden items-stretch gap-4 md:grid md:grid-cols-3">
            {filtered.map((r) => (
              <RecipeCard key={r.id} r={r} onOpen={() => navigate(`/repas/recettes/${r.id}`)} />
            ))}
          </div>
        </>
      )}

      <MobileActionBar label="Ajouter une recette" onClick={() => setCreateOpen(true)} />

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

/* ---------------- Rangée et carte d'une recette ---------------- */

/** Vignette carrée, ou un aplat marqué du type de plat quand il n'y a pas de photo. */
function RecipeThumb({ r, className }: { r: Recipe; className: string }) {
  return r.imageUrl ? (
    <img
      src={r.imageUrl}
      alt=""
      loading="lazy"
      className={`${className} shrink-0 rounded-xl object-cover`}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.display = "none";
      }}
    />
  ) : (
    <div
      aria-hidden="true"
      className={`${className} flex shrink-0 items-center justify-center rounded-xl bg-surface-2 text-2xl`}
    >
      {COURSE_META[r.course].icon}
    </div>
  );
}

/** Pastille de contenu : type de plat, régime, viande. */
function RecipeTag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-surface-2 px-2.5 py-1 text-xs text-ink-2">
      {children}
    </span>
  );
}

/** Une ligne de méta : la même icône de trait pour tout le monde, plus son libellé. */
function RecipeMeta({ r }: { r: Recipe }) {
  // `totalMinutes` est le temps total « avec cuisson » : ce qui dépasse la
  // préparation est donc du temps de cuisson, et on le dit plutôt que
  // d'aligner deux horloges sans légende.
  const cooking =
    r.prepMinutes != null && r.totalMinutes != null && r.totalMinutes > r.prepMinutes
      ? r.totalMinutes - r.prepMinutes
      : null;
  const minutes = r.prepMinutes ?? r.totalMinutes;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
      {minutes != null && (
        <span className="inline-flex items-center gap-1">
          <IconClock size={14} /> {fmtDuration(minutes)}
        </span>
      )}
      <span className="inline-flex items-center gap-1">
        <IconUser size={14} /> {r.servings} pers
      </span>
      <span className="inline-flex items-center gap-1">
        <IconLines size={14} /> {r.ingredients.length} ingr.
      </span>
      {cooking != null && <span>+{fmtDuration(cooking)} de cuisson</span>}
    </span>
  );
}

/** Les pastilles d'une recette : type de plat, puis régime ou viande. */
function RecipeTags({ r }: { r: Recipe }) {
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <RecipeTag>{COURSE_META[r.course].label}</RecipeTag>
      {r.vegetarian ? (
        <RecipeTag>🌿 Végé</RecipeTag>
      ) : (
        r.meat && (
          <RecipeTag>
            {MEAT_META[r.meat].icon} {MEAT_META[r.meat].label}
          </RecipeTag>
        )
      )}
    </span>
  );
}

/** Rangée d'index (mobile) : vignette, titre, méta, pastilles. Toute la ligne ouvre. */
function RecipeRow({ r, to, last }: { r: Recipe; to: string; last: boolean }) {
  return (
    <div className={last ? "" : "border-b border-hairline"}>
      <Link to={to} className="flex items-start gap-3 py-3">
        <RecipeThumb r={r} className="h-[78px] w-[78px]" />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold leading-snug">{r.title}</span>
          <RecipeMeta r={r} />
          <RecipeTags r={r} />
        </span>
      </Link>
    </div>
  );
}

/** Carte d'index (ordinateur) : la grille a la largeur pour une grande photo. */
function RecipeCard({ r, onOpen }: { r: Recipe; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="card flex h-full flex-col text-left transition hover:border-brand-400"
    >
      <RecipeThumb r={r} className="h-32 w-full" />
      <span className="mt-2 line-clamp-2 font-semibold leading-snug" title={r.title}>
        {r.title}
      </span>
      <RecipeMeta r={r} />
      <span className="mt-auto pt-2">
        <RecipeTags r={r} />
      </span>
    </button>
  );
}

/* ---------------- Sous-page : une recette ---------------- */

/**
 * Multiplie la quantité d'une ligne d'ingrédient. Gère « 200 », « 1,5 » et
 * « 1/2 » ; laisse le reste intact (« 1 pincée » reste « 1 pincée » si le
 * facteur est 1). Une quantité qu'on ne sait pas lire n'est pas inventée.
 */
function scaleQty(qty: string, factor: number): string {
  if (factor === 1 || !qty) return qty;
  const fmt = (n: number) =>
    Number(n.toFixed(2))
      .toString()
      .replace(".", ",");
  const frac = qty.match(/^(\d+)\s*\/\s*(\d+)/);
  if (frac) {
    const value = (Number(frac[1]) / Number(frac[2])) * factor;
    return qty.replace(frac[0], fmt(value));
  }
  return qty.replace(/\d+(?:[.,]\d+)?/, (m) => fmt(Number(m.replace(",", ".")) * factor));
}

function RecipeDetail({ recipe: r, backTo }: { recipe?: Recipe; backTo: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [servings, setServings] = useState(r?.servings ?? 4);
  const [editing, setEditing] = useState(false);
  // Ingrédients cochés pendant la préparation (par défaut aucun).
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/courses/recipes/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recipes"] });
      navigate(backTo, { replace: true });
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
  const cookTonight = useMutation({
    mutationFn: (id: string) => api.post("/api/courses/meal-plan/add", { recipeId: id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meal-plan"] });
      toast.success("Ajoutée au menu de la semaine");
    },
    onError: () => toast.error("Impossible d'ajouter au menu."),
  });

  // Hooks déclarés avant tout retour anticipé.
  usePageHeader(r?.title ?? "Recette", "Mes recettes");
  usePageChrome(backTo, [
    { label: "Modifier la recette", onClick: () => setEditing(true) },
    {
      label: "Supprimer la recette",
      danger: true,
      onClick: () => {
        if (r && confirm(`Supprimer « ${r.title} » ?`)) remove.mutate(r.id);
      },
    },
  ]);

  if (!r) {
    return (
      <div className="card flex flex-col items-start gap-3 text-sm text-slate-400">
        <p>Cette recette n'existe plus.</p>
        <Link to={backTo} className="btn-primary">
          Revenir aux recettes
        </Link>
      </div>
    );
  }

  const factor = r.servings > 0 ? servings / r.servings : 1;
  // Le nom porte la ligne : il commence par une majuscule, la quantité vit à
  // droite. C'est la colonne des noms qu'on balaie en cuisinant.
  const scaled = r.ingredients.map((line) => {
    const { qty, name } = splitIngredient(line);
    const label = qty ? name : line;
    return {
      qty: scaleQty(qty, factor),
      name: label.charAt(0).toUpperCase() + label.slice(1),
    };
  });
  const allNames = scaled.map((s) => joinIngredient(s.qty, s.name));

  const Stat = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="flex flex-col items-center rounded-2xl border border-line bg-surface px-2 py-2.5">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-0.5 text-base font-semibold">{children}</div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 pb-28 md:pb-0">
      <RecipeThumb r={r} className="h-52 w-full md:h-64" />

      <div>
        <h1 className="text-xl font-bold leading-snug">{r.title}</h1>
        <RecipeTags r={r} />
      </div>

      {/* Les trois chiffres de la recette. Les portions sont réglables : les
          quantités d'ingrédients suivent. */}
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Préparation">
          {r.prepMinutes != null ? fmtDuration(r.prepMinutes) : "—"}
        </Stat>
        <Stat label="Total">{r.totalMinutes != null ? fmtDuration(r.totalMinutes) : "—"}</Stat>
        <Stat label="Portions">
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setServings((s) => Math.max(1, s - 1))}
              aria-label="Moins de portions"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-ink-2"
            >
              −
            </button>
            <span className="min-w-4 text-center tabular-nums">{servings}</span>
            <button
              type="button"
              onClick={() => setServings((s) => Math.min(30, s + 1))}
              aria-label="Plus de portions"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-ink-2"
            >
              +
            </button>
          </span>
        </Stat>
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <span className="eyebrow">Ingrédients · {r.ingredients.length}</span>
          <button
            type="button"
            onClick={() => addToList.mutate(allNames)}
            className="shrink-0 text-sm font-semibold text-brand-600"
          >
            Tout aux courses
          </button>
        </div>
        <div className="card">
          {scaled.map((ing, i) => {
            const done = checked.has(i);
            return (
              <div
                key={i}
                className={`flex min-h-[52px] items-center gap-3 ${
                  i === scaled.length - 1 ? "" : "border-b border-hairline"
                }`}
              >
                <Checkbox size="lg" checked={done} onChange={() => toggle(i)} />
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  className={`min-w-0 flex-1 py-2 text-left text-base ${
                    done ? "text-slate-400 line-through" : ""
                  }`}
                >
                  {ing.name}
                </button>
                {ing.qty && (
                  <span
                    className={`shrink-0 text-sm tabular-nums ${done ? "text-slate-400" : "text-ink-2"}`}
                  >
                    {ing.qty}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {r.steps.length > 0 && (
        <div>
          <div className="eyebrow mb-2">Étapes</div>
          <div className="card flex flex-col gap-3">
            {r.steps.map((st, i) => (
              <div key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-ink-2">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 text-base leading-relaxed">{st}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {r.sourceUrl && (
        <a
          href={r.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-brand-600 underline"
        >
          Voir la recette originale
        </a>
      )}

      {/* Action principale : la recette sert à cuisiner. Le panier envoie les
          ingrédients aux courses sans quitter l'écran. */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex gap-2 px-4 pt-6 md:hidden"
        style={{
          paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
          background: "linear-gradient(to top, rgb(var(--c-bg)) 55%, rgb(var(--c-bg) / 0))",
        }}
      >
        <button
          type="button"
          onClick={() => cookTonight.mutate(r.id)}
          className="pointer-events-auto flex h-[52px] flex-1 items-center justify-center rounded-full bg-brand-600 text-base font-semibold text-on-brand shadow-lg"
        >
          Cuisiner ce soir
        </button>
        <button
          type="button"
          onClick={() => addToList.mutate(allNames)}
          aria-label="Envoyer les ingrédients aux courses"
          className="pointer-events-auto flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-lg"
        >
          <IconCart size={22} />
        </button>
      </div>

      {/* Ordinateur : les mêmes actions, en ligne. */}
      <div className="hidden items-center gap-2 md:flex">
        <button type="button" onClick={() => cookTonight.mutate(r.id)} className="btn-primary">
          Cuisiner ce soir
        </button>
        <button type="button" onClick={() => addToList.mutate(allNames)} className="btn">
          Envoyer aux courses
        </button>
      </div>

      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
          onClick={() => setEditing(false)}
        >
          <div className="card my-4 w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 font-semibold">Modifier la recette</div>
            <RecipeEditor
              key={r.id}
              recipe={r}
              onClose={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                qc.invalidateQueries({ queryKey: ["recipes"] });
              }}
            />
          </div>
        </div>
      )}
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
  /** { recipeId: date ISO } — les repas déjà cuisinés. */
  cooked: Record<string, string>;
  recipes: Recipe[];
}

/**
 * Familles de repas de la semaine. Plus grossier que `MEAT_TYPES` : c'est
 * l'équilibre qu'on regarde (combien de végé, combien de rouge), pas le détail.
 */
const MEAL_FAMILIES = [
  { key: "vege", label: "végé", color: "bg-brand-600" },
  { key: "volaille", label: "volaille", color: "bg-warning" },
  { key: "poisson", label: "poisson", color: "bg-info" },
  { key: "rouge", label: "viande rouge", color: "bg-danger" },
] as const;
type MealFamily = (typeof MEAL_FAMILIES)[number]["key"];

function familyOf(r: Recipe): MealFamily {
  if (r.vegetarian || !r.meat) return "vege";
  if (r.meat === "poisson") return "poisson";
  if (r.meat === "poulet" || r.meat === "canard") return "volaille";
  return "rouge";
}

/** « Végé », « Poulet »… — ce que la ligne annonce à droite de la durée. */
function mealLabel(r: Recipe): string {
  if (r.vegetarian || !r.meat) return "Végé";
  return MEAT_META[r.meat].label;
}

/** « lundi », « mercredi » — le jour où le repas a été coché. */
function weekdayFr(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR", { weekday: "long" });
}

function WeekMealPlan() {
  const qc = useQueryClient();
  const toast = useToast();
  const [modal, setModal] = useState<{ id: string; edit: boolean } | null>(null);
  // Repas dont la feuille d'actions est ouverte, et sélecteur « choisir moi-même ».
  const [sheet, setSheet] = useState<Recipe | null>(null);
  const [picking, setPicking] = useState<Recipe | null>(null);
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
  // Mobile : les paramètres vivent dans une modale ouverte par le bouton flottant.
  const [paramsOpen, setParamsOpen] = useState(false);

  const { data: plan, isLoading } = useQuery({
    queryKey: ["meal-plan"],
    queryFn: () => api.get<MealPlanData | null>("/api/courses/meal-plan"),
  });
  // Même clé que l'onglet « Mes recettes » : déjà en cache, aucune requête de
  // plus. Sert à compter les remplacements possibles et à les proposer.
  const { data: allRecipesData } = useQuery({
    queryKey: ["recipes"],
    queryFn: () => api.get<Recipe[]>("/api/courses/recipes"),
  });
  useEffect(() => {
    if (plan) {
      setCount(String(plan.count));
      setMaxPrep(plan.maxPrepMinutes != null ? String(plan.maxPrepMinutes) : "");
      setMaxTotal(plan.maxTotalMinutes != null ? String(plan.maxTotalMinutes) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.createdAt]);

  // Le sur-titre dit où l'on en est du menu, pas le nombre total de recettes.
  const remaining = (plan?.recipes ?? []).filter((r) => !plan?.cooked?.[r.id]).length;
  usePageHeader(
    "Repas",
    plan ? `Menu en cours · ${remaining} à cuisiner` : "Aucun menu en cours",
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ["meal-plan"] });
  const generate = useMutation({
    mutationFn: () =>
      api.post("/api/courses/meal-plan/generate", {
        count: Math.max(1, Math.min(14, Number(count) || 5)),
        maxPrepMinutes: maxPrep ? Number(maxPrep) : null,
        maxTotalMinutes: maxTotal ? Number(maxTotal) : null,
      }),
    onSuccess: () => {
      setParamsOpen(false);
      invalidate();
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError && e.message.includes("no_candidates")
          ? "Aucun plat de « Mes recettes » ne respecte ces contraintes de temps."
          : "Impossible de générer la semaine.",
      ),
  });
  const replace = useMutation({
    mutationFn: (v: { recipeId: string; withRecipeId?: string }) =>
      api.post("/api/courses/meal-plan/replace", v),
    onSuccess: invalidate,
    onError: () => toast.error("Pas d'autre plat compatible pour remplacer celui-ci."),
  });
  const setCooked = useMutation({
    mutationFn: (v: { recipeId: string; done: boolean }) =>
      api.post("/api/courses/meal-plan/cooked", v),
    onSuccess: invalidate,
  });
  const removeFromPlan = useMutation({
    mutationFn: (recipeId: string) => api.post("/api/courses/meal-plan/remove", { recipeId }),
    onSuccess: invalidate,
  });
  const moveTop = useMutation({
    mutationFn: (recipeId: string) => api.post("/api/courses/meal-plan/move-top", { recipeId }),
    onSuccess: invalidate,
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
  const allRecipes = allRecipesData ?? [];
  const inPlan = new Set(recipes.map((r) => r.id));
  /** Plats de « Mes recettes » qui pourraient prendre la place de celui-ci. */
  const swapCandidates = (r: Recipe) =>
    allRecipes.filter(
      (c) => c.course === "plat" && !inPlan.has(c.id) && (!r.meat || c.meat !== r.meat),
    );

  // Champs de génération, partagés par la carte (ordinateur) et la modale (mobile).
  const paramFields = (
    <>
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
    </>
  );
  const generateButton = (
    <button
      type="button"
      onClick={() => generate.mutate()}
      disabled={generate.isPending}
      className="btn-primary"
    >
      {generate.isPending ? "Génération…" : plan ? "Régénérer la semaine" : "Générer les repas"}
    </button>
  );

  const cooked = plan?.cooked ?? {};
  const todo = recipes.filter((r) => !cooked[r.id]);
  const done = recipes.filter((r) => cooked[r.id]);
  // Ce qu'il reste à acheter : les ingrédients des repas pas encore cuisinés.
  const pendingIngredients = todo.flatMap((r) => selectedIngredients(r));

  // Équilibre : combien de chaque famille, et les deux chiffres de temps.
  const counts = MEAL_FAMILIES.map((f) => ({
    ...f,
    n: recipes.filter((r) => familyOf(r) === f.key).length,
  })).filter((f) => f.n > 0);
  const times = recipes.map((r) => r.totalMinutes ?? r.prepMinutes).filter((v): v is number => !!v);
  const avgTime = times.length ? Math.round(times.reduce((s, v) => s + v, 0) / times.length) : null;
  const maxTime = times.length ? Math.max(...times) : null;
  const meats = recipes.map((r) => r.meat).filter(Boolean);
  const starches = recipes.map((r) => r.starch).filter((s) => s !== "aucun");
  const noRepeat = new Set(meats).size === meats.length && new Set(starches).size === starches.length;

  /** Une ligne de repas : la case à cocher est la seule action visible. */
  const mealRow = (r: Recipe, last: boolean) => {
    const at = cooked[r.id];
    return (
      <div key={r.id} className={last ? "" : "border-b border-hairline"}>
        <div className="flex items-center gap-3 py-2.5">
          <Checkbox
            size="lg"
            checked={!!at}
            onChange={() => setCooked.mutate({ recipeId: r.id, done: !at })}
          />
          <button
            type="button"
            onClick={() => setModal({ id: r.id, edit: false })}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            <RecipeThumb r={r} className="h-14 w-14" />
            <span className="min-w-0 flex-1">
              <span
                className={`block text-base font-semibold leading-snug ${
                  at ? "text-slate-400 line-through" : ""
                }`}
              >
                {r.title}
              </span>
              <span className="mt-0.5 block text-xs text-slate-400">
                {at
                  ? `fait ${weekdayFr(at)} · ne sera plus proposé`
                  : [
                      r.totalMinutes ?? r.prepMinutes
                        ? fmtDuration((r.totalMinutes ?? r.prepMinutes) as number)
                        : null,
                      mealLabel(r),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSheet(r)}
            aria-label={`Autres actions sur ${r.title}`}
            className="flex h-tap w-9 shrink-0 items-center justify-center rounded-lg text-ink-2"
          >
            <IconMore size={20} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3 pb-28 md:pb-0">
      {/* Ce qu'est ce menu, et de quoi il est fait. Le ↻ régénère sans quitter. */}
      <div className="card flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold">
            {plan
              ? `${recipes.length} repas piochés dans tes ${allRecipes.length} recettes`
              : "Aucun menu en cours"}
          </div>
          <p className="mt-0.5 text-sm text-slate-400">
            {plan
              ? "Jamais deux fois la même viande ni le même féculent · dans l'ordre que tu veux"
              : "Génère une sélection variée piochée dans Mes recettes."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => generate.mutate()}
          disabled={generate.isPending}
          aria-label={plan ? "Régénérer la semaine" : "Générer les repas"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink disabled:opacity-50"
        >
          <IconRefresh size={20} />
        </button>
      </div>

      {/* Paramètres inline sur ordinateur (sur mobile ils vivent dans « Règles »). */}
      <div className="card hidden flex-wrap items-end gap-3 md:flex">
        {paramFields}
        {generateButton}
      </div>

      {!plan ? (
        <div className="card text-sm text-slate-400">
          Aucune semaine générée pour le moment — lance une génération pour la remplir.
        </div>
      ) : (
        <>
          {todo.length > 0 && (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <span className="eyebrow">À cuisiner · {todo.length}</span>
                <span className="text-xs text-slate-400">coche quand c'est fait</span>
              </div>
              <div className="card">
                {todo.map((r, i) => mealRow(r, i === todo.length - 1))}
              </div>
            </>
          )}

          {done.length > 0 && (
            <>
              <div className="eyebrow mt-1 flex items-center gap-1.5">
                <IconCheck size={14} className="text-brand-600" />
                Faits · {done.length}
              </div>
              <div className="card">
                {done.map((r, i) => mealRow(r, i === done.length - 1))}
              </div>
            </>
          )}

          {/* L'équilibre de la semaine, en une barre et une phrase. */}
          {recipes.length > 0 && (
            <div className="card mt-1">
              <div className="eyebrow">Équilibre de la semaine</div>
              <div className="mt-2 flex gap-1">
                {counts.map((f) => (
                  <span
                    key={f.key}
                    className={`h-2 rounded-full ${f.color}`}
                    style={{ flexGrow: f.n }}
                  />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
                {counts.map((f) => (
                  <span key={f.key} className="inline-flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${f.color}`} aria-hidden="true" />
                    {f.n} {f.label}
                  </span>
                ))}
              </div>
              <p className="mt-3 border-t border-hairline pt-3 text-sm text-slate-400">
                {noRepeat
                  ? "Aucune répétition de viande ni de féculent."
                  : "Une viande ou un féculent revient deux fois."}
                {avgTime != null && ` Temps moyen ${fmtDuration(avgTime)}`}
                {maxTime != null && ` · le plus long ${fmtDuration(maxTime)}`}.
              </p>
            </div>
          )}

          {/* Les deux actions de la semaine, libellées. */}
          <div className="card">
            <button
              type="button"
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
              className="flex w-full items-center gap-3 border-b border-hairline py-2 text-left disabled:opacity-50"
            >
              <IconRefresh size={20} className="shrink-0 text-ink-2" />
              <span className="min-w-0">
                <span className="block text-base font-medium">
                  {generate.isPending ? "Génération…" : "Régénérer la semaine"}
                </span>
                <span className="block text-xs text-slate-400">garde les repas déjà cuisinés</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setParamsOpen(true)}
              className="flex w-full items-center gap-3 py-2 text-left"
            >
              <IconFilter size={20} className="shrink-0 text-ink-2" />
              <span className="min-w-0 flex-1">
                <span className="block text-base font-medium">Règles de génération</span>
                <span className="block text-xs text-slate-400">
                  {plan.count} repas
                  {plan.maxTotalMinutes ? ` · max ${fmtDuration(plan.maxTotalMinutes)}` : ""}
                  {plan.maxPrepMinutes ? ` · préparation ≤ ${fmtDuration(plan.maxPrepMinutes)}` : ""}
                </span>
              </span>
              <IconChevronRight size={20} className="shrink-0 text-slate-400" />
            </button>
          </div>

          <MobileActionBar
            label={
              pendingIngredients.length > 0
                ? `Ajouter les ${pendingIngredients.length} ingrédients`
                : "Aucun ingrédient à ajouter"
            }
            icon={<IconCart size={20} />}
            disabled={pendingIngredients.length === 0 || addToList.isPending}
            onClick={() => addToList.mutate(pendingIngredients)}
          />
          <div className="hidden justify-center pt-1 md:flex">
            <button
              type="button"
              onClick={() => addToList.mutate(pendingIngredients)}
              disabled={pendingIngredients.length === 0 || addToList.isPending}
              className="btn-primary"
            >
              Ajouter les {pendingIngredients.length} ingrédients à la liste de course
            </button>
          </div>
        </>
      )}

      {sheet && (
        <ActionSheet
          title={sheet.title}
          subtitle={[
            sheet.totalMinutes ?? sheet.prepMinutes
              ? fmtDuration((sheet.totalMinutes ?? sheet.prepMinutes) as number)
              : null,
            mealLabel(sheet),
          ]
            .filter(Boolean)
            .join(" · ")}
          thumbnail={<RecipeThumb r={sheet} className="h-12 w-12" />}
          items={[
            {
              label: "Remplacer par une autre recette",
              hint: `${swapCandidates(sheet).length} proposition${
                swapCandidates(sheet).length > 1 ? "s" : ""
              }${sheet.meat ? ` sans ${MEAT_META[sheet.meat].label.toLowerCase()}` : ""}`,
              icon: <IconRefresh size={20} />,
              onClick: () => replace.mutate({ recipeId: sheet.id }),
            },
            {
              label: "Choisir moi-même dans mes recettes",
              icon: <IconLines size={20} />,
              onClick: () => setPicking(sheet),
            },
            {
              label: "Remonter en haut de la liste",
              icon: <IconArrows size={20} />,
              onClick: () => moveTop.mutate(sheet.id),
            },
            {
              label: "Retirer ce repas",
              hint: "il redevient piochable",
              icon: <IconClose size={20} />,
              danger: true,
              onClick: () => removeFromPlan.mutate(sheet.id),
            },
          ]}
          onClose={() => setSheet(null)}
        />
      )}

      {picking && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
          onClick={() => setPicking(null)}
        >
          <div className="card my-4 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 font-semibold">Remplacer « {picking.title} »</div>
            <p className="mb-3 text-xs text-slate-400">
              Choisis la recette qui prend sa place dans le menu.
            </p>
            <div className="max-h-[60vh] overflow-y-auto">
              {swapCandidates(picking).length === 0 ? (
                <p className="text-sm text-slate-400">
                  Toutes tes recettes de plat sont déjà dans le menu.
                </p>
              ) : (
                swapCandidates(picking).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      replace.mutate({ recipeId: picking.id, withRecipeId: r.id });
                      setPicking(null);
                    }}
                    className="flex w-full items-center gap-3 border-b border-hairline py-2.5 text-left last:border-0"
                  >
                    <RecipeThumb r={r} className="h-12 w-12" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-medium">{r.title}</span>
                      <span className="block text-xs text-slate-400">
                        {[
                          r.totalMinutes ?? r.prepMinutes
                            ? fmtDuration((r.totalMinutes ?? r.prepMinutes) as number)
                            : null,
                          mealLabel(r),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {paramsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
          onClick={() => setParamsOpen(false)}
        >
          <div className="card my-4 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Générer des repas</h2>
              <button
                onClick={() => setParamsOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-wrap items-end gap-3">{paramFields}</div>
            <div className="mt-4 flex justify-end">{generateButton}</div>
          </div>
        </div>
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
  // Les coins arrondis sont portés par l'image elle-même, pas par un
  // `overflow-hidden` sur la carte : celui-ci rognait le menu « ⋯ » qui s'ouvre
  // à l'intérieur de la carte.
  const shape = "h-44 w-full rounded-t-2xl";
  if (!src || failed) {
    return (
      <div className={`${shape} flex items-center justify-center bg-surface-2 text-4xl`}>
        {COURSE_META[course].icon}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className={`${shape} object-cover`}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Carte d'une idée : la photo, ce que c'est, ses ingrédients, **une** action.
 * Le reste (ne plus la proposer) vit dans le « ⋯ » — plus de légende en tête de
 * page pour expliquer un pictogramme.
 */
function IdeaCard({
  idea,
  onAdd,
  onHide,
  adding,
}: {
  idea: RecipeIdea;
  onAdd: () => void;
  onHide: () => void;
  adding: boolean;
}) {
  // Trois ingrédients affichés, le reste compté : la carte annonce le plat,
  // elle n'est pas la recette.
  const shown = idea.ingredients.slice(0, 3);
  const extra = idea.ingredients.length - shown.length;
  return (
    // Photo bord à bord : le retrait est porté par le bloc de texte, pas par la
    // carte. `p-0` en style inline — `.card` est hors `@layer` et bat `p-0`.
    // Pas d'`overflow-hidden` ici : il rognerait le menu « ⋯ » de la carte.
    <div className="card flex flex-col" style={{ padding: 0 }}>
      <IdeaImage src={idea.imageUrl} course={idea.course} />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="text-base font-semibold leading-snug">{idea.title}</div>
        <p className="text-sm leading-relaxed text-slate-400">{idea.description}</p>
        {shown.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {shown.map((ing) => (
              <span
                key={ing}
                className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-ink-2"
              >
                {ing}
              </span>
            ))}
            {extra > 0 && (
              <span className="rounded-full px-2 py-1 text-xs text-slate-400">+{extra}</span>
            )}
          </div>
        )}
        <div className="mt-auto flex items-center gap-2 pt-2">
          <button
            type="button"
            onClick={onAdd}
            disabled={adding}
            className="flex h-[52px] flex-1 items-center justify-center rounded-full bg-brand-600 text-base font-semibold text-on-brand disabled:opacity-60"
          >
            {adding ? "Ajout…" : "Ajouter à mes recettes"}
          </button>
          <OverflowMenu
            label={`Autres actions sur « ${idea.title} »`}
            buttonClassName="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-line bg-surface text-ink-2 transition hover:text-ink"
            items={[{ label: "Ne plus proposer", danger: true, onClick: onHide }]}
          />
        </div>
      </div>
    </div>
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
  const exclusions = data?.exclusions ?? [];
  // Le sur-titre remplace le paragraphe d'explication : il dit d'où viennent
  // les idées et combien d'ingrédients sont écartés. Le parent laisse la main.
  usePageHeader(
    "Repas",
    `Hors de tes recettes${
      exclusions.length > 0
        ? ` · ${exclusions.length} ingrédient${exclusions.length > 1 ? "s" : ""} exclu${exclusions.length > 1 ? "s" : ""}`
        : ""
    }`,
  );

  if (!data) return <PageLoader variant="repas" />;
  const visible = data.ideas.filter((i) => i.course === fCourse);
  const generateLabel = generate.isPending
    ? "Génération…"
    : visible.length > 0
      ? "Proposer d'autres idées"
      : "Proposer des idées";

  return (
    <div className="flex flex-col gap-3 pb-28 md:pb-0">
      <div className="flex items-center gap-2">
        {/* La génération cible la catégorie affichée : le filtre EST le choix. */}
        <FilterChips
          value={fCourse}
          onChange={(v) => setFCourse(v as CourseType)}
          className="min-w-0 flex-1"
          items={COURSE_TYPES.map((ct) => ({ value: ct, label: COURSE_META[ct].label }))}
        />
        <button
          type="button"
          onClick={() => generate.mutate(fCourse)}
          disabled={generate.isPending}
          className="btn-primary hidden shrink-0 whitespace-nowrap md:inline-flex"
        >
          {generateLabel}
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="card text-sm text-slate-400">
          {generate.isPending
            ? "Génération des idées en cours…"
            : `Aucune idée de type « ${COURSE_META[fCourse].label.toLowerCase()} » pour l'instant.`}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visible.map((idea) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              adding={add.isPending && add.variables === idea.id}
              onAdd={() => add.mutate(idea.id)}
              onHide={() => hide.mutate(idea.id)}
            />
          ))}
        </div>
      )}

      <Link to="/settings/repas" className="px-1 text-xs text-slate-400 underline">
        Gérer les ingrédients exclus
        {exclusions.length > 0 ? ` (${exclusions.length})` : ""}
      </Link>

      <MobileActionBar
        label={generateLabel}
        icon={<IconSparkle size={20} />}
        disabled={generate.isPending}
        onClick={() => generate.mutate(fCourse)}
      />
    </div>
  );
}

/* ---------------- Édition d'une recette ---------------- */

// Sépare "200 g de farine" -> { qty: "200 g", name: "farine" } (heuristique, sans perte).
function splitIngredient(line: string): { qty: string; name: string } {
  const m = line
    .trim()
    .match(
      /^([\d.,/]+\s*(?:g|kg|mg|ml|cl|l|cs|cc|càs|càc|cuillères?(?:\s?à\s?(?:soupe|café))?|pincées?|sachets?|gousses?|tranches?|pièces?|verres?|tasses?|bottes?|boîtes?|rouleaux?|feuilles?|brins?|bouquets?|filets?|barquettes?|c\.?\s?à\.?\s?[sc]\.?)?\.?)\s+(?:de\s+|d['’])?(.+)$/i,
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
