# Données personnelles

> Ce document recense les données collectées et leur usage. Les **durées de
> conservation et la base légale précises restent à valider avec un
> professionnel** — `TO_VERIFY.md`, décision 12. Aucune conformité définitive
> n'est revendiquée ici.

## Ce qui est collecté

| Donnée | Pourquoi | Qui y accède |
|--------|----------|--------------|
| Identité, e-mail, téléphone | Compte, contact, facturation | L'utilisateur, l'admin |
| Adresse de livraison | Exécution de la commande | Le shop et le coursier concernés, le temps de la course |
| Instructions de livraison (`Address.notes`) | Accès au logement | Le coursier assigné uniquement, pendant la course |
| Position du coursier | Dispatch et suivi temps réel | Le client de la commande en cours, l'admin |
| Historique de commandes | Support, statistiques | L'utilisateur, l'admin |
| Documents de conformité (shop) | Vérification réglementaire | L'admin uniquement |
| `sessionKey` d'acquisition QR | Mesurer le tunnel scan → commande | Agrégé côté shop, détail côté admin |

## Choix de minimisation déjà appliqués au schéma

- **Position du coursier** : `Driver.lastLat/lastLng` est un champ **écrasé** à
  chaque mise à jour, jamais un historique. Hors mission, aucune trace de
  déplacement n'est conservée.
- **`sessionKey`** est un identifiant technique éphémère reliant les événements
  d'un même visiteur dans le tunnel d'acquisition. Ce n'est pas un profil
  publicitaire et il n'est pas rattaché à un compte tant que le visiteur n'en a
  pas créé un.
- **IP** : stockée sous forme de hash (`Session.ipHash`, `AuditLog.ipHash`),
  jamais en clair.
- **Suppression de compte** : `User.anonymizedAt` déclenche une anonymisation
  plutôt qu'une suppression physique — l'historique comptable des commandes déjà
  livrées ne doit pas être cassé, mais plus rien ne doit y être nominatif.

## À prévoir avant le pilote

- Export des données d'un utilisateur sur demande.
- Purge automatique des données dont la durée de conservation est dépassée
  (règles à définir — décision 12).
- Journalisation des consultations de données personnelles depuis le
  back-office : `AuditLog` le prévoit, la couverture reste à implémenter.
- Information des personnes concernées : mentions, politique de confidentialité,
  cookies éventuels.
