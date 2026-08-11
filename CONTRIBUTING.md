# Contribuer

Merci de ton intérêt ! Ce projet est un assistant familial auto-hébergé,
maintenu sur du temps personnel — les contributions sont bienvenues, en gardant
en tête sa philosophie.

## Philosophie

- **Un foyer de deux personnes.** Le modèle a/b + « joint » est structurel ;
  les PRs qui généralisent à N membres ou ajoutent des rôles/permissions ne
  seront probablement pas retenues.
- **UI en français**, code et identifiants en anglais. Les libellés visibles
  (boutons, messages, placeholders) s'écrivent en français.
- **Cohérence avant tout** : une nouvelle vue doit ressembler aux vues
  existantes (primitives de `ui.tsx`, classes maison `.card`/`.btn`/`.input`,
  motifs mobile documentés dans [CLAUDE.md](CLAUDE.md)).
- **Free tier Cloudflare** : pas de dépendance qui impose une offre payante.

## Démarrer

```bash
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars   # remplis au moins Google OAuth
pnpm db:migrate:local
pnpm dev            # API :8787 + front :5173
```

## Avant d'ouvrir une PR

1. `pnpm typecheck` doit passer (les 3 packages).
2. `pnpm --filter @gfa/web build` doit passer.
3. Pas de runner de tests : décris **comment tu as vérifié manuellement** dans
   la description de la PR.
4. Migration D1 = fichier **numéroté** dans `apps/api/migrations/` (jamais de
   `DROP COLUMN`, jamais renommer un fichier déjà appliqué — voir
   `apps/api/migrations/README.md`).
5. Un schéma de validation vit dans `packages/shared` (Zod), jamais dupliqué
   côté API ou front.
6. Aucun secret, URL d'instance ou donnée personnelle dans le code ou les
   migrations — la CI fait tourner un scan gitleaks.

## Signaler un bug

Ouvre une issue avec : ce que tu faisais, ce qui était attendu, ce qui s'est
passé, et si possible la sortie de `wrangler tail` (API) ou de la console
navigateur (front).
