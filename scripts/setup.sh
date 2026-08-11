#!/usr/bin/env bash
# Installation guidée d'une nouvelle instance (Cloudflare Workers + D1 + R2 + Pages).
# Usage : ./scripts/setup.sh   (depuis la racine du repo, après `pnpm install`)
#
# Le script crée les ressources Cloudflare, pose les secrets, déploie, puis
# affiche l'URL du wizard web (/setup?token=…) qui finit la configuration.
set -euo pipefail
cd "$(dirname "$0")/.."

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ask() { # ask "Question" VAR default
  local q="$1" var="$2" def="${3:-}" v
  if [ -n "$def" ]; then read -r -p "$q [$def] : " v; v="${v:-$def}"; else
    while true; do read -r -p "$q : " v; [ -n "$v" ] && break; done
  fi
  printf -v "$var" '%s' "$v"
}

command -v pnpm >/dev/null || { echo "✗ pnpm est requis (https://pnpm.io)"; exit 1; }
[ -d node_modules ] || { echo "▶ pnpm install…"; pnpm install; }

WRANGLER="pnpm --dir apps/api exec wrangler"

bold "── 1/8 · Compte Cloudflare"
if ! $WRANGLER whoami >/dev/null 2>&1; then
  echo "Connexion à Cloudflare (une fenêtre de navigateur va s'ouvrir)…"
  $WRANGLER login
fi
$WRANGLER whoami | head -5 || true

bold "── 2/8 · Noms des ressources"
ask "Nom du Worker API" WORKER_NAME "family-assistant-api"
ask "Nom de la base D1" DB_NAME "family-assistant-db"
ask "Nom du bucket R2" BUCKET_NAME "family-assistant-files"
ask "Nom du projet Cloudflare Pages" PAGES_PROJECT "family-assistant"
ask "Nom affiché de l'application" APP_DISPLAY_NAME "Family Assistant"

bold "── 3/8 · Création de la base D1"
if [ -f apps/api/wrangler.toml ]; then
  echo "⚠ apps/api/wrangler.toml existe déjà — il ne sera PAS écrasé."
  DB_ID=$(grep -m1 'database_id' apps/api/wrangler.toml | sed 's/.*"\(.*\)".*/\1/')
  echo "  database_id actuel : $DB_ID"
else
  CREATE_OUT=$($WRANGLER d1 create "$DB_NAME" 2>&1) || { echo "$CREATE_OUT"; exit 1; }
  DB_ID=$(echo "$CREATE_OUT" | grep -o '[0-9a-f]\{8\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{12\}' | head -1)
  [ -n "$DB_ID" ] || { echo "✗ database_id introuvable dans la sortie de wrangler :"; echo "$CREATE_OUT"; exit 1; }
  echo "  ✓ D1 « $DB_NAME » créée (id $DB_ID)"

  bold "── 3b · Bucket R2"
  $WRANGLER r2 bucket create "$BUCKET_NAME" >/dev/null 2>&1 && echo "  ✓ R2 « $BUCKET_NAME » créé" \
    || echo "  (bucket déjà existant ou création impossible — vérifie que R2 est activé sur ton compte)"

  bold "── 3c · Écriture de apps/api/wrangler.toml"
  WORKERS_SUBDOMAIN=$($WRANGLER whoami 2>/dev/null | grep -o '[a-z0-9-]*\.workers\.dev' | head -1 || true)
  API_HOST="${WORKER_NAME}.${WORKERS_SUBDOMAIN:-VOTRE-SOUS-DOMAINE.workers.dev}"
  sed -e "s/^name = .*/name = \"$WORKER_NAME\"/" \
      -e "s/database_name = .*/database_name = \"$DB_NAME\"/" \
      -e "s/database_id = .*/database_id = \"$DB_ID\"/" \
      -e "s/bucket_name = .*/bucket_name = \"$BUCKET_NAME\"/" \
      -e "s|https://REMPLACER_PROJET.pages.dev|https://${PAGES_PROJECT}.pages.dev|" \
      -e "s|https://REMPLACER_WORKER.workers.dev|https://${API_HOST}|g" \
      apps/api/wrangler.toml.example > apps/api/wrangler.toml
  echo "  ✓ apps/api/wrangler.toml écrit (API : https://${API_HOST})"
fi
API_URL=$(grep -m1 '^API_URL' apps/api/wrangler.toml | sed 's/.*"\(.*\)".*/\1/')

bold "── 4/8 · Google OAuth"
cat <<EOF
Crée un ID client OAuth sur https://console.cloud.google.com/apis/credentials :
  1. « Créer des identifiants » → « ID client OAuth » → type « Application Web ».
  2. URI de redirection autorisée : ${API_URL}/auth/google/callback
  3. Active l'API « Google Calendar » (APIs & Services → Library).
     Scopes utilisés : openid email profile https://www.googleapis.com/auth/calendar
EOF
ask "GOOGLE_CLIENT_ID" GOOGLE_CLIENT_ID
ask "GOOGLE_CLIENT_SECRET" GOOGLE_CLIENT_SECRET

bold "── 5/8 · Secrets (SESSION_SECRET + SETUP_TOKEN générés)"
SESSION_SECRET=$(openssl rand -hex 32)
SETUP_TOKEN=$(openssl rand -hex 24)
printf '%s' "$GOOGLE_CLIENT_ID"     | $WRANGLER secret put GOOGLE_CLIENT_ID
printf '%s' "$GOOGLE_CLIENT_SECRET" | $WRANGLER secret put GOOGLE_CLIENT_SECRET
printf '%s' "$SESSION_SECRET"       | $WRANGLER secret put SESSION_SECRET
printf '%s' "$SETUP_TOKEN"          | $WRANGLER secret put SETUP_TOKEN
echo "  ✓ 4 secrets posés (les clés API optionnelles se configurent dans le wizard)"

bold "── 6/8 · Migrations D1 (remote)"
pnpm --filter @gfa/api run db:migrate:remote

bold "── 7/8 · Config de déploiement (scripts/deploy.env)"
if [ ! -f scripts/deploy.env ]; then
  cat > scripts/deploy.env <<EOF
# Config de déploiement de CETTE instance (gitignorée).
# Le fichier est sourcé par bash : valeurs avec espaces entre guillemets.
VITE_API_URL=${API_URL}
CF_PAGES_PROJECT=${PAGES_PROJECT}
VITE_APP_NAME="${APP_DISPLAY_NAME}"
EOF
  echo "  ✓ scripts/deploy.env écrit"
else
  echo "  (scripts/deploy.env existe déjà — conservé)"
fi

bold "── 8/8 · Déploiement (API + front)"
bash scripts/deploy.sh

APP_URL=$(grep -m1 '^APP_URL' apps/api/wrangler.toml | sed 's/.*"\(.*\)".*/\1/')
echo
bold "🎉 Installation déployée !"
echo
echo "Termine la configuration dans ton navigateur (foyer, membres, comptes, clés API) :"
echo
bold "    ${APP_URL}/setup?token=${SETUP_TOKEN}"
echo
echo "Ce lien ne fonctionne qu'une fois (tant qu'aucun foyer n'existe en base)."
