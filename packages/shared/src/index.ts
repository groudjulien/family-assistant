import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Enums & primitives                                                  */
/* ------------------------------------------------------------------ */

/** Slots techniques des deux membres du foyer ; noms/couleurs configurés sur household. */
export const MEMBERS = ["a", "b"] as const;
export type Member = (typeof MEMBERS)[number];

export const PAYER = ["a", "b", "joint"] as const;
export type Payer = (typeof PAYER)[number];

/** Config d'affichage d'un membre (nom + couleur de pastille). */
export const memberConfigSchema = z.object({
  name: z.string(),
  color: z.string(),
});
export type MemberConfig = z.infer<typeof memberConfigSchema>;

export const membersConfigSchema = z.object({
  a: memberConfigSchema,
  b: memberConfigSchema,
});
export type MembersConfig = z.infer<typeof membersConfigSchema>;

/** Personne supplémentaire du foyer (liste de valise…), hors membres a/b. */
export const extraPersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
});
export type ExtraPerson = z.infer<typeof extraPersonSchema>;

export const TASK_STATUS = ["todo", "doing", "done"] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

/** 1 = low, 2 = normale, 3 = haute, 4 = critique */
export const PRIORITIES = [1, 2, 3, 4] as const;
export const PRIORITY_LABELS: Record<number, string> = {
  1: "Faible",
  2: "Normale",
  3: "Haute",
  4: "Critique",
};

export const TX_KIND = ["actual", "planned"] as const;
export type TxKind = (typeof TX_KIND)[number];

export const CATEGORY_KIND = ["income", "expense"] as const;
export type CategoryKind = (typeof CATEGORY_KIND)[number];

export const ACCOUNT_TYPE = ["checking", "savings", "investment"] as const;
export type AccountType = (typeof ACCOUNT_TYPE)[number];

export const FREQUENCY = ["monthly", "weekly", "yearly"] as const;
export type Frequency = (typeof FREQUENCY)[number];

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export const followedCitySchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type FollowedCity = z.infer<typeof followedCitySchema>;

export const createFollowedCitySchema = z.object({
  name: z.string().min(1),
});

/* Flux RSS d'événements suivis (agendas municipaux hors OpenAgenda). */
export const activityFeedSchema = z.object({
  id: z.string(),
  name: z.string(), // libellé affiché comme ville sur les cartes
  url: z.string(),
});
export type ActivityFeed = z.infer<typeof activityFeedSchema>;

export const createActivityFeedSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
});

export const weatherCitySchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type WeatherCity = z.infer<typeof weatherCitySchema>;

export const createWeatherCitySchema = z.object({
  name: z.string().min(1),
});

/* ------------------------------------------------------------------ */
/* Transports (widget accueil) — catalogue des lignes Île-de-France    */
/* ------------------------------------------------------------------ */

export interface IdfLine {
  id: string; // identifiant catalogue (unique)
  code: string; // code utilisé par l'API trafic (ex. "H", "C", "14")
  label: string; // libellé affiché
  color: string; // couleur de la ligne
}

export const IDF_LINES: IdfLine[] = [
  // Métro
  { id: "metro-1", code: "1", label: "Métro 1", color: "#FFCD00" },
  { id: "metro-2", code: "2", label: "Métro 2", color: "#0064B0" },
  { id: "metro-3", code: "3", label: "Métro 3", color: "#9F9825" },
  { id: "metro-3b", code: "3b", label: "Métro 3bis", color: "#98D4E2" },
  { id: "metro-4", code: "4", label: "Métro 4", color: "#C04191" },
  { id: "metro-5", code: "5", label: "Métro 5", color: "#F28E42" },
  { id: "metro-6", code: "6", label: "Métro 6", color: "#83C491" },
  { id: "metro-7", code: "7", label: "Métro 7", color: "#F3A4BA" },
  { id: "metro-7b", code: "7b", label: "Métro 7bis", color: "#83C491" },
  { id: "metro-8", code: "8", label: "Métro 8", color: "#CEADD2" },
  { id: "metro-9", code: "9", label: "Métro 9", color: "#D5C900" },
  { id: "metro-10", code: "10", label: "Métro 10", color: "#E3B32A" },
  { id: "metro-11", code: "11", label: "Métro 11", color: "#8D5E2A" },
  { id: "metro-12", code: "12", label: "Métro 12", color: "#00814F" },
  { id: "metro-13", code: "13", label: "Métro 13", color: "#98D4E2" },
  { id: "metro-14", code: "14", label: "Métro 14", color: "#662483" },
  // RER
  { id: "rer-a", code: "A", label: "RER A", color: "#E2231A" },
  { id: "rer-b", code: "B", label: "RER B", color: "#5291CE" },
  { id: "rer-c", code: "C", label: "RER C", color: "#F3D311" },
  { id: "rer-d", code: "D", label: "RER D", color: "#00A94F" },
  { id: "rer-e", code: "E", label: "RER E", color: "#C04191" },
  // Transilien
  { id: "tn-h", code: "H", label: "Transilien H", color: "#8D653D" },
  { id: "tn-j", code: "J", label: "Transilien J", color: "#CDCF00" },
  { id: "tn-k", code: "K", label: "Transilien K", color: "#A0006E" },
  { id: "tn-l", code: "L", label: "Transilien L", color: "#7584C2" },
  { id: "tn-n", code: "N", label: "Transilien N", color: "#00A88F" },
  { id: "tn-p", code: "P", label: "Transilien P", color: "#F3A4BA" },
  { id: "tn-r", code: "R", label: "Transilien R", color: "#D6796D" },
  { id: "tn-u", code: "U", label: "Transilien U", color: "#B90845" },
  // Tramways
  { id: "tram-1", code: "T1", label: "Tram T1", color: "#0064B0" },
  { id: "tram-2", code: "T2", label: "Tram T2", color: "#B90845" },
  { id: "tram-3a", code: "T3a", label: "Tram T3a", color: "#FF7E2E" },
  { id: "tram-3b", code: "T3b", label: "Tram T3b", color: "#00A94F" },
  { id: "tram-4", code: "T4", label: "Tram T4", color: "#E3B32A" },
  { id: "tram-5", code: "T5", label: "Tram T5", color: "#662483" },
  { id: "tram-6", code: "T6", label: "Tram T6", color: "#E2231A" },
  { id: "tram-7", code: "T7", label: "Tram T7", color: "#5291CE" },
  { id: "tram-8", code: "T8", label: "Tram T8", color: "#837902" },
  { id: "tram-9", code: "T9", label: "Tram T9", color: "#B90845" },
  { id: "tram-11", code: "T11", label: "Tram T11", color: "#F28E42" },
  { id: "tram-13", code: "T13", label: "Tram T13", color: "#8D653D" },
];

export const TRANSIT_KINDS = ["principal", "secondary"] as const;
export type TransitKind = (typeof TRANSIT_KINDS)[number];

export const transitLineSchema = z.object({
  id: z.string(),
  lineCode: z.string(),
  label: z.string(),
  color: z.string(),
  stationA: z.string(),
  stationB: z.string(),
  kind: z.enum(TRANSIT_KINDS),
});
export type TransitLineConfig = z.infer<typeof transitLineSchema>;

export const createTransitLineSchema = z.object({
  lineCode: z.string().min(1),
  label: z.string().min(1),
  color: z.string().min(1),
  stationA: z.string().min(1),
  stationB: z.string().min(1),
  kind: z.enum(TRANSIT_KINDS),
});

export const updateTransitLineSchema = z.object({
  lineCode: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  stationA: z.string().min(1).optional(),
  stationB: z.string().min(1).optional(),
  kind: z.enum(TRANSIT_KINDS).optional(),
});

export const streamingProviderSchema = z.object({
  id: z.string(),
  tmdbId: z.number().int(),
  name: z.string(),
  enabled: z.boolean(),
  logo: z.string().nullable(),
});
export type StreamingProvider = z.infer<typeof streamingProviderSchema>;

export const updateStreamingProviderSchema = z.object({
  enabled: z.boolean(),
});

// Certifications cinéma FR (du plus permissif au plus restreint)
export const FR_CERTS = ["U", "10", "12", "16", "18"] as const;

export const householdConfigSchema = z.object({
  kidsMaxCert: z.enum(FR_CERTS),
});
export type HouseholdConfig = z.infer<typeof householdConfigSchema>;

export const FILM_AUDIENCE = ["enfants", "adultes"] as const;
export type FilmAudience = (typeof FILM_AUDIENCE)[number];

/**
 * Où le film se regarde, du point de vue du foyer :
 * - `subscription` — inclus dans un abonnement activé dans les Réglages ;
 * - `vod` — hors abonnement, mais proposé à la demande en France (location,
 *   achat, ou plateforme gratuite / financée par la pub) ;
 * - `unknown` — TMDB ne connaît aucune offre FR (pas encore sorti, sorti
 *   seulement en salle, ou jamais distribué ici).
 */
export const FILM_AVAILABILITY = ["subscription", "vod", "unknown"] as const;
export type FilmAvailability = (typeof FILM_AVAILABILITY)[number];

export const createFilmFavoriteSchema = z.object({
  externalId: z.string().min(1),
  audience: z.enum(FILM_AUDIENCE),
  title: z.string().min(1),
  description: z.string().nullish(),
  imageUrl: z.string().nullish(),
  providers: z.string().nullish(),
  year: z.string().nullish(),
  /** Durée en minutes et certification FR, figées à l'instant du marquage. */
  runtime: z.number().int().nullish(),
  ageLimit: z.string().nullish(),
  availability: z.enum(FILM_AVAILABILITY).nullish(),
});

export const createFilmSeenSchema = z.object({
  externalId: z.string().min(1),
  title: z.string().nullish(),
  audience: z.enum(FILM_AUDIENCE).nullish(),
  imageUrl: z.string().nullish(),
  providers: z.string().nullish(),
  year: z.string().nullish(),
  /** Durée en minutes et certification FR, figées à l'instant du marquage. */
  runtime: z.number().int().nullish(),
  ageLimit: z.string().nullish(),
  availability: z.enum(FILM_AVAILABILITY).nullish(),
});

export const createActivityFavoriteSchema = z.object({
  externalId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullish(),
  city: z.string().nullish(),
  address: z.string().nullish(),
  start: z.string().nullish(),
  end: z.string().nullish(),
  dateLabel: z.string().nullish(),
  imageUrl: z.string().nullish(),
  url: z.string().nullish(),
});

/* ------------------------------------------------------------------ */
/* Voyages                                                             */
/* ------------------------------------------------------------------ */

export const TRIP_ITEM_TYPES = ["transport", "lodging", "activity"] as const;
export type TripItemType = (typeof TRIP_ITEM_TYPES)[number];

export const TRANSPORT_MODES = ["voiture", "train", "avion", "bateau", "bus"] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

export const TRANSPORT_META: Record<TransportMode, { icon: string; label: string }> = {
  voiture: { icon: "🚗", label: "Voiture" },
  train: { icon: "🚆", label: "Train" },
  avion: { icon: "✈️", label: "Avion" },
  bateau: { icon: "⛴️", label: "Bateau" },
  bus: { icon: "🚌", label: "Bus" },
};

export const tripSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Drapeau ou pictogramme du voyage (null = avion par défaut). */
  emoji: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  budget: z.number().int().nullable(),
  archived: z.boolean(),
});
export type Trip = z.infer<typeof tripSchema>;

export const createTripSchema = z.object({
  name: z.string().min(1),
  emoji: z.string().trim().max(8).nullish(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  budget: z.number().int().nullish(),
});
export const updateTripSchema = createTripSchema.partial().extend({
  archived: z.boolean().optional(),
});

export const tripItemSchema = z.object({
  id: z.string(),
  tripId: z.string(),
  type: z.enum(TRIP_ITEM_TYPES),
  mode: z.enum(TRANSPORT_MODES).nullable(),
  title: z.string().nullable(),
  fromPlace: z.string().nullable(),
  toPlace: z.string().nullable(),
  address: z.string().nullable(),
  url: z.string().nullable(),
  description: z.string().nullable(),
  startAt: z.string().nullable(),
  endAt: z.string().nullable(),
  fileKey: z.string().nullable(),
  fileName: z.string().nullable(),
});
export type TripItem = z.infer<typeof tripItemSchema>;

// Affaires à prendre pour un voyage (todo-liste cochable).
// L'ordre des deux constantes ci-dessous EST l'ordre de tri de la liste.
export const PACKING_CATEGORIES = ["vetements", "toilette", "jeux", "nourriture", "autre"] as const;
export type PackingCategory = (typeof PACKING_CATEGORIES)[number];

export const PACKING_CATEGORY_META: Record<PackingCategory, { label: string; icon: string }> = {
  vetements: { label: "Vêtements", icon: "👕" },
  toilette: { label: "Affaires de toilette", icon: "🧼" },
  jeux: { label: "Jeux", icon: "🎲" },
  nourriture: { label: "Nourriture", icon: "🍽️" },
  autre: { label: "Autre", icon: "📦" },
};

/** Personnes de base toujours proposées ; les autres viennent de household.extraPersons. */
export const PACKING_BASE_PERSONS = ["famille", ...MEMBERS] as const;
/** "famille", "a", "b" ou l'id d'une personne supplémentaire du foyer. */
export type PackingPerson = string;

/** Liste ordonnée { id, label } des personnes proposées pour la valise. */
export function packingPersonOptions(
  members: MembersConfig,
  extras: ExtraPerson[] = [],
): { id: PackingPerson; label: string }[] {
  return [
    { id: "famille", label: "Famille" },
    { id: "a", label: members.a.name },
    { id: "b", label: members.b.name },
    ...extras.map((p) => ({ id: p.id, label: p.name })),
  ];
}

export const tripPackingItemSchema = z.object({
  id: z.string(),
  tripId: z.string(),
  label: z.string(),
  category: z.enum(PACKING_CATEGORIES),
  person: z.string().min(1),
  checked: z.boolean(),
  position: z.number().int(),
});
export type TripPackingItem = z.infer<typeof tripPackingItemSchema>;

export const createTripPackingItemSchema = z.object({
  label: z.string().min(1),
  category: z.enum(PACKING_CATEGORIES).default("autre"),
  person: z.string().min(1).default("famille"),
});
export const updateTripPackingItemSchema = z.object({
  label: z.string().min(1).optional(),
  category: z.enum(PACKING_CATEGORIES).optional(),
  person: z.string().min(1).optional(),
  checked: z.boolean().optional(),
});

/** Liste d'affaires par défaut du foyer (Réglages → Activités). */
export const defaultPackingItemSchema = z.object({
  label: z.string().min(1),
  category: z.enum(PACKING_CATEGORIES),
  person: z.string().min(1),
});
export type DefaultPackingItem = z.infer<typeof defaultPackingItemSchema>;

export const updateDefaultPackingSchema = z.object({
  items: z.array(defaultPackingItemSchema),
});

/** Tri d'affichage : catégorie, puis personne, puis ordre d'ajout.
 *  `personsOrder` = ids ordonnés (base + personnes supplémentaires du foyer) ;
 *  une personne inconnue est classée en dernier. */
export function comparePackingItems(
  a: { category: PackingCategory; person: PackingPerson; position?: number },
  b: { category: PackingCategory; person: PackingPerson; position?: number },
  personsOrder: readonly string[] = PACKING_BASE_PERSONS,
): number {
  const cat = PACKING_CATEGORIES.indexOf(a.category) - PACKING_CATEGORIES.indexOf(b.category);
  if (cat !== 0) return cat;
  const rank = (p: string) => {
    const i = personsOrder.indexOf(p);
    return i === -1 ? personsOrder.length : i;
  };
  const per = rank(a.person) - rank(b.person);
  if (per !== 0) return per;
  return (a.position ?? 0) - (b.position ?? 0);
}

export const createTripItemSchema = z.object({
  type: z.enum(TRIP_ITEM_TYPES),
  mode: z.enum(TRANSPORT_MODES).nullish(),
  title: z.string().nullish(),
  fromPlace: z.string().nullish(),
  toPlace: z.string().nullish(),
  address: z.string().nullish(),
  url: z.string().nullish(),
  description: z.string().nullish(),
  startAt: z.string().nullish(),
  endAt: z.string().nullish(),
});
export const updateTripItemSchema = createTripItemSchema.partial();

// Catégories de dépenses (configurables par foyer). `key` = identifiant stable stocké sur la dépense.
export const DEFAULT_EXPENSE_CATEGORIES = [
  { key: "nourriture", name: "Nourriture", icon: "🍽️" },
  { key: "logement", name: "Logement", icon: "🏠" },
  { key: "transport", name: "Transport", icon: "🚆" },
  { key: "loisirs", name: "Loisirs", icon: "🎉" },
  { key: "cadeaux", name: "Cadeaux", icon: "🎁" },
  { key: "divers", name: "Divers", icon: "🛍️" },
] as const;

export const expenseCategorySchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  icon: z.string().min(1),
  hidden: z.boolean().optional(),
});
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;

export const updateExpenseCategoriesSchema = z.object({
  categories: z.array(expenseCategorySchema),
});

/**
 * Rayons de la liste de courses. Configurables par foyer (Réglages → Courses) ;
 * cette liste est le défaut et sert de repli quand rien n'est configuré.
 * La clé `autre` accueille tout produit inconnu du catalogue — ne pas la retirer.
 */
export const DEFAULT_SHOPPING_CATEGORIES = [
  { key: "frais", name: "Frais" },
  { key: "surgele", name: "Surgelé" },
  { key: "epicerie", name: "Épicerie" },
  { key: "boissons", name: "Boissons" },
  { key: "entretien", name: "Entretien" },
  { key: "autre", name: "Autre" },
];

/** Rayon d'accueil des produits sans rayon connu. */
export const FALLBACK_SHOPPING_CATEGORY = "autre";

export const shoppingCategorySchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
});
export type ShoppingCategory = z.infer<typeof shoppingCategorySchema>;

export const updateShoppingCategoriesSchema = z.object({
  categories: z.array(shoppingCategorySchema),
});

// Dépenses sur place d'un voyage (mêmes champs qu'une dépense d'équilibrage).
export const tripExpenseSchema = z.object({
  id: z.string(),
  tripId: z.string(),
  label: z.string(),
  amount: z.number().int(), // centimes signés
  paidBy: z.enum(MEMBERS),
  shareA: z.number().int(),
  shareB: z.number().int(),
  date: z.string(),
  category: z.string().nullable(), // clé de catégorie (cf. DEFAULT_EXPENSE_CATEGORIES + custom)
  pushedAt: z.string().nullable(),
});
export type TripExpense = z.infer<typeof tripExpenseSchema>;

export const createTripExpenseSchema = z.object({
  label: z.string().min(1),
  amount: z.number().int(),
  paidBy: z.enum(MEMBERS),
  shareA: z.number().int(),
  shareB: z.number().int(),
  date: z.string(),
  category: z.string().nullish(),
});
export const updateTripExpenseSchema = createTripExpenseSchema.partial();

/* ------------------------------------------------------------------ */
/* Jours du mariage (nombre et libellés configurables)                 */
/* ------------------------------------------------------------------ */

/**
 * Emplacements de jour, dans l'ordre : ce sont les colonnes historiques de
 * `wedding_guest`. Ces noms sont internes — l'affichage utilise les libellés de
 * `household.weddingDays`, qui peut n'activer qu'un ou deux emplacements.
 */
export const WEDDING_DAY_KEYS = ["vendredi", "samedi", "dimanche"] as const;
export type WeddingDayKey = (typeof WEDDING_DAY_KEYS)[number];

export const weddingDaySchema = z.object({
  key: z.enum(WEDDING_DAY_KEYS),
  label: z.string().trim().min(1).max(24),
});
export type WeddingDay = z.infer<typeof weddingDaySchema>;

/** Configuration par défaut : les trois jours historiques. */
export const WEDDING_DAYS_DEFAULT: WeddingDay[] = [
  { key: "vendredi", label: "Vendredi" },
  { key: "samedi", label: "Samedi" },
  { key: "dimanche", label: "Dimanche" },
];

/**
 * Les jours actifs occupent toujours les premiers emplacements, dans l'ordre :
 * 1 jour → `vendredi`, 2 jours → `vendredi` + `samedi`, 3 → les trois. Le
 * libellé est libre (« Jeudi », « Brunch du dimanche »…).
 */
export const setWeddingDaysSchema = z.object({
  days: z.array(weddingDaySchema).min(1).max(WEDDING_DAY_KEYS.length),
});

/** Normalise une config lue en base (JSON permissif) en liste sûre. */
export function parseWeddingDays(raw: unknown): WeddingDay[] {
  const parsed = z.array(weddingDaySchema).min(1).max(WEDDING_DAY_KEYS.length).safeParse(raw);
  if (!parsed.success) return WEDDING_DAYS_DEFAULT;
  // L'ordre des emplacements est imposé, pour rester aligné sur les colonnes.
  return parsed.data.map((d, i) => ({ key: WEDDING_DAY_KEYS[i], label: d.label }));
}

export const meSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  member: z.enum(MEMBERS),
  menuOrder: z.array(z.string()).nullable(),
  menuHidden: z.array(z.string()).nullable(),
  /** Nom de chaque groupe de menu, indexé par sa clé `sep:<id>` dans `menuOrder`. */
  menuGroups: z.record(z.string()).nullable(),
  widgetPrefs: z
    .object({ order: z.array(z.string()), hidden: z.array(z.string()) })
    .nullable(),
  hasAnthropicKey: z.boolean(),
  hasLunchflowKey: z.boolean(),
  hasPrimKey: z.boolean(),
  hasPrimJeton: z.boolean(),
  hasTmdbKey: z.boolean(),
  expenseCategories: z.array(expenseCategorySchema).nullable(),
  /** Rayons de la liste de courses ; null = `DEFAULT_SHOPPING_CATEGORIES`. */
  shoppingCategories: z.array(shoppingCategorySchema).nullable(),
  /** Liste d'affaires injectée à la création d'un voyage (null = aucune). */
  defaultPacking: z.array(defaultPackingItemSchema).nullable(),
  household: z.object({
    id: z.string(),
    name: z.string(),
    currency: z.string(),
    defaultSplitA: z.number(),
    defaultSplitB: z.number(),
    defaultAccountId: z.string().nullable(), // compte proposé par défaut (transactions)
    /** Noms/couleurs d'affichage des deux membres. */
    members: membersConfigSchema,
    /** Personnes supplémentaires (liste de valise…). */
    extraPersons: z.array(extraPersonSchema),
    /** Jours du mariage retenus (1 à 3) et leurs libellés. */
    weddingDays: z.array(weddingDaySchema),
    /** Date du mariage : le compte à rebours en tête de la section la lit. */
    weddingTargetDate: z.string(),
  }),
});
export type Me = z.infer<typeof meSchema>;

/** Mise à jour des noms/couleurs des membres + personnes supplémentaires (Réglages). */
export const updateMembersConfigSchema = z.object({
  members: membersConfigSchema,
  extraPersons: z.array(extraPersonSchema).default([]),
});

/** Email Google autorisé (allowlist en base), rattaché à une personne du foyer.
 *  `personId` = "a" | "b" (peut se connecter), id d'une personne supplémentaire
 *  (informatif, ne permet pas la connexion) ou null (hérité : premier slot libre). */
export const allowedEmailSchema = z.object({
  email: z.string().email(),
  personId: z.string().nullable(),
});
export type AllowedEmail = z.infer<typeof allowedEmailSchema>;

/** Remplace la liste d'emails d'une personne (édition depuis la fiche personne). */
export const setPersonEmailsSchema = z.object({
  personId: z.string().min(1),
  emails: z.array(z.string().trim().email()).default([]),
});

/** Date cible du mariage (le montant objectif = somme du plan d'épargne). */
export const updateWeddingTargetSchema = z.object({
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Date posée par défaut à la création du foyer : un repère, pas une vraie date
 * choisie. Le formulaire d'initialisation du plan d'épargne la laisse vide.
 */
export const WEDDING_DATE_PLACEHOLDER = "2030-01-01";
/** Épargne pré-remplie : 100 € par personne et par mois (en centimes). */
export const WEDDING_SAVINGS_DEFAULT_PER_PERSON = 10_000;
/** Garde-fou : au-delà, la date saisie est probablement une erreur. */
export const WEDDING_SAVINGS_MAX_MONTHS = 120;

/**
 * Initialisation du plan d'épargne (uniquement s'il est vide) : une ligne par
 * mois, du mois courant jusqu'au mois du mariage, au même montant par membre.
 */
export const initWeddingSavingsSchema = z.object({
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  monthlyPerPerson: z.number().int().min(0).default(WEDDING_SAVINGS_DEFAULT_PER_PERSON),
});

/**
 * Modèle de budget proposé quand le budget est vide : postes classiques d'un
 * mariage, montants en centimes, sans prestataire assigné. Tout est modifiable
 * (ou supprimable) une fois créé.
 */
export const WEDDING_BUDGET_TEMPLATE: { group: string; label: string; amount: number }[] = [
  { group: "Lieu & réception", label: "Salle", amount: 500_000 },
  { group: "Lieu & réception", label: "Décoration", amount: 100_000 },
  { group: "Lieu & réception", label: "Fleurs", amount: 150_000 },
  { group: "Boissons", label: "Vins", amount: 60_000 },
  { group: "Boissons", label: "Softs", amount: 40_000 },
  { group: "Boissons", label: "Champagne", amount: 60_000 },
  { group: "Prestataires", label: "Photographe", amount: 150_000 },
  { group: "Prestataires", label: "DJ", amount: 150_000 },
  { group: "Prestataires", label: "Animateurs enfants", amount: 80_000 },
  { group: "Prestataires", label: "Wedding planneuse", amount: 440_000 },
  { group: "Prestataires", label: "Taxi", amount: 50_000 },
  { group: "Tenues", label: "Costume homme", amount: 80_000 },
  { group: "Tenues", label: "Robe", amount: 150_000 },
  { group: "Tenues", label: "Chaussures femme", amount: 20_000 },
  { group: "Tenues", label: "Tenues des enfants", amount: 20_000 },
  { group: "Tenues", label: "Coiffeur / maquillage", amount: 50_000 },
  { group: "Papeterie", label: "Faire-part", amount: 15_000 },
  { group: "Papeterie", label: "Remerciements", amount: 10_000 },
  { group: "Papeterie", label: "Alliances", amount: 100_000 },
];

/* ------------------------------------------------------------------ */
/* Wizard de premier lancement (/setup)                                */
/* ------------------------------------------------------------------ */

/** Payload final du wizard : crée le foyer et toute sa config d'un coup. */
export const setupCompleteSchema = z.object({
  token: z.string().min(1),
  household: z.object({
    name: z.string().trim().min(1),
    currency: z.string().trim().min(1).default("EUR"),
    defaultSplitA: z.number().int().min(0).max(100).default(50),
    members: membersConfigSchema,
    /** Email Google de l'installeur → membre a. */
    memberAEmail: z.string().trim().email(),
    /** Email Google du second membre (ajoutable plus tard dans Réglages). */
    memberBEmail: z.string().trim().email().nullish(),
    extraPersons: z.array(extraPersonSchema).default([]),
  }),
  accounts: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        owner: z.enum(PAYER),
        type: z.enum(ACCOUNT_TYPE).default("checking"),
        isPrimary: z.boolean().default(false),
        /** Solde initial en centimes. */
        balance: z.number().int().default(0),
      }),
    )
    .default([]),
  /** Index (dans `accounts`) du compte par défaut à la création d'une dépense. */
  defaultAccountIndex: z.number().int().min(0).nullish(),
  /** Clés API optionnelles — chacune skippable, stockées chiffrées en base. */
  apiKeys: z
    .object({
      anthropic: z.string().trim().min(10).nullish(),
      lunchflow: z.string().trim().min(10).nullish(),
      prim: z.string().trim().min(1).nullish(),
      primJeton: z.string().trim().min(1).nullish(),
      tmdb: z.string().trim().min(1).nullish(),
    })
    .default({}),
  /** Menus masqués par défaut pour le foyer (clés de NAV, ex. "/wedding"). */
  menuHidden: z.array(z.string()).default([]),
  /** Catégories de dépenses ; null = catégories par défaut. */
  expenseCategories: z.array(expenseCategorySchema).nullish(),
});
export type SetupComplete = z.infer<typeof setupCompleteSchema>;

export const updateMenuOrderSchema = z.object({
  order: z.array(z.string().min(1)),
  hidden: z.array(z.string().min(1)).optional(),
  /** Nom des groupes, indexé par clé de séparateur (`sep:<id>`). */
  groups: z.record(z.string().trim().max(40)).optional(),
});

export const updateWidgetPrefsSchema = z.object({
  order: z.array(z.string().min(1)),
  hidden: z.array(z.string().min(1)),
});

export const updateAnthropicKeySchema = z.object({
  apiKey: z.string().trim().min(10),
});

export const updateLunchflowKeySchema = z.object({
  apiKey: z.string().trim().min(10),
});

// Mobilité (PRIM Île-de-France Mobilités) : clé API + jeton (le jeton est optionnel).
export const updateMobiliteKeysSchema = z.object({
  apiKey: z.string().trim().min(1),
  jeton: z.string().trim().default(""),
});

export const updateTmdbKeySchema = z.object({
  apiKey: z.string().trim().min(1),
});

/* ------------------------------------------------------------------ */
/* LunchFlow (synchro des soldes bancaires)                            */
/* ------------------------------------------------------------------ */

// Un compte tel que renvoyé par l'API LunchFlow, enrichi du compte local associé.
export const lunchflowAccountSchema = z.object({
  id: z.string(), // id externe LunchFlow (numérique côté API, exposé en string)
  name: z.string(),
  institutionName: z.string().nullable(),
  institutionLogo: z.string().nullable(),
  provider: z.string().nullable(),
  status: z.string(), // "ACTIVE" = OK, autre = reconnexion nécessaire
  linkedAccountId: z.string().nullable(), // id du compte local déjà associé (null sinon)
});
export type LunchflowAccount = z.infer<typeof lunchflowAccountSchema>;

export const linkLunchflowSchema = z.object({
  lunchflowAccountId: z.string().min(1),
});

// Transaction bancaire stockée (source : LunchFlow), enrichie via Claude.
// Type de mouvement bancaire (déduit du libellé + sens du montant).
export const TX_TYPES = [
  "virement_in",
  "virement_out",
  "cb_out",
  "cb_in",
  "retrait",
  "autre",
] as const;
export type TxType = (typeof TX_TYPES)[number];
export const TX_TYPE_LABEL: Record<TxType, string> = {
  virement_in: "Virement entrant",
  virement_out: "Virement sortant",
  cb_out: "CB sortant",
  cb_in: "CB entrant",
  retrait: "Retrait",
  autre: "Autre",
};

export const bankTransactionSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  accountName: z.string(),
  amount: z.number().int(), // centimes signés (négatif = débit)
  currency: z.string(),
  date: z.string(), // YYYY-MM-DD
  rawLabel: z.string(), // libellé bancaire brut (merchant LunchFlow)
  type: z.enum(TX_TYPES), // type de mouvement (virement/CB/retrait…)
  isPending: z.boolean(), // pas encore débitée
  future: z.boolean(), // date de valeur dans le futur
  merchantName: z.string().nullable(), // nom lisible (enrichi)
  category: z.string().nullable(), // clé de catégorie de dépense (enrichi)
  merchantWebsite: z.string().nullable(), // site du vendeur (best-effort)
  merchantAddress: z.string().nullable(), // adresse du vendeur (best-effort)
});
export type BankTransaction = z.infer<typeof bankTransactionSchema>;

/**
 * Classement manuel d'une opération (« Sans catégorie · toucher pour classer »).
 * `null` la renvoie sans catégorie. Le choix de l'utilisateur fait foi :
 * l'opération est marquée enrichie pour que Claude ne la reclasse pas.
 */
export const setBankTransactionCategorySchema = z.object({
  category: z.string().min(1).nullable(),
});

/* ------------------------------------------------------------------ */
/* Tasks (with subtasks + drag & drop ordering)                        */
/* ------------------------------------------------------------------ */

export const taskSchema = z.object({
  id: z.string(),
  parentTaskId: z.string().nullable(),
  title: z.string(),
  notes: z.string().nullable(),
  status: z.enum(TASK_STATUS),
  priority: z.number().int().min(1).max(4),
  position: z.number(),
  dueDate: z.string().nullable(),
  assigneeId: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(), // date de passage à « done »
});
export type Task = z.infer<typeof taskSchema>;
export type TaskWithSubtasks = Task & { subtasks: Task[] };

export const createTaskSchema = z.object({
  title: z.string().min(1),
  notes: z.string().optional(),
  parentTaskId: z.string().nullish(),
  priority: z.number().int().min(1).max(4).default(2),
  dueDate: z.string().nullish(),
  assigneeId: z.string().nullish(),
});
export type CreateTask = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = createTaskSchema.partial().extend({
  status: z.enum(TASK_STATUS).optional(),
  position: z.number().optional(),
});
export type UpdateTask = z.infer<typeof updateTaskSchema>;

export const reorderTasksSchema = z.object({
  /** ordered list of task ids at the same level */
  orderedIds: z.array(z.string()),
  parentTaskId: z.string().nullish(),
});
export type ReorderTasks = z.infer<typeof reorderTasksSchema>;

/* ------------------------------------------------------------------ */
/* Accounts / Categories / Transactions / Recurring                    */
/* ------------------------------------------------------------------ */

export const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
  owner: z.enum(PAYER),
  type: z.enum(ACCOUNT_TYPE),
  isPrimary: z.boolean(), // compte principal de dépenses de son propriétaire
  forecast: z.boolean(), // affiché dans les prévisions de trésorerie
  currentBalance: z.number().int(),
  balanceUpdatedAt: z.string().nullable(),
  lunchflowAccountId: z.string().nullable(), // id externe LunchFlow associé (null = non connecté)
  lunchflowSyncedAt: z.string().nullable(), // dernière tentative de synchro du solde
  lunchflowError: z.string().nullable(), // message d'erreur de la dernière synchro (null = OK)
});
export type Account = z.infer<typeof accountSchema>;

export const updateAccountSchema = z.object({
  name: z.string().optional(),
  type: z.enum(ACCOUNT_TYPE).optional(),
  isPrimary: z.boolean().optional(),
  forecast: z.boolean().optional(),
  currentBalance: z.number().int().optional(),
  balanceUpdatedAt: z.string().optional(),
});

export const createAccountSchema = z.object({
  name: z.string().min(1),
  owner: z.enum(PAYER),
  type: z.enum(ACCOUNT_TYPE).default("checking"),
  isPrimary: z.boolean().default(false),
});

export const updateDefaultAccountSchema = z.object({
  accountId: z.string().nullable(), // null = aucun compte par défaut
});

export const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  groupName: z.string(),
  kind: z.enum(CATEGORY_KIND),
  color: z.string(),
});
export type Category = z.infer<typeof categorySchema>;

export const createCategorySchema = z.object({
  name: z.string().min(1),
  groupName: z.string().min(1),
  kind: z.enum(CATEGORY_KIND),
  color: z.string().default("#6366f1"),
});

export const transactionSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  categoryId: z.string().nullable(),
  label: z.string(),
  amount: z.number().int(),
  paidBy: z.enum(PAYER),
  shareA: z.number().int(),
  shareB: z.number().int(),
  date: z.string(),
  kind: z.enum(TX_KIND),
  recurringId: z.string().nullable(),
  archived: z.boolean(),
  createdBy: z.string(),
});
export type Transaction = z.infer<typeof transactionSchema>;

export const createTransactionSchema = z.object({
  accountId: z.string(),
  categoryId: z.string().nullish(),
  label: z.string().min(1),
  amount: z.number().int(),
  paidBy: z.enum(PAYER).default("joint"),
  shareA: z.number().int(),
  shareB: z.number().int(),
  date: z.string(),
  kind: z.enum(TX_KIND).default("actual"),
  archived: z.boolean().optional(),
});
export type CreateTransaction = z.infer<typeof createTransactionSchema>;

export const recurringDebitSchema = z.object({
  id: z.string(),
  label: z.string(),
  amount: z.number().int(),
  dayOfMonth: z.number().int().nullable(),
});
export type RecurringDebit = z.infer<typeof recurringDebitSchema>;

export const recurringSchema = z.object({
  id: z.string(),
  categoryId: z.string().nullable(),
  accountId: z.string(),
  label: z.string(),
  amount: z.number().int(),
  shareA: z.number().int(),
  shareB: z.number().int(),
  frequency: z.enum(FREQUENCY),
  dayOfMonth: z.number().int().nullable(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  active: z.boolean(),
  position: z.number(),
  debits: z.array(recurringDebitSchema),
  // Motifs de nom (vendeur) pour matcher des transactions bancaires au montant
  // variable (ex. prélèvement DDFIP). Une transaction matche si son nom contient
  // l'un de ces motifs.
  matchNames: z.array(z.string()),
});
export type Recurring = z.infer<typeof recurringSchema>;

// Sous-débit à la création/mise à jour (sans id)
export const createRecurringDebitSchema = z.object({
  label: z.string().default(""),
  amount: z.number().int(),
  dayOfMonth: z.number().int().min(1).max(31).nullish(),
});

export const createRecurringSchema = z.object({
  categoryId: z.string().nullish(),
  accountId: z.string(),
  label: z.string().min(1),
  amount: z.number().int(),
  shareA: z.number().int(),
  shareB: z.number().int(),
  frequency: z.enum(FREQUENCY).default("monthly"),
  dayOfMonth: z.number().int().min(1).max(31).nullish(),
  startDate: z.string(),
  endDate: z.string().nullish(),
  active: z.boolean().default(true),
  debits: z.array(createRecurringDebitSchema).optional(),
  matchNames: z.array(z.string()).optional(),
});
export type CreateRecurring = z.infer<typeof createRecurringSchema>;

export const reorderRecurringSchema = z.object({
  orderedIds: z.array(z.string()),
});

// Ajout d'un motif de nom depuis une transaction bancaire (page Comptes).
export const addMatchNameSchema = z.object({
  name: z.string().min(1),
});

/* ------------------------------------------------------------------ */
/* Settlement (who owes whom)                                          */
/* ------------------------------------------------------------------ */

export const balanceSchema = z.object({
  /** positif => b doit à a ; négatif => a doit à b */
  net: z.number().int(),
  fromUser: z.enum(MEMBERS),
  toUser: z.enum(MEMBERS),
  amount: z.number().int(),
});
export type Balance = z.infer<typeof balanceSchema>;

export const createSettlementSchema = z.object({
  fromUser: z.enum(MEMBERS),
  toUser: z.enum(MEMBERS),
  amount: z.number().int().positive(),
  date: z.string(),
  note: z.string().optional(),
  archived: z.boolean().optional(),
});

export const settlementSchema = z.object({
  id: z.string(),
  fromUser: z.enum(MEMBERS),
  toUser: z.enum(MEMBERS),
  amount: z.number().int(),
  date: z.string(),
  note: z.string().nullable(),
  archived: z.boolean(),
});
export type Settlement = z.infer<typeof settlementSchema>;

/* ------------------------------------------------------------------ */
/* Wedding                                                             */
/* ------------------------------------------------------------------ */

export const weddingBudgetItemSchema = z.object({
  id: z.string(),
  groupName: z.string(),
  prestataire: z.string().nullable(),
  label: z.string(),
  amount: z.number().int(),
  note: z.string().nullable(),
  url: z.string().nullable(), // site du prestataire
  address: z.string().nullable(), // adresse du prestataire
  optional: z.boolean(),
  done: z.boolean(),
  position: z.number(),
});
export type WeddingBudgetItem = z.infer<typeof weddingBudgetItemSchema>;

export const createWeddingBudgetItemSchema = z.object({
  groupName: z.string().min(1),
  prestataire: z.string().nullish(),
  label: z.string().min(1),
  amount: z.number().int(),
  note: z.string().nullish(),
  url: z.string().nullish(),
  address: z.string().nullish(),
  optional: z.boolean().default(false),
  done: z.boolean().default(false),
  position: z.number().optional(),
});

export const reorderWeddingBudgetSchema = z.object({
  orderedIds: z.array(z.string()),
});

// Fichiers joints acceptés sur une dépense mariage : images, PDF, CSV, Excel, PowerPoint. Max 25 Mo.
export const WEDDING_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const WEDDING_FILE_EXTENSIONS: string[] = [
  "png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "svg", // images
  "pdf", "csv", "xls", "xlsx", "ppt", "pptx",
];
export const isAllowedWeddingFile = (name: string): boolean =>
  WEDDING_FILE_EXTENSIONS.includes((name.split(".").pop() ?? "").toLowerCase());

export const weddingBudgetFileSchema = z.object({
  id: z.string(),
  budgetItemId: z.string(),
  fileName: z.string(),
  contentType: z.string().nullable(),
  size: z.number().int(),
  createdAt: z.string(),
});
export type WeddingBudgetFile = z.infer<typeof weddingBudgetFileSchema>;

export const savingsContributionSchema = z.object({
  id: z.string(),
  month: z.string(),
  amountA: z.number().int(),
  amountB: z.number().int(),
  planned: z.boolean(),
  /**
   * Versement effectué, **par membre** : sur un même mois l'un peut avoir versé
   * et l'autre non. `planned` reste la vue mois entier (faux dès que les deux
   * ont versé), pour ne pas casser les écrans qui la lisent déjà.
   */
  realizedA: z.boolean(),
  realizedB: z.boolean(),
});
export type SavingsContribution = z.infer<typeof savingsContributionSchema>;

export const createSavingsContributionSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  amountA: z.number().int().default(0),
  amountB: z.number().int().default(0),
  planned: z.boolean().default(false),
  realizedA: z.boolean().default(false),
  realizedB: z.boolean().default(false),
});

export const weddingPaymentSchema = z.object({
  id: z.string(),
  budgetItemId: z.string().nullable(),
  prestataire: z.string(),
  type: z.string().nullable(),
  dueDate: z.string(),
  amountDue: z.number().int(),
  amountPaid: z.number().int(),
});
export type WeddingPayment = z.infer<typeof weddingPaymentSchema>;

export const createWeddingPaymentSchema = z.object({
  budgetItemId: z.string().nullish(),
  prestataire: z.string().min(1),
  type: z.string().nullish(),
  dueDate: z.string().default(""), // peut être vide (échéance non encore fixée)
  amountDue: z.number().int(),
  amountPaid: z.number().int().default(0),
});

export const weddingTodoSchema = z.object({
  id: z.string(),
  description: z.string(),
  dueDate: z.string().nullable(),
  owner: z.enum(MEMBERS).nullable(),
  done: z.boolean(),
});
export type WeddingTodo = z.infer<typeof weddingTodoSchema>;

export const createWeddingTodoSchema = z.object({
  description: z.string().min(1),
  dueDate: z.string().nullish(),
  owner: z.enum(MEMBERS).nullish(),
  done: z.boolean().default(false),
});

/* ---- Invités ---- */

export const GUEST_TYPE = ["maries", "famille", "amis", "temoin"] as const;
export type GuestType = (typeof GUEST_TYPE)[number];

export const GUEST_GROUP = ["vendredi", "samedi"] as const;
export type GuestGroup = (typeof GUEST_GROUP)[number];

export const GUEST_AGE = ["adult", "child"] as const;
export type GuestAge = (typeof GUEST_AGE)[number];

export const GUEST_TYPE_META: Record<GuestType, { icon: string; label: string }> = {
  maries: { icon: "💍", label: "Mariés" },
  famille: { icon: "👪", label: "Famille" },
  amis: { icon: "🍻", label: "Amis" },
  temoin: { icon: "⭐", label: "Témoin" },
};

export const GUEST_AGE_META: Record<GuestAge, { icon: string; label: string }> = {
  adult: { icon: "🧑", label: "Adulte" },
  child: { icon: "🧒", label: "Enfant" },
};

// Statut du faire-part (chef de famille uniquement ; "none" = "-" pour les autres).
export const INVITATION_STATUS = ["none", "to_send", "sent", "opened", "filled"] as const;
export type InvitationStatus = (typeof INVITATION_STATUS)[number];

export const INVITATION_STATUS_META: Record<InvitationStatus, { label: string }> = {
  none: { label: "-" },
  to_send: { label: "À envoyer" },
  sent: { label: "Envoyé" },
  opened: { label: "Ouvert" },
  filled: { label: "Répondu" },
};

export const weddingGuestSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(GUEST_TYPE),
  ageGroup: z.enum(GUEST_AGE),
  invitationStatus: z.enum(INVITATION_STATUS),
  guestGroup: z.enum(GUEST_GROUP),
  vendredi: z.boolean(),
  samedi: z.boolean(),
  dimanche: z.boolean(),
  archived: z.boolean(),
  parentId: z.string().nullable(),
  address: z.string().nullable(), // rue / n° (ligne 1)
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
  position: z.number(),
});
export type WeddingGuest = z.infer<typeof weddingGuestSchema>;

export const createWeddingGuestSchema = z.object({
  name: z.string().min(1),
  type: z.enum(GUEST_TYPE).default("famille"),
  ageGroup: z.enum(GUEST_AGE).default("adult"),
  invitationStatus: z.enum(INVITATION_STATUS).default("to_send"),
  guestGroup: z.enum(GUEST_GROUP).default("vendredi"),
  vendredi: z.boolean().default(true),
  samedi: z.boolean().default(true),
  dimanche: z.boolean().default(true),
  archived: z.boolean().default(false),
  parentId: z.string().nullish(),
  address: z.string().nullish(),
  postalCode: z.string().nullish(),
  city: z.string().nullish(),
  position: z.number().optional(),
});

export const reorderGuestsSchema = z.object({
  orderedIds: z.array(z.string()),
});

export const updateWeddingGuestSchema = createWeddingGuestSchema.partial();

export const weddingSummarySchema = z.object({
  targetAmount: z.number().int(),
  targetDate: z.string(),
  savedToDate: z.number().int(),
  shouldHaveByNow: z.number().int(),
  surplus: z.number().int(),
  monthsLeft: z.number().int(),
  monthlyRequired: z.number().int(),
  percentFunded: z.number(),
  totalDue: z.number().int(),
  totalPaid: z.number().int(),
});
export type WeddingSummary = z.infer<typeof weddingSummarySchema>;

/* ------------------------------------------------------------------ */
/* Courses (liste + recettes)                                          */
/* ------------------------------------------------------------------ */

export const shoppingItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  quantity: z.number().int(),
  /** Clé de rayon ; null pour les articles antérieurs aux rayons. */
  category: z.string().nullable(),
  createdAt: z.string(),
});
export type ShoppingItem = z.infer<typeof shoppingItemSchema>;

export const createShoppingItemSchema = z.object({
  name: z.string().min(1),
  /** Absent = rayon déduit du catalogue (`categoryFor`). */
  category: z.string().min(1).nullish(),
});

export const updateShoppingItemSchema = z.object({
  quantity: z.number().int().min(0).optional(),
  category: z.string().min(1).optional(),
});

export const addShoppingItemsSchema = z.object({
  names: z.array(z.string().min(1)),
});

export const shoppingFavoriteSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.number(),
});
export type ShoppingFavorite = z.infer<typeof shoppingFavoriteSchema>;

export const createShoppingFavoriteSchema = z.object({
  name: z.string().min(1),
});

export const reorderFavoritesSchema = z.object({
  orderedIds: z.array(z.string()),
});

/* ------------------------------------------------------------------ */
/* Listes libres (menu « Listes »)                                     */
/* ------------------------------------------------------------------ */

/** `shared` = visible de tout le foyer ; `personal` = privée à son créateur. */
export const LIST_SCOPES = ["shared", "personal"] as const;
export type ListScope = (typeof LIST_SCOPES)[number];

export const customListItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  done: z.boolean(),
});
export type CustomListItem = z.infer<typeof customListItemSchema>;

export const customListSchema = z.object({
  id: z.string(),
  scope: z.enum(LIST_SCOPES),
  name: z.string(),
  /** Emoji de contenu affiché en tête de liste (null = pastille neutre). */
  emoji: z.string().nullable(),
  /** Dernière modification de la liste ou d'un de ses éléments (ISO), null si jamais touchée. */
  updatedAt: z.string().nullable(),
  /** Slot du membre auteur de la dernière modification (`a` | `b`). */
  updatedBy: z.string().nullable(),
  items: z.array(customListItemSchema),
});
export type CustomList = z.infer<typeof customListSchema>;

/** Emoji proposés à la création d'une liste (le champ reste libre). */
export const LIST_EMOJIS = [
  "📝", "🛒", "🧳", "🎁", "🍲", "🔧", "🏠", "🌱",
  "🎬", "📚", "💡", "🎉", "🚗", "🐾", "💊", "👕",
] as const;

/** Un seul emoji (ou rien) : on borne à 8 UTF-16 pour couvrir les séquences ZWJ. */
const emojiField = z.string().trim().max(8).nullable().optional();

export const createCustomListSchema = z.object({
  scope: z.enum(LIST_SCOPES),
  name: z.string().trim().min(1).max(80),
  emoji: emojiField,
});

export const updateCustomListSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  emoji: emojiField,
});

export const createCustomListItemSchema = z.object({
  label: z.string().trim().min(1).max(200),
});

export const updateCustomListItemSchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  done: z.boolean().optional(),
});

export const reorderIdsSchema = z.object({
  orderedIds: z.array(z.string()),
});

export const MEAT_TYPES = ["poulet", "veau", "porc", "boeuf", "agneau", "canard", "poisson"] as const;
export type MeatType = (typeof MEAT_TYPES)[number];
export const MEAT_META: Record<MeatType, { icon: string; label: string }> = {
  poulet: { icon: "🍗", label: "Poulet" },
  veau: { icon: "🐄", label: "Veau" },
  porc: { icon: "🐷", label: "Porc" },
  boeuf: { icon: "🥩", label: "Bœuf" },
  agneau: { icon: "🐑", label: "Agneau" },
  canard: { icon: "🦆", label: "Canard" },
  poisson: { icon: "🐟", label: "Poisson" },
};

export const STARCH_TYPES = ["pates", "riz", "patate", "semoule", "aucun"] as const;
export type StarchType = (typeof STARCH_TYPES)[number];
export const STARCH_META: Record<StarchType, { icon: string; label: string }> = {
  pates: { icon: "🍝", label: "Pâtes" },
  riz: { icon: "🍚", label: "Riz" },
  patate: { icon: "🥔", label: "Pomme de terre" },
  semoule: { icon: "🌾", label: "Semoule" },
  aucun: { icon: "", label: "Aucun" },
};

export const COURSE_TYPES = ["entree", "plat", "dessert"] as const;
export type CourseType = (typeof COURSE_TYPES)[number];
export const COURSE_META: Record<CourseType, { icon: string; label: string }> = {
  entree: { icon: "🥗", label: "Entrée" },
  plat: { icon: "🍽️", label: "Plat" },
  dessert: { icon: "🍰", label: "Dessert" },
};

export const recipeSchema = z.object({
  id: z.string(),
  title: z.string(),
  sourceUrl: z.string().nullable(),
  imageUrl: z.string().nullable(),
  servings: z.number().int(),
  prepMinutes: z.number().int().nullable(),
  totalMinutes: z.number().int().nullable(),
  vegetarian: z.boolean(),
  meat: z.enum(MEAT_TYPES).nullable(),
  starch: z.enum(STARCH_TYPES),
  vegetables: z.boolean(),
  course: z.enum(COURSE_TYPES),
  ingredients: z.array(z.string()),
  steps: z.array(z.string()),
  createdAt: z.string(),
});
export type Recipe = z.infer<typeof recipeSchema>;

// Import : soit une URL (page ou post Instagram/TikTok), soit un texte collé
// par l'utilisateur (description complète de la recette).
export const importRecipeSchema = z
  .object({
    url: z.string().url().optional(),
    text: z.string().min(20).optional(),
  })
  .refine((d) => d.url || d.text, { message: "url ou text requis" });

// Import en masse : tableau de recettes complètes (collé en JSON, sans LLM).
export const bulkRecipeSchema = z.object({
  title: z.string().min(1),
  sourceUrl: z.string().nullish(),
  imageUrl: z.string().nullish(),
  // Photo du plat encodée en base64 (data URI ou base64 nu) — stockée dans R2
  // à l'import, prioritaire sur imageUrl. ~3 M de caractères ≈ 2 Mo d'image.
  imageBase64: z.string().max(3_000_000).nullish(),
  servings: z.number().int().min(1).default(4),
  prepMinutes: z.number().int().min(0).nullish(),
  totalMinutes: z.number().int().min(0).nullish(),
  vegetarian: z.boolean().default(false),
  meat: z.enum(MEAT_TYPES).nullish(),
  starch: z.enum(STARCH_TYPES).default("aucun"),
  vegetables: z.boolean().default(false),
  course: z.enum(COURSE_TYPES).default("plat"),
  ingredients: z.array(z.string().min(1)).min(1),
  steps: z.array(z.string().min(1)).min(1),
});
export const bulkImportRecipesSchema = z.object({
  recipes: z.array(bulkRecipeSchema).min(1).max(500),
});

export const updateRecipeSchema = z.object({
  title: z.string().min(1).optional(),
  sourceUrl: z.string().nullish(),
  imageUrl: z.string().nullish(),
  servings: z.number().int().min(1).optional(),
  prepMinutes: z.number().int().min(0).nullish(),
  totalMinutes: z.number().int().min(0).nullish(),
  vegetarian: z.boolean().optional(),
  meat: z.enum(MEAT_TYPES).nullish(),
  starch: z.enum(STARCH_TYPES).optional(),
  vegetables: z.boolean().optional(),
  course: z.enum(COURSE_TYPES).optional(),
  ingredients: z.array(z.string()).optional(),
  steps: z.array(z.string()).optional(),
});

/* Idées repas : suggestions de recettes générées (onglet « Idées repas »). */
export const recipeIdeaSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  course: z.enum(COURSE_TYPES),
  ingredients: z.array(z.string()), // ingrédients principaux, sans quantités
  imageUrl: z.string().nullable(),
});
export type RecipeIdea = z.infer<typeof recipeIdeaSchema>;

export const updateExcludedIngredientsSchema = z.object({
  ingredients: z.array(z.string().min(1)),
});

export const generateIdeasSchema = z.object({
  course: z.enum(COURSE_TYPES).nullish(), // catégorie ciblée (null = mix, surtout des plats)
});

/* Repas de la semaine : sélection variée dans « Mes recettes », partagée au foyer. */
export const generateMealPlanSchema = z.object({
  count: z.number().int().min(1).max(14).default(5),
  maxPrepMinutes: z.number().int().min(1).nullish(),
  maxTotalMinutes: z.number().int().min(1).nullish(),
});

export const replaceMealPlanRecipeSchema = z.object({
  recipeId: z.string().min(1),
  /** Recette de remplacement choisie à la main (sinon tirage varié). */
  withRecipeId: z.string().min(1).nullish(),
});

/** Une seule recette du menu : la retirer, la remonter, la cocher. */
export const mealPlanRecipeSchema = z.object({ recipeId: z.string().min(1) });

export const setMealCookedSchema = z.object({
  recipeId: z.string().min(1),
  done: z.boolean(),
});

/** Ajoute une recette au menu de la semaine (« Cuisiner ce soir »). */
export const addMealPlanRecipeSchema = z.object({
  recipeId: z.string().min(1),
});

/* ------------------------------------------------------------------ */
/* Dépenses prévues (anticipées)                                       */
/* ------------------------------------------------------------------ */

export const plannedExpenseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  amount: z.number().int(),
  date: z.string().nullable(),
  owner: z.enum(PAYER), // a | b | joint (à qui incombe la dépense)
  purchasedAt: z.string().nullable(), // date d'achat effectif — sort de la projection trésorerie
  createdAt: z.string(),
});
export type PlannedExpense = z.infer<typeof plannedExpenseSchema>;

export const createPlannedExpenseSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullish(),
  amount: z.number().int(),
  date: z.string().nullish(),
  owner: z.enum(PAYER).default("joint"),
  purchasedAt: z.string().nullish(),
});

/* ------------------------------------------------------------------ */
/* Bien-être — objectifs personnalisables                              */
/* ------------------------------------------------------------------ */

/** Périodicité d'un objectif. */
export const GOAL_PERIODS = ["daily", "weekly", "monthly"] as const;
export type GoalPeriod = (typeof GOAL_PERIODS)[number];
export const GOAL_PERIOD_META: Record<GoalPeriod, { label: string; short: string }> = {
  daily: { label: "Journalier", short: "jour" },
  weekly: { label: "Hebdomadaire", short: "semaine" },
  monthly: { label: "Mensuel", short: "mois" },
};

/**
 * Nature d'un objectif :
 * - `max` / `min` : compteur avec une cible chiffrée sur la période ;
 * - `todo` / `nottodo` : à cocher (respecté / raté), sans chiffre.
 */
export const GOAL_KINDS = ["max", "min", "todo", "nottodo"] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];
export const GOAL_KIND_META: Record<GoalKind, { label: string; counter: boolean }> = {
  max: { label: "Max", counter: true },
  min: { label: "Min", counter: true },
  todo: { label: "À faire", counter: false },
  nottodo: { label: "À ne pas faire", counter: false },
};

/** Un objectif « typé sport » est associé à une séance (activités + séries). */
export const GOAL_TYPES = ["simple", "sport"] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

/** Unité de mesure d'une activité de séance. */
export const ACTIVITY_UNITS = ["reps", "sec", "min", "hour"] as const;
export type ActivityUnit = (typeof ACTIVITY_UNITS)[number];
export const ACTIVITY_UNIT_META: Record<
  ActivityUnit,
  { label: string; short: string; seconds: number | null }
> = {
  reps: { label: "Répétitions", short: "rép.", seconds: null },
  sec: { label: "Secondes", short: "s", seconds: 1 },
  min: { label: "Minutes", short: "min", seconds: 60 },
  hour: { label: "Heures", short: "h", seconds: 3600 },
};

/* ---- Activités (catalogue réutilisable dans les séances) ---- */

export const wellnessActivitySchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  unit: z.enum(ACTIVITY_UNITS),
  position: z.number().int(),
});
export type WellnessActivity = z.infer<typeof wellnessActivitySchema>;

export const upsertWellnessActivitySchema = z.object({
  name: z.string().min(1),
  icon: z.string().default("💪"),
  unit: z.enum(ACTIVITY_UNITS).default("reps"),
});

/* ---- Séances ---- */

export const wellnessSessionItemSchema = z.object({
  activityId: z.string(),
  amount: z.number().int().min(0),
});
export type WellnessSessionItem = z.infer<typeof wellnessSessionItemSchema>;

export const wellnessSessionSchema = z.object({
  id: z.string(),
  name: z.string(),
  emoji: z.string(),
  series: z.number().int(),
  items: z.array(wellnessSessionItemSchema),
  position: z.number().int(),
});
export type WellnessSession = z.infer<typeof wellnessSessionSchema>;

export const upsertWellnessSessionSchema = z.object({
  name: z.string().min(1),
  emoji: z.string().default("🏋️"),
  series: z.number().int().min(1).default(1),
  items: z.array(wellnessSessionItemSchema).default([]),
});

/* ---- Objectifs ---- */

export const wellnessGoalSchema = z.object({
  id: z.string(),
  name: z.string(),
  emoji: z.string(),
  period: z.enum(GOAL_PERIODS),
  kind: z.enum(GOAL_KINDS),
  /** Cible chiffrée (max/min) ; null pour les objectifs à cocher. */
  target: z.number().int().nullable(),
  goalType: z.enum(GOAL_TYPES),
  /** Séance associée pour un objectif de type `sport`. */
  sessionId: z.string().nullable(),
  /** Jours d'application (0 = dimanche … 6 = samedi) ; null = tous les jours. */
  days: z.array(z.number().int().min(0).max(6)).nullable(),
  position: z.number().int(),
});
export type WellnessGoal = z.infer<typeof wellnessGoalSchema>;

export const upsertWellnessGoalSchema = z.object({
  name: z.string().min(1),
  emoji: z.string().default("🎯"),
  period: z.enum(GOAL_PERIODS).default("daily"),
  kind: z.enum(GOAL_KINDS).default("todo"),
  target: z.number().int().min(0).nullish(),
  goalType: z.enum(GOAL_TYPES).default("simple"),
  sessionId: z.string().nullish(),
  days: z.array(z.number().int().min(0).max(6)).nullish(),
});

/** Réordonnancement générique (objectifs, séances, activités). */
export const reorderWellnessSchema = z.object({ orderedIds: z.array(z.string()) });

/* ---- Saisie quotidienne ---- */

/**
 * Séance réalisée : figée (snapshot nom + activités) au moment de la saisie,
 * pour qu'une modification ultérieure de la séance ne réécrive pas l'historique.
 * Les stats cumulent les activités **par nom**.
 */
export const wellnessLoggedSessionSchema = z.object({
  sessionId: z.string().nullish(),
  name: z.string(),
  emoji: z.string().default("🏋️"),
  series: z.number().int().min(1),
  items: z.array(
    z.object({
      name: z.string(),
      icon: z.string(),
      unit: z.enum(ACTIVITY_UNITS),
      amount: z.number().int().min(0),
    }),
  ),
});
export type WellnessLoggedSession = z.infer<typeof wellnessLoggedSessionSchema>;

export const wellnessLogSchema = z.object({
  date: z.string(),
  goalId: z.string(),
  /** Compteur (max/min), 1/0 pour les objectifs à cocher, nb de séances pour le sport. */
  value: z.number().int(),
  sessions: z.array(wellnessLoggedSessionSchema),
});
export type WellnessLog = z.infer<typeof wellnessLogSchema>;

export const upsertWellnessLogSchema = z.object({
  value: z.number().int().min(0).default(0),
  sessions: z.array(wellnessLoggedSessionSchema).default([]),
});

/**
 * Journal d'un membre : les saisies, plus les journées déclarées terminées.
 * La clôture voyage avec les logs — c'est la même donnée de journal, et la
 * fusionner évite une troisième requête sur l'écran du quotidien.
 */
export type WellnessJournal = {
  logs: WellnessLog[];
  /** Journées clôturées (YYYY-MM-DD). */
  closedDates: string[];
};

/** « Clôturer la journée » / rouvrir une journée close. */
export const setWellnessDayClosedSchema = z.object({ closed: z.boolean() });

/** Configuration complète du module bien-être d'un membre. */
export type WellnessConfig = {
  goals: WellnessGoal[];
  sessions: WellnessSession[];
  activities: WellnessActivity[];
};

/* ------------------------------------------------------------------ */
/* Electricity                                                         */
/* ------------------------------------------------------------------ */

export const utilityReadingSchema = z.object({
  id: z.string(),
  utility: z.string(),
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  kwh: z.number().int(),
});
export type UtilityReading = z.infer<typeof utilityReadingSchema>;

/**
 * Réponse de `GET /api/utilities` : les relevés bruts et le tarif du foyer.
 * Les agrégats (totaux par année, variations) se calculent côté front — ils
 * dépendent de la vue affichée, pas de la base.
 */
export interface UtilityData {
  utility: string;
  /** Prix TTC du kWh en euros (ex. 0.2516) ; null = coût non estimé. */
  pricePerKwh: number | null;
  /** Triés du plus récent au plus ancien. */
  readings: UtilityReading[];
}

export const upsertUtilityReadingSchema = z.object({
  utility: z.string().default("electricity"),
  year: z.number().int().min(1970).max(2999),
  month: z.number().int().min(1).max(12),
  kwh: z.number().int().min(0),
});

/** Tarif du foyer (config foyer) : `null` efface le prix et masque les coûts. */
export const updateUtilityPriceSchema = z.object({
  pricePerKwh: z.number().min(0).max(10).nullable(),
});

/* ------------------------------------------------------------------ */
/* Cashflow                                                            */
/* ------------------------------------------------------------------ */

export const cashflowAccountSchema = z.object({
  accountId: z.string(),
  accountName: z.string(),
  currentBalance: z.number().int(),
  totalDebits: z.number().int(),
  totalCredits: z.number().int(),
  projectedBalance: z.number().int(),
});

export const cashflowEntrySchema = z.object({
  date: z.string(),
  label: z.string(),
  amount: z.number().int(),
  accountId: z.string(),
  source: z.enum(["recurring", "wedding", "planned"]),
});

export const cashflowSchema = z.object({
  horizonDays: z.number().int(),
  byAccount: z.array(cashflowAccountSchema),
  upcoming: z.array(cashflowEntrySchema),
  lowPoint: z.object({ date: z.string(), balance: z.number().int() }).nullable(),
});
export type Cashflow = z.infer<typeof cashflowSchema>;

/* ------------------------------------------------------------------ */
/* Calendar (Google)                                                   */
/* ------------------------------------------------------------------ */

export const calendarEventSchema = z.object({
  id: z.string(),
  calendarId: z.string(),
  calendarName: z.string().optional(),
  summary: z.string(),
  description: z.string().nullable().optional(),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean(),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

export const createCalendarEventSchema = z.object({
  calendarId: z.string().default("primary"),
  summary: z.string().min(1),
  description: z.string().nullish(),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean().default(false),
});

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

export const CLAUDE_MODELS = [
  { id: "claude-haiku-4-5-20251001", label: "Haiku (rapide, économique)" },
  { id: "claude-sonnet-4-6", label: "Sonnet (équilibré)" },
  { id: "claude-opus-4-8", label: "Opus (le plus puissant)" },
] as const;

export const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  model: z.string().nullable(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  userId: z.string().nullable(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const sendChatSchema = z.object({
  content: z.string().min(1),
  model: z.string().default("claude-haiku-4-5-20251001"),
  webSearch: z.boolean().default(false),
});

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export const dashboardSchema = z.object({
  tasksToday: z.array(taskSchema),
  overdueTasks: z.number().int(),
  wedding: weddingSummarySchema,
  treasuryTotal: z.number().int(),
  upcomingDebits30d: z.number().int(),
  balance: balanceSchema,
  electricityYearTotal: z.number().int(),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

/* ------------------------------------------------------------------ */
/* Indicateurs de navigation (pastilles en bout de menu)               */
/* ------------------------------------------------------------------ */

/**
 * Compteurs affichés au bout des menus. Propres à l'utilisateur connecté :
 * « mes tâches », « mon compte principal ». `null` = rien à afficher.
 */
export const navBadgesSchema = z.object({
  /** Tâches à faire qui me sont attribuées ou qui ne le sont à personne. */
  tasks: z.number().int(),
  /** Articles restant à acheter sur la liste de courses. */
  courses: z.number().int(),
  /** Reste à vivre du compte principal du membre connecté (fin de mois), en centimes. */
  moneyCents: z.number().int().nullable(),
  /** Jours restants avant le mariage (0 = jour J). Null si non configuré ou passé. */
  weddingDays: z.number().int().nullable(),
});
export type NavBadges = z.infer<typeof navBadgesSchema>;

/* ------------------------------------------------------------------ */
/* Sommaire de la section Argent (hub mobile)                          */
/* ------------------------------------------------------------------ */

/**
 * Un chiffre par onglet de la section Argent, calculé en une requête.
 *
 * Endpoint dédié (`GET /api/money/summary`) et **pas** un ajout à `/api/badges` :
 * celui-ci est sur le chemin critique de toutes les pages, alors que ce
 * sommaire n'est chargé que par l'accueil de la section.
 */
export const moneySummarySchema = z.object({
  /** Mois de référence, `YYYY-MM`. */
  month: z.string(),
  /**
   * Répartition du disponible du mois. Les trois parts s'additionnent au
   * disponible : soldes actuels + crédits attendus d'ici la fin du mois.
   */
  split: z.object({
    /** Débits récurrents restants (charges fixes). */
    chargesCents: z.number().int(),
    /** Autres débits attendus : dépenses prévues, échéances mariage. */
    variablesCents: z.number().int(),
    /** Ce qui reste après tout ça — le « reste à vivre » du foyer. */
    freeCents: z.number().int(),
  }),
  depenses: z.object({ count: z.number().int(), monthlyCents: z.number().int() }),
  tresorerie: z.object({ balanceCents: z.number().int(), accounts: z.number().int() }),
  equilibrage: balanceSchema,
  prevue: z.object({ count: z.number().int(), totalCents: z.number().int() }),
  /** Dernier relevé électricité connu (null si aucun). */
  electricite: z
    .object({ year: z.number().int(), month: z.number().int(), kwh: z.number() })
    .nullable(),
  comptes: z.object({ count: z.number().int(), names: z.array(z.string()) }),
});
export type MoneySummary = z.infer<typeof moneySummarySchema>;

/* ------------------------------------------------------------------ */
/* Virements de début de mois — la to-do, pas le calcul                */
/* ------------------------------------------------------------------ */

/**
 * Un virement coché. La clé est calculée par le front à partir du membre et du
 * compte destinataire (`a:<accountId>`) : le serveur ne fait que la stocker,
 * il n'a pas à rejouer la logique de répartition pour la valider.
 */
export const transferCheckSchema = z.object({
  key: z.string(),
  doneAt: z.string(),
  /** Slot du membre qui a coché (`a` | `b`). */
  doneBy: z.string(),
});
export type TransferCheck = z.infer<typeof transferCheckSchema>;

export const setTransferChecksSchema = z.object({
  /** Mois des virements, `YYYY-MM`. */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  keys: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
  done: z.boolean(),
});

/* ------------------------------------------------------------------ */
/* WishList                                                            */
/* ------------------------------------------------------------------ */

// À qui appartient le souhait : à l'un des membres, ou aux deux (« commun »).
export const WISH_OWNERS = ["commun", ...MEMBERS] as const;
export type WishOwner = (typeof WISH_OWNERS)[number];

/** Libellés des propriétaires de souhaits, à partir de la config des membres. */
export function wishOwnerLabels(members: MembersConfig): Record<WishOwner, string> {
  return { commun: "Commun", a: members.a.name, b: members.b.name };
}

// Faisabilité ressentie du souhait (tag affiché sur la carte).
export const WISH_FEASIBILITIES = ["easy", "doable", "hard"] as const;
export type WishFeasibility = (typeof WISH_FEASIBILITIES)[number];

export const WISH_FEASIBILITY_META: Record<WishFeasibility, { label: string }> = {
  easy: { label: "Easy" },
  doable: { label: "Ça se fait" },
  hard: { label: "Ouah c'est chaud" },
};

// Icônes proposées dans la modale (l'emoji choisi est stocké tel quel).
export const WISH_ICONS = [
  "⭐", "🎯", "✈️", "🏝️", "🗺️", "🚢", "🚗", "🏍️", "🚁", "🚀",
  "🎢", "🎡", "🏊", "🤿", "⛷️", "🏄", "🧗", "🪂", "🎈", "🎿",
  "🍽️", "🍖", "🍣", "🍷", "🍸", "🎂", "🎪", "🎤", "🎸", "🎬",
  "🎭", "🏟️", "🏆", "🎾", "⚽", "🏉", "🏎️", "🎮", "🎨", "🧘",
  "💆", "💅", "🏡", "🏨", "🏕️", "🌋", "🌌", "🐬", "🐴", "💎",
] as const;

export const wishSchema = z.object({
  id: z.string(),
  owner: z.enum(WISH_OWNERS),
  name: z.string(),
  icon: z.string().nullable(),
  description: z.string().nullable(),
  url: z.string().nullable(),
  address: z.string().nullable(),
  date: z.string().nullable(), // date souhaitée (optionnelle)
  feasibility: z.enum(WISH_FEASIBILITIES).nullable(),
  starred: z.boolean(), // mis en avant : remonte en haut de sa liste
  doneAt: z.string().nullable(), // date de réalisation (null = à faire)
});
export type Wish = z.infer<typeof wishSchema>;

export const createWishSchema = z.object({
  owner: z.enum(WISH_OWNERS),
  name: z.string().min(1),
  icon: z.string().nullish(),
  description: z.string().nullish(),
  url: z.string().nullish(),
  address: z.string().nullish(),
  date: z.string().nullish(),
  feasibility: z.enum(WISH_FEASIBILITIES).nullish(),
});
export const updateWishSchema = createWishSchema.partial().extend({
  starred: z.boolean().optional(),
  doneAt: z.string().nullish(), // date de réalisation, null pour remettre « à faire »
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export const eurosToCents = (euros: number): number => Math.round(euros * 100);
export const centsToEuros = (cents: number): number => cents / 100;
export const formatEuros = (cents: number): string =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);

/* ------------------------------------------------------------------ */
/* Catalogue produits (liste de courses)                               */
/* ------------------------------------------------------------------ */

// Réexporté ici pour que l'API comme le front consomment le même catalogue :
// c'est lui qui donne l'emoji et le rayon par défaut d'un article.
export * from "./groceries";
