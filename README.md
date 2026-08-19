# Plateforme de livraison CBD

Marketplace et infrastructure de livraison pour **CBD shops physiques**. Les
shops existent déjà : la plateforme leur apporte une présence numérique, un
système de commande, un QR d'acquisition et un réseau de coursiers. Elle ne les
remplace pas.

```
SHOP PHYSIQUE → QR CODE → CLIENT → COMMANDE → SHOP → COURSIER → LIVRAISON
```

> **Note temporaire sur le dépôt.** Ce projet occupe pour l'instant une branche
> d'un dépôt qui héberge par ailleurs un projet sans rapport (un convertisseur
> vidéo, relié à Lovable et en production). Ce projet-là vit sur `main` et n'est
> pas affecté : cette branche a simplement été vidée de ses fichiers.
>
> **Ne pas fusionner cette branche dans `main`** — cela supprimerait le
> convertisseur de `main`, et Lovable répercuterait la suppression sur
> l'application en ligne. La branche est destinée à devenir son propre dépôt.

## État du projet

Phase 1 en cours — **socle métier**. Ce qui existe aujourd'hui :

- `packages/domain` — les règles métier, testées
- `packages/config` — validation de la configuration, qui refuse de démarrer si elle est incomplète
- `packages/db` — schéma Prisma complet, validé
- `apps/api` — authentification, contrôle d'accès, service de commande
- `docs/` — architecture, modèle économique, conformité, RGPD, propriété intellectuelle, décisions ouvertes

**140 tests, typecheck propre.** Les interfaces (`apps/client`, `shop`,
`courier`, `admin`) restent des emplacements réservés.

## Démarrer

```sh
npm install
npm test          # 140 tests, tous les paquets
npm run typecheck
```

```sh
cd packages/db
npm install
DATABASE_URL="postgresql://…" npx prisma validate
```

## Structure

```
apps/
  client/   interface client
  shop/     back-office commerçant
  courier/  application coursier
  admin/    back-office plateforme
  api/      API centrale — seul écrivain de la base
packages/
  domain/   règles métier pures — aucune dépendance framework
  db/       schéma Prisma
  ui/       design system partagé
  config/   config TypeScript / lint partagée
docs/
```

## Les deux invariants

**`Inventory` est le pivot du catalogue, pas `Product`.** Prix et stock
appartiennent à un point de vente précis, jamais au catalogue global. Un produit
n'est jamais présenté comme disponible parce qu'il existe quelque part.

**Les transitions de commande sont contrôlées côté serveur.** Chaque changement
de statut passe par `assertTransition(from, to, actor)`, qui vérifie la
transition *et* le droit de l'acteur. Aucune app front n'écrit un statut.

## Décisions non arrêtées

Le statut juridique des coursiers, le modèle économique, qui est le vendeur
légal, le PSP et les seuils de conformité **ne sont pas tranchés**. Le code ne
présuppose aucune réponse : voir [`docs/TO_VERIFY.md`](docs/TO_VERIFY.md).

Le logiciel peut avancer en parallèle ; c'est la mise en service réelle qui
attend ces décisions.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Modèle économique](docs/MODELE-ECONOMIQUE.md)
- [Conformité produit](docs/CONFORMITE-CBD.md)
- [Données personnelles](docs/RGPD.md)
- [Propriété intellectuelle](docs/PROPRIETE-INTELLECTUELLE.md)
- [Décisions ouvertes](docs/TO_VERIFY.md)
