#!/usr/bin/env bash
# Déploiement complet sur Cloudflare (API Worker + base D1 + front Pages).
# Usage : pnpm release
#
# Configuration par instance (jamais committée) : scripts/deploy.env, ou
# variables d'environnement. Variables :
#   VITE_API_URL       (requis)  URL publique du Worker API
#   CF_PAGES_PROJECT   (requis)  Nom du projet Cloudflare Pages
#   VITE_APP_NAME      (option)  Nom affiché de l'app (défaut : Family Assistant)
set -euo pipefail
cd "$(dirname "$0")/.."

# Charge la config locale si présente (gitignorée).
if [ -f scripts/deploy.env ]; then
  # shellcheck disable=SC1091
  set -a; source scripts/deploy.env; set +a
fi

if [ -z "${VITE_API_URL:-}" ] || [ -z "${CF_PAGES_PROJECT:-}" ]; then
  echo "✗ Configuration manquante." >&2
  echo "  Renseignez VITE_API_URL et CF_PAGES_PROJECT (env ou scripts/deploy.env) :" >&2
  echo "    VITE_API_URL=https://mon-api.workers.dev" >&2
  echo "    CF_PAGES_PROJECT=mon-projet-pages" >&2
  exit 1
fi

echo "▶ 1/4  Migrations D1 (remote)…"
pnpm --filter @gfa/api run db:migrate:remote

echo "▶ 2/4  Build (shared + web)…"
pnpm --filter @gfa/shared run build
pnpm --filter @gfa/web run build

echo "▶ 3/4  Déploiement de l'API (Worker)…"
pnpm --filter @gfa/api run deploy

echo "▶ 4/4  Déploiement du front (Pages)…"
pnpm --filter @gfa/web run deploy

echo "✅ Déploiement terminé. API: $VITE_API_URL — Pages: $CF_PAGES_PROJECT"
