# Migrations D1

> Certaines migrations historiques (0002, 0003, 0017, 0020, 0027, 0062, 0063)
> contenaient des données ou conversions propres au foyer d'origine : elles ont
> été **vidées ou réduites à leur partie structurelle** avant publication.
> C'était sans risque : wrangler suit les migrations par **nom de fichier**,
> jamais rejouées une fois appliquées — et sur une installation neuve, le
> schéma initial crée directement les colonnes génériques, le wizard `/setup`
> fournissant les données.

Fichiers SQL numérotés appliqués par `wrangler d1 migrations apply` (suivi par
**nom de fichier** dans la table `d1_migrations`).

## Conventions

- Une migration = un fichier `NNNN_nom.sql`, numéro strictement croissant.
- Jamais de `DROP COLUMN` ni de renommage de fichier déjà appliqué en
  production : uniquement `ADD`, `RENAME COLUMN`, `UPDATE` de backfill,
  `CREATE TABLE`. Les colonnes devenues inutiles restent en place.
- Avant de créer une migration, vérifier le dernier numéro utilisé **et**
  l'absence de doublon (`ls migrations/ | sort`).

## ⚠️ Doublons historiques (à ne pas corriger)

Deux numéros ont été utilisés deux fois par le passé :

- `0047_planned_expense_owner.sql` et `0047_wedding_budget_vendor.sql`
- `0057_menu_hidden.sql` et `0057_recipe_course.sql`

Wrangler suivant les migrations par **nom de fichier complet**, ces doublons
sont inoffensifs — mais **ne pas renommer ces fichiers** (ils sont enregistrés
sous ces noms dans `d1_migrations` en production ; un renommage les ferait
rejouer). Reprendre simplement la numérotation au premier numéro libre.
