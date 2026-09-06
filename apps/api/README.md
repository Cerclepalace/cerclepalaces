# apps/api

API centrale. Seul composant autorisé à écrire un statut de commande : chaque transition passe par assertTransition() de @cbd/domain, et écrit une ligne dans OrderStatusEvent.

> Emplacement réservé — à construire sur le socle `packages/domain` et `packages/db`.
