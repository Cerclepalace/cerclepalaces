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
| 05 | **Qui est le vendeur légal** — modèle A, B ou C | Développement partiel | Détermine le flux de paiement et la facturation ; aucun modèle transactionnel n'est en base (décision 14) |
| 06 | TVA et facturation selon le modèle retenu | Lancement | Pas de modèle `Invoice` tant que 05 n'est pas tranché |
| 07 | Responsabilité produit et politique de remboursement | Lancement | `requiresRefundDecision()` signale le cas, ne le traite pas |
| 08 | CGV / CGU adaptées au modèle retenu | Lancement | — |
| 09 | Choix du PSP **et de l'acquéreur** : compatibilité CBD, modèle marketplace, MCC, réseaux cartes | Développement paiement | Aucune dépendance à un fournisseur : `PaymentProvider` est une interface, son implémentation refuse toute opération. État détaillé dans `PSP-REGISTRE.md` |
| 10 | Seuils réglementaires de conformité produit (THC/CBD) | Mise en vente | Taux stockés tels que déclarés, seuils non codés |
| 11 | Vérification d'âge à la commande ou à la livraison | Lancement | `ProofOfDelivery` accepte PHOTO/SIGNATURE/CODE ; `DEFAULT_PROOF_POLICY` n'exige rien tant que la règle n'est pas connue |
| 12 | Durées de conservation RGPD et base légale par donnée | Lancement | Voir `RGPD.md` |
| 13 | Zone géographique exacte du pilote | Phase 2 | `DeliveryZone` paramétrable, aucune zone en dur |

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
- Aucun modèle de paiement ni de versement n'existe en base : ils ont été
  retirés du schéma avant la première migration (décision 14, tranchée le
  1er septembre 2026). Les figer aujourd'hui trancherait les décisions 05 et 09
  en silence.
- `NoopPaymentProvider` et `NoopDeliveryProvider` **refusent explicitement**
  toute opération plutôt que de simuler un succès : une commande ne peut pas
  passer en `PAID` sans qu'un euro ait bougé.
- Le split payment et les comptes connectés ne sont **pas** modélisés : les
  ajouter trancherait la décision 05 en silence, du côté du modèle marketplace.
- `ProductCompliance` stocke les taux déclarés sans appliquer de seuil : la
  règle appliquée est uniquement « seul `APPROVED` est vendable ».
