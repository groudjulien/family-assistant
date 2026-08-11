# Mettre à jour son instance

Ton instance est un déploiement Cloudflare qui t'appartient : les mises à jour
se font en tirant le code puis en redéployant. Tes données (base D1, fichiers
R2, secrets) ne sont jamais touchées par une mise à jour du code.

```bash
git pull
pnpm install          # au cas où les dépendances ont changé
pnpm release          # migrations D1 (remote) → build → deploy API → deploy front
```

`pnpm release` applique automatiquement les **nouvelles migrations** de base de
données avant de déployer — l'API et le front partent ensemble, il n'y a pas
d'état intermédiaire incohérent.

## Bon à savoir

- Les migrations sont **additives** (jamais de suppression de colonne) : revenir
  en arrière sur le code reste possible sans casser la base.
- Ta config locale n'est pas versionnée et survit aux `git pull` :
  `apps/api/wrangler.toml`, `scripts/deploy.env`, `apps/web/.env.local`,
  `apps/api/.dev.vars`.
- Vérifie [CHANGELOG / releases GitHub] pour les changements notables avant une
  grosse mise à jour.

## En cas de problème

- Logs de l'API en direct : `cd apps/api && pnpm exec wrangler tail`.
- État des migrations : `cd apps/api && pnpm exec wrangler d1 migrations list <ta-db> --remote`.
- Le front affiche sa version dans Réglages (en bas de page).
