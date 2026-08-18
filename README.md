# Family Assistant

A **self-hosted personal assistant for a two-person household**: shared tasks,
Google Calendar, expenses and account settling, cash-flow forecasting, recipes &
shopping list, trips, and a Claude chat that acts on your own data.

This project was first built **for my own household**, then made installable and
customisable. Treat it as a **starting point to break apart** rather than a
finished product: fork it, hand it to
[Claude Code](https://claude.com/claude-code) and re-tailor it to your own
habits — drop the modules that mean nothing to you, add your own.
[CLAUDE.md](CLAUDE.md) documents the code conventions precisely so that
re-appropriation stays easy.

> **Before you clone**
> - The interface is **in French** (the code is in English).
> - The model is deliberately **a couple**: two members with equal rights
>   (+ extra people without an account, e.g. children). No roles, no admin, no
>   N-members.
> - **Single-tenant**: one deployment = one household. There is no multi-account
>   isolation server-side — only invite people you trust.
> - A few modules are very much **bespoke** (Wedding, Wellness, Île-de-France
>   transit, Electricity): they are **off by default** and can be enabled in the
>   wizard or in Settings.

## Modules

Thirteen modules — Home, then twelve menus — and all of them **à la carte**:
hide the ones you don't want, reorder the rest, group them under your own
headings. See [Make it yours](#make-it-yours) below. Menu labels are given in
French, as they appear in the app.

<img width="231" height="484" alt="image" src="https://github.com/user-attachments/assets/be00f5e5-44cf-4885-b564-5361ee72db84" />
<img width="230" height="480" alt="image" src="https://github.com/user-attachments/assets/bd686a8f-bfb9-46b9-aa15-4c4183564bec" />
<img width="230" height="480" alt="image" src="https://github.com/user-attachments/assets/be3a354d-f250-4547-9c11-5fd185283a0e" />
<img width="229" height="480" alt="image" src="https://github.com/user-attachments/assets/509e8f7a-8f98-4147-ac0f-41c30f5fdd18" />
<img width="231" height="485" alt="image" src="https://github.com/user-attachments/assets/e7dabe7c-bcc8-4881-b353-d9eb037b1762" />
<img width="230" height="482" alt="image" src="https://github.com/user-attachments/assets/778d5f05-9393-4ba6-adba-f9f0f610adc0" />
<img width="229" height="478" alt="image" src="https://github.com/user-attachments/assets/41c56188-f6ad-4ab6-8310-1aca36b270c6" />
<img width="230" height="480" alt="image" src="https://github.com/user-attachments/assets/1772f9ea-c295-4e9c-8a36-c43690860bdb" />
<img width="230" height="480" alt="image" src="https://github.com/user-attachments/assets/3d1f9c7e-c164-4e00-aa65-8b6ded7e3b25" />


## Stack & coût

<table><tr><td width="55%">

A wall of widgets, each member choosing which ones they see and in which order:
transit, weather, the day's agenda, open tasks, the next trip, the wedding
countdown, the shopping list, who owes whom, and the next F1 race with its news.

</td><td width="45%"><img src="docs/screenshots/accueil.png" alt="Accueil"></td></tr></table>

### Tasks *(Tâches)*

<table><tr><td width="55%">

- Subtasks, four priority levels, due date, assignee.
- Reordering by drag & drop, plus ↑/↓ arrows for touch.
- Filters: everything, mine, done.

</td><td width="45%"><img src="docs/screenshots/taches.png" alt="Tâches"></td></tr></table>

### Calendar *(Agenda)*

<table><tr><td width="55%">

- Google Calendar, read **and** write, across several calendars.
- Today, week and month views.

</td><td width="45%"><img src="docs/screenshots/agenda.png" alt="Agenda"></td></tr></table>

### Meals *(Repas)*

<table><tr><td width="55%">

- Recipes: photo (stored in R2), ingredients, steps, cook time, course type,
  meat/starch tags.
- AI import: drop a recipe URL — an Instagram or TikTok post works too — or
  paste the text, and Claude fills the recipe in. Bulk import from JSON.
- Weekly menu and a "meal ideas" pool with filters (course, meat, starch,
  ≤ 15 min…), minus the ingredients you've blacklisted.
- One tap sends a recipe's ingredients to the shopping list.

</td><td width="45%"><img src="docs/screenshots/repas.png" alt="Repas"></td></tr></table>

### Shopping *(Courses)*

<table><tr><td width="55%">

- Shared list with quantities, grouped by aisle.
- The aisle is resolved server-side from a shared product catalogue, so every
  path in (typing, a recipe, an import) lands in the right one.
- Aisles are configurable, and their order is **your** store's order.

</td><td width="45%"><img src="docs/screenshots/courses.png" alt="Courses"></td></tr></table>

### Money *(Argent)*

<table><tr><td width="55%">

Six tabs, plus a numbered summary as the mobile home of the section.

- **Expenses** — recurring charges and the household's monthly total.
- **Cash flow** — forecast balance per account, planned transfers, and what's
  left to live on.
- **Settling** — shared expenses with a split key, and who owes whom.
- **Planned** — one-off expenses to come.
- **Electricity** — meter readings, consumption and cost per month/year.
- **Bank accounts** — balances (manual, or synced via LunchFlow), transactions,
  bank-statement import.

</td><td width="45%"><img src="docs/screenshots/argent.png" alt="Argent"></td></tr></table>

### Wedding *(Mariage)*

<table><tr><td width="55%">

- **Guests** — one row per guest household (a couple, a family): presence day by
  day, invitation tracking, addresses, `.xlsx` export.
- **Todo** — tasks with an owner and a due date, grouped by urgency.
- **Vendors** — budget items grouped by category, payment schedule, and quotes
  or invoices attached (R2).
- **Savings** — a month-by-month plan, per member, against the target.

</td><td width="45%"><img src="docs/screenshots/mariage.png" alt="Mariage"></td></tr></table>

### Wellness *(Bien-être)*

<table><tr><td width="55%">

Its own space per member, and four tabs.

- Customisable goals: daily, weekly or monthly counters, or plain checkboxes —
  each member defines their own.
- Workout log with the day's activities.
- Today's view and statistics over time.

</td><td width="45%"><img src="docs/screenshots/bienetre.png" alt="Bien-être"></td></tr></table>

### Activities *(Activités)*

<table><tr><td width="55%">

- Outing suggestions over the next 30 days, with date and venue, for **the
  cities you follow** — OpenAgenda, plus your own RSS agenda feeds for the towns
  it doesn't cover.
- Three lists: shortlisted, suggestions, history (what you've ruled out).

</td><td width="45%"><img src="docs/screenshots/activites.png" alt="Activités"></td></tr></table>

### Films

<table><tr><td width="55%">

- TMDB search: poster, synopsis, runtime, age rating.
- Suggestions restricted to **the streaming services you actually pay for**,
  with a deep link into the right one (Netflix, Disney+, Prime Video, Canal+,
  Apple TV, Max, Paramount+, OCS, Crunchyroll, arte.tv).
- Three lists: to watch, suggestions, history.

</td><td width="45%"><img src="docs/screenshots/films.png" alt="Films"></td></tr></table>

### Trips *(Vacances)*

<table><tr><td width="55%">

- One trip = an itinerary (transport, lodging, activities), a packing list and a
  budget.
- The packing list is per person, including people without an account, and is
  pre-filled from your own default list.
- Tickets and documents attached (R2). Past trips get archived.

</td><td width="45%"><img src="docs/screenshots/vacances.png" alt="Vacances"></td></tr></table>

### Lists *(Listes)*

<table><tr><td width="55%">

- Personal lists and shared lists, each with its own emoji and drag & drop.
- A wishlist filterable by who it's for.

</td><td width="45%"><img src="docs/screenshots/listes.png" alt="Listes"></td></tr></table>

### Chat

<table><tr><td width="55%">

- Claude, with tools that **read and write** household data: tasks, shopping
  list, recipes, trips, wedding todos and guests, money settings.
- Optional web search.

</td><td width="45%"><img src="docs/screenshots/chat.png" alt="Chat"></td></tr></table>

## Make it yours

Two households don't want the same app. Almost nothing here is hard-coded —
what follows is configured from **Settings**, not from the source.

### The menu is yours

<table><tr><td width="55%">

- **Hide what you don't use.** Every entry can be switched off; the bespoke
  modules (Wedding, Wellness, Île-de-France transit, Electricity) start off.
- **Order them** by drag & drop, or with ↑/↓ arrows on touch.
- **Group them** under headings you name yourself — "Every day", "Money",
  "Later".
- All three are **per member**: you and your partner can have completely
  different menus over the same data.

The home widgets follow the same rule: each member picks which ones show and in
what order.

</td><td width="45%"><img src="docs/screenshots/reglages-menus.png" alt="Réglages — menus"></td></tr></table>

### Your cities, your tastes

<table><tr><td width="55%">

- **Weather cities** — as many as you want, in your own order (Paris by
  default).
- **Activity cities** — the towns whose listings you want to see, plus extra
  RSS agenda feeds for the ones OpenAgenda doesn't cover.
- **Transit** — your lines and your two stations (Île-de-France).
- **Streaming services** — tick only the ones you subscribe to; film
  suggestions follow.
- **Blacklisted ingredients** — meal ideas stop suggesting what you won't eat.
- **Shopping aisles** — rename them and put them in the order of your own
  supermarket.
- **Expense categories**, **default packing list**, **split key** between the
  two members.
- **Household members** — names, colours, avatars, plus extra people without an
  account (children) who still appear in packing lists.
- **Appearance** — light or dark.

</td><td width="45%"><img src="docs/screenshots/reglages-villes.png" alt="Réglages — villes et goûts"></td></tr></table>

### Settings *(Réglages)*

Seven tabs — General, Money, Home, Activities, Shopping, Meals, Parameters —
holding everything above, plus the sign-in allowlist and the API keys.

## Stack & cost

| Layer | Tech | Hosting |
|---|---|---|
| Frontend | Vite + React 18 + TypeScript + Tailwind + TanStack Query | Cloudflare **Pages** |
| API | Hono (TypeScript) | Cloudflare **Workers** |
| Database | SQLite via Drizzle ORM | Cloudflare **D1** |
| Files | Travel tickets, recipe photos | Cloudflare **R2** |
| Auth | Google OAuth + allowlist + session cookie | — |

Everything fits in the **Cloudflare free tier** for two people (~€0/month).
Only the Claude chat consumes Anthropic API credits (optional, a few euros a
month).

## Installation (~30 min)

Requirements: Node 20+, pnpm 9+, a [Cloudflare](https://dash.cloudflare.com/)
account (free, with R2 enabled), and a Google Cloud project for OAuth
([step-by-step guide](docs/google-oauth.md)).

```bash
git clone <this-repo> && cd family-assistant
pnpm install
./scripts/setup.sh
```

The script creates the D1 database and the R2 bucket, writes
`apps/api/wrangler.toml`, walks you through Google OAuth, sets the secrets,
deploys, then prints the URL of the **web wizard** (`/setup?token=…`) that
finishes the configuration: household members, bank accounts, API keys (all
skippable), modules, expense categories. At the end you sign in with your Google
account and you're ready.

### Optional API keys

| Key | Unlocks | Without it |
|---|---|---|
| [Claude (Anthropic)](docs/api-keys.md#claude-anthropic) | Chat + AI generation (recipes, trips) | Chat disabled |
| [LunchFlow](docs/api-keys.md#lunchflow) | Automatic bank balance sync | Balances entered by hand |
| [PRIM](docs/api-keys.md#prim-île-de-france-mobilités) | Transit (Île-de-France only) | Widget can be hidden |
| [TMDB](docs/api-keys.md#tmdb-the-movie-database) | Films & streaming | Empty films tab |

Each one is set in the wizard or later in Settings → Parameters (stored
encrypted in the database) — details in [docs/api-keys.md](docs/api-keys.md).

## Structure

```
apps/web         # React frontend            → @gfa/web
apps/api         # Hono Worker + D1 + R2     → @gfa/api
packages/shared  # Zod schemas + types       → @gfa/shared (source of truth)
scripts/setup.sh   # guided install of a new instance
scripts/deploy.sh  # deployment (pnpm release)
docs/              # Google OAuth, API keys, updating
```

## Local development

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars   # dev secrets
pnpm dev          # API (:8787) + frontend (:5173)
pnpm typecheck    # types across the 3 packages
```

Migrate the local D1 database with `pnpm db:migrate:local`. The frontend reads
`VITE_API_URL` (defaults to `http://localhost:8787`) and `VITE_APP_NAME` (the
displayed name, overridable in `apps/web/.env.local`).

## Secrets (reference)

Set by `setup.sh`, or by hand with `wrangler secret put` from `apps/api`:

| Secret | Role |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth ([guide](docs/google-oauth.md)) |
| `SESSION_SECRET` | Signs sessions + encrypts API keys in the database |
| `SETUP_TOKEN` | Token for the `/setup` wizard (inert once the household exists) |
| `ALLOWED_EMAILS` | Seeds the allowlist (`a:email,b:email`) — managed in Settings afterwards |
| `ANTHROPIC_API_KEY`, `LUNCHFLOW_API_KEY`, `PRIM_IDF_MOBILITE_API`, `PRIM_JETON`, `TMDB_API_KEY` | Global fallbacks for the [optional keys](docs/api-keys.md) |

## Updating

```bash
git pull && pnpm install && pnpm release
```

Migrations are applied automatically — details in
[docs/update.md](docs/update.md).

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Code
conventions: [CLAUDE.md](CLAUDE.md) (the repo is meant to be worked on with
Claude Code, but nothing forces it).

## Licence

[MIT](LICENSE)
