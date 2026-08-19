# Protection de la propriété intellectuelle

> **Ce document n'est pas un conseil juridique.** Il rassemble ce qu'il faut
> savoir pour poser les bonnes questions à un **conseil en propriété
> industrielle (CPI)** et à un avocat. Les montants, délais et procédures
> changent : tout ce qui est chiffré ici est marqué `TO_VERIFY` et doit être
> confirmé auprès de l'INPI ou d'un professionnel avant toute décision.

## Le malentendu à lever en premier : les brevets

**Un brevet sur cette plateforme est très peu probable en Europe.** Ce n'est pas
une question de budget ou de qualité du dossier — c'est une question de ce que
la loi accepte de breveter.

La Convention sur le brevet européen (art. 52) et le Code de la propriété
intellectuelle français (art. L611-10) excluent expressément de la brevetabilité :

- les **programmes d'ordinateur** « en tant que tels » ;
- les **méthodes dans l'exercice d'activités économiques**.

Une plateforme de mise en relation avec dispatch de livraison et QR codes tombe
dans ces deux catégories. Il existe une porte étroite — l'« invention mise en
œuvre par ordinateur », qui suppose de démontrer un **effet technique** au-delà
de l'exécution normale d'un programme (typiquement : traitement du signal,
cryptographie, gestion de mémoire). Un algorithme d'attribution de courses n'en
relève quasiment jamais.

**Ce que cela veut dire concrètement** : engager une procédure de brevet ici,
c'est plusieurs milliers d'euros et 2 à 4 ans pour un refus probable. L'argent
est bien mieux placé ailleurs — voir ci-dessous.

Un CPI tranchera définitivement. Mais pose-lui la question dans ce sens :
« *y a-t-il quoi que ce soit de brevetable ici ?* », pas « *combien coûte le
dépôt ?* ».

### Et Uber, alors ?

Uber détient des brevets, mais **ce n'est pas ce qui les protège**. Leur
protection réelle tient à quatre choses, dans cet ordre :

1. **La liquidité du marché** — assez de coursiers pour que le client soit livré
   vite, assez de clients pour que le coursier gagne sa journée. Cette boucle
   est très difficile à répliquer localement.
2. **La densité opérationnelle** dans chaque zone.
3. **La marque** et l'habitude d'usage.
4. **Le capital**.

Aucun de ces quatre points ne s'obtient par un dépôt. C'est une bonne nouvelle :
ils s'obtiennent par l'exécution, et l'exécution est à ta portée.

## Ce qui protège réellement, par ordre d'utilité

### 1. La marque — le seul dépôt vraiment indispensable

C'est ce qui empêche quelqu'un d'ouvrir un service concurrent sous ton nom, et
ce qui te permet de faire retirer une contrefaçon.

- **INPI** pour la France, **EUIPO** pour l'Union européenne.
- Classes probablement pertinentes : **9** (logiciel), **35** (services de
  marketplace, publicité), **39** (transport et livraison), **42** (SaaS).
  `TO_VERIFY` — la liste exacte se cale avec le CPI.
- À faire **avant** toute communication publique, et avant d'imprimer le moindre
  support QR portant le nom.
- Vérifier d'abord la disponibilité (recherche d'antériorité) : déposer une
  marque déjà prise coûte le dépôt *et* le litige.

Réserver les **noms de domaine** dans la foulée, même ceux que tu n'utiliseras
pas tout de suite.

### 2. Le droit d'auteur — automatique, mais à pouvoir prouver

En France, **le code source est protégé dès sa création**, sans aucune formalité
(art. L112-2 13° CPI). Tu n'as rien à déposer pour être titulaire des droits.

Ce qui manque n'est pas la protection, c'est la **preuve d'antériorité** : être
capable de démontrer qu'à telle date, tel code existait et venait de toi.

Moyens usuels, du plus léger au plus solide :

| Moyen | Remarque |
|-------|----------|
| Historique Git horodaté | Déjà en place. Utile, mais modifiable — insuffisant seul |
| Commits signés (GPG) | Renforce nettement la valeur probante de l'historique |
| **Enveloppe Soleau** (INPI) | Peu coûteuse, simple, date certaine `TO_VERIFY` |
| **Dépôt APP** (Agence pour la Protection des Programmes) | Spécialisé logiciel, plus complet `TO_VERIFY` |
| Constat d'huissier | Le plus solide, le plus cher |

Recommandation : activer les commits signés dès maintenant (gratuit), et faire
un dépôt formel au moment où le socle est stable.

### 3. Le droit des bases de données — sous-estimé, et taillé pour ce projet

Le droit *sui generis* du producteur de bases de données (art. L341-1 CPI,
directive 96/9/CE) protège **l'investissement substantiel** consacré à
constituer, vérifier et présenter une base — indépendamment de tout droit
d'auteur sur son contenu.

C'est exactement ta situation : le réseau de shops partenaires, leurs
catalogues, les données de conformité vérifiées, l'historique des zones. Ce
patrimoine se constitue par un travail réel et coûteux, et ce droit permet de
s'opposer à son **extraction massive** — le scraping d'un concurrent, typiquement.

Pour en bénéficier, il faut pouvoir **documenter l'investissement** : temps
passé, coûts de vérification, moyens engagés. À tracer dès maintenant, pas
reconstitué après coup.

### 4. Le secret des affaires — et pourquoi le code compte ici

La loi du 30 juillet 2018 protège les informations qui ont une valeur
économique parce qu'elles sont secrètes — algorithmes, données, méthodes,
chiffres d'exploitation.

Point crucial : cette protection n'est acquise que si tu prends des **mesures
raisonnables de protection**. Sans mesures, pas de secret protégé.

Ce qui a déjà été construit y contribue directement :

- le cloisonnement d'accès par rôle **et** par appartenance de ressource
  (`apps/api/src/auth/guard.ts`) ;
- le journal d'audit sur les actions sensibles ;
- les secrets tenus hors du dépôt, en variables d'environnement ;
- le dépôt privé.

À compléter par : dépôt et accès nominatifs, marquage « confidentiel » des
documents sensibles, et les contrats ci-dessous.

### 5. Les contrats — le vrai bouclier au quotidien

C'est le point le plus souvent négligé, et le plus coûteux à rattraper.

**Cession de droits sur le code.** En droit français, un prestataire
indépendant ou un freelance **conserve ses droits d'auteur** en l'absence de
clause de cession écrite et précise (art. L131-3 CPI). Un développeur externe
qui livre du code sans cession signée reste titulaire de ses droits sur ce
code. Ce n'est pas théorique : c'est un blocage classique au moment d'une levée
de fonds ou d'un rachat, quand l'acquéreur audite la chaîne des droits.

À prévoir systématiquement, avant la première ligne livrée :

- **clause de cession de droits** dans tout contrat de prestation ;
- **NDA** avec prestataires, stagiaires, associés potentiels, et les premiers
  shops partenaires si tu leur montres des éléments non publics ;
- **CGU/CGV** interdisant expressément l'extraction automatisée et la
  réutilisation des données ;
- **contrats de partenariat** avec les shops, qui cadrent qui possède quoi
  (catalogues, photos, données clients).

Pour un salarié, le régime diffère : les droits sur le logiciel créé dans
l'exercice des fonctions sont dévolus à l'employeur (art. L113-9 CPI). `TO_VERIFY`
sur les contours exacts.

## Ordre de priorité proposé

| Priorité | Action | Quand |
|----------|--------|-------|
| 1 | Recherche d'antériorité + **dépôt de marque** | Avant toute communication publique |
| 2 | Réservation des noms de domaine | Immédiat |
| 3 | **Commits signés** activés | Immédiat, gratuit |
| 4 | Modèles de **NDA + cession de droits** | Avant tout prestataire externe |
| 5 | CGU/CGV avec clause anti-extraction | Avant l'ouverture publique |
| 6 | Dépôt de preuve d'antériorité du code | Socle stable |
| 7 | Traçage de l'investissement base de données | En continu, dès le premier shop |
| 8 | Question « y a-t-il du brevetable ? » au CPI | Sans urgence |

## Ce qui n'est pas tranché

- `TO_VERIFY` — classes de marque exactes et coûts de dépôt INPI / EUIPO.
- `TO_VERIFY` — choix entre enveloppe Soleau, dépôt APP, ou constat d'huissier.
- `TO_VERIFY` — contours de la dévolution des droits selon le statut des
  intervenants (salarié, prestataire, stagiaire, associé).
- `TO_VERIFY` — articulation avec la décision « qui est le vendeur légal »
  (voir `TO_VERIFY.md`, décision 05), qui influe sur la propriété des données
  clients et des catalogues.

## Le point à retenir

Aucun dépôt ne remplace l'exécution. Ce qui rendra ce projet difficile à voler,
ce n'est pas un titre de propriété : c'est un réseau de shops qui te fait
confiance, des coursiers qui gagnent leur vie, et une boucle
commande → livraison qui tourne mieux que celle du voisin.

La protection juridique sert à ne pas se faire prendre le **nom**, à ne pas
perdre les **droits sur son propre code**, et à empêcher l'**aspiration** de la
base. Ces trois-là, il faut les traiter sérieusement et tôt. Le reste se gagne
sur le terrain.
