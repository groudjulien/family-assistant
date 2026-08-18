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
                #   src/groceries.ts — catalogue produits (emoji + rayon), lu par le front ET l'API
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
- **Shell** : [`src/components/Layout.tsx`](apps/web/src/components/Layout.tsx) — sidebar (≥ `md`) / drawer hamburger (< `md`), tous deux rendus par le **même** composant `NavList` : un menu ne peut pas diverger entre mobile et ordinateur. `NAV` y est défini (sans icône : elle est résolue depuis `to` par `NavIcon`) ; `orderedNav(me.menuOrder, me.menuHidden)` applique l'ordre et les masquages perso, puis `groupNav(items, me.menuGroups)` découpe en **groupes titrés**.
  - Un **groupe** est une entrée `sep:<id>` dans `menuOrder` ; son nom vit dans `me.menuGroups` (`{ "sep:x7k": "Au quotidien" }`) et se modifie dans Réglages → Menus de navigation. Un groupe titre les menus **placés en dessous de lui** et disparaît s'il ne lui reste aucun menu visible.
  - **Indicateurs de bout de menu** : `GET /api/badges` ([`routes/badges.ts`](apps/api/src/routes/badges.ts)) renvoie `{ tasks, courses, moneyCents, weddingDays }` pour l'utilisateur connecté ; rendu par `NavBadge`. Cet endpoint est appelé depuis **toutes** les pages : y ajouter un compteur signifie l'ajouter au chemin critique du shell — pas de synchro bancaire, pas d'appel externe.
- **Appels API** : [`src/lib/api.ts`](apps/web/src/lib/api.ts) — `api.get/post/put/patch/del`, `credentials: "include"`, lève `ApiError(status, message)`. Ne jamais `fetch` à la main.
- **Données** : **TanStack Query** partout. Clé = tableau (`["tasks"]`, `["me"]`, `["dashboard"]`, `["members"]`…). Après mutation : `qc.invalidateQueries({ queryKey: [...] })`.
- **Utilisateur courant** : `useMe()` ([`src/auth.tsx`](apps/web/src/auth.tsx)) renvoie `Me` (id, member `a|b`, avatarUrl, household + config des membres, prefs perso). La query est `["me"]` — l'invalider après avoir changé une préférence.
- **Types** : importés de `@gfa/shared` (jamais redéclarés côté front).

### Composants UI réutilisables — [`src/components/ui.tsx`](apps/web/src/components/ui.tsx)

`Select`, `SearchSelect`, `Checkbox`, `Switch`, `SubNav`, `FilterChips`, `SearchField`, `OverflowMenu`, `MobileActionBar`, `Input`, `DateInput`, `TimeInput`, `DateTimeInput`, `DateRangeCalendar`. **Réutiliser ces primitives** avant d'en écrire une nouvelle. Un nouveau motif réutilisé ≥ 2 fois → l'extraire (dans `ui.tsx` si générique, sinon en composant local de la page).

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
3. **Rendu** : onglets soulignés, en casse normale, défilants horizontalement quand ils débordent. Plus de `<Select>` sur mobile (il cachait les autres onglets), et **pas d'icône** dans un onglet.
   - **Sur mobile, les onglets vivent dans la barre du haut** : la page appelle `usePageTabs(value, items, onChange)` et rend son `SubNav` en `hidden md:block` pour l'ordinateur. Le sous-menu se lit alors comme appartenant à la page, le filet du bas de la barre est celui des onglets (un seul trait), et la page gagne une rangée.
   - `SubNav` reste utilisable en direct pour une rangée de filtres ou un popover : lui passer alors `bleed={false}` (il n'est pas un bloc pleine largeur de la page).
4. Le **dernier sous-menu visité est mémorisé automatiquement** par `useLastPaths` dans [`Layout.tsx`](apps/web/src/components/Layout.tsx) (localStorage, clé `nav:lastPaths`) : `linkFor(base)` renvoie la dernière sous-page visitée de la section. Ne pas ré-implémenter cette mémoire.
5. **Mémoire du dernier sous-menu (OBLIGATOIRE pour tout nouveau menu/sous-menu)** : `useLastPaths` ne couvre que la navigation par la sidebar. Pour qu'un retour sur un onglet retombe sur le dernier sous-menu visité (ex. Courses → Idées repas → « Repas de la semaine »), les sous-menus **imbriqués** (niveau 2) utilisent le hook [`useLastView`](apps/web/src/lib/lastView.ts) : `const sub = useLastView("section:onglet", ["a", "b"], "a", viewParam, "/section/onglet")`. Il mémorise en localStorage (`nav:lastView:<clé>`), restaure quand l'URL n'a pas de sous-chemin, et réaligne l'URL en `replace`. Motif de référence : `IdeasTab` dans [`Courses.tsx`](apps/web/src/pages/Courses.tsx).

À chaque ajout de menus ou de sous-menus, appliquer ces cinq points — la mémoire du dernier menu/sous-menu visité n'est pas optionnelle.

---

## Style & couleurs (RÈGLES)

**Cohérence avant tout : une nouvelle vue doit ressembler aux vues existantes.** Réutiliser les classes utilitaires maison plutôt que d'inventer des styles.

- **Classes maison** ([`src/index.css`](apps/web/src/index.css)) : `.card`, `.btn` / `.btn-primary` / `.btn-ghost`, `.input`, `.subtabs` / `.subtab`. Utiliser celles-là pour cartes, boutons, champs et onglets.
  - Les `.btn*` sont dans **`@layer components`** : les utilitaires les surchargent normalement (`hidden`, `md:hidden`, `rounded-full`, `flex`, `text-xs`…). On peut donc faire `btn-primary md:hidden` (FAB) ou `btn-primary hidden md:inline-flex` directement. ⚠️ `.card`, `.input`, `.subtab` ne sont **pas** dans un layer (définis après `@tailwind utilities`) : un utilitaire de même spécificité **ne les surcharge pas** → les envelopper dans un élément neutre (`<div className="hidden md:block">`) ou utiliser un style inline.
### Couleurs — tokens (RÈGLE)

**La source de vérité est le bloc de tokens en tête de [`index.css`](apps/web/src/index.css)** (`:root` + `.dark`), exposé en utilitaires par [`tailwind.config.js`](apps/web/tailwind.config.js). **Ne jamais écrire une couleur d'UI en dur** (`#…`, `bg-[#…]`) : si le token manque, on l'ajoute ici.

| Rôle | Utilitaire | Clair | Sombre |
|---|---|---|---|
| Fond de page | `var(--paper)` | `#F5F4F0` | `#0B1219` |
| Carte | `bg-surface` | `#FFFFFF` | `#131E2A` |
| Surface élevée (tuile, hover) | `bg-surface-2` | `#F1EFEA` | `#1B2836` |
| Texte principal | `text-ink` | `#16202B` | `#F2F5F8` |
| Texte secondaire | `text-ink-2` / `text-slate-400` | `#5B6570` | `#A7B4C2` |
| Bordure | `border-line` | `#E2E7EC` | `#22303F` |
| Action | `bg-brand-600` | `#2F6F47` | `#5FB574` |
| Texte **sur** un aplat vert | `text-on-brand` | blanc | `#08120B` |
| Argent qui sort | `text-danger` | `#B3261E` | `#F08A82` |
| Attention | `text-warning` | `#8A6416` | `#E3B341` |
| Info | `text-info` | `#2A5DA8` | `#8AB4F8` |

- **Un token suit déjà le thème** : `bg-surface` n'a **pas** besoin de `dark:` — c'est tout l'intérêt. Ne remettre une variante `dark:` que sur les classes Tailwind natives (`bg-white dark:bg-slate-900`) encore présentes dans les pages historiques.
- **`text-white` sur du vert est interdit** : en sombre le vert est clair, le texte doit être `text-on-brand`.
- **Rôle des couleurs** : le vert dit « cliquable », pas « montant positif ». Rouge / ambre / bleu ne servent qu'aux **données** (`danger` / `warning` / `info`).
- **`slate` est repointé** sur la rampe neutre du design (`slate-950` = fond sombre → `slate-100` = texte clair) : les usages historiques `dark:bg-slate-900`, `text-slate-400`… restent valides. `slate-400` et `slate-500` suivent le thème (elles portent le texte secondaire, presque toujours écrit sans `dark:`).
- **Dark mode** : `darkMode: "class"`, **sombre par défaut** (`lib/theme.ts`).

### Typo, échelle et icônes (RÈGLE)

- **Police** : `Instrument Sans` partout (`font-sans` *et* `font-serif`), auto-hébergée en variable (`public/fonts/`, `src/fonts.css`) ; `JetBrains Mono` réservée aux étiquettes techniques (`.eyebrow`) — **pas aux onglets**, qui sont des noms de page en casse normale. **Pas de serif** : illisible sur une liste de 60 lignes et sur les chiffres.
- **Échelle à 6 tailles, plancher 13 px** ([`tailwind.config.js`](apps/web/tailwind.config.js)) : `text-3xl` 27 (titre) · `text-xl` 20 (sous-titre) · `text-base` 16 (ligne de liste) · `text-sm` 14 (secondaire) · `text-xs` 13 (méta) · `text-2xs` 11 (étiquette majuscules **uniquement**). Ne pas écrire de taille arbitraire (`text-[10px]`).
- **Chiffres tabulaires** : appliqués globalement sur `body`. Rien à faire par vue.
- **Cibles tactiles** : 44 px minimum (`h-tap` / `w-tap` / `min-h-tap`), 8 px d'écart, jamais collé au bord.
- **Icônes** : jeu de trait maison dans [`components/icons.tsx`](apps/web/src/components/icons.tsx) (24 px, `stroke-width` 1.85, `currentColor`). **Pas de librairie d'icônes, pas d'emoji dans un bouton d'action** — l'emoji est réservé au *contenu* (un plat, un film, un lieu). `NavIcon to="/money"` résout l'icône d'une section depuis son chemin.
- **Responsive** : la frontière mobile/desktop de l'app est le breakpoint **`md`** (la sidebar apparaît à `md`). Aligner les bascules « mobile vs ordinateur » sur `md:` pour rester cohérent.

### Motifs mobile (RÈGLES)

Motif de référence complet : [`Tasks.tsx`](apps/web/src/pages/Tasks.tsx) (rendu mobile et rendu ordinateur séparés, mutations partagées par `useTaskMutations`).

- **Titre de page (OBLIGATOIRE)** : chaque page appelle `usePageHeader("Tâches", "3 en cours · 1 aujourd'hui")` ([`PageHeader.tsx`](apps/web/src/components/PageHeader.tsx)). La barre mobile porte alors le titre de la page et **un indicateur qui apprend quelque chose**, au lieu du nom de l'app. Sans appel, elle retombe sur le nom de l'app.
  - L'appel se fait dans le composant **de plus haut niveau réellement monté** pour l'onglet courant, et **avant tout `return` conditionnel** (c'est un hook). Quand un parent et un enfant l'appellent tous les deux, c'est le **parent** qui gagne (les effets remontent) — ne le poser qu'à un seul endroit par onglet.
  - Compteurs déjà agrégés : `useNavBadges()` ([`lib/badges.ts`](apps/web/src/lib/badges.ts)) lit le cache `["nav-badges"]` déjà chargé par le menu — gratuit pour « reste à vivre » (Argent) et le compte à rebours (Mariage).
  - Un **emoji de contenu** (une liste, un plat) se passe en 3ᵉ argument : `usePageHeader(list.name, eyebrow, list.emoji)`. Il est rendu à part, avant le titre — jamais concaténé dans la chaîne (les emojis n'ont pas de chasse latérale).
- **Sous-page (ouvrir un enregistrement)** : quand une ligne d'index ouvre un écran dédié (une liste dans Listes), la page appelle **`usePageChrome(backTo, actions)`** en plus de `usePageHeader`. La barre du haut échange alors le hamburger contre un **retour** et l'avatar contre le **« ⋯ »** de la page ; elle déclare aussi des onglets **vides** (`usePageTabs(tab, [], …)`) pour que la rangée d'onglets disparaisse. Motif de référence : `ListDetail` dans [`Listes.tsx`](apps/web/src/pages/Listes.tsx).
  - L'URL reste le 3ᵉ segment de la section (`/listes/partagees/<id>`) : partageable, et le retour du navigateur remonte à l'index.
  - Ce segment est un **identifiant**, pas un sous-menu : rien à mémoriser avec `useLastView`, et il est tronqué par `memorablePath` dans [`Layout.tsx`](apps/web/src/components/Layout.tsx) (`RECORD_TABS`) pour que la sidebar ne rouvre pas un enregistrement — voire un enregistrement supprimé.
- **Hub de section** : quand une section a beaucoup d'onglets, son accueil mobile (`/money`) est un **sommaire chiffré** — un chiffre-héros, puis une rangée par onglet (icône, nom, ce qu'il contient, son chiffre, chevron), groupée par `.eyebrow`. La rangée d'onglets disparaît alors du mobile (`usePageTabs` n'est plus appelé) et chaque onglet devient une sous-page avec retour vers le hub. Sur ordinateur, rien ne change : le `SubNav` reste et `/money` ouvre son premier onglet. Motif de référence : `MoneyHub` dans [`Money.tsx`](apps/web/src/pages/Money.tsx).
  - Le hub charge **un seul** endpoint de sommaire (`GET /api/money/summary`), pas les six requêtes des onglets qu'il résume — et pas non plus un ajout à `/api/badges`, qui est sur le chemin critique de toutes les pages.
  - La section est ajoutée à `FLAT_SECTIONS` ([`Layout.tsx`](apps/web/src/components/Layout.tsx)) : le menu doit retomber sur le sommaire, pas sur le dernier onglet visité.
  - Un onglet peut à son tour porter des **sous-onglets** dans la barre (`usePageTabs` depuis l'onglet, `useLastView` pour la mémoire) : retour + titre + sous-onglets cohabitent. Motif : `Tresorerie` dans [`Money.tsx`](apps/web/src/pages/Money.tsx) (`Virements` / `Reste à vivre`).
  - Quand un **enfant** prend l'écran et déclare le titre, le parent passe `null` à `usePageHeader` : sans ça il écraserait le titre de l'enfant (les effets du parent s'exécutent après). Motif : `Repas` → `RecipeDetail`.
  - **Pas d'état initial déduit du viewport** (`useState(!useIsMobile())`) : la première mesure peut tomber avant la mise en page et rester fausse. Choisir une valeur par défaut identique partout.
  - L'index mobile n'a **aucun bouton dans la ligne** : on entre d'une touche, on réordonne d'un **appui long** (dnd-kit, `TouchSensor` + `activationConstraint: { delay: 250, tolerance: 8 }` ; les `listeners` vont sur l'enveloppe, pas sur le `<a>`, et on laisse tomber les `attributes` qui feraient du lien un `role="button"`). Les entrées « Déplacer vers le haut / bas » du « ⋯ » de la sous-page tiennent lieu de flèches ↑/↓.
- **Action principale** : sur mobile, **`MobileActionBar`** — un bouton **libellé** pleine largeur ancré en bas (« Nouvelle tâche », pas un `+` muet), sous un dégradé. Le bouton rond est abandonné : il recouvrait une ligne réelle et disait la même chose partout. Sur ordinateur, garder le bouton inline en haut.
  - Conteneur de page : `pb-28 md:pb-0`, pour que la dernière ligne reste atteignable au-dessus de la barre.
- **Une seule action visible par ligne** : la case à cocher. Modifier / supprimer / partager vivent dans **`OverflowMenu`** (le « ⋯ » de fin de ligne). Jamais une action destructive collée à une case à cocher, et toute action irréversible porte un **libellé texte**.
  - Quand les actions portent sur un **objet identifiable** (un film, un repas du menu), préférer **`ActionSheet`** : la feuille rappelle l'objet en tête (vignette + titre + méta), ses lignes ont la place d'un libellé complet et d'une phrase de conséquence (« retiré des propositions futures »). `OverflowMenu` reste le bon choix pour 2–3 actions courtes en fin de ligne.
  - ⚠️ Le menu d'`OverflowMenu` s'ouvre **dans** son conteneur : un `overflow-hidden` sur la carte parente le rogne. Porter les coins arrondis sur l'image (`rounded-t-2xl`) plutôt que sur la carte.
- **Cartes groupées** : une liste de lignes simples tient dans **une** carte à filets (`border-hairline`), pas une carte par ligne. Une ligne qui porte du détail (étapes, progression) prend sa propre carte.
- **Filtres** : **`FilterChips`** — rangée de pastilles de 42 px défilable horizontalement, verte pleine quand active. Un seul style de filtre dans l'app (plus de segment vert / pills claires / onglets soulignés pour le même rôle). Quand le filtre est un sous-menu, il pilote l'URL (cf. WishList : `/listes/wishlist/<tous|commun|a|b>`).
- **Recherche** : **`SearchField`** (icône + 48 px). Ne pas la bricoler avec `className="input pl-11"` : `.input` est hors `@layer`, son `px-3` bat le `pl-11` et l'icône passe sous le texte.
- **Sections de liste** : une étiquette `.eyebrow` au-dessus de chaque carte (« PRIORITÉS », « FRAIS · 8 »), plutôt qu'un titre à l'intérieur — l'œil balaie la colonne des étiquettes.
- **Modale alignée en haut** : toute modale doit être **alignée en haut** de l'écran sur mobile (la place du clavier) et centrée sur ordinateur : `fixed inset-0 … flex items-start justify-center overflow-y-auto … sm:items-center`.
- **États vides** : une phrase courte **et** un bouton (« Aucune tâche pour l'instant. » + « Ajouter la première »), jamais un simple constat.
- **Pas de mode d'emploi dans l'UI** : si un encart doit expliquer des icônes, c'est l'icône qui est fausse (`GestureHelp` est en voie de retrait).
- **Éviter la marge fantôme de `space-y`** : quand le premier enfant est masqué en mobile (`hidden md:block`), `space-y-*` lui applique quand même une marge (`:not([hidden])` ne voit pas la classe `hidden`). Utiliser **`flex flex-col gap-*`** sur le conteneur (le `gap` ignore les enfants `display:none`).

### ⚠️ Piège de spécificité sur `.card`

`.card` est défini **hors `@layer`** (après `@tailwind utilities`) : à spécificité égale il gagne par ordre de source. Une classe utilitaire simple (`border-l-red-500`) posée sur une `.card` **ne la surcharge pas**. Utiliser un **style inline** (`style={{ borderLeftColor: … }}`), ou envelopper dans un élément neutre.

---

## Préférences par utilisateur (pattern à réutiliser)

Pour toute config personnelle (ordre de menus, ordre/visibilité de widgets…) :

1. **Colonne** TEXT JSON sur `user` (`apps/api/src/db/schema.ts`) + migration.
2. **Champ** ajouté à `meSchema` + schéma de mutation dédié dans `packages/shared/src/index.ts`.
3. **`/me`** ([`apps/api/src/routes/auth.ts`](apps/api/src/routes/auth.ts)) renvoie la valeur parsée défensivement.
4. **Endpoint** `PATCH /api/household/<truc>` ([`routes/household.ts`](apps/api/src/routes/household.ts)) qui `JSON.stringify` dans la colonne.
5. **Front** : lire via `useMe()`, muter avec `api.patch`, puis `invalidateQueries(["me"])`.

Exemples en place : `menuOrder` (ordre des menus), `menuGroups` (nom des groupes de menus) et `widgetPrefs` (`{ order, hidden }` des widgets d'accueil).

Même schéma pour une config **de foyer** (partagée par les deux membres), colonne sur `household` : `expenseCategories`, `shoppingCategories` (rayons de courses, Réglages → Courses).

## Liste de courses — rayons

Un article porte une clé de rayon (`shopping_item.category`). Elle est résolue **côté API**, dans `addOrIncrement` ([`routes/courses.ts`](apps/api/src/routes/courses.ts)), via `categoryFor(nom)` du catalogue partagé : tous les chemins d'ajout (saisie, liste d'une recette, import) obtiennent donc un rayon, pas seulement le formulaire. Le front peut passer un `category` explicite pour surcharger.

- Rayons par défaut : `DEFAULT_SHOPPING_CATEGORIES`. Le foyer les redéfinit dans Réglages → Courses ; l'ordre configuré est celui des sections de la page Courses (l'ordre du magasin).
- La clé `autre` (`FALLBACK_SHOPPING_CATEGORY`) accueille les produits inconnus du catalogue et les articles dont le rayon a été supprimé — elle n'est pas supprimable.
- Renommer un rayon ne déplace aucun article : la **clé** est stable, seul le `name` change.

---

## Ajouter une fonctionnalité (checklist)

1. **Type & validation** dans `packages/shared` (schéma Zod → type inféré).
2. **DB** : colonne/table + migration numérotée si persistance.
3. **API** : route Hono dans `apps/api/src/routes/`, montée dans `src/index.ts`, validée par `parseBody`.
4. **Front** : page/composant, données via TanStack Query + `api`, UI avec les primitives `ui.tsx` et les classes maison.
5. `pnpm typecheck` vert.

## Membres du foyer

Deux **slots techniques** : `a` et `b` (constante `MEMBERS` dans `@gfa/shared`). Les prénoms et couleurs d'affichage sont de la **config foyer** (`household.member_a_name`, `member_b_color`…), exposée via `useMe().household.members` (`{ a: { name, color }, b: { … } }`) et modifiable dans Réglages (« Membres du foyer », endpoint `PATCH /api/household/members-config`). Ne jamais coder un prénom en dur : toujours passer par cette config (`usePersonMeta()` / `useMembers()` dans [`MemberAvatar.tsx`](apps/web/src/components/MemberAvatar.tsx)). Les personnes supplémentaires (listes de valise) vivent dans `household.extra_persons` (JSON `[{id,name,color}]`, hook `usePackingPersons()`). Avatar = photo Google (`user.avatarUrl`, via `/api/household/members`) avec repli sur une pastille initiale colorée (couleur de la config).
