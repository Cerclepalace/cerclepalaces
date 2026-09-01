# Architecture

## Le modèle en une phrase

Les CBD shops existent déjà physiquement. La plateforme leur apporte une
présence numérique, un système de commande et une infrastructure de livraison —
elle ne les remplace pas. Le shop reste au centre du parcours et reste visible à
chaque étape.

## Les deux boucles

**Boucle commerciale** — le QR affiché en boutique est le premier maillon de
l'acquisition :

```
SHOP PHYSIQUE → QR CODE → CLIENT SCANNE → PAGE SHOP → COMMANDE
```

**Boucle logistique** — le dispatch relie la commande au réseau de coursiers :

```
COMMANDE → SHOP → COMMANDE PRÊTE → DISPATCH → COURSIER → CLIENT
```

## Structure du dépôt

```
.
├── apps/
│   ├── client/     interface client (recherche, commande, suivi)
│   ├── shop/       back-office commerçant
│   ├── driver/     application coursier, mobile-first
│   ├── admin/      back-office plateforme
│   └── api/        API centrale — seul écrivain de la base
├── packages/
│   ├── domain/     règles métier pures (state machines, rôles, répartition)
│   ├── db/         schéma Prisma et migrations
│   ├── ui/         design system partagé
│   └── config/     validation de la configuration d'exécution
└── docs/
```

### Pourquoi `packages/domain` ne dépend de rien

Ce package ne connaît ni base de données, ni framework web, ni HTTP : uniquement
des fonctions pures et des types. C'est ce qui permet d'appliquer exactement la
même règle dans l'API, dans les quatre back-offices et dans les tests, sans
duplication et sans dérive.

Les quatre machines qu'il contient :

| Module | Rôle |
|--------|------|
| `order/` | états et transitions de commande |
| `compliance/` | statut réglementaire produit, règle de mise en vente |
| `delivery/` | états de livraison, propositions, disponibilité, dispatch, preuve, payout |
| `tenancy/` | `TenantScope` nominal, frontière de multi-tenancy |
| `ports/` | interfaces PaymentProvider et DeliveryProvider, implémentations Noop |
| `pricing/` | répartition financière d'une commande |

Les tests couvrent ces règles, dont l'intégrité structurelle des tables de
transitions (pas de cul-de-sac, pas d'état inatteignable, pas de sortie depuis
un état terminal).

## Stack

| Choix | Raison |
|-------|--------|
| TypeScript partout | un seul langage entre les 5 apps, types partagés via `@cbd/domain` |
| Next.js (App Router) | SSR nécessaire au référencement des pages shop, qui sont la cible des QR |
| PostgreSQL | transactions fiables sur commandes et stocks ; PostGIS disponible pour les zones sans changer de moteur |
| Prisma | migrations versionnées, types générés depuis le schéma |
| Redis | file de dispatch, cache géographique, rate limiting |
| Stockage S3-compatible | photos produits et documents de conformité |
| PSP | **non arrêté** — voir `TO_VERIFY.md` décision 09 |

Alternative écartée : réutiliser TanStack Start. Cohérent avec l'outillage
existant côté utilisateur, mais le référencement des pages shop et la maturité
de l'écosystème auth/paiement pèsent davantage sur ce projet précis.

## Deux invariants à ne pas casser

### 1. `Inventory` est le pivot du catalogue, pas `Product`

Un produit existe une fois au référentiel global. Son **prix**, son **stock** et
sa **mise en vente** appartiennent à une `MerchantLocation` précise.

```
Shop A → Produit X → 3 en stock, 24,90 €
Shop B → Produit X → 0 en stock
```

La plateforme ne doit jamais présenter un produit comme disponible parce qu'il
existe au catalogue. Toute liste de produits commandables passe par
`isOrderable()`.

### 2. Les transitions de commande sont contrôlées côté serveur

`apps/api` est le seul écrivain d'un statut de commande. Chaque transition
passe par `assertTransition(from, to, actor)`, qui vérifie à la fois que la
transition existe et que l'acteur a le droit de la déclencher.

L'acteur `system` — webhook de paiement, dispatch, expiration de délai —
n'existe que côté serveur : aucune requête entrante ne peut s'en réclamer.

Chaque transition écrit une ligne dans `OrderStatusEvent`, ce qui reconstitue
l'historique complet d'une commande et sert de preuve en cas de litige.

## Sécurité

- Validation et RBAC systématiquement côté serveur ; le front n'est jamais la
  source de vérité d'une autorisation.
- Le rôle seul n'autorise rien : presque chaque endpoint vérifie aussi
  l'appartenance de la ressource (un `merchant_staff` n'agit que sur sa
  `MerchantLocation`, un `driver` que sur ses propres missions).
- Rate limiting sur authentification, checkout et scan QR.
- Secrets uniquement en variables d'environnement, jamais commités, jamais
  exposés au front.
- `AuditLog` sur les actions sensibles : validation d'un shop ou d'un coursier,
  changement de statut de conformité, remboursement, consultation de données
  personnelles depuis le back-office.

## Documents liés

- `TO_VERIFY.md` — les 13 décisions non arrêtées
- `MODELE-ECONOMIQUE.md` — répartition financière, non tranchée
- `CONFORMITE-CBD.md` — architecture de conformité produit
- `DELIVERY-NETWORK.md` — réseau de livraison, dispatch, multi-tenancy
- `INTEGRATION-POSTGRESQL.md` — ce que la vraie base confirme, et ce qu'elle a contredit
- `V1-PARCOURS-METIER.md` — le parcours vendeur → produit → commande simulée
- `RGPD.md` — données personnelles collectées et leur usage
- `PROPRIETE-INTELLECTUELLE.md` — ce qui protège réellement le projet
