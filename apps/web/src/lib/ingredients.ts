/**
 * Lecture des lignes d'ingrédients (« 200 g de farine »).
 *
 * Partagé par la page Repas (édition, mise à l'échelle des quantités) et la
 * page Courses, qui rapproche un article de la liste des recettes du menu :
 * les deux doivent découper une ligne de la même façon, sinon « 200 g de
 * farine » et « farine » ne se reconnaissent plus.
 */

/** Sépare "200 g de farine" -> { qty: "200 g", name: "farine" } (heuristique, sans perte). */
export function splitIngredient(line: string): { qty: string; name: string } {
  const m = line
    .trim()
    .match(
      /^([\d.,/]+\s*(?:g|kg|mg|ml|cl|l|cs|cc|càs|càc|cuillères?(?:\s?à\s?(?:soupe|café))?|pincées?|sachets?|gousses?|tranches?|pièces?|verres?|tasses?|bottes?|boîtes?|rouleaux?|feuilles?|brins?|bouquets?|filets?|barquettes?|c\.?\s?à\.?\s?[sc]\.?)?\.?)\s+(?:de\s+|d['’])?(.+)$/i,
    );
  if (m && /\d/.test(m[1])) return { qty: m[1].trim(), name: m[2].trim() };
  return { qty: "", name: line.trim() };
}

export const joinIngredient = (qty: string, name: string) =>
  [qty.trim(), name.trim()].filter(Boolean).join(" ");

/** Mots vides d'une ligne d'ingrédient : ils ne portent pas le produit. */
const STOP_WORDS = new Set([
  "de", "du", "des", "d", "le", "la", "les", "l", "au", "aux", "a", "en", "et", "un", "une",
]);

/** "Tomates" -> "tomate" : pluriel simple, sans dictionnaire. */
const singular = (w: string) => (w.length > 3 && /[sx]$/.test(w) ? w.slice(0, -1) : w);

/**
 * Mots comparables d'un produit : sans quantité, sans casse, sans accent,
 * sans mot vide et au singulier. « 200 g de Tomates » -> ["tomate"].
 */
export function ingredientWords(line: string): string[] {
  return splitIngredient(line)
    .name.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOP_WORDS.has(w))
    .map(singular);
}

/**
 * Deux lignes désignent-elles le même produit ? Le plus court doit être
 * entièrement contenu dans le plus long, **mot à mot** : « poulet » reconnaît
 * « blanc de poulet », mais « ail » ne reconnaît pas « aile de poulet ».
 */
export function sameIngredient(a: string, b: string): boolean {
  const x = ingredientWords(a);
  const y = ingredientWords(b);
  if (x.length === 0 || y.length === 0) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every((w) => long.includes(w));
}
