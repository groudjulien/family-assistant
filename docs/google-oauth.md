# Google OAuth — pas à pas

L'application s'authentifie exclusivement via Google (pas de mot de passe), et
l'agenda utilise l'API Google Calendar. Il te faut un projet Google Cloud avec
un ID client OAuth. Compter ~10 minutes.

## 1. Créer le projet

1. Ouvre [console.cloud.google.com](https://console.cloud.google.com/) et crée
   un projet (ex. `family-assistant`).
2. Menu **APIs & Services → Library** : recherche **Google Calendar API** et
   active-la.

## 2. Écran de consentement

1. **APIs & Services → OAuth consent screen**.
2. Type **External**, renseigne le nom de l'app et ton email.
3. Scopes utilisés (ajoutés automatiquement à la demande d'autorisation) :
   - `openid`, `email`, `profile`
   - `https://www.googleapis.com/auth/calendar`
4. Ajoute les 2 comptes Google du foyer comme **utilisateurs de test** — c'est
   suffisant : inutile de faire vérifier l'app par Google pour un usage à deux.

> En statut « Testing », Google expire les refresh tokens au bout de 7 jours ;
> passe l'app en « In production » (bouton *Publish app*) pour éviter d'avoir à
> reconnecter l'agenda chaque semaine. Aucune vérification n'est requise tant
> que l'app n'est pas distribuée largement.

## 3. ID client OAuth

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Type **Web application**.
3. **Authorized redirect URIs** — ajoute les deux :
   - `https://<ton-worker>.workers.dev/auth/google/callback` (prod)
   - `http://localhost:8787/auth/google/callback` (dev local)
4. Récupère le **Client ID** et le **Client Secret**.

## 4. Les fournir à l'application

- **Installation guidée** : `./scripts/setup.sh` te les demande et les pose en
  secrets Wrangler.
- **Manuellement** :

  ```bash
  cd apps/api
  wrangler secret put GOOGLE_CLIENT_ID
  wrangler secret put GOOGLE_CLIENT_SECRET
  ```

- **Dev local** : dans `apps/api/.dev.vars` (copie de `.dev.vars.example`).

La variable publique `GOOGLE_REDIRECT_URI` (dans `apps/api/wrangler.toml`) doit
correspondre exactement à l'URI déclarée côté Google.
