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
| 4 | Releases et mises à jour contrôlées | GO | agent E (1 passage), agent F (3 passages, réserve : CI verte avant fusion) |
| 5 | Compatibilité MCP et sécurité | en revue | — |
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

Revues du lot 4 : agent E (architecture) **GO**, retour arrière rejoué par l'agent avec ses propres images ; six
remarques non bloquantes. Agent F (sécurité) : « corrections requises ». Majeure : une fois l'image de base figée,
rien ne détectait plus ses failles (Trivy ne scannait que le dépôt, aucune exécution planifiée). Mineures :
immuabilité des tags affirmée sans protection posée, « même image » trop fort, `npm audit` annoncé sans être en CI,
ancienne version jamais en écriture pendant le test de retour arrière, nettoyage des images, choix de la version
précédente.

Corrections : job `trivy-image` (image construite comme en production) et exécution hebdomadaire de la CI sur `main` ;
`npm audit` dans le job `tests` ; procédure de version corrective de sécurité avec délai cible ; documentation exacte
(immuabilité par convention tant que la protection `v*` n'est pas posée, même contenu de base à partir de la
1.3.2-rc.1, anciens tags sur base flottante) ; test de retour arrière avec écriture par la version précédente, version
précédente choisie parmi les ancêtres de l'arbre testé, images construites supprimées. Le premier scan local de
l'image (Trivy 0.67.2) a trouvé 10 vulnérabilités hautes, toutes dans les dépendances embarquées de npm, corepack et
yarn de l'image Node : ces outils sont retirés de l'image d'exécution, le scan suivant est propre (code de retour 0).
Gitleaks (94 commits, aucune fuite) et Semgrep (règles `p/javascript`, `p/nodejs`, `p/security-audit`, aucun constat)
ont aussi été exécutés en local sur la branche. Reste hors périmètre : actions GitHub référencées par version et non
par empreinte (antérieur à la mission).

Second passage de l'agent F : corrections acquises, mais clé `if-no-files-found` en double dans le workflow (fichier
invalide pour GitHub, aucune CI ne se serait exécutée). Corrigé ; `actionlint` 1.7.7 confirme l'erreur avant correction
et n'émet après que deux avertissements shellcheck antérieurs à la mission (variable de boucle inutilisée). Validation
par une exécution réelle : PR en brouillon vers `dev`.

Troisième passage de l'agent F : **GO** sous réserve que la CI de la PR #16 finisse au vert avant fusion. Première
exécution réelle sur GitHub (`705a130`) : 8 jobs verts dont `trivy-image`, `npm audit` et la sauvegarde ; deux rouges,
corrigés dans `ce291be` :

* `rollback` : la copie de sauvegarde, faite en root dans le conteneur, restait en mode 600 et illisible pour le runner
  non root (vert en local parce que la session tourne en root). Reproduit en local avec un utilisateur non root, puis
  corrigé (`chmod 644` de la copie chiffrée) et vérifié avec le même utilisateur.
* CodeQL : une alerte haute nouvelle, `js/incomplete-sanitization` dans `hub/test/release.test.js` (version échappée
  par une expression incomplète). Identifiée en exécutant CodeQL (bundle officiel, suite `security-extended`) en local,
  corrigée par une comparaison littérale ; la requête ne renvoie plus rien.

Commits du lot 4 : `073ed7e`, `140221a`, `705a130`, `ce291be`.

## Lot 5 — Compatibilité MCP et sécurité

**Compatibilité.** SDK `@modelcontextprotocol/sdk` 1.32.1 ; la 1.32.2 (23/10/2026) ne change que l'enregistrement des
outils après `connect()`, que le hub n'utilise pas : pas de mise à jour, conformément à la règle « pas de mise à jour
inutile ». Transports Streamable HTTP (sans état) et SSE. Nouveau `hub/test/compat.test.js` (8 tests en JSON-RPC brut,
indépendants du client du SDK) : négociation de chacune des cinq révisions du protocole (2024-10-07 à 2025-11-25) et
d'une révision inconnue, identité et consignes du serveur, schéma objet, description et `readOnlyHint` des 14 outils,
erreurs JSON-RPC sans 500 (outil inconnu, arguments hors schéma, méthode inconnue, JSON mal formé), reconnexion SSE
répétée, journaux détaillés sans argument, résultat, clé ni jeton. Clients déclarés : Claude Desktop seul vérifié en
réel ; Claude Code, ChatGPT et Copilot testés au niveau du protocole seulement.

**Dépendances.** `npm audit --omit=dev` : 0 vulnérabilité (hub, bouchon), désormais exécuté en CI. Backend : aucune
dépendance. Image : base figée, npm retiré, Trivy image propre (lot 4).

**Contrôles de sécurité** (preuves existantes ou ajoutées, aucun contrôle affaibli) :

| Point | Preuve |
|---|---|
| Cloisonnement des utilisateurs | `mcp.test.js` (cloisonnement, cache par utilisateur, session SSE liée à sa clé), `sso.test.js` (Marie et Paul, poste partagé, usurpation) |
| Transmission des jetons, aucun compte technique | `mcp.test.js` : chaque appel amont porte le jeton de l'appelant, jamais un jeton de service |
| Lecture seule | listes blanches et refus d'écriture (`mcp.test.js`, `docs.test.js`), `readOnlyHint` sur les 14 outils (`compat.test.js`) |
| Protection des points d'entrée | 401 sans clé, clé en URL refusée, limitation de débit, origine vérifiée, en-têtes de sécurité (`mcp.test.js`, `portal.test.js`) |
| Gestion des erreurs | `isError` sans arrêt du processus, erreurs JSON-RPC sans 500 (`compat.test.js`) |
| Secrets | `users.json` chiffré, secrets masqués au portail, diagnostic sans secret (`diagnostic.test.js`), Gitleaks (historique complet, aucune fuite) |
| Journaux | `LOG_LEVEL=debug` sans argument ni secret (`compat.test.js`), réponses du backend filtrées avant journalisation (`telemetry.test.js`) |
| Télémétrie, sauvegardes | lots 2 et 4 ; scénarios de sauvegarde et restauration A à L |
| Exposition réseau | aucun port ajouté ; diagnostic et contrôle de santé internes au conteneur |
| Configuration Docker | utilisateur `node`, lecture seule, `cap_drop: ALL`, `no-new-privileges` (inchangés), Trivy configuration et image |

Analyses exécutées en local sur la branche : Gitleaks 8.30.1 (aucune fuite), Semgrep 1.181.1 (aucun constat), Trivy
0.67.2 (image : 0 après retrait de npm), CodeQL `security-extended` (une alerte nouvelle corrigée ; restent cinq alertes
antérieures à la mission : bouchon de test sans limitation de débit et deux expressions coûteuses, `store.js:58`
injection de propriété — nom de système toujours validé par la liste des connecteurs —, requête de test construite
depuis la liste des fichiers du portail).

**Tests réels impossibles depuis cet environnement**, consignés dans
[l'état des fonctionnalités § 3](etat-des-fonctionnalites.md#3-tests-restant-à-réaliser) : comptes restreints et
révocation sur Sage X3 et Salesforce, Salesforce production, SharePoint, Dropbox, MyReport, SSO `entra`, restauration
sur le serveur du client, charge en préproduction réelle, exactitude financière, injection de prompts, sessions
réelles avec Claude Code, ChatGPT et Copilot, backend AWS déployé, mise à jour et retour arrière sous Portainer,
diagnostic chez le client. Aucun n'est présenté comme fait.

Tests : hub 101 tests (100 réussis, 1 ignoré en pré-prod ; 99 réussis, 2 ignorés en production) ; documentation réussie.
