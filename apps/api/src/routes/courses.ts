import { Hono } from "hono";
import { eq, and, asc, desc, sql } from "drizzle-orm";
import type { Db } from "../lib/types";
import {
  createShoppingItemSchema,
  updateShoppingItemSchema,
  addShoppingItemsSchema,
  createShoppingFavoriteSchema,
  reorderFavoritesSchema,
  importRecipeSchema,
  bulkImportRecipesSchema,
  updateRecipeSchema,
  updateExcludedIngredientsSchema,
  categoryFor,
  generateIdeasSchema,
  generateMealPlanSchema,
  replaceMealPlanRecipeSchema,
  addMealPlanRecipeSchema,
  mealPlanRecipeSchema,
  setMealCookedSchema,
} from "@gfa/shared";
import { shoppingItem, shoppingFavorite, recipe, recipeIdea, mealPlan, household } from "../db/schema";
import { callClaude, resolveAnthropicKey } from "../lib/anthropic";
import { OUTBOUND_USER_AGENT } from "../lib/http";
import { parseBody } from "../lib/validate";
import { newId, nowIso } from "../lib/util";
import type { AppContext } from "../lib/types";

const courses = new Hono<AppContext>();

/* ---------------- Liste à acheter ---------------- */

/**
 * Ajoute un article ; si un article de même nom existe déjà, incrémente sa
 * quantité. Le rayon est résolu ici plutôt que par l'appelant, pour que tous
 * les chemins d'ajout (saisie, liste d'une recette, import) en aient un.
 */
async function addOrIncrement(db: Db, hid: string, rawName: string, category?: string | null) {
  const name = rawName.trim();
  if (!name) return;
  const existing = await db
    .select()
    .from(shoppingItem)
    .where(
      and(
        eq(shoppingItem.householdId, hid),
        sql`lower(${shoppingItem.name}) = ${name.toLowerCase()}`,
      ),
    );
  if (existing.length > 0) {
    await db
      .update(shoppingItem)
      .set({ quantity: existing[0].quantity + 1 })
      .where(eq(shoppingItem.id, existing[0].id));
  } else {
    await db.insert(shoppingItem).values({
      id: newId(),
      householdId: hid,
      name,
      quantity: 1,
      category: category ?? categoryFor(name),
      createdAt: nowIso(),
    });
  }
}

courses.get("/items", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select()
    .from(shoppingItem)
    .where(eq(shoppingItem.householdId, c.get("household").id))
    .orderBy(asc(shoppingItem.createdAt));
  return c.json(rows);
});

courses.post("/items", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, createShoppingItemSchema);
  await addOrIncrement(db, c.get("household").id, body.name, body.category);
  return c.json({ ok: true }, 201);
});

courses.patch("/items/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const body = await parseBody(c, updateShoppingItemSchema);
  // Quantité à zéro = article acheté : la ligne disparaît de la liste.
  if (body.quantity !== undefined && body.quantity <= 0) {
    await db.delete(shoppingItem).where(eq(shoppingItem.id, id));
    return c.json({ ok: true });
  }
  await db
    .update(shoppingItem)
    .set({
      ...(body.quantity !== undefined && { quantity: body.quantity }),
      ...(body.category !== undefined && { category: body.category }),
    })
    .where(eq(shoppingItem.id, id));
  return c.json({ ok: true });
});

courses.post("/items/bulk", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, addShoppingItemsSchema);
  const hid = c.get("household").id;
  for (const name of body.names) await addOrIncrement(db, hid, name);
  return c.json({ ok: true });
});

courses.delete("/items/:id", async (c) => {
  await c.get("db").delete(shoppingItem).where(eq(shoppingItem.id, c.req.param("id")));
  return c.json({ ok: true });
});

/* ---------------- Favoris ---------------- */

courses.get("/favorites", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select()
    .from(shoppingFavorite)
    .where(eq(shoppingFavorite.householdId, c.get("household").id))
    .orderBy(asc(shoppingFavorite.position));
  return c.json(rows.map((r) => ({ id: r.id, name: r.name, position: r.position })));
});

courses.post("/favorites", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, createShoppingFavoriteSchema);
  const name = body.name.trim();
  // pas de doublon (insensible à la casse)
  const existing = await db
    .select()
    .from(shoppingFavorite)
    .where(
      and(
        eq(shoppingFavorite.householdId, hid),
        sql`lower(${shoppingFavorite.name}) = ${name.toLowerCase()}`,
      ),
    );
  if (existing.length > 0) return c.json({ ok: true, id: existing[0].id });
  const all = await db
    .select()
    .from(shoppingFavorite)
    .where(eq(shoppingFavorite.householdId, hid));
  const maxPos = all.reduce((m, f) => Math.max(m, f.position), 0);
  const id = newId();
  await db.insert(shoppingFavorite).values({
    id,
    householdId: hid,
    name,
    position: maxPos + 1,
    createdAt: nowIso(),
  });
  return c.json({ ok: true, id }, 201);
});

courses.patch("/favorites/reorder", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, reorderFavoritesSchema);
  for (let i = 0; i < body.orderedIds.length; i++) {
    await db
      .update(shoppingFavorite)
      .set({ position: i })
      .where(eq(shoppingFavorite.id, body.orderedIds[i]));
  }
  return c.json({ ok: true });
});

courses.delete("/favorites/:id", async (c) => {
  await c.get("db").delete(shoppingFavorite).where(eq(shoppingFavorite.id, c.req.param("id")));
  return c.json({ ok: true });
});

/* ---------------- Recettes ---------------- */

type RecipeRow = typeof recipe.$inferSelect;

function mapRecipeRow(r: RecipeRow) {
  return {
    id: r.id,
    title: r.title,
    sourceUrl: r.sourceUrl,
    imageUrl: r.imageUrl,
    servings: r.servings,
    prepMinutes: r.prepMinutes,
    totalMinutes: r.totalMinutes,
    vegetarian: Boolean(r.vegetarian),
    meat: normalizeMeat(r.meat),
    starch: normalizeStarch(r.starch),
    vegetables: Boolean(r.vegetables),
    course: normalizeCourse(r.course),
    ingredients: safeArray(r.ingredients),
    steps: safeArray(r.steps),
    createdAt: r.createdAt,
  };
}

courses.get("/recipes", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select()
    .from(recipe)
    .where(eq(recipe.householdId, c.get("household").id))
    .orderBy(asc(recipe.createdAt));
  return c.json(rows.map(mapRecipeRow));
});

/**
 * Instagram / TikTok : la recette vit dans la légende de la vidéo, mais les
 * pages elles-mêmes sont des murs anti-bot (login wall, shell JS). On passe
 * par leurs endpoints oEmbed, qui renvoient la légende complète (`title`),
 * la vignette et l'auteur sans authentification.
 * Renvoie null si l'URL n'est pas un réseau social (→ extraction HTML classique).
 */
async function fetchSocialCaption(
  url: string,
): Promise<{ text: string; imageUrl: string | null } | null> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  let oembedUrl: string | null = null;
  if (/(^|\.)tiktok\.com$/.test(host)) {
    oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
  } else if (/(^|\.)instagram\.com$/.test(host)) {
    oembedUrl = `https://i.instagram.com/api/v1/oembed/?url=${encodeURIComponent(url)}`;
  }
  if (!oembedUrl) return null;

  const res = await fetch(oembedUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`oembed_${res.status}`);
  const data = (await res.json()) as {
    title?: string;
    thumbnail_url?: string;
    author_name?: string;
  };
  if (!data.title) throw new Error("oembed_no_caption");
  return {
    text: data.author_name ? `Recette de ${data.author_name} :\n\n${data.title}` : data.title,
    imageUrl: data.thumbnail_url ?? null,
  };
}

courses.post("/recipes/import", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, importRecipeSchema);

  let pageText: string;
  let imageUrl: string | null = null;
  if (body.url) {
    try {
      const social = await fetchSocialCaption(body.url);
      if (social) {
        pageText = social.text.slice(0, 14000);
        imageUrl = social.imageUrl;
      } else {
        const res = await fetch(body.url, {
          headers: { "User-Agent": OUTBOUND_USER_AGENT },
        });
        if (!res.ok) return c.json({ error: "fetch_failed", status: res.status }, 502);
        const html = await res.text();
        imageUrl = extractImage(html, body.url);
        pageText = htmlToText(html).slice(0, 14000);
      }
    } catch (e) {
      return c.json({ error: "fetch_error", detail: String(e) }, 502);
    }
  } else {
    // Texte collé par l'utilisateur (repli quand le lien ne fonctionne pas).
    pageText = (body.text ?? "").slice(0, 14000);
  }

  const apiKey = await resolveAnthropicKey(c.get("household"), c.env);
  if (!apiKey) return c.json({ error: "no_api_key" }, 400);
  let parsed: ParsedRecipe;
  try {
    parsed = await extractRecipeJson(apiKey, pageText);
  } catch (e) {
    return c.json({ error: "extract_failed", detail: String(e) }, 502);
  }
  // Publication sans recette dans le texte (ex. légende TikTok = hashtags seuls).
  if (parsed.error === "no_recipe") {
    return c.json({ error: "no_recipe" }, 422);
  }

  const id = await insertRecipe(db, c.get("household").id, parsed, body.url ?? null, imageUrl);
  return c.json({ ok: true, id }, 201);
});

// Décode une image base64 (data URI "data:image/…;base64,…" ou base64 nu).
function decodeBase64Image(input: string): { bytes: Uint8Array; contentType: string } | null {
  const m = input.match(/^data:(image\/[a-z0-9+.-]+);base64,([\s\S]*)$/i);
  const contentType = m ? m[1] : "image/jpeg";
  const b64 = (m ? m[2] : input).replace(/\s+/g, "");
  try {
    const bin = atob(b64);
    if (bin.length === 0) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, contentType };
  } catch {
    return null;
  }
}

// Import en masse depuis un JSON collé (généré ailleurs, ex. par Claude) :
// insertion directe, aucun appel LLM. Une image base64 est stockée dans R2 et
// servie via /public/recipe-images/:key (prioritaire sur imageUrl).
courses.post("/recipes/bulk", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, bulkImportRecipesSchema);
  for (const r of body.recipes) {
    let imageUrl = r.imageUrl ?? null;
    if (r.imageBase64) {
      const img = decodeBase64Image(r.imageBase64);
      if (img) {
        const key = newId();
        await c.env.FILES.put(`recipes/${key}`, img.bytes, {
          httpMetadata: { contentType: img.contentType },
        });
        imageUrl = `${c.env.API_URL}/public/recipe-images/${key}`;
      }
    }
    await insertRecipe(db, hid, r, r.sourceUrl ?? null, imageUrl);
  }
  return c.json({ ok: true, inserted: body.recipes.length }, 201);
});

/** Structure renvoyée par le LLM pour une recette (import ou idée développée). */
interface ParsedRecipe {
  error?: string;
  title?: string;
  servings?: number;
  prepMinutes?: number | null;
  totalMinutes?: number | null;
  vegetarian?: boolean;
  meat?: string | null;
  starch?: string | null;
  vegetables?: boolean;
  course?: string | null;
  ingredients?: string[];
  steps?: string[];
}

const RECIPE_EXTRACT_SYSTEM = [
  "Tu es un assistant culinaire. On te donne le contenu texte d'une page web de recette, la légende d'une vidéo Instagram/TikTok de recette, une description de recette collée par l'utilisateur, ou une idée de recette à développer entièrement.",
  "S'il s'agit d'une légende de réseau social, ignore les hashtags, mentions et appels à s'abonner.",
  "S'il s'agit d'une idée à développer, invente une recette complète, réaliste et détaillée correspondant à l'idée.",
  'Si le texte ne contient pas de recette exploitable (par exemple une légende sans ingrédients ni instructions), renvoie exactement {"error": "no_recipe"}.',
  "Extrais la recette et renvoie UNIQUEMENT un objet JSON valide, sans aucun texte autour, ni balises markdown.",
  'Format exact : {"title": string, "servings": 4, "prepMinutes": number|null, "totalMinutes": number|null, "vegetarian": boolean, "meat": "poulet"|"veau"|"porc"|"boeuf"|"agneau"|"canard"|"poisson"|null, "starch": "pates"|"riz"|"patate"|"semoule"|"aucun", "vegetables": boolean, "course": "entree"|"plat"|"dessert", "ingredients": string[], "steps": string[]}.',
  "prepMinutes = durée de préparation en minutes ; totalMinutes = durée totale en minutes (préparation + cuisson + repos).",
  "Si une durée n'est pas indiquée, estime-la raisonnablement ; mets null seulement si tu ne peux vraiment pas.",
  "vegetarian = true si la recette ne contient ni viande ni poisson. meat = la viande/poisson principale ou null si végétarien. starch = le féculent principal ou 'aucun'. vegetables = true si la recette contient des légumes.",
  "course = le type de plat : 'entree' (apéritif, entrée, salade d'accompagnement), 'plat' (plat principal) ou 'dessert' (dessert, gâteau, goûter sucré). En cas de doute, 'plat'.",
  "Adapte impérativement toutes les quantités des ingrédients pour 4 personnes.",
  "Les steps doivent être des phrases d'instruction claires, dans l'ordre. Réponds en français.",
].join(" ");

// 8192 tokens : le JSON d'une recette longue (nombreux ingrédients/étapes)
// dépasse le défaut de 1024 et se faisait tronquer → JSON.parse échouait.
async function extractRecipeJson(apiKey: string, text: string): Promise<ParsedRecipe> {
  const result = await callClaude(
    apiKey,
    "claude-sonnet-4-6",
    RECIPE_EXTRACT_SYSTEM,
    [{ role: "user", content: text }],
    8192,
  );
  return JSON.parse(stripFences(result.text)) as ParsedRecipe;
}

async function insertRecipe(
  db: Db,
  householdId: string,
  parsed: ParsedRecipe,
  sourceUrl: string | null,
  imageUrl: string | null,
): Promise<string> {
  const ingredients = (parsed.ingredients ?? []).filter((i) => !isSaltOrPepper(i));
  const id = newId();
  await db.insert(recipe).values({
    id,
    householdId,
    title: parsed.title ?? "Recette",
    sourceUrl,
    imageUrl,
    servings: parsed.servings ?? 4,
    prepMinutes: parsed.prepMinutes ?? null,
    totalMinutes: parsed.totalMinutes ?? null,
    vegetarian: parsed.vegetarian ? 1 : 0,
    meat: parsed.vegetarian ? null : normalizeMeat(parsed.meat ?? null),
    starch: normalizeStarch(parsed.starch ?? null),
    vegetables: parsed.vegetables ? 1 : 0,
    course: normalizeCourse(parsed.course ?? null),
    ingredients: JSON.stringify(ingredients),
    steps: JSON.stringify(parsed.steps ?? []),
    createdAt: nowIso(),
  });
  return id;
}

courses.patch("/recipes/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const body = await parseBody(c, updateRecipeSchema);
  await db
    .update(recipe)
    .set({
      ...(body.title !== undefined && { title: body.title }),
      ...(body.sourceUrl !== undefined && { sourceUrl: body.sourceUrl || null }),
      ...(body.imageUrl !== undefined && { imageUrl: body.imageUrl || null }),
      ...(body.servings !== undefined && { servings: body.servings }),
      ...(body.prepMinutes !== undefined && { prepMinutes: body.prepMinutes ?? null }),
      ...(body.totalMinutes !== undefined && { totalMinutes: body.totalMinutes ?? null }),
      ...(body.vegetarian !== undefined && { vegetarian: body.vegetarian ? 1 : 0 }),
      ...(body.meat !== undefined && { meat: body.meat ?? null }),
      ...(body.starch !== undefined && { starch: body.starch }),
      ...(body.vegetables !== undefined && { vegetables: body.vegetables ? 1 : 0 }),
      ...(body.course !== undefined && { course: body.course }),
      ...(body.ingredients !== undefined && {
        ingredients: JSON.stringify(body.ingredients.filter((s) => s.trim())),
      }),
      ...(body.steps !== undefined && { steps: JSON.stringify(body.steps.filter((s) => s.trim())) }),
    })
    .where(eq(recipe.id, id));
  return c.json({ ok: true });
});

courses.delete("/recipes/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  // Si la photo est hébergée chez nous (R2), on la supprime aussi.
  const rows = await db.select().from(recipe).where(eq(recipe.id, id)).limit(1);
  const key = rows[0]?.imageUrl?.match(/\/public\/recipe-images\/([a-zA-Z0-9_-]+)$/)?.[1];
  if (key) await c.env.FILES.delete(`recipes/${key}`);
  await db.delete(recipe).where(eq(recipe.id, id));
  return c.json({ ok: true });
});

/* ---------------- Repas de la semaine (sélection variée, figée, partagée) ---------------- */

// Candidats d'un plan : les plats du foyer qui respectent les contraintes de temps.
// Une recette sans durée renseignée est exclue quand la contrainte correspondante est active.
function planCandidates(
  rows: RecipeRow[],
  maxPrep: number | null,
  maxTotal: number | null,
): RecipeRow[] {
  return rows.filter(
    (r) =>
      normalizeCourse(r.course) === "plat" &&
      (maxPrep == null || (r.prepMinutes != null && r.prepMinutes <= maxPrep)) &&
      (maxTotal == null || (r.totalMinutes != null && r.totalMinutes <= maxTotal)),
  );
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Une recette « entre en conflit » avec la sélection si sa viande ou son féculent
// y figure déjà (le sans-viande et le sans-féculent ne comptent pas comme doublons).
function conflicts(r: RecipeRow, usedMeat: Set<string>, usedStarch: Set<string>): boolean {
  const meat = normalizeMeat(r.meat);
  const starch = normalizeStarch(r.starch);
  return (meat != null && usedMeat.has(meat)) || (starch !== "aucun" && usedStarch.has(starch));
}

function markUsed(r: RecipeRow, usedMeat: Set<string>, usedStarch: Set<string>): void {
  const meat = normalizeMeat(r.meat);
  const starch = normalizeStarch(r.starch);
  if (meat) usedMeat.add(meat);
  if (starch !== "aucun") usedStarch.add(starch);
}

// Sélection variée : tirage aléatoire en évitant les doublons de viande et de
// féculent ; si le vivier est trop petit, on complète en relâchant la contrainte.
function pickVaried(candidates: RecipeRow[], count: number): RecipeRow[] {
  const pool = shuffle(candidates);
  const picked: RecipeRow[] = [];
  const usedMeat = new Set<string>();
  const usedStarch = new Set<string>();
  for (const r of pool) {
    if (picked.length >= count) break;
    if (conflicts(r, usedMeat, usedStarch)) continue;
    picked.push(r);
    markUsed(r, usedMeat, usedStarch);
  }
  for (const r of pool) {
    if (picked.length >= count) break;
    if (!picked.includes(r)) picked.push(r);
  }
  return picked;
}

// Le plan courant du foyer (recettes dans l'ordre stocké, supprimées ignorées).
courses.get("/meal-plan", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const rows = await db.select().from(mealPlan).where(eq(mealPlan.householdId, hid)).limit(1);
  const plan = rows[0];
  if (!plan) return c.json(null);
  const ids: string[] = safeArray(plan.recipeIds);
  const recipes = await db.select().from(recipe).where(eq(recipe.householdId, hid));
  const byId = new Map(recipes.map((r) => [r.id, r]));
  return c.json({
    count: plan.count,
    maxPrepMinutes: plan.maxPrepMinutes,
    maxTotalMinutes: plan.maxTotalMinutes,
    createdAt: plan.createdAt,
    cooked: parseCooked(plan.cooked),
    recipes: ids
      .map((id) => byId.get(id))
      .filter((r): r is RecipeRow => r !== undefined)
      .map(mapRecipeRow),
  });
});

/** Parse défensif de la colonne `cooked` → { recipeId: date ISO }. */
function parseCooked(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const out: Record<string, string> = {};
      for (const [k, d] of Object.entries(v)) if (typeof d === "string") out[k] = d;
      return out;
    }
  } catch {
    /* colonne illisible : on repart d'un menu vierge de cases cochées */
  }
  return {};
}

/** Charge le menu du foyer, ou `null` s'il n'y en a pas encore. */
async function loadPlan(db: Db, hid: string) {
  const rows = await db.select().from(mealPlan).where(eq(mealPlan.householdId, hid)).limit(1);
  return rows[0] ?? null;
}

/** Coche (ou décoche) un repas du menu comme cuisiné. */
courses.post("/meal-plan/cooked", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, setMealCookedSchema);
  const plan = await loadPlan(db, hid);
  if (!plan) return c.json({ error: "no_plan" }, 404);
  const cooked = parseCooked(plan.cooked);
  if (body.done) cooked[body.recipeId] = nowIso();
  else delete cooked[body.recipeId];
  await db
    .update(mealPlan)
    .set({ cooked: JSON.stringify(cooked) })
    .where(eq(mealPlan.id, plan.id));
  return c.json({ ok: true });
});

/** Retire un repas du menu (il redevient piochable). */
courses.post("/meal-plan/remove", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, mealPlanRecipeSchema);
  const plan = await loadPlan(db, hid);
  if (!plan) return c.json({ error: "no_plan" }, 404);
  const ids: string[] = safeArray(plan.recipeIds).filter((id) => id !== body.recipeId);
  const cooked = parseCooked(plan.cooked);
  delete cooked[body.recipeId];
  await db
    .update(mealPlan)
    .set({ recipeIds: JSON.stringify(ids), cooked: JSON.stringify(cooked), count: ids.length })
    .where(eq(mealPlan.id, plan.id));
  return c.json({ ok: true });
});

/** Remonte un repas en tête du menu (l'ordre est celui où l'on cuisine). */
courses.post("/meal-plan/move-top", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, mealPlanRecipeSchema);
  const plan = await loadPlan(db, hid);
  if (!plan) return c.json({ error: "no_plan" }, 404);
  const ids: string[] = safeArray(plan.recipeIds);
  if (!ids.includes(body.recipeId)) return c.json({ error: "not_in_plan" }, 404);
  const next = [body.recipeId, ...ids.filter((id) => id !== body.recipeId)];
  await db
    .update(mealPlan)
    .set({ recipeIds: JSON.stringify(next) })
    .where(eq(mealPlan.id, plan.id));
  return c.json({ ok: true });
});

// Génère (ou regénère) le plan de la semaine et le fige pour tout le foyer.
courses.post("/meal-plan/generate", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, generateMealPlanSchema);

  const rows = await db.select().from(recipe).where(eq(recipe.householdId, hid));
  const existing = await loadPlan(db, hid);

  // Régénérer garde les repas déjà cuisinés : ils restent en tête du menu et
  // sortent du vivier, pour ne pas être reproposés la semaine suivante.
  const cooked = existing ? parseCooked(existing.cooked) : {};
  const keptIds = existing
    ? safeArray(existing.recipeIds).filter((id: string) => cooked[id])
    : [];
  const kept = keptIds
    .map((id) => rows.find((r) => r.id === id))
    .filter((r): r is RecipeRow => r !== undefined);

  const candidates = planCandidates(
    rows.filter((r) => !cooked[r.id]),
    body.maxPrepMinutes ?? null,
    body.maxTotalMinutes ?? null,
  );
  if (candidates.length === 0 && kept.length === 0) return c.json({ error: "no_candidates" }, 422);

  const picked = pickVaried(candidates, Math.max(0, body.count - kept.length));
  const values = {
    recipeIds: JSON.stringify([...kept.map((r) => r.id), ...picked.map((r) => r.id)]),
    cooked: JSON.stringify(Object.fromEntries(kept.map((r) => [r.id, cooked[r.id]]))),
    count: body.count,
    maxPrepMinutes: body.maxPrepMinutes ?? null,
    maxTotalMinutes: body.maxTotalMinutes ?? null,
    createdAt: nowIso(),
  };
  if (existing) {
    await db.update(mealPlan).set(values).where(eq(mealPlan.id, existing.id));
  } else {
    await db.insert(mealPlan).values({ id: newId(), householdId: hid, ...values });
  }
  return c.json({ ok: true, picked: picked.length, requested: body.count }, 201);
});

/**
 * Ajoute une recette au menu de la semaine (« Cuisiner ce soir » depuis une
 * recette). Crée le plan s'il n'existe pas encore, et ne double pas une recette
 * déjà présente — l'appel doit rester idempotent, on peut toucher deux fois.
 */
courses.post("/meal-plan/add", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, addMealPlanRecipeSchema);

  const exists = (
    await db
      .select({ id: recipe.id })
      .from(recipe)
      .where(and(eq(recipe.householdId, hid), eq(recipe.id, body.recipeId)))
      .limit(1)
  )[0];
  if (!exists) return c.json({ error: "not_found" }, 404);

  const rows = await db.select().from(mealPlan).where(eq(mealPlan.householdId, hid)).limit(1);
  const plan = rows[0];
  if (!plan) {
    await db.insert(mealPlan).values({
      id: newId(),
      householdId: hid,
      recipeIds: JSON.stringify([body.recipeId]),
      count: 1,
      maxPrepMinutes: null,
      maxTotalMinutes: null,
      createdAt: nowIso(),
    });
    return c.json({ ok: true, added: true }, 201);
  }

  const ids: string[] = safeArray(plan.recipeIds);
  if (ids.includes(body.recipeId)) return c.json({ ok: true, added: false });
  ids.push(body.recipeId);
  await db
    .update(mealPlan)
    .set({ recipeIds: JSON.stringify(ids), count: ids.length })
    .where(eq(mealPlan.id, plan.id));
  return c.json({ ok: true, added: true });
});

// Remplace UNE recette du plan par une autre (variée par rapport au reste du plan).
courses.post("/meal-plan/replace", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, replaceMealPlanRecipeSchema);

  const rows = await db.select().from(mealPlan).where(eq(mealPlan.householdId, hid)).limit(1);
  const plan = rows[0];
  if (!plan) return c.json({ error: "no_plan" }, 404);
  const ids: string[] = safeArray(plan.recipeIds);
  const idx = ids.indexOf(body.recipeId);
  if (idx === -1) return c.json({ error: "not_in_plan" }, 404);

  const recipes = await db.select().from(recipe).where(eq(recipe.householdId, hid));
  const byId = new Map(recipes.map((r) => [r.id, r]));

  // Remplacement choisi à la main : on le prend tel quel, sans contrainte de
  // variété — c'est un choix explicite, pas un tirage.
  if (body.withRecipeId) {
    if (!byId.has(body.withRecipeId)) return c.json({ error: "not_found" }, 404);
    if (ids.includes(body.withRecipeId)) return c.json({ error: "already_in_plan" }, 409);
    ids[idx] = body.withRecipeId;
    await db.update(mealPlan).set({ recipeIds: JSON.stringify(ids) }).where(eq(mealPlan.id, plan.id));
    return c.json({ ok: true, id: body.withRecipeId });
  }

  const candidates = planCandidates(recipes, plan.maxPrepMinutes, plan.maxTotalMinutes).filter(
    (r) => !ids.includes(r.id),
  );
  if (candidates.length === 0) return c.json({ error: "no_candidates" }, 422);

  // Contraintes de variété par rapport aux AUTRES recettes du plan.
  const usedMeat = new Set<string>();
  const usedStarch = new Set<string>();
  for (const id of ids) {
    if (id === body.recipeId) continue;
    const r = byId.get(id);
    if (r) markUsed(r, usedMeat, usedStarch);
  }
  const pool = shuffle(candidates);
  const replacement = pool.find((r) => !conflicts(r, usedMeat, usedStarch)) ?? pool[0];

  ids[idx] = replacement.id;
  await db.update(mealPlan).set({ recipeIds: JSON.stringify(ids) }).where(eq(mealPlan.id, plan.id));
  return c.json({ ok: true, id: replacement.id });
});

/* ---------------- Idées repas (catalogue TheMealDB + adaptation LLM) ---------------- */

// Source : TheMealDB (gratuit, clé de dev « 1 ») — chaque plat a sa vraie photo.
// Claude ne sert qu'à traduire/adapter en français et à vérifier les exclusions.
const MEALDB = "https://www.themealdb.com/api/json/v1/1";

// Catégories TheMealDB par type de plat.
const MEALDB_CATEGORIES: Record<string, string[]> = {
  entree: ["Starter", "Side"],
  plat: ["Beef", "Chicken", "Lamb", "Pasta", "Pork", "Seafood", "Vegetarian", "Vegan"],
  dessert: ["Dessert"],
};

interface MealSummary {
  idMeal: string;
  strMeal: string;
  strMealThumb: string;
  course: string;
}

async function fetchMealsOfCategory(category: string, course: string): Promise<MealSummary[]> {
  try {
    const res = await fetch(`${MEALDB}/filter.php?c=${encodeURIComponent(category)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { meals?: { idMeal: string; strMeal: string; strMealThumb: string }[] };
    return (data.meals ?? []).map((m) => ({ ...m, course }));
  } catch {
    return [];
  }
}

interface MealDetail {
  idMeal: string;
  strMeal: string;
  strMealThumb: string;
  strArea?: string;
  strCategory?: string;
  strInstructions?: string;
  [key: string]: string | undefined;
}

async function fetchMealDetail(id: string): Promise<MealDetail | null> {
  try {
    const res = await fetch(`${MEALDB}/lookup.php?i=${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { meals?: MealDetail[] };
    return data.meals?.[0] ?? null;
  } catch {
    return null;
  }
}

// Paires « quantité + ingrédient » d'un plat TheMealDB (champs strIngredient1..20).
function mealIngredients(meal: MealDetail): string[] {
  const out: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const name = (meal[`strIngredient${i}`] ?? "").trim();
    if (!name) continue;
    const qty = (meal[`strMeasure${i}`] ?? "").trim();
    out.push([qty, name].filter(Boolean).join(" "));
  }
  return out;
}

const ADAPT_IDEAS_SYSTEM = [
  "Tu es un assistant culinaire. On te donne une liste de plats issus d'une base de recettes (id, nom anglais, origine, ingrédients en anglais).",
  "Pour CHAQUE plat de la liste, renvoie un objet. Réponds UNIQUEMENT avec un tableau JSON valide, sans texte autour ni balises markdown :",
  '[{"id": string, "title": string, "description": string, "ingredients": string[], "excluded": boolean}].',
  "id = recopié tel quel. title = le nom du plat en français, naturel et appétissant.",
  "description = 1 à 2 phrases appétissantes en français décrivant le plat.",
  "ingredients = les 4 à 6 ingrédients principaux, en français, sans quantités.",
  "excluded = true si le plat contient un des ingrédients interdits indiqués (ou un dérivé), false sinon.",
].join(" ");

const normTitle = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

// Idées proposées + ingrédients exclus du foyer. Les idées contenant un
// ingrédient exclu (ajouté après leur génération) sont filtrées à la volée.
courses.get("/ideas", async (c) => {
  const db = c.get("db");
  const hh = c.get("household");
  const exclusions = safeArray(hh.excludedIngredients ?? "[]");
  const excludedNorm = exclusions.map(normTitle).filter(Boolean);
  const rows = await db
    .select()
    .from(recipeIdea)
    .where(and(eq(recipeIdea.householdId, hh.id), eq(recipeIdea.status, "proposed")))
    .orderBy(desc(recipeIdea.createdAt));
  const ideas = rows
    .map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      course: normalizeCourse(r.course),
      ingredients: safeArray(r.ingredients),
      imageUrl: r.imageUrl,
    }))
    .filter(
      (i) =>
        !excludedNorm.some((x) =>
          [i.title, ...i.ingredients].some((s) => normTitle(s).includes(x)),
        ),
    );
  return c.json({ ideas, exclusions });
});

const IDEAS_BATCH = 12;

// Propose un lot de nouvelles idées : tirage aléatoire dans le catalogue
// TheMealDB (photo officielle du plat), jamais déjà proposées, puis adaptation
// française et contrôle des exclusions en UN appel Claude.
courses.post("/ideas/generate", async (c) => {
  const db = c.get("db");
  const hh = c.get("household");
  const body = await parseBody(c, generateIdeasSchema);
  const apiKey = await resolveAnthropicKey(hh, c.env);
  if (!apiKey) return c.json({ error: "no_api_key" }, 400);

  const exclusions = safeArray(hh.excludedIngredients ?? "[]");
  const pastIdeas = await db
    .select({ externalId: recipeIdea.externalId })
    .from(recipeIdea)
    .where(eq(recipeIdea.householdId, hh.id));
  const knownIds = new Set(pastIdeas.map((i) => i.externalId).filter(Boolean));

  // Catalogue des catégories ciblées (toutes si pas de filtre).
  const categories = body.course
    ? MEALDB_CATEGORIES[body.course]
    : Object.entries(MEALDB_CATEGORIES).flatMap(([, cats]) => cats);
  const courseOf = (cat: string) =>
    Object.entries(MEALDB_CATEGORIES).find(([, cats]) => cats.includes(cat))?.[0] ?? "plat";
  const lists = await Promise.all(
    categories.map((cat) => fetchMealsOfCategory(cat, courseOf(cat))),
  );
  const candidates = lists.flat().filter((m) => !knownIds.has(m.idMeal));
  if (candidates.length === 0) {
    return c.json({ ok: true, inserted: 0, exhausted: true }, 201);
  }

  // Tirage aléatoire — quelques plats en plus pour compenser les exclusions.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const picked = candidates.slice(0, IDEAS_BATCH + 4);
  const details = (await Promise.all(picked.map((m) => fetchMealDetail(m.idMeal)))).filter(
    (d): d is MealDetail => d !== null,
  );
  if (details.length === 0) return c.json({ error: "mealdb_unavailable" }, 502);

  const user = [
    exclusions.length > 0
      ? `Ingrédients interdits : ${exclusions.join(", ")}.`
      : "Aucun ingrédient interdit.",
    "Plats :",
    ...details.map(
      (d) =>
        `- id ${d.idMeal} : ${d.strMeal} (${d.strArea ?? "?"}) — ingrédients : ${mealIngredients(d).join(", ")}`,
    ),
  ].join("\n");

  let adapted: {
    id?: string;
    title?: string;
    description?: string;
    ingredients?: string[];
    excluded?: boolean;
  }[];
  try {
    const result = await callClaude(apiKey, "claude-sonnet-4-6", ADAPT_IDEAS_SYSTEM, [
      { role: "user", content: user },
    ], 8192);
    const parsed = JSON.parse(stripFences(result.text));
    if (!Array.isArray(parsed)) throw new Error("not_an_array");
    adapted = parsed;
  } catch (e) {
    return c.json({ error: "generate_failed", detail: String(e) }, 502);
  }

  const byId = new Map(details.map((d) => [d.idMeal, d]));
  const courseByMealId = new Map(picked.map((m) => [m.idMeal, m.course]));
  let inserted = 0;
  for (const item of adapted) {
    if (inserted >= IDEAS_BATCH) break;
    const meal = item.id ? byId.get(item.id) : undefined;
    if (!meal || !item.title || !item.description || item.excluded) continue;
    await db.insert(recipeIdea).values({
      id: newId(),
      householdId: hh.id,
      title: item.title.trim(),
      description: item.description.trim(),
      course: normalizeCourse(body.course ?? courseByMealId.get(meal.idMeal) ?? null),
      ingredients: JSON.stringify((item.ingredients ?? []).filter(Boolean)),
      imageUrl: meal.strMealThumb,
      externalId: meal.idMeal,
      status: "proposed",
      createdAt: nowIso(),
    });
    inserted++;
  }
  return c.json({ ok: true, inserted }, 201);
});

// « Ne plus proposer » (le cercle 🚫, comme sur les activités et films).
courses.post("/ideas/:id/hide", async (c) => {
  await c
    .get("db")
    .update(recipeIdea)
    .set({ status: "hidden" })
    .where(
      and(eq(recipeIdea.id, c.req.param("id")), eq(recipeIdea.householdId, c.get("household").id)),
    );
  return c.json({ ok: true });
});

// « + » : développe l'idée en recette complète (LLM) et l'ajoute à Mes recettes.
courses.post("/ideas/:id/add", async (c) => {
  const db = c.get("db");
  const hh = c.get("household");
  const rows = await db
    .select()
    .from(recipeIdea)
    .where(and(eq(recipeIdea.id, c.req.param("id")), eq(recipeIdea.householdId, hh.id)));
  const idea = rows[0];
  if (!idea) return c.json({ error: "not_found" }, 404);

  const apiKey = await resolveAnthropicKey(hh, c.env);
  if (!apiKey) return c.json({ error: "no_api_key" }, 400);

  // Idée TheMealDB : on traduit/adapte la VRAIE recette (ingrédients + étapes).
  // Ancienne idée générée (sans externalId) : on la développe de zéro.
  let text: string;
  const detail = idea.externalId ? await fetchMealDetail(idea.externalId) : null;
  if (detail) {
    text =
      `Recette en anglais à traduire et adapter (titre français : ${idea.title}) :\n` +
      `${detail.strMeal} (${detail.strArea ?? "?"})\n` +
      `Ingrédients : ${mealIngredients(detail).join(" ; ")}\n` +
      `Instructions : ${(detail.strInstructions ?? "").slice(0, 8000)}`;
  } else {
    text =
      `Idée de recette à développer entièrement : ${idea.title}.\n${idea.description}\n` +
      `Ingrédients principaux : ${safeArray(idea.ingredients).join(", ")}.\n` +
      `Type de plat : ${idea.course}.`;
  }
  let parsed: ParsedRecipe;
  try {
    parsed = await extractRecipeJson(apiKey, text);
  } catch (e) {
    return c.json({ error: "extract_failed", detail: String(e) }, 502);
  }
  if (parsed.error === "no_recipe") return c.json({ error: "no_recipe" }, 422);

  const id = await insertRecipe(
    db,
    hh.id,
    { ...parsed, title: parsed.title ?? idea.title, course: parsed.course ?? idea.course },
    null,
    idea.imageUrl, // la recette hérite de la photo de l'idée
  );
  await db.update(recipeIdea).set({ status: "added" }).where(eq(recipeIdea.id, idea.id));
  return c.json({ ok: true, id }, 201);
});

// Ingrédients exclus des idées (config du foyer) — lecture seule pour les Réglages.
courses.get("/ideas/exclusions", async (c) => {
  return c.json(safeArray(c.get("household").excludedIngredients ?? "[]"));
});

// Ingrédients exclus des idées (config du foyer).
courses.put("/ideas/exclusions", async (c) => {
  const body = await parseBody(c, updateExcludedIngredientsSchema);
  const cleaned = [...new Set(body.ingredients.map((s) => s.trim()).filter(Boolean))];
  await c
    .get("db")
    .update(household)
    .set({ excludedIngredients: JSON.stringify(cleaned) })
    .where(eq(household.id, c.get("household").id));
  return c.json({ ok: true });
});

/* ---------------- helpers ---------------- */

const MEATS = ["poulet", "veau", "porc", "boeuf", "agneau", "canard", "poisson"];
const STARCHES = ["pates", "riz", "patate", "semoule", "aucun"];
const COURSES = ["entree", "plat", "dessert"];
function normalizeMeat(v: string | null): string | null {
  return v && MEATS.includes(v) ? v : null;
}
function normalizeStarch(v: string | null): string {
  return v && STARCHES.includes(v) ? v : "aucun";
}
function normalizeCourse(v: string | null): string {
  return v && COURSES.includes(v) ? v : "plat";
}

// Détecte les lignes d'ingrédient qui ne sont que du sel / poivre (à exclure).
function isSaltOrPepper(line: string): boolean {
  const core = line
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents
    .replace(/[^a-z\s]/g, " ") // chiffres / ponctuation
    .replace(
      /\b(de|du|d|le|la|les|un|une|au|aux|et|ou|pincee|pincees|cuillere|cuilleres|c|a|cafe|soupe|g|kg|mg|ml|cl|l|cs|cc|qs|selon|gout|gouts|votre|son|moulin|moulu|moulue|fin|fine|gros|grosse|fleur|mer|guerande|table|noir|noire|blanc|blanche|concasse|concassee|frais|fraichement|du)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!core) return false;
  return core.split(" ").every((t) => t === "sel" || t === "poivre");
}

function safeArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function stripFences(s: string): string {
  const t = s.trim();
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (m ? m[1] : t).trim();
}

function extractImage(html: string, baseUrl: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      try {
        return new URL(m[1], baseUrl).toString();
      } catch {
        return m[1];
      }
    }
  }
  return null;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default courses;
