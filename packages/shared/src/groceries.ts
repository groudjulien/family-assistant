export interface Product {
  name: string;
  emoji: string;
  /** Rayon par défaut (clé de DEFAULT_SHOPPING_CATEGORIES). */
  category: string;
}

/** Catalogue de produits courants (FR) avec emoji. */
export const PRODUCTS: Product[] = [
  // Fruits
  { name: "Pommes", emoji: "🍎", category: "frais" },
  { name: "Bananes", emoji: "🍌", category: "frais" },
  { name: "Oranges", emoji: "🍊", category: "frais" },
  { name: "Citrons", emoji: "🍋", category: "frais" },
  { name: "Fraises", emoji: "🍓", category: "frais" },
  { name: "Raisin", emoji: "🍇", category: "frais" },
  { name: "Poires", emoji: "🍐", category: "frais" },
  { name: "Pêches", emoji: "🍑", category: "frais" },
  { name: "Cerises", emoji: "🍒", category: "frais" },
  { name: "Ananas", emoji: "🍍", category: "frais" },
  { name: "Pastèque", emoji: "🍉", category: "frais" },
  { name: "Melon", emoji: "🍈", category: "frais" },
  { name: "Kiwi", emoji: "🥝", category: "frais" },
  { name: "Avocat", emoji: "🥑", category: "frais" },
  { name: "Myrtilles", emoji: "🫐", category: "frais" },
  { name: "Mangue", emoji: "🥭", category: "frais" },
  // Légumes
  { name: "Tomates", emoji: "🍅", category: "frais" },
  { name: "Carottes", emoji: "🥕", category: "frais" },
  { name: "Pommes de terre", emoji: "🥔", category: "frais" },
  { name: "Oignons", emoji: "🧅", category: "frais" },
  { name: "Ail", emoji: "🧄", category: "frais" },
  { name: "Poivrons", emoji: "🫑", category: "frais" },
  { name: "Courgettes", emoji: "🥒", category: "frais" },
  { name: "Concombre", emoji: "🥒", category: "frais" },
  { name: "Salade", emoji: "🥬", category: "frais" },
  { name: "Brocoli", emoji: "🥦", category: "frais" },
  { name: "Champignons", emoji: "🍄", category: "frais" },
  { name: "Maïs", emoji: "🌽", category: "frais" },
  { name: "Aubergine", emoji: "🍆", category: "frais" },
  { name: "Piment", emoji: "🌶️", category: "frais" },
  { name: "Petits pois", emoji: "🫛", category: "frais" },
  { name: "Haricots verts", emoji: "🫛", category: "frais" },
  { name: "Chou-fleur", emoji: "🥦", category: "frais" },
  { name: "Gingembre", emoji: "🫚", category: "frais" },
  // Boulangerie
  { name: "Pain", emoji: "🥖", category: "frais" },
  { name: "Baguette", emoji: "🥖", category: "frais" },
  { name: "Pain de mie", emoji: "🍞", category: "frais" },
  { name: "Croissants", emoji: "🥐", category: "frais" },
  { name: "Brioche", emoji: "🥐", category: "frais" },
  { name: "Bagels", emoji: "🥯", category: "frais" },
  { name: "Pancakes", emoji: "🥞", category: "frais" },
  // Produits laitiers
  { name: "Lait", emoji: "🥛", category: "frais" },
  { name: "Beurre", emoji: "🧈", category: "frais" },
  { name: "Fromage", emoji: "🧀", category: "frais" },
  { name: "Yaourts", emoji: "🥛", category: "frais" },
  { name: "Œufs", emoji: "🥚", category: "frais" },
  { name: "Crème fraîche", emoji: "🥛", category: "frais" },
  // Viandes & poissons
  { name: "Poulet", emoji: "🍗", category: "frais" },
  { name: "Dinde", emoji: "🦃", category: "frais" },
  { name: "Canard", emoji: "🦆", category: "frais" },
  { name: "Bœuf", emoji: "🥩", category: "frais" },
  { name: "Veau", emoji: "🐄", category: "frais" },
  { name: "Cordon bleu", emoji: "🍗", category: "frais" },
  { name: "Viande hachée", emoji: "🥩", category: "frais" },
  { name: "Steak", emoji: "🥩", category: "frais" },
  { name: "Bacon", emoji: "🥓", category: "frais" },
  { name: "Jambon", emoji: "🍖", category: "frais" },
  { name: "Saucisses", emoji: "🌭", category: "frais" },
  { name: "Poisson", emoji: "🐟", category: "frais" },
  { name: "Saumon", emoji: "🐟", category: "frais" },
  { name: "Crevettes", emoji: "🦐", category: "frais" },
  // Épicerie
  { name: "Pâtes", emoji: "🍝", category: "epicerie" },
  { name: "Gnocchi", emoji: "🥟", category: "epicerie" },
  { name: "Riz", emoji: "🍚", category: "epicerie" },
  { name: "Farine", emoji: "🌾", category: "epicerie" },
  { name: "Sucre", emoji: "🧂", category: "epicerie" },
  { name: "Sel", emoji: "🧂", category: "epicerie" },
  { name: "Huile d'olive", emoji: "🫒", category: "epicerie" },
  { name: "Miel", emoji: "🍯", category: "epicerie" },
  { name: "Confiture", emoji: "🍯", category: "epicerie" },
  { name: "Nutella", emoji: "🍫", category: "epicerie" },
  { name: "Compotes", emoji: "🍏", category: "epicerie" },
  { name: "Céréales", emoji: "🥣", category: "epicerie" },
  { name: "Café", emoji: "☕", category: "epicerie" },
  { name: "Thé", emoji: "🍵", category: "epicerie" },
  { name: "Chocolat", emoji: "🍫", category: "epicerie" },
  { name: "Biscuits", emoji: "🍪", category: "epicerie" },
  { name: "Pizza", emoji: "🍕", category: "surgele" },
  { name: "Frites", emoji: "🍟", category: "surgele" },
  { name: "Soupe", emoji: "🥫", category: "epicerie" },
  { name: "Conserves", emoji: "🥫", category: "epicerie" },
  { name: "Beurre de cacahuète", emoji: "🥜", category: "epicerie" },
  { name: "Sauce tomate", emoji: "🥫", category: "epicerie" },
  // Boissons
  { name: "Eau", emoji: "💧", category: "boissons" },
  { name: "Eau pétillante", emoji: "🫧", category: "boissons" },
  { name: "Sirop", emoji: "🍶", category: "boissons" },
  { name: "Jus d'orange", emoji: "🧃", category: "boissons" },
  { name: "Soda", emoji: "🥤", category: "boissons" },
  { name: "Bière", emoji: "🍺", category: "boissons" },
  { name: "Vin", emoji: "🍷", category: "boissons" },
  { name: "Champagne", emoji: "🍾", category: "boissons" },
  // Condiments & apéro
  { name: "Ketchup", emoji: "🍅", category: "epicerie" },
  { name: "Mayonnaise", emoji: "🫙", category: "epicerie" },
  { name: "Gâteaux", emoji: "🍰", category: "epicerie" },
  { name: "Gâteaux apéro", emoji: "🥨", category: "epicerie" },
  { name: "Chips", emoji: "🥔", category: "epicerie" },
  { name: "Oeufs", emoji: "🥚", category: "epicerie" },
  { name: "Boissons", emoji: "🥤", category: "epicerie" },
  // Maison & divers
  { name: "Mouchoirs", emoji: "🤧", category: "entretien" },
  { name: "Brosse à dent", emoji: "🪥", category: "entretien" },
  { name: "Papier toilette", emoji: "🧻", category: "entretien" },
  { name: "Essuie-tout", emoji: "🧻", category: "entretien" },
  { name: "Liquide vaisselle", emoji: "🧴", category: "entretien" },
  { name: "Lessive", emoji: "🧺", category: "entretien" },
  { name: "Sac poubelle", emoji: "🗑️", category: "entretien" },
  { name: "Savon", emoji: "🧼", category: "entretien" },
  { name: "Gel douche", emoji: "🧴", category: "entretien" },
  { name: "Dentifrice", emoji: "🪥", category: "entretien" },
  { name: "Shampoing", emoji: "🧴", category: "entretien" },
  { name: "Vinaigre", emoji: "🫗", category: "entretien" },
  { name: "Scotch", emoji: "🩹", category: "autre" },
  { name: "Piles", emoji: "🔋", category: "autre" },
  { name: "Glace", emoji: "🍦", category: "surgele" },
  { name: "Glaçons", emoji: "🧊", category: "surgele" },
];

// Marques / mots-clés → icône, pour les cas où le nom saisi ne contient pas le
// mot générique (ex. « Cristaline » pour l'eau, « Coca » pour un soda en canette).
// Vérifié dans l'ordre : eau pétillante, eau plate, sodas en canette.
const KEYWORD_ICONS: { emoji: string; keywords: string[] }[] = [
  {
    emoji: "🫧", // eau pétillante / gazeuse
    keywords: [
      "petillante",
      "gazeuse",
      "perrier",
      "san pellegrino",
      "pellegrino",
      "badoit",
      "quezac",
      "salvetat",
      "vichy",
      "st yorre",
      "st-yorre",
      "rozana",
    ],
  },
  {
    emoji: "💧", // eau plate (marques)
    keywords: [
      "cristaline",
      "evian",
      "volvic",
      "vittel",
      "contrex",
      "hepar",
      "wattwiller",
      "montcalm",
      "thonon",
      "valvert",
      "mont roucous",
    ],
  },
  {
    emoji: "🥤", // sodas (canette / bouteille)
    keywords: [
      "coca",
      "cola",
      "fanta",
      "sprite",
      "schwep",
      "schweppes",
      "schweips",
      "orangina",
      "oasis",
      "pepsi",
      "7up",
      "seven up",
      "red bull",
      "redbull",
      "monster",
      "canette",
      "gini",
      "ice tea",
    ],
  },
];

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Suggestions pour une saisie. */
export function searchProducts(query: string, limit = 8): Product[] {
  const q = normalize(query);
  if (!q) return [];
  const starts: Product[] = [];
  const contains: Product[] = [];
  for (const p of PRODUCTS) {
    const n = normalize(p.name);
    if (n.startsWith(q)) starts.push(p);
    else if (n.includes(q)) contains.push(p);
  }
  return [...starts, ...contains].slice(0, limit);
}

/**
 * Produit du catalogue correspondant à un nom saisi (recherche tolérante).
 * Sert à la fois à l'emoji et au rayon par défaut.
 */
export function matchProduct(name: string): Product | undefined {
  const n = normalize(name);
  // correspondance exacte
  const exact = PRODUCTS.find((p) => normalize(p.name) === n);
  if (exact) return exact;
  // marques / mots-clés (eau, eau pétillante, sodas en canette…)
  for (const group of KEYWORD_ICONS) {
    if (group.keywords.some((k) => n.includes(k))) {
      // Les mots-clés (marques) ne portent qu'un emoji : on retrouve le rayon
      // via le produit générique du même emoji, sinon « autre ».
      const generic = PRODUCTS.find((p) => p.emoji === group.emoji);
      return { name, emoji: group.emoji, category: generic?.category ?? "autre" };
    }
  }
  // Correspondance par mots entiers (insensible au pluriel) : on privilégie le
  // produit le plus spécifique, c.-à-d. celui dont TOUS les mots figurent dans la
  // saisie, en gardant celui qui compte le plus de mots
  // (« pommes de terre » l'emporte sur « pommes »).
  const singular = (w: string) => (w.length > 3 ? w.replace(/s$/, "") : w);
  const qWords = new Set(n.split(" ").filter(Boolean).map(singular));
  let best: Product | undefined;
  let bestScore = 0;
  for (const p of PRODUCTS) {
    const pWords = normalize(p.name).split(" ").filter(Boolean).map(singular);
    if (pWords.every((w) => qWords.has(w)) && pWords.length > bestScore) {
      best = p;
      bestScore = pWords.length;
    }
  }
  if (best) return best;
  // Repli : la saisie complète est contenue dans un nom de produit (saisie tronquée).
  return PRODUCTS.find((p) => normalize(p.name).includes(n));
}

/** Emoji associé à un nom d'article (repli : caddie). */
export function iconFor(name: string): string {
  return matchProduct(name)?.emoji ?? "🛒";
}

/** Rayon par défaut d'un nom d'article (repli : « autre »). */
export function categoryFor(name: string): string {
  return matchProduct(name)?.category ?? "autre";
}
