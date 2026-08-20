# Inspection : code actuel ↔ projet marketplace CBD avec livraison

**Date :** 20 août 2026
**Dépôt inspecté :** `cerclepalace/cerclepalaces` (branche `claude/cbd-marketplace-legal-analysis-k62gqn`)
**Document de référence :** « Projet 1 – Analyse juridique, administrative et fiscale (marketplace CBD, France) »
**Angle demandé :** *cbd shop livraison*

> **Avertissement.** Cette inspection est une revue technique et une revue de complétude du
> document juridique. Ce n'est pas un conseil juridique. Aucune vérification en ligne n'a été
> faite : toutes les références de textes ci-dessous sont à faire confirmer par un avocat
> (numérique / consommation) et un expert-comptable avant de s'en servir.

---

## 0. Verdict en une phrase

**Le dépôt ne contient aucune ligne du projet marketplace CBD.** C'est *NeonCut*, un
convertisseur de vidéos YouTube en shorts 9:16 avec sous-titres néon. Le taux de couverture du
document juridique par le code existant est de **0 %** : il n'y a rien à auditer côté conformité,
tout est à écrire. La partie utile de cette inspection est donc ailleurs : (a) ce qui est
récupérable de la stack, (b) les patterns actuels qui seraient disqualifiants pour une plateforme
qui encaisse, et (c) **ce que le document juridique oublie, en particulier sur la livraison.**

---

## 1. Ce que contient réellement le dépôt

| Zone | Contenu | Rapport avec le projet CBD |
|---|---|---|
| `src/routes/index.tsx` (1 806 l.) | UI de découpe vidéo : segments, polices, couleurs néon, trim, export | Aucun |
| `src/routes/promo.tsx` (852 l.) | Générateur de séquence promo | Aucun |
| `src/lib/video-processor.ts` (1 072 l.) | Pipeline ffmpeg.wasm navigateur | Aucun |
| `src/lib/viral-detect.ts` (396 l.) | Détection de moments « viraux » via LLM | Aucun |
| `src/lib/remote-render.ts`, `ffmpeg-pool.ts`, `ffmpeg-worker.ts`, `segment-cache.ts` | Rendu distant, pool de workers, cache IndexedDB | Aucun |
| `src/routes/api/tts.ts` | Synthèse vocale ElevenLabs | Aucun |
| `src/routes/api/youtube-mp4.ts` | Récupération de flux via instances Piped publiques | Aucun |
| `render-service/server.js` (414 l.) | Service ffmpeg natif (Express + Docker, Fly/Railway) | Aucun |
| `src/components/ui/**` (47 fichiers) | shadcn/ui | Réutilisable |

**Preuve de l'absence :** recherche insensible à la casse de
`cbd|thc|chanvre|panier|checkout|stripe|commande|vendeur|marketplace|livraison|livreur|kyc|kyb`
sur `src/` et `render-service/`, hors `components/ui/` → **0 résultat**.
Une recherche plus large (`shop`, `order`, `cart`, `payment`, `cookie`, `rgpd`, `cgv`) ne remonte
que des faux positifs de Tailwind/shadcn (`shadow`, `border-`, `sidebar_state`).

**Conséquence pratique :** ce dépôt est connecté à Lovable (`.lovable/project.json`) et déployé
sur `cerclepalaces.lovable.app` en tant que NeonCut. Y greffer une marketplace CBD casserait le
projet Lovable existant. → **Nouveau dépôt / nouveau projet.** Ce document sert de cahier des
charges de départ, pas de plan de migration.

---

## 2. Couverture du document juridique par le code

Reprise du « tableau final priorisé » du document, colonne « état du code » :

| Élément 🔴 bloquant | Attendu côté code | État actuel |
|---|---|---|
| Mentions légales (LCEN) | Page + lien permanent | ❌ absent — `src/routes/__root.tsx` n'a ni footer ni lien légal |
| CGV / conditions marketplace | Page + acceptation horodatée à l'inscription et à la commande | ❌ absent |
| Politique de confidentialité (14 mentions CNIL) | Page + versionnage | ❌ absent |
| Bandeau cookies (refus aussi simple qu'accepter) | Consent Management + blocage des tags avant consentement | ❌ absent — aucun mécanisme de consentement |
| PSP marketplace / split payment | Comptes connectés, `application_fee_amount`, webhooks, réconciliation | ❌ absent — aucune dépendance paiement dans `package.json` |
| Registre des traitements RGPD | Document + durées de conservation appliquées en base | ❌ absent — et **aucune base de données** dans le projet |
| Procédure de modération CBD | Signalement, décision motivée, suspension, journal | ❌ absent |
| Onboarding shops / KYB | Collecte de pièces, statuts de vérification | ❌ absent — aucun compte utilisateur, aucune authentification |

Ajout non listé dans le document mais indispensable dès la première commande :
facturation, numérotation séquentielle, archivage, journal d'audit. ❌ absent également.

---

## 3. Ce qui est récupérable, ce qui est à jeter

**Récupérable (patterns, pas fonctionnalités) :**

- Stack TanStack Start + React 19 + Tailwind 4 + shadcn/ui : base saine pour du SSR e-commerce.
- `src/start.ts:22` — middleware CSRF explicitement réinstallé sur les server functions. Bon réflexe, à conserver.
- `src/routes/api/tts.ts:4` — validation Zod stricte du corps de requête (bornes, regex). À généraliser à toutes les entrées.
- `src/lib/render-session.functions.ts` — le secret partagé ne quitte jamais le serveur, le client ne reçoit qu'un jeton dérivé. Principe correct.
- `src/lib/error-page.ts` + `src/server.ts` — normalisation des erreurs 500, pas de fuite de stack vers le client.

**À jeter intégralement (~5 500 lignes) :** tout le pipeline vidéo, ffmpeg (wasm et natif),
Piped, ElevenLabs, la détection virale, le service de rendu et son Dockerfile.

**Manquant structurellement, et c'est le point important :** le projet n'a
**aucune base de données**, **aucune authentification**, **aucune session utilisateur**,
**aucun stockage durable**, **aucun envoi d'e-mail**, **aucune file de traitement**.
NeonCut est une app sans état : tout vit dans le navigateur ou dans un dossier temporaire.
Une marketplace est exactement l'inverse. Il n'y a donc pas de « socle » à reprendre.

---

## 4. Patterns actuels incompatibles avec une plateforme qui encaisse

À lire comme « ce qu'il ne faut pas reproduire », pas comme des bugs de NeonCut — dans son
contexte (rendu vidéo anonyme, éphémère), la plupart sont des choix défendables.

1. **Aucune persistance.** `render-service/server.js:71` stocke les sessions dans une `Map`
   mémoire ; les fichiers vont dans `os.tmpdir()` (`server.js:22`). Un redémarrage de conteneur
   efface tout. Or une marketplace doit conserver : commandes, factures, preuves de consentement,
   pièces KYB, journal de modération, registre des opérations facilitées (durée de conservation
   longue, cf. §5.6). → Postgres hébergé dans l'UE + stockage objet, dès le premier jour.
2. **Jeton porteur non lié à un utilisateur.** `render-session.functions.ts:16` : la signature HMAC
   ne couvre que l'horodatage d'expiration. N'importe quel jeton vaut pour n'importe qui pendant
   15 minutes. Acceptable pour un service de rendu anonyme ; disqualifiant dès qu'il existe des
   comptes, des commandes et des documents d'identité.
3. **CORS permissif.** `render-service/server.js:43` : `origin: true` renvoie l'origine appelante,
   donc autorise tout le monde. À remplacer par une liste blanche stricte.
4. **Télémétrie vers un tiers avec le chemin d'URL.**
   `src/lib/lovable-error-reporting.ts:30` envoie `route: window.location.pathname` à
   `window.__lovableEvents.captureException`. Sur une marketplace, les URL contiennent des
   identifiants de commande, de shop, parfois d'utilisateur → transmission de données personnelles
   à un sous-traitant. À encadrer (contrat de sous-traitance art. 28 RGPD + anonymisation des
   URL) ou à retirer.
5. **Appels sortants vers des services publics non contractualisés.**
   `src/routes/api/youtube-mp4.ts:5` : cinq instances Piped publiques en chaîne de repli. Pattern
   à bannir pour tout ce qui touche des données client — chaque destinataire doit être un
   sous-traitant identifié dans le registre.
6. **Absent partout :** en-têtes de sécurité (CSP, HSTS), limitation de débit, journal d'audit,
   traçabilité des accès admin. Tous obligatoires de fait dès qu'il y a de l'argent et des données.

---

## 5. Le document juridique vu sous l'angle « shop livraison »

C'est la partie la plus faible du document : la livraison y tient en une ligne
(« livraison sous responsabilité du shop, modèle L1 ») et n'est jamais instruite. Or c'est
précisément là que le montage « simple intermédiaire » se fait requalifier.

### 5.1 Le modèle L1 est affirmé, pas tenu — contradiction interne

Le document pose « livraison sous responsabilité du shop », puis écrit en section RGPD :
« données livreurs (**si gérés via ta plateforme**) ». Les deux ne peuvent pas être vrais en même
temps. Dès que la plateforme recrute, référence, note, géolocalise, dispatche ou paie des livreurs,
elle n'est plus tiers à la livraison.

Conséquences à trancher **avant** d'écrire le moindre schéma de données :

- Obligations des plateformes de mise en relation envers les travailleurs indépendants
  (art. L.7342-1 et s. du code du travail : assurance AT, formation, droit de refus…).
- Risque de requalification en contrat de travail. Le faisceau d'indices retenu par la Cour de
  cassation (Take Eat Easy, ch. soc. 28 nov. 2018 ; Uber, ch. soc. 4 mars 2020) : géolocalisation
  en temps réel, tarif imposé, pouvoir de sanction, exclusivité de fait.
- Question concrète : la table `deliveries` porte-t-elle une clé étrangère `courier_id` vers un
  livreur que **nous** gérons ? Si oui, tout le montage « intermédiaire technique » du document
  tombe et il faut refaire l'analyse.

**Recommandation :** si L1 est le choix, il doit être visible dans le code — aucune entité
livreur, aucun tarif de livraison calculé par la plateforme, aucun suivi produit par nous.
Le shop transmet un statut et éventuellement un numéro de suivi, on l'affiche, point.

### 5.2 Commissionnaire de transport — absent du document

Organiser le transport pour le compte d'autrui (choisir le transporteur, fixer le prix du port,
encaisser les frais de port) peut relever du **commissionnaire de transport**, avec inscription au
registre des transporteurs, capacité professionnelle et capacité financière
(art. L.1411-1 et s. du code des transports). Le document n'évoque jamais cette qualification.

En pratique, pour rester hors de ce champ :
- les frais de port sont **fixés par le shop**, affichés comme siens ;
- ils sont **facturés par le shop** et **reversés intégralement au shop** dans le split ;
- la commission de la plateforme est assise sur le prix produits, pas sur le port — ou alors elle
  est explicitement une commission de service technique, jamais une marge de transport.

C'est une contrainte de code : le calcul du `application_fee_amount` doit exclure la ligne port.

### 5.3 Qui répond de la livraison devant le client

L'art. L.221-15 du code de la consommation rend le professionnel qui conclut le contrat à
distance **responsable de plein droit** de sa bonne exécution, livraison comprise. La
responsabilité suit **celui qui apparaît comme vendeur**, pas ce que disent les CGV. Un client
qui a payé sur ta plateforme, reçu un mail à ton nom et une page de suivi à tes couleurs a de
bons arguments pour dire qu'il a contracté avec toi.

Impacts directs sur le code, non mentionnés dans le document :

- **Commande éclatée par shop** : une commande client = N sous-commandes, une par shop, avec
  numérotation, facture et suivi distincts. Un panier multi-shops payé en une fois est possible,
  mais l'écran de paiement doit montrer la ventilation par vendeur.
- **Identité du vendeur affichée** à chaque étape : fiche produit, panier, récapitulatif de
  paiement, mail de confirmation, page de suivi, facture.
- **Une facture par shop**, émise au nom du shop. Ta facture à toi ne concerne que la commission,
  adressée au shop.
- Les e-mails transactionnels doivent dire « expédié par <shop> », jamais « votre commande
  <plateforme> ».

### 5.4 DSA — totalement absent du document (Règl. (UE) 2022/2065)

Une place de marché est une « plateforme en ligne permettant de conclure des contrats à
distance ». Obligations qui pèsent directement sur le produit :

- **Art. 30 — traçabilité des professionnels** : avant toute mise en ligne, collecter et
  vérifier identité, RCS, coordonnées, IBAN, et obtenir une **autocertification de conformité des
  produits**. Suspension si les informations ne sont pas fournies. C'est le vrai fondement de
  l'onboarding shop, plus encore que le KYB du PSP.
- **Art. 31 — conformité dès la conception** : l'interface doit permettre d'afficher les
  informations obligatoires (identité du vendeur, marquages, étiquetage).
- **Art. 16 — notification et action** : mécanisme public de signalement de produit ou contenu
  illicite. C'est exactement la « procédure de modération CBD » du document, mais avec un format
  imposé et un accusé de réception.
- **Art. 17 — exposé des motifs** : toute suspension ou retrait doit être **motivée par écrit**
  auprès du vendeur. Le document prévoit un « droit de suspension » sans dire qu'il faut le
  motiver, l'horodater et ouvrir un recours.
- **Art. 20 — système interne de traitement des réclamations** (au moins 6 mois pour contester).
- **Art. 11-13** : points de contact pour les autorités et les utilisateurs.

Impact code : tables `product_reports`, `moderation_actions` (motif, auteur, horodatage,
notification envoyée), `appeals`, plus un back-office qui les rend exploitables.

### 5.5 P2B — absent du document (Règl. (UE) 2019/1150)

Régit la relation plateforme ↔ vendeurs professionnels :

- conditions générales claires, accessibles, et **préavis (15 jours minimum)** avant toute
  modification ;
- **motivation écrite préalable** de toute restriction/suspension, préavis de 30 jours pour une
  résiliation (sauf cas d'illégalité ou de risque) ;
- **transparence du classement** : les critères de tri des produits et des shops doivent être
  publiés. Ce point est structurant si tu comptes vendre de la mise en avant.
- système interne de traitement des plaintes et médiateurs désignés — avec exemption pour les
  petites entreprises (seuils à vérifier), donc probablement non applicable au lancement.

Le « droit de suspension immédiate » que le document recommande d'inscrire au contrat n'est
opposable que dans les cas prévus. À faire relire.

### 5.6 Obligations fiscales *de plateforme* — absentes du document

Le document conclut « les shops gèrent leur TVA, toi tu ne touches pas aux produits ». C'est vrai
pour l'assiette, faux pour les obligations :

- **DAC7 / art. 1649 ter A du CGI** : déclaration annuelle à la DGFiP de l'identité des vendeurs
  et des revenus qu'ils ont tirés de la plateforme (échéance 31 janvier), et information de chaque
  vendeur des données transmises. → il faut collecter **dès l'onboarding** : NIF ou n° TVA
  intracommunautaire, forme juridique, adresse, date de naissance pour les personnes physiques,
  IBAN — et savoir agréger le CA par vendeur et par trimestre.
- **Art. 242 bis du CGI** : information des utilisateurs sur leurs obligations fiscales et
  sociales, récapitulatif annuel des transactions à chaque vendeur, tenue d'un registre des
  opérations facilitées.
- **Art. 283 bis du CGI** : **responsabilité solidaire de la plateforme** pour la TVA d'un vendeur
  défaillant après signalement de l'administration. → nécessité de vérifier les numéros de TVA
  (VIES) et de pouvoir suspendre un vendeur rapidement.

Ces trois points imposent des colonnes en base et des exports. Les découvrir après le lancement
coûte une migration de données et un rattrapage déclaratif.

### 5.7 Sécurité des produits — GPSR, absent du document (Règl. (UE) 2023/988)

Applicable depuis décembre 2024, il vise **nommément les places de marché** : point de contact
unique pour les autorités, enregistrement auprès du portail de signalement, coopération aux
rappels, obligation d'informer les consommateurs concernés en cas de rappel. Cela suppose de
pouvoir répondre à : « quels clients ont reçu un produit du lot X ? » — donc une traçabilité au
niveau **ligne de commande ↔ lot ↔ certificat d'analyse**, et pas seulement « le shop m'a envoyé
ses certificats », comme le prévoit le document.

### 5.8 Spécifique CBD livré à domicile

- **Vérification d'âge.** Le droit français n'interdit pas spécifiquement la vente de CBD aux
  mineurs (contrairement au tabac ou à l'alcool), mais les PSP, les assureurs et la pratique du
  secteur l'imposent en 18+. → contrôle au compte + à la commande, et mention sur le bon de
  livraison. À écrire dans les CGV plutôt que de s'en remettre à un usage.
- **Colis contenant des fleurs ou résines.** Produit légal, mais visuellement et olfactivement
  identique au cannabis. Exiger contractuellement que chaque colis embarque la facture et une
  copie du certificat d'analyse (THC ≤ 0,3 %). → impact code : génération automatique du
  bon de livraison avec le COA du lot en pièce jointe.
- **Rétractation 14 jours.** Le document l'énonce sans nuance. Les exceptions de l'art. L.221-28
  du code de la consommation (produits scellés descellés pour raisons d'hygiène, produits
  périssables) peuvent jouer selon les catégories. À trancher **catégorie par catégorie** et à
  refléter dans la fiche produit, pas seulement dans les CGV. Rappel : en cas de rétractation, le
  vendeur rembourse aussi les frais de livraison standard.
- **Livraison locale rapide vs colis.** Si tu vises de la livraison locale en propre, relire
  §5.1 : c'est le scénario qui fait sortir du modèle L1.

### 5.9 Affirmations du document à confirmer avant de s'en servir

Le document s'appuie sur des articles secondaires (`[web:21]`…) pour des points structurants.
Je n'ai pas pu les vérifier dans cette session. À confirmer sur source officielle
(Légifrance, DGCCRF, DGAL, impots.gouv.fr) :

- « Depuis mai 2026, les produits à ingérer mentionnant le CBD sont retirés du marché » — c'est
  ce qui détermine le catalogue autorisé. À sourcer sur un texte publié, pas sur un article.
- Statut des fleurs et feuilles brutes : le document le donne pour acquis. Historiquement,
  l'interdiction de l'arrêté du 30 décembre 2021 a été annulée par le Conseil d'État ; vérifier
  qu'aucun texte postérieur n'est intervenu.
- Seuils 2026 de franchise en base de TVA, taux et seuil du taux réduit d'IS : le document les
  donne lui-même comme « à vérifier ». Ne pas coder la facturation dessus.
- Code APE : attribué par l'INSEE, sans valeur juridique sur la nature réelle de l'activité — ne
  pas en faire un argument de conformité auprès d'un PSP.

---

## 6. Ce qu'il faut écrire (traduction technique)

Phasage proposé, dépendances juridiques en regard.

**Phase 0 — décisions préalables, avant toute ligne de code**
- Trancher L1 strict vs livreurs gérés (§5.1). Conditionne tout le modèle de données.
- Faire valider l'activité CBD par 3 PSP (Stripe Connect, Mangopay, Lemon Way…) *avant* de
  développer : un refus PSP invalide le projet, pas seulement une intégration.
- Choisir un hébergement UE (base + fichiers) pour limiter les transferts hors UE.

**Phase 1 — socle**
Postgres (UE), comptes client / shop / admin, sessions, journal d'audit, durées de conservation
appliquées en base dès la création des tables (RGPD by design), en-têtes de sécurité, rate-limit.

**Phase 2 — catalogue et conformité produit**
Catégories autorisées en dur (liste blanche, pas liste noire), lots, certificats d'analyse liés au
lot, blocage de publication sans COA valide, autocertification DSA art. 30.

**Phase 3 — commande et paiement**
Panier multi-shops → sous-commandes par shop, Stripe Connect en comptes connectés, split avec
frais de port exclus de la commission (§5.2), webhooks, réconciliation, factures par shop,
facture de commission au shop.

**Phase 4 — livraison (L1)**
Statuts fournis par le shop, numéro de suivi transmis, aucune orchestration de transport, aucune
entité livreur, mentions « expédié par <shop> » partout (§5.3).

**Phase 5 — conformité plateforme**
Pages légales versionnées, consentement cookies avec blocage préalable des tags, signalement
produit (DSA art. 16), décisions motivées et recours (art. 17 et 20), exports DAC7 et récapitulatifs
art. 242 bis, procédure de rappel GPSR.

**Schéma de données minimal :** `users`, `shops` (statut KYB, autocertification, n° TVA vérifié),
`products`, `product_batches` (lot, THC, COA), `orders`, `sub_orders` (par shop), `order_items`
(→ lot), `shipments` (statut, tracking, transporteur du shop), `payouts`, `commission_invoices`,
`consents` (cookies + CGV, horodatés, versionnés), `product_reports`, `moderation_actions`,
`appeals`, `audit_log`, `tax_reports` (agrégats DAC7).

---

## 7. Réponse directe à la question posée

Le code actuel **n'apporte rien** au projet marketplace CBD, hors la stack et trois ou quatre bons
réflexes (CSRF, validation Zod, secrets côté serveur). Il ne faut pas le faire évoluer vers une
marketplace : il est connecté à Lovable et sert une application en production sans rapport.

Le document juridique, lui, est solide sur la structure (SASU), le rôle d'intermédiaire, le split
payment et le CBD produit. Il lui manque **toute la couche « obligations propres aux plateformes »** :
DSA, P2B, DAC7 / art. 242 bis / 283 bis du CGI, GPSR — et **toute l'instruction de la livraison**,
qui est justement l'endroit où le statut d'intermédiaire se perd (§5.1 à 5.3). Ces manques ne sont
pas théoriques : ils déterminent des tables, des colonnes et des écrans. Les intégrer maintenant
coûte quelques jours ; les intégrer après le premier client coûte une migration et un rattrapage
déclaratif.
