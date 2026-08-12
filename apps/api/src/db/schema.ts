import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const household = sqliteTable("household", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("EUR"),
  defaultSplitA: integer("default_split_a").notNull().default(50),
  defaultSplitB: integer("default_split_b").notNull().default(50),
  memberAName: text("member_a_name").notNull().default("Membre A"),
  memberBName: text("member_b_name").notNull().default("Membre B"),
  memberAColor: text("member_a_color").notNull().default("#3b82f6"),
  memberBColor: text("member_b_color").notNull().default("#f43f5e"),
  extraPersons: text("extra_persons"), // JSON [{id,name,color}] — personnes hors membres a/b
  weddingTargetAmount: integer("wedding_target_amount").notNull().default(0),
  weddingTargetDate: text("wedding_target_date").notNull().default("2030-01-01"),
  weddingDays: text("wedding_days"), // JSON [{ key, label }] — jours retenus (null = les 3 par défaut)
  kidsMaxCert: text("kids_max_cert").notNull().default("U"), // certification FR max pour les enfants
  anthropicApiKey: text("anthropic_api_key"), // clé API Claude chiffrée (AES-GCM, cf. lib/crypto)
  lunchflowApiKey: text("lunchflow_api_key"), // clé API LunchFlow chiffrée (AES-GCM, cf. lib/crypto)
  primApiKey: text("prim_api_key"), // clé API PRIM Île-de-France Mobilités chiffrée
  primJeton: text("prim_jeton"), // jeton PRIM chiffré
  tmdbApiKey: text("tmdb_api_key"), // clé API TMDB chiffrée
  expenseCategories: text("expense_categories"), // JSON [{ key, name, icon, hidden }] (null = défauts)
  defaultPacking: text("default_packing"), // JSON ["Passeport", …] injecté à la création d'un voyage
  excludedIngredients: text("excluded_ingredients"), // JSON string[] — jamais dans les idées repas
  defaultAccountId: text("default_account_id"), // compte proposé par défaut (transactions)
  defaultMenuOrder: text("default_menu_order"), // JSON string[] — ordre des menus par défaut (wizard)
  defaultMenuHidden: text("default_menu_hidden"), // JSON string[] — menus masqués par défaut (wizard)
  createdAt: text("created_at").notNull(),
});

export const streamingProvider = sqliteTable("streaming_provider", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  tmdbId: integer("tmdb_id").notNull(),
  name: text("name").notNull(),
  enabled: integer("enabled").notNull().default(1),
  position: integer("position").notNull().default(0),
});

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  googleSub: text("google_sub"),
  member: text("member").notNull(), // 'a' | 'b'
  menuOrder: text("menu_order"), // JSON array des clés de menu (ordre personnalisé)
  menuHidden: text("menu_hidden"), // JSON array des clés de menu masquées
  widgetPrefs: text("widget_prefs"), // JSON { order: string[]; hidden: string[] } widgets accueil
  createdAt: text("created_at").notNull(),
});

// Emails Google autorisés à se connecter (source de vérité ; remplie
// paresseusement depuis le secret ALLOWED_EMAILS au premier login).
export const allowedEmail = sqliteTable("allowed_email", {
  email: text("email").primaryKey(),
  memberSlot: text("member_slot"), // 'a' | 'b' | null (premier arrivé = a, deuxième = b)
  createdAt: text("created_at").notNull(),
});

export const googleOauthToken = sqliteTable("google_oauth_token", {
  userId: text("user_id").primaryKey(),
  refreshToken: text("refresh_token").notNull(),
  scope: text("scope"),
  updatedAt: text("updated_at").notNull(),
});

export const task = sqliteTable("task", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  parentTaskId: text("parent_task_id"),
  title: text("title").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("todo"),
  priority: integer("priority").notNull().default(2),
  position: real("position").notNull().default(0),
  dueDate: text("due_date"),
  assigneeId: text("assignee_id"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"), // date de passage à « done » (tri de l'onglet Faites)
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  name: text("name").notNull(),
  owner: text("owner").notNull(), // a | b | joint
  type: text("type").notNull().default("checking"),
  isPrimary: integer("is_primary").notNull().default(0), // compte principal de dépenses du propriétaire
  forecast: integer("forecast").notNull().default(1), // affiché dans les prévisions de trésorerie
  currentBalance: integer("current_balance").notNull().default(0),
  balanceUpdatedAt: text("balance_updated_at"),
  lunchflowAccountId: text("lunchflow_account_id"), // id externe LunchFlow associé (null = non connecté)
  lunchflowSyncedAt: text("lunchflow_synced_at"), // dernière tentative de synchro du solde (ISO)
  lunchflowError: text("lunchflow_error"), // message d'erreur de la dernière synchro (null = OK)
  lunchflowTxSyncedAt: text("lunchflow_tx_synced_at"), // dernière synchro des transactions (ISO)
});

// Transactions bancaires (source LunchFlow), stockées pour conserver l'historique
// au-delà de la fenêtre glissante (~3 mois) exposée par l'API. Enrichies via Claude.
export const bankTransaction = sqliteTable("bank_transaction", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  accountId: text("account_id").notNull(), // id du compte local
  externalId: text("external_id").notNull(), // id LunchFlow (dédoublonnage)
  amount: integer("amount").notNull(), // centimes signés
  currency: text("currency").notNull().default("EUR"),
  date: text("date").notNull(), // YYYY-MM-DD
  rawLabel: text("raw_label").notNull(), // libellé bancaire brut
  isPending: integer("is_pending").notNull().default(0),
  type: text("type"), // type de mouvement : virement_in/out, cb_in/out, retrait, autre
  merchantName: text("merchant_name"), // enrichi (Claude)
  category: text("category"), // clé de catégorie (enrichi)
  merchantWebsite: text("merchant_website"), // best-effort
  merchantAddress: text("merchant_address"), // best-effort
  enrichedAt: text("enriched_at"), // date d'enrichissement (null = à enrichir)
  createdAt: text("created_at").notNull(),
});

export const category = sqliteTable("category", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  name: text("name").notNull(),
  groupName: text("group_name").notNull(),
  kind: text("kind").notNull(), // income | expense
  color: text("color").notNull().default("#6366f1"),
});

export const transaction = sqliteTable("transaction", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  accountId: text("account_id").notNull(),
  categoryId: text("category_id"),
  label: text("label").notNull(),
  amount: integer("amount").notNull(), // signed cents
  paidBy: text("paid_by").notNull().default("joint"),
  shareA: integer("share_a").notNull().default(0),
  shareB: integer("share_b").notNull().default(0),
  date: text("date").notNull(),
  kind: text("kind").notNull().default("actual"),
  recurringId: text("recurring_id"),
  tripId: text("trip_id"), // lignes de synthèse d'un voyage (équilibrage) → id du voyage
  archived: integer("archived").notNull().default(0),
  createdBy: text("created_by").notNull(),
});

export const recurring = sqliteTable("recurring", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  categoryId: text("category_id"),
  accountId: text("account_id").notNull(),
  label: text("label").notNull(),
  amount: integer("amount").notNull(), // signed cents
  shareA: integer("share_a").notNull().default(0),
  shareB: integer("share_b").notNull().default(0),
  frequency: text("frequency").notNull().default("monthly"),
  dayOfMonth: integer("day_of_month"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  active: integer("active").notNull().default(1),
  position: real("position").notNull().default(0),
  matchNames: text("match_names"), // JSON array de motifs de nom (matching transactions bancaires)
});

export const recurringDebit = sqliteTable("recurring_debit", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  recurringId: text("recurring_id").notNull(),
  label: text("label").notNull().default(""),
  amount: integer("amount").notNull(), // signed cents, même signe que le parent
  dayOfMonth: integer("day_of_month"),
  position: real("position").notNull().default(0),
});

export const settlement = sqliteTable("settlement", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  fromUser: text("from_user").notNull(),
  toUser: text("to_user").notNull(),
  amount: integer("amount").notNull(),
  date: text("date").notNull(),
  note: text("note"),
  archived: integer("archived").notNull().default(0),
});

export const weddingBudgetItem = sqliteTable("wedding_budget_item", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  groupName: text("group_name").notNull(),
  prestataire: text("prestataire"),
  label: text("label").notNull(),
  amount: integer("amount").notNull(),
  note: text("note"),
  url: text("url"), // site du prestataire
  address: text("address"), // adresse du prestataire
  optional: integer("optional").notNull().default(0),
  done: integer("done").notNull().default(0),
  position: real("position").notNull().default(0),
});

export const weddingBudgetFile = sqliteTable("wedding_budget_file", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  budgetItemId: text("budget_item_id").notNull(),
  fileKey: text("file_key").notNull(), // clé objet R2
  fileName: text("file_name").notNull(),
  contentType: text("content_type"),
  size: integer("size").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const savingsContribution = sqliteTable("savings_contribution", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  month: text("month").notNull(), // YYYY-MM
  amountA: integer("amount_a").notNull().default(0),
  amountB: integer("amount_b").notNull().default(0),
  planned: integer("planned").notNull().default(0),
});

export const weddingPayment = sqliteTable("wedding_payment", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  budgetItemId: text("budget_item_id"),
  prestataire: text("prestataire").notNull(),
  type: text("type"),
  dueDate: text("due_date").notNull(),
  amountDue: integer("amount_due").notNull(),
  amountPaid: integer("amount_paid").notNull().default(0),
});

export const weddingTodo = sqliteTable("wedding_todo", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  description: text("description").notNull(),
  dueDate: text("due_date"),
  owner: text("owner"), // a | b | null (optionnel)
  done: integer("done").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const weddingGuest = sqliteTable("wedding_guest", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().default("famille"), // famille | amis | temoin
  ageGroup: text("age_group").notNull().default("adult"), // adult | child
  invitationStatus: text("invitation_status").notNull().default("to_send"), // faire-part (chef de famille)
  guestGroup: text("guest_group").notNull().default("vendredi"), // vendredi | samedi
  vendredi: integer("vendredi").notNull().default(0),
  samedi: integer("samedi").notNull().default(0),
  dimanche: integer("dimanche").notNull().default(0),
  archived: integer("archived").notNull().default(0),
  parentId: text("parent_id"), // famille : rattaché à l'invité principal
  address: text("address"), // rue / n° (sur le principal)
  postalCode: text("postal_code"),
  city: text("city"),
  position: real("position").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const utilityReading = sqliteTable(
  "utility_reading",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    utility: text("utility").notNull().default("electricity"),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    kwh: integer("kwh").notNull(),
  },
);

/* ---- Bien-être : objectifs personnalisables ---- */

// Catalogue d'activités d'un membre (briques des séances).
export const wellnessActivity = sqliteTable("wellness_activity", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  member: text("member").notNull(), // 'a' | 'b'
  name: text("name").notNull(),
  icon: text("icon").notNull().default("💪"),
  unit: text("unit").notNull().default("reps"), // reps | sec | min | hour
  position: integer("position").notNull().default(0),
});

// Séance = un nombre de séries + une liste d'activités (JSON [{activityId, amount}]).
export const wellnessSession = sqliteTable("wellness_session", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  member: text("member").notNull(),
  name: text("name").notNull(),
  emoji: text("emoji").notNull().default("🏋️"),
  series: integer("series").notNull().default(1),
  items: text("items").notNull().default("[]"), // JSON [{ activityId, amount }]
  position: integer("position").notNull().default(0),
});

export const wellnessGoal = sqliteTable("wellness_goal", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  member: text("member").notNull(),
  name: text("name").notNull(),
  emoji: text("emoji").notNull().default("🎯"),
  period: text("period").notNull().default("daily"), // daily | weekly | monthly
  kind: text("kind").notNull().default("todo"), // max | min | todo | nottodo
  target: integer("target"), // cible chiffrée (max/min) ; null sinon
  goalType: text("goal_type").notNull().default("simple"), // simple | sport
  sessionId: text("session_id"), // séance associée (goal_type = sport)
  days: text("days"), // JSON number[] des jours applicables ; null = tous
  position: integer("position").notNull().default(0),
});

// Saisie d'un objectif pour un jour donné (absence de ligne = non saisi).
export const wellnessLog = sqliteTable("wellness_log", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  member: text("member").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  goalId: text("goal_id").notNull(),
  value: integer("value").notNull().default(0),
  sessions: text("sessions").notNull().default("[]"), // JSON séances réalisées (snapshot)
});

/* ---- Bien-être : ancien modèle figé (conservé comme sauvegarde) ---- */

export const sportConfig = sqliteTable("sport_config", {
  member: text("member").primaryKey(), // 'a' | 'b'
  householdId: text("household_id").notNull(),
  series: integer("series").notNull().default(3),
  pompes: integer("pompes").notNull().default(2),
  gainage: integer("gainage").notNull().default(10),
  chaise: integer("chaise").notNull().default(10),
  corde: integer("corde").notNull().default(20),
});

export const sportEntry = sqliteTable("sport_entry", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  member: text("member").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  sport: integer("sport").notNull().default(0),
  boissons: integer("boissons").notNull().default(0),
  desserts: integer("desserts").notNull().default(0),
  failed: text("failed").notNull().default("[]"), // JSON string[]
  sessions: text("sessions").notNull().default("[]"), // JSON of session objects
});

export const plannedExpense = sqliteTable("planned_expense", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  amount: integer("amount").notNull(),
  date: text("date"),
  owner: text("owner").notNull().default("joint"), // a | b | joint
  purchasedAt: text("purchased_at"), // YYYY-MM-DD — renseignée = achetée
  createdAt: text("created_at").notNull(),
});

export const shoppingItem = sqliteTable("shopping_item", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  name: text("name").notNull(),
  quantity: integer("quantity").notNull().default(1),
  createdAt: text("created_at").notNull(),
});

export const shoppingFavorite = sqliteTable("shopping_favorite", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  name: text("name").notNull(),
  position: real("position").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const recipe = sqliteTable("recipe", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  title: text("title").notNull(),
  sourceUrl: text("source_url"),
  imageUrl: text("image_url"),
  servings: integer("servings").notNull().default(4),
  prepMinutes: integer("prep_minutes"), // durée de préparation
  totalMinutes: integer("total_minutes"), // durée totale (avec cuisson)
  vegetarian: integer("vegetarian").notNull().default(0),
  meat: text("meat"), // poulet|veau|porc|boeuf|agneau|canard|poisson|null
  starch: text("starch").notNull().default("aucun"), // pates|riz|patate|semoule|aucun
  vegetables: integer("vegetables").notNull().default(0),
  course: text("course").notNull().default("plat"), // entree|plat|dessert
  ingredients: text("ingredients").notNull(), // JSON array
  steps: text("steps").notNull(), // JSON array
  createdAt: text("created_at").notNull(),
});

// Idées repas générées par le LLM (onglet Courses → Idées repas).
// status : proposed (affichée) | hidden (« ne plus proposer ») | added (passée dans les recettes).
export const recipeIdea = sqliteTable("recipe_idea", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  course: text("course").notNull().default("plat"), // entree|plat|dessert
  ingredients: text("ingredients").notNull().default("[]"), // JSON string[] (principaux)
  imageUrl: text("image_url"), // photo officielle du plat (TheMealDB)
  externalId: text("external_id"), // idMeal TheMealDB (dédoublonnage ; null = ancienne idée générée)
  status: text("status").notNull().default("proposed"),
  createdAt: text("created_at").notNull(),
});

// Repas de la semaine : sélection de recettes du foyer, générée puis figée
// (partagée entre les membres jusqu'à la prochaine génération). Une ligne par foyer.
export const mealPlan = sqliteTable("meal_plan", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull().unique(),
  recipeIds: text("recipe_ids").notNull().default("[]"), // JSON string[] ordonné
  count: integer("count").notNull().default(5),
  maxPrepMinutes: integer("max_prep_minutes"),
  maxTotalMinutes: integer("max_total_minutes"),
  createdAt: text("created_at").notNull(),
});

export const chatMessage = sqliteTable("chat_message", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  model: text("model"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  userId: text("user_id"),
  createdAt: text("created_at").notNull(),
});

export const chatAction = sqliteTable("chat_action", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  messageId: text("message_id").notNull(), // message assistant qui a proposé l'action
  tool: text("tool").notNull(),
  input: text("input").notNull(), // JSON des arguments
  summary: text("summary").notNull(), // description lisible de l'action
  status: text("status").notNull().default("pending"), // pending | confirmed | cancelled
  result: text("result"), // résultat JSON après exécution
  createdAt: text("created_at").notNull(),
});

export const activityFavorite = sqliteTable("activity_favorite", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  externalId: text("external_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  city: text("city"),
  address: text("address"),
  start: text("start"),
  end: text("end"),
  dateLabel: text("date_label"),
  imageUrl: text("image_url"),
  url: text("url"),
  createdAt: text("created_at").notNull(),
});

export const filmFavorite = sqliteTable("film_favorite", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  externalId: text("external_id").notNull(), // id TMDB
  audience: text("audience").notNull(), // enfants | adultes
  title: text("title").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  providers: text("providers"), // CSV des plateformes
  year: text("year"),
  createdAt: text("created_at").notNull(),
});

export const filmSeen = sqliteTable("film_seen", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  externalId: text("external_id").notNull(),
  title: text("title"),
  audience: text("audience"),
  imageUrl: text("image_url"),
  providers: text("providers"), // JSON [{name, logo}]
  year: text("year"),
  createdAt: text("created_at").notNull(),
});

export const filmHidden = sqliteTable("film_hidden", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  externalId: text("external_id").notNull(),
  audience: text("audience"),
  title: text("title"),
  imageUrl: text("image_url"),
  providers: text("providers"),
  year: text("year"),
  createdAt: text("created_at").notNull(),
});

export const activityHidden = sqliteTable("activity_hidden", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  externalId: text("external_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  city: text("city"),
  address: text("address"),
  start: text("start"),
  end: text("end"),
  dateLabel: text("date_label"),
  imageUrl: text("image_url"),
  url: text("url"),
  createdAt: text("created_at").notNull(),
});

export const followedCity = sqliteTable("followed_city", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});

// Flux RSS d'événements suivis pour l'onglet Activités (agendas municipaux
// non présents sur OpenAgenda, ex. WordPress `/evenement/feed/`).
export const activityFeed = sqliteTable("activity_feed", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  name: text("name").notNull(), // libellé affiché comme ville sur les cartes
  url: text("url").notNull(),
  createdAt: text("created_at").notNull(),
});

export const weatherCity = sqliteTable("weather_city", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  name: text("name").notNull(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  position: real("position").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const transitLine = sqliteTable("transit_line", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  lineCode: text("line_code").notNull(), // code API trafic (H, C, 14…)
  label: text("label").notNull(),
  color: text("color").notNull(),
  stationA: text("station_a").notNull(),
  stationB: text("station_b").notNull(),
  kind: text("kind").notNull().default("principal"), // principal | secondary
  position: real("position").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const trip = sqliteTable("trip", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  name: text("name").notNull(),
  startDate: text("start_date"),
  endDate: text("end_date"),
  budget: integer("budget"), // budget total du voyage en centimes (null = non défini)
  archived: integer("archived").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const tripItem = sqliteTable("trip_item", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  tripId: text("trip_id").notNull(),
  type: text("type").notNull(), // transport | lodging | activity
  mode: text("mode"), // transport : voiture|train|avion|bateau
  title: text("title"),
  fromPlace: text("from_place"),
  toPlace: text("to_place"),
  address: text("address"),
  url: text("url"),
  description: text("description"),
  startAt: text("start_at"), // ISO datetime (ou date)
  endAt: text("end_at"),
  fileKey: text("file_key"),
  fileName: text("file_name"),
  createdAt: text("created_at").notNull(),
});

// Affaires à prendre pour un voyage (todo-liste cochable, onglet valise).
export const tripPackingItem = sqliteTable("trip_packing_item", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  tripId: text("trip_id").notNull(),
  label: text("label").notNull(),
  category: text("category").notNull().default("autre"), // cf. PACKING_CATEGORIES
  person: text("person").notNull().default("famille"), // cf. PACKING_PERSONS
  checked: integer("checked").notNull().default(0),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

// Dépenses sur place d'un voyage (montant + parts, comme une transaction).
export const tripExpense = sqliteTable("trip_expense", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  tripId: text("trip_id").notNull(),
  label: text("label").notNull(),
  amount: integer("amount").notNull(), // centimes signés (négatif = dépense)
  paidBy: text("paid_by").notNull(), // a | b
  shareA: integer("share_a").notNull().default(0),
  shareB: integer("share_b").notNull().default(0),
  date: text("date").notNull(),
  category: text("category"), // nourriture|transport|loisirs|cadeaux|divers (null = aucune)
  pushedAt: text("pushed_at"), // date d'ajout à l'équilibrage (null = pas encore)
  createdAt: text("created_at").notNull(),
});

// WishList : souhaits du foyer (commun / a / b), à faire ou réalisés.
export const wish = sqliteTable("wish", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  owner: text("owner").notNull(), // commun | a | b
  name: text("name").notNull(),
  icon: text("icon"), // emoji choisi dans WISH_ICONS
  description: text("description"),
  url: text("url"),
  address: text("address"),
  date: text("date"), // date souhaitée
  feasibility: text("feasibility"), // easy | doable | hard
  starred: integer("starred").notNull().default(0), // mis en avant (remonte en haut de sa liste)
  doneAt: text("done_at"), // date de réalisation (null = à faire)
  createdAt: text("created_at").notNull(),
});

/** Listes libres du menu « Listes » : partagées au foyer ou personnelles. */
export const customList = sqliteTable("custom_list", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  scope: text("scope").notNull(), // shared | personal
  ownerId: text("owner_id"), // user.id quand scope = personal, null si partagée
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const customListItem = sqliteTable("custom_list_item", {
  id: text("id").primaryKey(),
  listId: text("list_id").notNull(),
  label: text("label").notNull(),
  done: integer("done").notNull().default(0),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export type DbUser = typeof user.$inferSelect;
export type DbHousehold = typeof household.$inferSelect;
