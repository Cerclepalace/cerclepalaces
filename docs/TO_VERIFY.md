# TO_VERIFY — décisions non arrêtées

Ce fichier est la source unique des décisions en attente. Rien de ce qui suit
n'est tranché, et **aucun code ne doit présupposer une réponse**. Quand une
décision est prise, elle est déplacée dans le document correspondant
(`MODELE-ECONOMIQUE.md`, `CONFORMITE-CBD.md`, `RGPD.md`) avec sa date et sa
source, et retirée d'ici.

Trois de ces décisions sont **bloquantes pour le lancement opérationnel** — pas
pour le développement. Le logiciel peut être construit en parallèle ; c'est la
mise en service réelle qui attend.

| # | Décision | Bloque | Impact code |
|---|----------|--------|-------------|
| 01 | Statut juridique des coursiers (indépendant / salarié / autre) | Lancement | `Driver.legalStatus` reste libre ; le calcul de rémunération est configurable |
| 02 | Assurance, matériel, responsabilité, gestion des accidents coursiers | Lancement | Modèle `Incident` prévu, règles de traitement non écrites |
| 03 | Règles spécifiques à la livraison de CBD (transport, étiquetage) | Lancement | Aucune règle codée en dur |
| 04 | Modèle économique retenu et niveau exact des parts | Développement partiel | `RevenueConfig` accepte 5 modèles, aucun par défaut |
| 05 | **Qui est le vendeur légal** — modèle A, B ou C | Développement partiel | Détermine le flux `Payment` et la facturation |
| 06 | TVA et facturation selon le modèle retenu | Lancement | Pas de modèle `Invoice` tant que 05 n'est pas tranché |
| 07 | Responsabilité produit et politique de remboursement | Lancement | `requiresRefundDecision()` signale le cas, ne le traite pas |
| 08 | CGV / CGU adaptées au modèle retenu | Lancement | — |
| 09 | Choix du PSP : compatibilité CBD, split payment, KYC/KYB, commissions | Développement paiement | `Payment.provider` volontairement générique |
| 10 | Seuils réglementaires de conformité produit (THC/CBD) | Mise en vente | Taux stockés tels que déclarés, seuils non codés |
| 11 | Vérification d'âge à la commande ou à la livraison | Lancement | `ProofOfDelivery` accepte PHOTO/SIGNATURE/CODE ; `DEFAULT_PROOF_POLICY` n'exige rien tant que la règle n'est pas connue |
| 12 | Durées de conservation RGPD et base légale par donnée | Lancement | Voir `RGPD.md` |
| 13 | Zone géographique exacte du pilote | Phase 2 | `DeliveryZone` paramétrable, aucune zone en dur |
| 14 | Portée de la première migration : la générer telle quelle créerait `Payment` et `DriverPayout`, hors périmètre actuel | Développement base | Voir ci-dessous ; aucun fichier de migration écrit tant que ce n'est pas tranché |

## Les trois modèles de vente (décision 05)

Cette décision commande les décisions 06, 07, 08 et 09. Elle doit être prise en
premier.

- **Modèle A** — le CBD shop reste le vendeur. La plateforme fournit la
  technologie, l'acquisition et la livraison, et facture une commission de
  service.
- **Modèle B** — la plateforme devient vendeur / revendeur.
- **Modèle C** — marketplace à flux multi-parties, avec répartition du paiement
  entre shop, plateforme et coursier.

Conséquences divergentes : encaissement, facturation, TVA, responsabilité
produit, remboursements, CGV, obligations de conformité, traitement des données
personnelles.

## Ce que le code fait en attendant

Plutôt que de choisir par défaut, le code exprime la variabilité :

- `packages/domain/src/pricing/breakdown.ts` calcule la répartition à partir
  d'une `RevenueConfig` ; changer de modèle est un changement de configuration.
- La marge plateforme y est un **reste**, pas une entrée — et peut être
  négative, ce qui est l'information à voir pendant le pilote.
- `Payment.provider` et `Payment.providerRef` sont des chaînes libres : aucune
  dépendance à un PSP particulier avant la décision 09.
- `NoopPaymentProvider` et `NoopDeliveryProvider` **refusent explicitement**
  toute opération plutôt que de simuler un succès : une commande ne peut pas
  passer en `PAID` sans qu'un euro ait bougé.
- Le split payment et les comptes connectés ne sont **pas** modélisés : les
  ajouter trancherait la décision 05 en silence, du côté du modèle marketplace.
- `ProductCompliance` stocke les taux déclarés sans appliquer de seuil : la
  règle appliquée est uniquement « seul `APPROVED` est vendable ».

## Portée de la première migration (décision 14)

`prisma migrate diff --from-empty` produit aujourd'hui 963 lignes de SQL : 37
tables, 12 énumérations, 59 clés étrangères, 72 index. Parmi ces tables,
`Payment` et `DriverPayout` — et l'énumération `PaymentStatus` — appartiennent à
un périmètre explicitement gelé.

Trois issues, aucune neutre :

- **A — migrer tout le schéma.** Simple, mais crée en base des tables d'un
  périmètre gelé. Ce que la base contient finit par être lu comme ce que le
  produit fait.
- **B — migrer tout sauf ces tables.** Le schéma Prisma et la base divergent
  alors en permanence, et chaque `migrate diff` ultérieur rejouera l'écart.
  C'est une dette qui se paie à chaque migration, pas une fois.
- **C — retirer ces modèles du schéma, puis migrer.** Aucune divergence, périmètre
  strict. Coût : les retirer maintenant et les réintroduire plus tard, avec la
  connaissance du PSP retenu (décision 09) et du modèle de vente (décision 05) —
  c'est-à-dire au moment où leur forme sera réellement connue.

Recommandation : **C**. Les deux modèles concernés dépendent de décisions non
prises ; les figer aujourd'hui en base, c'est figer des colonnes qu'on redessinera
de toute façon.

En attendant, la base de développement est peuplée par `prisma db push` sur une
base jetable, et aucun fichier de migration n'est versionné.
