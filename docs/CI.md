# Intégration continue — ce qu'elle garantit, et ce qu'elle ne garantit pas

`.github/workflows/ci.yml` s'exécute à chaque poussée, sur chaque branche, et
sur chaque *pull request*.

Avant lui, ce dépôt comptait six cent soixante et un tests, quatre migrations et
deux gardes statiques — et **rien ne les exécutait**. Chaque garantie tenait à ce
que quelqu'un pense à lancer les commandes. Une garantie qui dépend d'une mémoire
humaine n'en est pas une.

## Ce qu'elle exécute

| Étape | Commande | Ce qu'elle attrape |
|---|---|---|
| Client Prisma | `npm run generate -w @cbd/db` | Aucun `postinstall` ne l'engendre : sans cette étape, le typecheck échoue sur des types absents |
| Migrations | `npm run migrate:deploy -w @cbd/db` | Une dérive entre le schéma et les migrations. N'en crée aucune, n'en modifie aucune |
| Typecheck | `npm run typecheck` | Ce que Vitest ne voit pas : il transpile sans vérifier les types |
| Lint | `npm run lint` | ESLint 9, `recommendedTypeChecked` |
| Tests | `npm test` | Les 704, **y compris les 43 d'intégration** |
| Tests sautés | motif sur le rapport | Un run vert dont un tiers de l'intégration n'a pas tourné |

## Le point qui justifie tout le reste

Les tests d'intégration se sautent d'eux-mêmes quand `PROJET1_TEST_DATABASE_URL`
est absente — `describe.skipIf`. C'est le bon comportement **en local** :
personne ne doit monter PostgreSQL pour corriger une faute de frappe.

Sans base, la suite affiche alors :

```
Tests  661 passed | 43 skipped (704)
```

Un relecteur pressé — humain ou automatique — y lit « tout est vert ». Rien ne
dit qu'un tiers de la couverture d'intégration n'a pas tourné. **Un vert qui
ment coûte plus cher qu'un rouge**, parce qu'il donne une confiance que rien ne
soutient.

La CI monte donc un PostgreSQL 16 — même version majeure qu'en développement —
renseigne la variable, et **refuse tout run comportant le moindre test sauté**.

Cette exigence est gardée **deux fois**, délibérément :

1. **Une étape du workflow** lit le rapport de tests et échoue sur un compte de
   sautés non nul.
2. **Un test de la suite**, `apps/api/src/integration-coverage.guard.test.ts`,
   échoue en CI si `PROJET1_TEST_DATABASE_URL` est absente.

Le doublon est voulu. La première garde vit dans un fichier de workflow, qu'une
commande modifiée suffirait à contourner ; la seconde vit dans la suite
elle-même. Il faut désormais désarmer les deux, et chacune se voit en revue.

`set -o pipefail` est posé explicitement dans les étapes concernées : GitHub
Actions ne l'active pas par défaut, et sans lui le code de sortie retenu serait
celui de `tee` — une suite rouge passerait pour verte. Exactement la panne que ce
fichier existe pour supprimer.

## Ce qu'elle ne garantit pas

- **Aucune preuve juridique.** Un test vert dit qu'un mécanisme fonctionne comme
  écrit. Il ne dit rien de la conformité réglementaire d'un seuil, d'une
  catégorie ou d'une substance. Les décisions ouvertes restent ouvertes ; voir
  `TO_VERIFY.md`.
- **Aucune qualification de prestataire.** La CI n'atteint aucun PSP, aucun
  acquéreur, aucun réseau cartes. `PSP-REGISTRE.md` reste la seule source.
- **Aucune couverture des applications front.** `apps/admin`, `apps/client`,
  `apps/shop` et `packages/ui` n'ont ni `package.json` ni code ; `npm test
  --workspaces --if-present` les saute sans bruit. Cette absence est connue.
- **Aucune vérification de l'exécution réelle en production.** Il n'existe pas
  encore de serveur HTTP : `apps/api/src/http/contract.ts` décrit un contrat que
  rien ne sert.
- **Aucune mesure de couverture de code.** Volontairement : un pourcentage de
  lignes couvertes se maximise sans améliorer une seule garantie.

## Exécuter localement ce que la CI exécute

```sh
npm run typecheck
npm run lint
npm test                       # 43 tests d'intégration sautés, sans base

# Avec une base jetable — la suite complète :
PROJET1_TEST_DATABASE_URL="postgresql://user:pass@localhost:5432/base_jetable" \
  npm test
```

Voir `INTEGRATION-POSTGRESQL.md` pour monter cette base. La variable est
distincte de `DATABASE_URL` à dessein : les tests d'intégration écrivent et
effacent, et ne doivent jamais pouvoir atteindre une base de travail.

## Ce que la CI ne fait pas, et ne doit pas faire

Elle ne déploie rien, ne publie rien, ne pousse aucun commit et ne touche à
aucune branche. Ses permissions sont réduites à `contents: read`. Elle vérifie,
et s'arrête là.
