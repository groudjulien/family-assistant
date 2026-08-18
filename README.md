# Family Assistant

Assistant personnel **auto-hébergé pour un foyer de deux adultes (avec ou sans enfants)**
pour gérer l'intégralité de la maison : tâches partagées, agenda Google, dépenses et équilibrage des comptes,
trésorerie prévisionnelle, recettes & liste de courses, voyages, et un chat Claude qui
agit sur vos données.

Ce projet a d'abord été construit **pour mon propre foyer**, puis rendu
installable et personnalisable. Prenez-le comme une **première brique à
casser** plutôt qu'un produit fini : dupliquez-le, donnez-le à
[Claude Code](https://claude.com/claude-code) et re-personnalisez-le pour vos
propres usages — supprimez les modules qui ne vous parlent pas, ajoutez les
vôtres. Le [CLAUDE.md](CLAUDE.md) documente les conventions du code précisément
pour rendre cette réappropriation facile.

> **À savoir avant de cloner**
> - L'interface est **en français** (le code est en anglais).
> - Le modèle est volontairement **un couple** : deux membres aux droits égaux
>   (+ personnes supplémentaires sans compte, ex. enfants). Pas de rôles, pas
>   d'admin, pas de N-membres.
> - **Single-tenant** : un déploiement = un foyer. Il n'y a pas de cloisonnement
>   multi-comptes côté serveur — n'invitez que des personnes de confiance.
> - Certains modules sont très « sur mesure » (Mariage, Bien-être, Transports
>   Île-de-France, Électricité) : ils sont **désactivés par défaut** et
>   activables dans le wizard ou les Réglages.

## Modules

Accueil (widgets configurables) · Tâches (sous-tâches, priorités, drag & drop) ·
Agenda (Google Calendar, lecture/écriture) · Repas (recettes, import par IA,
idées repas, liste de courses) · Argent (dépenses partagées & équilibrage,
trésorerie prévisionnelle, dépenses prévues, comptes bancaires) · Activités
(sorties, films, voyages avec valise et dépenses) · Chat (Claude, avec outils
qui agissent sur le foyer) · Mariage (budget, plan d'épargne, invités) ·
Bien-être (objectifs personnalisables par membre : compteurs journaliers /
hebdomadaires / mensuels, cases à cocher, séances de sport) · Réglages.

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

| Couche | Techno | Hébergement |
|---|---|---|
| Front | Vite + React 18 + TypeScript + Tailwind + TanStack Query | Cloudflare **Pages** |
| API | Hono (TypeScript) | Cloudflare **Workers** |
| Base | SQLite via Drizzle ORM | Cloudflare **D1** |
| Fichiers | Billets de voyage, photos de recettes | Cloudflare **R2** |
| Auth | Google OAuth + allowlist + cookie de session | — |

Tout tient dans le **free tier Cloudflare** pour un usage à deux (~0 €/mois).
Seul le chat Claude consomme des crédits API Anthropic (optionnel, quelques
euros par mois).

## Installation (~30 min)

Prérequis : Node 20+, pnpm 9+, un compte [Cloudflare](https://dash.cloudflare.com/)
(gratuit, avec R2 activé), un projet Google Cloud pour l'OAuth
([guide pas-à-pas](docs/google-oauth.md)).

```bash
git clone <ce-repo> && cd family-assistant
pnpm install
./scripts/setup.sh
```

Le script crée la base D1, le bucket R2, écrit `apps/api/wrangler.toml`, te
guide pour l'OAuth Google, pose les secrets, déploie, puis affiche l'URL du
**wizard web** (`/setup?token=…`) qui termine la configuration : membres du
foyer, comptes bancaires, clés API (toutes skippables), modules, catégories de
dépenses. À la fin, tu te connectes avec ton compte Google et c'est prêt.

### Clés API optionnelles

| Clé | Débloque | Sans elle |
|---|---|---|
| [Claude (Anthropic)](docs/api-keys.md#claude-anthropic) | Chat + générations IA (recettes, voyages) | Chat désactivé |
| [LunchFlow](docs/api-keys.md#lunchflow) | Synchro automatique des soldes bancaires | Saisie manuelle des soldes |
| [PRIM](docs/api-keys.md#prim-île-de-france-mobilités) | Transports (Île-de-France uniquement) | Widget masquable |
| [TMDB](docs/api-keys.md#tmdb-the-movie-database) | Films & streaming | Onglet films vide |

Chacune se configure dans le wizard ou plus tard dans Réglages → Paramètre
(stockage chiffré en base) — détails dans [docs/api-keys.md](docs/api-keys.md).

## Structure

```
apps/web         # front React                → @gfa/web
apps/api         # Worker Hono + D1 + R2      → @gfa/api
packages/shared  # schémas Zod + types        → @gfa/shared (source de vérité)
scripts/setup.sh   # installation guidée d'une nouvelle instance
scripts/deploy.sh  # déploiement (pnpm release)
docs/              # OAuth Google, clés API, mise à jour
```

## Développement local

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars   # secrets de dev
pnpm dev          # API (:8787) + front (:5173)
pnpm typecheck    # types des 3 packages
```

La base D1 locale se migre avec `pnpm db:migrate:local`. Le front lit
`VITE_API_URL` (défaut `http://localhost:8787`) et `VITE_APP_NAME` (nom affiché,
surchageable dans `apps/web/.env.local`).

## Secrets (référence)

Posés par `setup.sh`, ou manuellement avec `wrangler secret put` depuis `apps/api` :

| Secret | Rôle |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth Google ([guide](docs/google-oauth.md)) |
| `SESSION_SECRET` | Signe les sessions + chiffre les clés API en base |
| `SETUP_TOKEN` | Jeton du wizard `/setup` (inerte une fois le foyer créé) |
| `ALLOWED_EMAILS` | Amorçage de l'allowlist (`a:email,b:email`) — ensuite gérée dans Réglages |
| `ANTHROPIC_API_KEY`, `LUNCHFLOW_API_KEY`, `PRIM_IDF_MOBILITE_API`, `PRIM_JETON`, `TMDB_API_KEY` | Replis globaux des [clés optionnelles](docs/api-keys.md) |

## Mise à jour

```bash
git pull && pnpm install && pnpm release
```

Les migrations sont appliquées automatiquement — détails dans
[docs/update.md](docs/update.md).

## Contribuer

Les issues et PRs sont bienvenues — voir [CONTRIBUTING.md](CONTRIBUTING.md).
Conventions de code : [CLAUDE.md](CLAUDE.md) (le repo est pensé pour être
travaillé avec Claude Code, mais rien ne l'impose).

## Licence

[MIT](LICENSE)
