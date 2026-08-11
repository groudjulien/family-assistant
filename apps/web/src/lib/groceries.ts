export interface Product {
  name: string;
  emoji: string;
}

/** Catalogue de produits courants (FR) avec emoji. */
export const PRODUCTS: Product[] = [
  // Fruits
  { name: "Pommes", emoji: "🍎" },
  { name: "Bananes", emoji: "🍌" },
  { name: "Oranges", emoji: "🍊" },
  { name: "Citrons", emoji: "🍋" },
  { name: "Fraises", emoji: "🍓" },
  { name: "Raisin", emoji: "🍇" },
  { name: "Poires", emoji: "🍐" },
  { name: "Pêches", emoji: "🍑" },
  { name: "Cerises", emoji: "🍒" },
  { name: "Ananas", emoji: "🍍" },
  { name: "Pastèque", emoji: "🍉" },
  { name: "Melon", emoji: "🍈" },
  { name: "Kiwi", emoji: "🥝" },
  { name: "Avocat", emoji: "🥑" },
  { name: "Myrtilles", emoji: "🫐" },
  { name: "Mangue", emoji: "🥭" },
  // Légumes
  { name: "Tomates", emoji: "🍅" },
  { name: "Carottes", emoji: "🥕" },
  { name: "Pommes de terre", emoji: "🥔" },
  { name: "Oignons", emoji: "🧅" },
  { name: "Ail", emoji: "🧄" },
  { name: "Poivrons", emoji: "🫑" },
  { name: "Courgettes", emoji: "🥒" },
  { name: "Concombre", emoji: "🥒" },
  { name: "Salade", emoji: "🥬" },
  { name: "Brocoli", emoji: "🥦" },
  { name: "Champignons", emoji: "🍄" },
  { name: "Maïs", emoji: "🌽" },
  { name: "Aubergine", emoji: "🍆" },
  { name: "Piment", emoji: "🌶️" },
  { name: "Petits pois", emoji: "🫛" },
  { name: "Haricots verts", emoji: "🫛" },
  { name: "Chou-fleur", emoji: "🥦" },
  { name: "Gingembre", emoji: "🫚" },
  // Boulangerie
  { name: "Pain", emoji: "🥖" },
  { name: "Baguette", emoji: "🥖" },
  { name: "Pain de mie", emoji: "🍞" },
  { name: "Croissants", emoji: "🥐" },
  { name: "Brioche", emoji: "🥐" },
  { name: "Bagels", emoji: "🥯" },
  { name: "Pancakes", emoji: "🥞" },
  // Produits laitiers
  { name: "Lait", emoji: "🥛" },
  { name: "Beurre", emoji: "🧈" },
  { name: "Fromage", emoji: "🧀" },
  { name: "Yaourts", emoji: "🥛" },
  { name: "Œufs", emoji: "🥚" },
  { name: "Crème fraîche", emoji: "🥛" },
  // Viandes & poissons
  { name: "Poulet", emoji: "🍗" },
  { name: "Dinde", emoji: "🦃" },
  { name: "Canard", emoji: "🦆" },
  { name: "Bœuf", emoji: "🥩" },
  { name: "Veau", emoji: "🐄" },
  { name: "Cordon bleu", emoji: "🍗" },
  { name: "Viande hachée", emoji: "🥩" },
  { name: "Steak", emoji: "🥩" },
  { name: "Bacon", emoji: "🥓" },
  { name: "Jambon", emoji: "🍖" },
  { name: "Saucisses", emoji: "🌭" },
  { name: "Poisson", emoji: "🐟" },
  { name: "Saumon", emoji: "🐟" },
  { name: "Crevettes", emoji: "🦐" },
  // Épicerie
  { name: "Pâtes", emoji: "🍝" },
  { name: "Gnocchi", emoji: "🥟" },
  { name: "Riz", emoji: "🍚" },
  { name: "Farine", emoji: "🌾" },
  { name: "Sucre", emoji: "🧂" },
  { name: "Sel", emoji: "🧂" },
  { name: "Huile d'olive", emoji: "🫒" },
  { name: "Miel", emoji: "🍯" },
  { name: "Confiture", emoji: "🍯" },
  { name: "Nutella", emoji: "🍫" },
  { name: "Compotes", emoji: "🍏" },
  { name: "Céréales", emoji: "🥣" },
  { name: "Café", emoji: "☕" },
  { name: "Thé", emoji: "🍵" },
  { name: "Chocolat", emoji: "🍫" },
  { name: "Biscuits", emoji: "🍪" },
  { name: "Pizza", emoji: "🍕" },
  { name: "Frites", emoji: "🍟" },
  { name: "Soupe", emoji: "🥫" },
  { name: "Conserves", emoji: "🥫" },
  { name: "Beurre de cacahuète", emoji: "🥜" },
  { name: "Sauce tomate", emoji: "🥫" },
  // Boissons
  { name: "Eau", emoji: "💧" },
  { name: "Eau pétillante", emoji: "🫧" },
  { name: "Sirop", emoji: "🍶" },
  { name: "Jus d'orange", emoji: "🧃" },
  { name: "Soda", emoji: "🥤" },
  { name: "Bière", emoji: "🍺" },
  { name: "Vin", emoji: "🍷" },
  { name: "Champagne", emoji: "🍾" },
  // Condiments & apéro
  { name: "Ketchup", emoji: "🍅" },
  { name: "Mayonnaise", emoji: "🫙" },
  { name: "Gâteaux", emoji: "🍰" },
  { name: "Gâteaux apéro", emoji: "🥨" },
  { name: "Chips", emoji: "🥔" },
  { name: "Oeufs", emoji: "🥚" },
  { name: "Boissons", emoji: "🥤" },
  // Maison & divers
  { name: "Mouchoirs", emoji: "🤧" },
  { name: "Brosse à dent", emoji: "🪥" },
  { name: "Papier toilette", emoji: "🧻" },
  { name: "Essuie-tout", emoji: "🧻" },
  { name: "Liquide vaisselle", emoji: "🧴" },
  { name: "Lessive", emoji: "🧺" },
  { name: "Sac poubelle", emoji: "🗑️" },
  { name: "Savon", emoji: "🧼" },
  { name: "Gel douche", emoji: "🧴" },
  { name: "Dentifrice", emoji: "🪥" },
  { name: "Shampoing", emoji: "🧴" },
  { name: "Vinaigre", emoji: "🫗" },
  { name: "Scotch", emoji: "🩹" },
  { name: "Piles", emoji: "🔋" },
  { name: "Glace", emoji: "🍦" },
  { name: "Glaçons", emoji: "🧊" },
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

/** Emoji associé à un nom d'article (recherche tolérante). */
export function iconFor(name: string): string {
  const n = normalize(name);
  // correspondance exacte
  const exact = PRODUCTS.find((p) => normalize(p.name) === n);
  if (exact) return exact.emoji;
  // marques / mots-clés (eau, eau pétillante, sodas en canette…)
  for (const group of KEYWORD_ICONS) {
    if (group.keywords.some((k) => n.includes(k))) return group.emoji;
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
  if (best) return best.emoji;
  // Repli : la saisie complète est contenue dans un nom de produit (saisie tronquée).
  const rev = PRODUCTS.find((p) => normalize(p.name).includes(n));
  return rev?.emoji ?? "🛒";
}
