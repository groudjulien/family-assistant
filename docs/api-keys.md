# Clés API optionnelles

Chaque clé est **facultative** : sans elle, la fonctionnalité correspondante est
simplement absente. Toutes se configurent :

- dans le **wizard d'installation** (`/setup`, chaque étape est skippable) ;
- ou plus tard dans **Réglages → Paramètre** (stockées chiffrées AES-GCM en base) ;
- ou en secret Wrangler global (repli si rien n'est configuré par le foyer).

| Clé | Débloque | Secret (repli) |
|---|---|---|
| Claude (Anthropic) | Chat de l'assistant, import de recettes par IA, remplissage de voyage depuis les emails | `ANTHROPIC_API_KEY` |
| LunchFlow | Synchronisation automatique des soldes et transactions bancaires | `LUNCHFLOW_API_KEY` |
| PRIM Île-de-France | Trafic et horaires des transports (**Île-de-France uniquement**) | `PRIM_IDF_MOBILITE_API` + `PRIM_JETON` |
| TMDB | Suggestions de films et disponibilité streaming | `TMDB_API_KEY` |

## Claude (Anthropic)

1. Crée un compte sur [platform.claude.com](https://platform.claude.com/).
2. **Settings → API keys → Create key** (`sk-ant-…`).
3. L'usage est facturé au jeton ; pour un foyer, quelques euros par mois suffisent
   largement (le chat affiche le suivi de consommation).

## LunchFlow

1. Compte sur [lunchflow.app](https://lunchflow.app/), connecte tes banques.
2. Crée une clé API depuis le tableau de bord.
3. Dans l'app : Argent → Comptes bancaires → associe chaque compte LunchFlow à
   un compte local.

## PRIM (Île-de-France Mobilités)

1. Compte sur [prim.iledefrance-mobilites.fr](https://prim.iledefrance-mobilites.fr/).
2. « Mes jetons d'authentification » → génère une **clé API** (le **jeton** est
   optionnel — certains flux temps réel le demandent).
3. Gratuit dans les quotas par défaut, largement suffisants pour un foyer.

## TMDB (The Movie Database)

1. Compte sur [themoviedb.org](https://www.themoviedb.org/) →
   [Settings → API](https://www.themoviedb.org/settings/api).
2. Utilise la **clé API v3** (pas le Read Access Token v4).
3. Gratuit pour un usage personnel.
