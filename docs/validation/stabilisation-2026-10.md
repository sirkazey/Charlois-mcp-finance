# Stabilisation d'octobre 2026

Public : direction technique Clevoa, DSI cliente. Objet : compte rendu de la mission de stabilisation qui clôt le
développement fonctionnel initial (gel à la 1.3.1) : lots réalisés, revues indépendantes, résultats des tests, limites.
Ce document sert aussi de journal de progression tant que la mission est en cours.

## Journal de progression

| Lot | Objet | État | Revue |
|---|---|---|---|
| 1 | Audit et nettoyage documentaire | GO | agent E (2 passages) |
| 2 | Télémétrie éditeur | GO | agents E et F (2 passages chacun) |
| 3 | Diagnostic et support | GO | agents F (1 passage) et E (2 passages) |
| 4 | Releases et mises à jour contrôlées | en revue | — |
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

Revues du lot 2, second passage : agent F **GO** (sondes rejouées : redirection, réponse piégée, clés mal formées,
taille, échec SNS) ; agent E **GO** (suites rejouées sur un extrait propre du commit). L'agent E n'a pas pu rejouer
lui-même le scénario Docker (construction d'image bloquée par le proxy de son environnement). Commits : `f72a0fb`,
`2e5a600`.

## Lot 3 — Diagnostic et support

Existant : `/health` (sans détail), journaux Docker plafonnés, bouton « Tester » par outil sur le portail (appel réel
avec le compte du collaborateur), version affichée sur le portail et dans les journaux, sauvegardes. Manquait : un
moyen pour l'administrateur de transmettre un état technique complet sans rien divulguer, et un état de santé visible
dans Portainer.

Travaux :

* `hub/diagnostic.js` : rapport JSON lancé par l'administrateur (`docker exec … node diagnostic.js`), en lecture seule,
  sans port ni dépendance. Contenu : version, environnement, `/health`, variables réduites à « renseignée » ou « vide »,
  état du fichier chiffré et compteurs, connecteurs et joignabilité de leur hôte (requête `HEAD` sans identifiant,
  désactivable par `--sans-reseau`), télémétrie, liste des problèmes. Ni secret, ni jeton, ni e-mail, ni URL, ni donnée
  métier.
* Contrôle de santé Docker du hub dans `docker-compose.yml` (hérité par les deux stacks).
* [Exploitation § 9](../admin/exploitation.md#9-diagnostic-et-support) : contenu du rapport, relecture avant envoi, ce
  que Clevoa ne fait jamais (ni tunnel, ni accès distant, ni commande à distance).

Tests : `hub/test/diagnostic.test.js` (8 tests : rapport complet, absence de 23 valeurs sensibles, joignabilité, hôte
injoignable, variables piégées, mauvaise clé, hub arrêté, lecture seule) ; hub 90 tests (89 réussis, 1 ignoré en
pré-prod ; 88 réussis, 2 ignorés en production). Vérifié dans le conteneur de la stack pré-prod construite en local : `docker exec
mcp-hub-preprod node diagnostic.js` (système de fichiers en lecture seule, utilisateur `node`) produit un rapport sans
problème signalé, cinq connecteurs joignables ; hub « healthy » après 45 s.

Revues du lot 3 : agent F (sécurité) **GO**, sonde avec variables piégées (URL à identifiants, paramètres secrets,
retour à la ligne, redirection) sans aucune fuite ; quatre mineures traitées dans `830653e` (test des variables
piégées, `TRUST_PROXY` numérique seulement, identifiant validé, formulation). Agent E (architecture) : « corrections
requises » : conduite à tenir quand le hub est arrêté ou redémarre en boucle, nombres de tests. Corrigé : § 9 complété
(journaux d'abord, diagnostic dans un conteneur jetable `docker compose run --rm --no-deps`, vérifié en local), problèmes
signalés pour un connecteur configuré sans URL et une `PUBLIC_URL` invalide, nombres alignés.

Second passage de l'agent E : **GO** (`92c8eb4`). Commits du lot 3 : `02b6bfc`, `830653e`, `92c8eb4`.

## Lot 4 — Releases et mises à jour contrôlées

État constaté : stacks Portainer en GitOps sur des branches mouvantes (`dev` → pré-production, `main` → production,
mise à jour à chaque commit) ; image de base `node:22-alpine` flottante (un même tag reconstruit plus tard donne une
autre image) ; retour arrière documenté sur une liste de tags inexacte (`v1.0.0` absent de GitHub, `v1.3.0` et
`v1.3.1` omis) et jamais testé.

Travaux :

* Installations déployées depuis un tag Git (`refs/tags/vX.Y.Z`), GitOps désactivé chez le client ; `dev` réservé à la
  plateforme d'intégration de Clevoa ; `main` = versions validées. Aucune branche par client.
* Image de base figée par empreinte (`node:22-alpine@sha256:fe4f6d74…`, Node 22.23.4, empreinte vérifiée sur Docker Hub)
  dans les deux `Dockerfile` et le conteneur de sauvegarde.
* Version candidate `1.3.2-rc.1` (non qualifiée pour la production) ; `hub/test/release.test.js` vérifie la
  cohérence version / `package.json` / lockfile / CHANGELOG et l'image figée.
* `ops/test-rollback.sh` et job CI `rollback` : version courante → version publiée précédente → courante, sur le même
  volume, conteneur en lecture seule sans privilèges ; vérifie démarrage, version, connexion d'un collaborateur et
  identifiant d'installation.
* Procédures : publication en 7 étapes et installation chez le client en 3 étapes ([installation § 6](../admin/installation.md#6-cycle-de-livraison-et-versions)),
  mise à jour et retour arrière ([exploitation § 10](../admin/exploitation.md#10-mise-à-jour-et-retour-arrière)), tableaux
  d'environnements, en-têtes des fichiers Compose, conventions.

Tests : hub 93 tests (92 réussis, 1 ignoré en pré-prod ; 91 réussis, 2 ignorés en production) ; bouchon 11/11 ; backend
15/15 ; documentation réussie. En local sous Docker : `ops/test-rollback.sh` réussi (1.3.2-rc.1 → v1.3.1 →
1.3.2-rc.1) ; scénario de sauvegarde et restauration A à L réussi avec l'image figée et le contrôle de santé. Images
construites localement à travers le proxy de la session (Dockerfile du dépôt précédé de l'autorité du proxy) ; la CI
construit les Dockerfile tels quels.

Actions manuelles (droits de la session insuffisants) : créer le tag `v1.3.2-rc.1` et sa Release sur `main` ; poser
une règle de protection des tags `v*` ; reconfigurer les stacks Portainer existantes sur un tag.
