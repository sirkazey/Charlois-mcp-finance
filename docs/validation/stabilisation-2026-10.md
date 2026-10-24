# Stabilisation d'octobre 2026

Public : direction technique Clevoa, DSI cliente. Objet : compte rendu de la mission de stabilisation qui clôt le
développement fonctionnel initial (gel à la 1.3.1) : lots réalisés, revues indépendantes, résultats des tests, limites.
Ce document sert aussi de journal de progression tant que la mission est en cours.

## Journal de progression

| Lot | Objet | État | Revue |
|---|---|---|---|
| 1 | Audit et nettoyage documentaire | GO | agent E (2 passages) |
| 2 | Télémétrie éditeur | en revue | — |
| 3 | Diagnostic et support | à faire | — |
| 4 | Releases et mises à jour contrôlées | à faire | — |
| 5 | Compatibilité MCP et sécurité | à faire | — |
| 6 | Qualification finale et livraison | à faire | — |

Branche de travail : `maintenance/stabilisation-2026-10`, créée depuis `main` (`affa329`, v1.3.1).

## Lot 1 — Audit et nettoyage documentaire

Inventaire (24/10/2026) :

* Branches distantes : `main` et `dev` (toutes deux sur `affa329`, v1.3.1), `docs/roadmap-skills-adoption-2026-10`
  (roadmap Skills abandonnée, archive non fusionnée). Tags : `v1.2.0`, `v1.2.1`, `v1.3.0`, `v1.3.1` ; `v1.1.0` absent.
* Roadmaps : une seule sur `main`, l'archive [`roadmap-2026-10.md`](../history/roadmap-2026-10.md), dont le § 2
  (catalogue d'évolutions) servait de référence aux lignes « prévu » de l'état des fonctionnalités. Aucune mention des
  Skills sur `main` : la roadmap Skills n'existe que sur sa branche.
* Contradictions relevées : lignes « prévu » (mini-portail d'administration, tableau de bord, connecteurs
  déclaratifs) contraires au gel ; § 8 de l'exploitation annonçant un mini-portail ; cycle de livraison
  « `main` → production automatique » contraire à la stratégie de versions figées (traité au lot 4).
* Composants : hub (Node 22, 3 dépendances), bouchon `clevoa-mcp-stub`, backend Lambda `clevoa-backend` (journalisation
  seule, sans persistance), outils de charge, scripts `ops/`, CI unique (tests, docs, sauvegarde et restauration,
  Semgrep, CodeQL, Gitleaks, Trivy) et DAST.

Travaux :

* [`docs/roadmap-produit.md`](../roadmap-produit.md) : seule roadmap active, trois axes, statuts et critères de sortie,
  liste « hors roadmap ».
* Quatre décisions datées dans [`decisions.md`](../history/decisions.md) : gel 1.3.1, abandon du registre Skills,
  stratégie de maintenance, stratégie de versions multi-client.
* Nouveau statut « non planifié » ([conventions](../CONTRIBUTING.md#statut-des-fonctionnalités)) appliqué aux pistes
  écartées ; renvois mis à jour dans `README.md`, `docs/README.md`, l'exploitation et l'archive (note en tête, contenu
  inchangé).

Contrôles : `node ops/check-docs.js` réussi ; `npm test` du hub : 78 tests, 77 réussis, 1 ignoré (verrou de production,
exécuté par le job CI `APP_ENV=production`).

Revue (agent E, relecteur indépendant) : premier passage « corrections requises » (README annonçant une instance
déployée ; compatibilité Claude Code déclarée « faite » sans entrée au journal), corrigé dans `eab8a3f` ; second
passage **GO**. Points reportés : liste de tags et `main` présenté comme la production (lot 4), exemple de télémétrie
daté (lot 2). Commits : `26af868`, `eab8a3f`.

## Lot 2 — Télémétrie éditeur

État constaté : le hub envoyait version, environnement, connecteurs, compteurs ; le backend journalisait sans
persistance ni identification d'installation ; après trois échecs, le hub retentait toutes les 30 minutes sans fin ;
aucun délai d'envoi ; la réponse du backend révélait le nombre d'envois du jour tous clients confondus.

Travaux :

* Hub : identifiant aléatoire d'installation (UUID) créé au premier envoi et conservé dans `users.json` chiffré ;
  délai de 10 s par envoi ; essais bornés (1, 5, 30 min puis horaire quotidien) ; avertissement de journal si la
  version est sous le minimum annoncé. Aucune autre donnée ajoutée au payload.
* Backend (`clevoa-backend/`) : clés `client=clé` comparées à temps constant sur leurs empreintes, clé jamais stockée ;
  validation stricte (champs connus, types, bornes, 4 Ko) ; fiche par installation rangée sous son client
  (`client#installation`) dans DynamoDB, ou en mémoire sans AWS ; expiration 400 jours après le dernier contact ;
  fonction `report` quotidienne (silence au-delà de 48 h, version sous `MIN_VERSION`) vers CloudWatch et SNS ;
  droits IAM limités à `UpdateItem`, `Scan` et `Publish` sur les seules ressources de la pile ; concurrence plafonnée à 5.
* Documentation : finalité, données, fréquence, destinataire, conservation, désactivation et point juridique ouvert
  ([sécurité § 4](../admin/securite.md#4-télémétrie-clevoa)) ; README du backend ; tests et CI.

Tests : backend 13/13 ; hub 81 tests (80 réussis et 1 ignoré en pré-prod ; 79 réussis et 2 ignorés en production) ;
bouchon 11/11 ; documentation réussie. Une exécution en mode production a montré 8 échecs des tests SSO, non
reproduits sur 9 relances (4 suites complètes, 5 fichiers SSO seuls) : aléa consigné, à surveiller en CI.
Non exécuté : déploiement AWS, `serverless package` (Serverless Framework v4 non installé, compte requis), DynamoDB et
SNS réels.

Revues du lot 2, premier passage :

* agent F (sécurité) : « corrections requises », aucune anomalie critique. Majeure : le hub journalisait tels quels des
  champs renvoyés par le backend (injection de fausses lignes de journal). Mineures retenues : redirections suivies
  avec la clé, compteur remis à zéro après l'envoi, 503 explicite sur la configuration, empreinte courte de clé
  stockée, taille contrôlée après décodage base64, sujet SNS non chiffré, conservation incomplète dans la doc,
  incohérence de version.
* agent E (architecture) : « corrections requises ». Fiches orphelines qui alerteraient pendant 400 jours ; identifiant
  copié par la restauration trimestrielle en pré-production ; README incomplet.

Corrections : statut et version minimale filtrés avant journalisation (test d'injection), `redirect: "error"`,
compteur décrémenté du nombre envoyé, 503 sans détail, entrées `client=clé` nommées obligatoires, taille contrôlée
avant décodage, sujet SNS chiffré (KMS géré par AWS), fiche `client#installation#environnement`, installations
« perdues » sans alerte au-delà de 30 jours, échec SNS sans échec de la fonction, retrait d'une fiche documenté,
préversions comparées comme côté backend, version portée à 1.3.2, conservation complète (TTL, PITR 35 jours,
CloudWatch, e-mails). Restent documentées comme limites : rôle IAM commun aux deux fonctions, pas de limitation de
débit par route, quota de concurrence du compte AWS.

Tests après corrections : backend 15/15 ; hub 82 tests (81 réussis, 1 ignoré en pré-prod ; 80 réussis, 2 ignorés en
production) ; bouchon 11/11 ; documentation réussie ; scénario de sauvegarde et restauration (A à L) joué en local
sous Docker sur la stack pré-prod : tous les scénarios passent.
