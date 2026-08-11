# CLAUDE.md — Family Assistant

Guide de travail pour ce dépôt. Assistant de foyer auto-hébergé (TypeScript de bout en bout) pour deux membres : tâches, agenda Google, dépenses partagées, courses, voyages, chat Claude.

Setup infra & installation : [`README.md`](./README.md) · Contribution : [`CONTRIBUTING.md`](./CONTRIBUTING.md).

> **L'UI est en français.** Tout texte visible (labels, boutons, messages, placeholders) s'écrit en français. Le code, les commentaires techniques et les identifiants restent en anglais/kebab-case.

---

## Stack & infra

| Couche | Techno | Hébergement |
|---|---|---|
| Front | Vite + React 18 + TypeScript + Tailwind + TanStack Query | Cloudflare **Pages** |
| API | Hono (TypeScript) | Cloudflare **Workers** |
| Base | SQLite via Drizzle ORM | Cloudflare **D1** (binding `DB`) |
| Fichiers | Voyages, photos de recettes | Cloudflare **R2** (binding `FILES`) |
| Auth | Google OAuth + allowlist + cookie de session | — |
| Chat | API Anthropic (Claude) | — |

Monorepo **pnpm** (`pnpm@9`), 2 apps + 1 package partagé :

```
apps/web        # front React              → @gfa/web
apps/api        # Worker Hono + D1 + R2    → @gfa/api
packages/shared # schémas Zod + types      → @gfa/shared  (source de vérité des types)
scripts/setup.sh   # installation guidée · scripts/deploy.sh (pnpm release) · docs/
```

---

## Commandes

Toujours lancer depuis la **racine** (pnpm résout les workspaces).

```bash
pnpm dev                 # API (:8787) + Web (:5173) en parallèle
pnpm dev:web             # front seul
pnpm dev:api             # worker seul (wrangler dev)

pnpm typecheck           # tsc --noEmit sur les 3 packages (à lancer avant de finir)
pnpm --filter @gfa/web build      # build front (inclut tsc)

# Base de données (D1)
pnpm db:generate         # drizzle-kit generate (génère une migration depuis le schéma)
pnpm db:migrate:local    # applique les migrations sur la D1 locale
pnpm db:migrate:remote   # applique en prod

pnpm release             # scripts/deploy.sh : migrate remote → build → deploy API → deploy Pages
./scripts/setup.sh       # installation guidée d'une NOUVELLE instance (D1, R2, secrets, wizard /setup)
```

Le front lit `VITE_API_URL` (défaut `http://localhost:8787`).

### Vérification attendue après une modif

`pnpm typecheck` doit passer. Pour le front uniquement : `npx tsc --noEmit -p apps/web/tsconfig.json`. Pas de runner de tests dans ce repo : on valide par le typecheck + (si demandé) un essai manuel via `pnpm dev`.

---

## Backend (`apps/api`)

- **Entrée** : [`src/index.ts`](apps/api/src/index.ts) — monte une route Hono par domaine. Tout `/api/*` passe par `requireSameOrigin` (CSRF) puis `requireAuth`.
- **Middlewares** : [`src/middleware/auth.ts`](apps/api/src/middleware/auth.ts)
  - `withDb` injecte Drizzle → `c.get("db")`.
  - `requireAuth` charge l'utilisateur et le foyer → `c.get("user")`, `c.get("household")`.
  - `requireSameOrigin` bloque les requêtes mutantes dont l'`Origin` ≠ `APP_URL`.
- **Contexte typé** : `AppContext` dans [`src/lib/types.ts`](apps/api/src/lib/types.ts) (`Bindings: Env`, `Variables: { db, user, household }`).
- **Validation** : `parseBody(c, schema)` ([`src/lib/validate.ts`](apps/api/src/lib/validate.ts)) parse le JSON avec un **schéma Zod importé de `@gfa/shared`**. Ne jamais redéfinir un schéma de validation côté API : il vit dans `packages/shared`.
- **Schéma DB** : [`src/db/schema.ts`](apps/api/src/db/schema.ts) (Drizzle `sqliteTable`).

### Pattern d'une route protégée

```ts
const router = new Hono<AppContext>();
router.patch("/:id", async (c) => {
  const body = await parseBody(c, updateThingSchema);   // zod de @gfa/shared
  await c.get("db").update(thing).set(body).where(eq(thing.id, c.req.param("id")));
  return c.json({ ok: true });
});
export default router;
```

### Migrations D1

Fichiers SQL **numérotés** dans `apps/api/migrations/` : `NNNN_nom.sql` (la dernière en date fait foi — incrémenter le numéro). Wrangler suit l'état dans la table `d1_migrations`.

Pour ajouter une colonne :
1. Éditer `apps/api/src/db/schema.ts`.
2. Créer `apps/api/migrations/NNNN_nom.sql` (ex. `ALTER TABLE user ADD COLUMN x TEXT;`).
3. `pnpm db:migrate:local` (puis `:remote` au déploiement).

Les colonnes « config » riches sont stockées en **TEXT JSON** (ex. `user.menu_order`, `user.widget_prefs`) et parsées défensivement.

### Secrets / vars

- Vars publiques : `apps/api/wrangler.toml` (`APP_URL`, `API_URL`, `GOOGLE_REDIRECT_URI`).
- Secrets (jamais commit) : `wrangler secret put …` (`GOOGLE_CLIENT_ID/SECRET`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`, `ALLOWED_EMAILS`). En local : `apps/api/.dev.vars`.
- **Allowlist** : la source de vérité est la table `allowed_email` (email + `member_slot` a|b), gérée dans Réglages → Membres du foyer (`GET /api/household/access`, `PUT /api/household/access/person`). Le secret `ALLOWED_EMAILS` reste accepté en repli et est importé en base au premier login (`ensureAllowlist`) ; format `email` ou `slot:email` (slot = `a`|`b`, anciens préfixes acceptés).
- **Bootstrap** : pas de foyer en base = état `setup_required` (401 propre, redirection login) — le foyer est créé par le wizard d'installation, jamais implicitement.

---

## Frontend (`apps/web`)

- **Routing** : [`src/App.tsx`](apps/web/src/App.tsx) — React Router. Pages dans `src/pages/`, une par module (Dashboard, Tasks, Calendar, Money, Wedding, Courses, Tools, Sport, Chat, Settings).
- **Shell** : [`src/components/Layout.tsx`](apps/web/src/components/Layout.tsx) — sidebar (≥ `md`) / menu hamburger (< `md`). `NAV` y est défini ; `orderedNav(me.menuOrder)` applique l'ordre perso.
- **Appels API** : [`src/lib/api.ts`](apps/web/src/lib/api.ts) — `api.get/post/put/patch/del`, `credentials: "include"`, lève `ApiError(status, message)`. Ne jamais `fetch` à la main.
- **Données** : **TanStack Query** partout. Clé = tableau (`["tasks"]`, `["me"]`, `["dashboard"]`, `["members"]`…). Après mutation : `qc.invalidateQueries({ queryKey: [...] })`.
- **Utilisateur courant** : `useMe()` ([`src/auth.tsx`](apps/web/src/auth.tsx)) renvoie `Me` (id, member `a|b`, avatarUrl, household + config des membres, prefs perso). La query est `["me"]` — l'invalider après avoir changé une préférence.
- **Types** : importés de `@gfa/shared` (jamais redéclarés côté front).

### Composants UI réutilisables — [`src/components/ui.tsx`](apps/web/src/components/ui.tsx)

`Select`, `SearchSelect`, `Checkbox`, `SubNav`, `Input`, `DateInput`, `TimeInput`, `DateTimeInput`, `DateRangeCalendar`. **Réutiliser ces primitives** avant d'en écrire une nouvelle. Un nouveau motif réutilisé ≥ 2 fois → l'extraire (dans `ui.tsx` si générique, sinon en composant local de la page).

Composants partagés dédiés (hors `ui.tsx`) :
- [`components/MemberAvatar.tsx`](apps/web/src/components/MemberAvatar.tsx) — `MemberAvatar` (photo Google d'un membre, repli sur pastille initiale) + `useMembers`.
- [`components/Indicator.tsx`](apps/web/src/components/Indicator.tsx) — carte KPI : `label` (1re ligne) + `value` en bas à droite (2e ligne), `tone` (`default`/`green`/`orange`/`red`), `money` (centimes → euros). À utiliser pour tous les indicateurs/stats.

### Drag & drop — `@dnd-kit`

Motif standard : `DndContext` (`PointerSensor`, `activationConstraint: { distance: 5 }`) + `SortableContext` (`verticalListSortingStrategy`) + `useSortable` par item ; `onDragEnd` calcule `arrayMove(ids, from, to)` et appelle un endpoint `…/reorder` qui renumérote `position`. Sur mobile, gérer `touch-action` (cf. règles ci-dessous).

Pour toute **liste réordonnable**, en plus du drag & drop (poignée `⠿`, masquée sur mobile via `hidden sm:block`), fournir des **flèches ↑ / ↓** en bout de ligne (désactivées en début/fin de liste) pour réordonner au clic — indispensable car le D&D ne marche pas bien au tactile. Motif de référence : `SortableMenuItem` + `MenuOrderCard` dans [`Settings.tsx`](apps/web/src/pages/Settings.tsx) (fonction `move(index, dir)` → `arrayMove` → mutation `…/reorder`).

### Sous-menus / onglets (RÈGLE)

Tout **sous-menu (onglet) DOIT être une URL distincte** et non un simple `useState`, afin d'être partageable et mémorisé. Motif de référence (Money, Wedding, Courses, Tools, Settings) :

1. Route paramétrée dans [`App.tsx`](apps/web/src/App.tsx) : `<Route path="/xxx" …/>` **et** `<Route path="/xxx/:tab" …/>` (ou `:section`, `:view`, `:member`…).
2. La page lit l'onglet via `useParams()` (avec repli sur l'onglet par défaut si absent/invalide) et change d'onglet via `navigate("/xxx/<tab>")` (pas de state local).
3. Le **dernier sous-menu visité est mémorisé automatiquement** par `useLastPaths` dans [`Layout.tsx`](apps/web/src/components/Layout.tsx) (localStorage, clé `nav:lastPaths`) : `linkFor(base)` renvoie la dernière sous-page visitée de la section. Ne pas ré-implémenter cette mémoire.
4. **Mémoire du dernier sous-menu (OBLIGATOIRE pour tout nouveau menu/sous-menu)** : `useLastPaths` ne couvre que la navigation par la sidebar. Pour qu'un retour sur un onglet retombe sur le dernier sous-menu visité (ex. Courses → Idées repas → « Repas de la semaine »), les sous-menus **imbriqués** (niveau 2) utilisent le hook [`useLastView`](apps/web/src/lib/lastView.ts) : `const sub = useLastView("section:onglet", ["a", "b"], "a", viewParam, "/section/onglet")`. Il mémorise en localStorage (`nav:lastView:<clé>`), restaure quand l'URL n'a pas de sous-chemin, et réaligne l'URL en `replace`. Motif de référence : `IdeasTab` dans [`Courses.tsx`](apps/web/src/pages/Courses.tsx).

À chaque ajout de menus ou de sous-menus, appliquer ces quatre points — la mémoire du dernier menu/sous-menu visité n'est pas optionnelle.

---

## Style & couleurs (RÈGLES)

**Cohérence avant tout : une nouvelle vue doit ressembler aux vues existantes.** Réutiliser les classes utilitaires maison plutôt que d'inventer des styles.

- **Classes maison** ([`src/index.css`](apps/web/src/index.css)) : `.card`, `.btn` / `.btn-primary` / `.btn-ghost`, `.input`, `.subtabs` / `.subtab`. Utiliser celles-là pour cartes, boutons, champs et onglets.
  - Les `.btn*` sont dans **`@layer components`** : les utilitaires les surchargent normalement (`hidden`, `md:hidden`, `rounded-full`, `flex`, `text-xs`…). On peut donc faire `btn-primary md:hidden` (FAB) ou `btn-primary hidden md:inline-flex` directement. ⚠️ `.card`, `.input`, `.subtab` ne sont **pas** dans un layer (définis après `@tailwind utilities`) : un utilitaire de même spécificité **ne les surcharge pas** → les envelopper dans un élément neutre (`<div className="hidden md:block">`) ou utiliser un style inline.
- **Couleur primaire** = vert **brand** (`#5b8a4e`). Palette Tailwind `brand.{50,100,500,600,700}` ([`tailwind.config.js`](apps/web/tailwind.config.js)). Ne pas coder de vert en dur : `bg-brand-600`, `text-brand-700`, etc. Variable CSS `--primary` pour le hors-Tailwind.
- **Dark mode** : `darkMode: "class"`. Toujours fournir les variantes `dark:` (ex. `bg-white dark:bg-slate-900`, `border-slate-200 dark:border-slate-800`).
- **Typo** : titres en `Fraunces` (serif, `font-sans`/`font-serif`), monospace `JetBrains Mono` pour les onglets/labels techniques.
- **Police d'icônes** : pas de librairie d'icônes. Utiliser des **SVG inline** (stroke `currentColor`) pour un rendu net et centré — pas de glyphe texte (`+`, `i`) seul dans un bouton rond.
- **Responsive** : la frontière mobile/desktop de l'app est le breakpoint **`md`** (la sidebar apparaît à `md`). Aligner les bascules « mobile vs ordinateur » sur `md:` pour rester cohérent.

### Motifs mobile (RÈGLES)

- **Bouton de création** : sur mobile, **toujours** un bouton flottant rond avec une icône **`+`** (SVG inline) en **bas à droite** de l'écran qui ouvre une **modale**. Sur ordinateur, garder le bouton/formulaire inline en haut.
  - FAB : `fixed bottom-6 right-6 z-30 … h-14 w-14 rounded-full md:hidden` (z-30 pour passer **sous** le menu hamburger en `z-40`).
  - Conteneur de page : ajouter `pb-24 md:pb-0` pour que la dernière ligne reste visible au scroll au-dessus du FAB.
- **Modale alignée en haut** : toute modale doit être **alignée en haut** de l'écran sur mobile (la place du clavier) et centrée sur ordinateur : `fixed inset-0 … flex items-start justify-center overflow-y-auto … sm:items-center`.
- **Filtres repliés** : sur mobile, masquer les filtres derrière un **bouton « Filtres »** (icône entonnoir) qui les déplie ; sur ordinateur les afficher inline (`md:flex`). Indiquer un filtre actif (ex. `ring-1 ring-brand-500`).
- **Éviter la marge fantôme de `space-y`** : quand le premier enfant est masqué en mobile (`hidden md:block`), `space-y-*` lui applique quand même une marge (`:not([hidden])` ne voit pas la classe `hidden`). Utiliser **`flex flex-col gap-*`** sur le conteneur (le `gap` ignore les enfants `display:none`).

### ⚠️ Piège de spécificité dark mode

`.card` applique `dark:border-slate-800`, qui compile en `.dark .card { … }` — un sélecteur **à 2 classes** qui **bat** une classe utilitaire simple (`border-l-red-500`) en mode sombre. Pour forcer une couleur de bordure/accent sur une `.card` en dark, utiliser un **style inline** (`style={{ borderLeftColor: … }}`) plutôt qu'une classe utilitaire.

---

## Préférences par utilisateur (pattern à réutiliser)

Pour toute config personnelle (ordre de menus, ordre/visibilité de widgets…) :

1. **Colonne** TEXT JSON sur `user` (`apps/api/src/db/schema.ts`) + migration.
2. **Champ** ajouté à `meSchema` + schéma de mutation dédié dans `packages/shared/src/index.ts`.
3. **`/me`** ([`apps/api/src/routes/auth.ts`](apps/api/src/routes/auth.ts)) renvoie la valeur parsée défensivement.
4. **Endpoint** `PATCH /api/household/<truc>` ([`routes/household.ts`](apps/api/src/routes/household.ts)) qui `JSON.stringify` dans la colonne.
5. **Front** : lire via `useMe()`, muter avec `api.patch`, puis `invalidateQueries(["me"])`.

Exemples en place : `menuOrder` (ordre des menus) et `widgetPrefs` (`{ order, hidden }` des widgets d'accueil).

---

## Ajouter une fonctionnalité (checklist)

1. **Type & validation** dans `packages/shared` (schéma Zod → type inféré).
2. **DB** : colonne/table + migration numérotée si persistance.
3. **API** : route Hono dans `apps/api/src/routes/`, montée dans `src/index.ts`, validée par `parseBody`.
4. **Front** : page/composant, données via TanStack Query + `api`, UI avec les primitives `ui.tsx` et les classes maison.
5. `pnpm typecheck` vert.

## Membres du foyer

Deux **slots techniques** : `a` et `b` (constante `MEMBERS` dans `@gfa/shared`). Les prénoms et couleurs d'affichage sont de la **config foyer** (`household.member_a_name`, `member_b_color`…), exposée via `useMe().household.members` (`{ a: { name, color }, b: { … } }`) et modifiable dans Réglages (« Membres du foyer », endpoint `PATCH /api/household/members-config`). Ne jamais coder un prénom en dur : toujours passer par cette config (`usePersonMeta()` / `useMembers()` dans [`MemberAvatar.tsx`](apps/web/src/components/MemberAvatar.tsx)). Les personnes supplémentaires (listes de valise) vivent dans `household.extra_persons` (JSON `[{id,name,color}]`, hook `usePackingPersons()`). Avatar = photo Google (`user.avatarUrl`, via `/api/household/members`) avec repli sur une pastille initiale colorée (couleur de la config).
