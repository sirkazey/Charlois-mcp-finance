# Roadmap produit

Public : direction, Clevoa, DSI cliente. Objet : ce sur quoi le produit évolue après le gel fonctionnel de la
version 1.3.1, et ce qu'il ne deviendra pas. Seule roadmap active ; les feuilles de route antérieures sont des archives
([octobre 2026](history/roadmap-2026-10.md)). Décision : [décisions du 2026-10-24](history/decisions.md).

État au 24 octobre 2026 : **aucune instance n'est déployée chez un client**. Les fonctionnalités sont développées et
testées automatiquement ; Sage X3 et Salesforce ont été exercés sur la préproduction et la sandbox du Groupe Charlois.
Le statut exact de chaque fonction est dans [l'état des fonctionnalités](validation/etat-des-fonctionnalites.md).

## 1. Cadre

Le périmètre fonctionnel de la 1.3.1 est **gelé** : connecteurs Salesforce, Sage X3, SharePoint / OneDrive, Dropbox et
MyReport, portail, SSO Entra ID, sauvegarde et restauration, télémétrie éditeur. Le produit évolue pour :

1. corriger des anomalies ;
2. améliorer la sécurité ;
3. rester compatible avec MCP et les assistants IA ;
4. rester compatible avec les API des applications métier ;
5. ajouter une intégration quand un client identifié en a besoin ;
6. faciliter l'exploitation et la maintenance.

Le produit ne deviendra pas un chatbot, un moteur LLM, un orchestrateur d'agents, un registre ou un outil de création
d'Agent Skills, une plateforme de gouvernance IA ni une plateforme de téléadministration. La formalisation des méthodes
métier et la création de Skills relèvent du conseil Clevoa et des fonctions natives des assistants.

Statuts employés ci-dessous : **fait** (livré, preuve citée : test automatisé ou entrée du journal des tests réels),
**à faire** (engagé, sans date),
**sur besoin** (déclenché seulement par une demande client identifiée).

## 2. Axe 1 — Qualification et stabilisation

Objectif : passer de « testé sur bouchon » à « disponible » sur les systèmes du premier client, sans ajouter de
fonction.

| Sujet | Statut | Critère de sortie |
|---|---|---|
| Tests réels des connecteurs SharePoint, Dropbox, MyReport | à faire | un appel réussi par outil sur un vrai compte, consigné dans le [journal](validation/journal-tests-reels.md) |
| Cloisonnement avec des comptes non administrateurs (Sage X3, Salesforce) | à faire | un compte restreint ne voit que ses données, preuve consignée |
| Authentification et révocation (expiration du jeton Salesforce, mot de passe Syracuse changé, SSO `entra`) | à faire | voyant rouge et message de reconnexion constatés sur chaque système |
| Sauvegarde et restauration sur un serveur du client | à faire | une restauration réelle, puis une par trimestre ([exploitation](admin/exploitation.md)) |
| Sécurité : CI (Semgrep, CodeQL, Gitleaks, Trivy) sur chaque PR | fait | CI verte avant toute fusion ; revue de sécurité à chaque version |
| Compatibilité MCP : Claude Desktop | fait | journal des tests réels S13–S19 et F4–F5 (23/10/2026) |
| Compatibilité MCP : Claude Code, ChatGPT, Copilot | à faire | une session réelle par assistant, consignée au journal ; Claude Code déclaré vérifié sans entrée au journal |
| Correction des anomalies remontées en recette | à faire | anomalie reproduite par un test, corrigée, publiée dans une version corrective |

La liste complète des tests réels restants est dans [l'état des fonctionnalités § 3](validation/etat-des-fonctionnalites.md#3-tests-restant-à-réaliser).

## 3. Axe 2 — Observabilité et maintenance

Objectif : Clevoa sait quelles installations tournent, dans quelle version, et l'administrateur du client garde la
main sur son déploiement. Aucun accès de Clevoa à l'infrastructure ni aux données du client.

| Sujet | Statut | Critère de sortie |
|---|---|---|
| Télémétrie éditeur : identifiant d'installation, version, dernier contact, connecteurs déclarés, persistance, détection des installations silencieuses et des versions obsolètes | fait (tests sans AWS) ; déploiement AWS à faire | [sécurité § 4](admin/securite.md#4-télémétrie-clevoa), [backend](../clevoa-backend/README.md) ; validation juridique de la télémétrie |
| Diagnostic exportable, relu par l'administrateur avant envoi | fait | [exploitation § 9](admin/exploitation.md#9-diagnostic-et-support) ; test automatisé de l'absence de valeur sensible |
| Publication de versions immuables (tag Git) et déploiement d'une version choisie | à faire | [installation § 6](admin/installation.md#6-cycle-de-livraison-et-versions) |
| Retour arrière à la version précédente | à faire | procédure documentée et testée en local ([exploitation § 2](admin/exploitation.md#2-démarrer-arrêter-redémarrer-mettre-à-jour-revenir-en-arrière)) |
| Suivi des versions du SDK MCP et des dépendances | à faire, à chaque version | `npm audit` et Trivy sans vulnérabilité haute ou critique corrigeable |

Pas de prise de contrôle à distance, pas de tunnel, pas de mise à jour automatique imposée aux installations.

## 4. Axe 3 — Intégrations applicatives

Objectif : couvrir les applications des clients, une à la fois, sur demande identifiée.

| Sujet | Statut | Règle |
|---|---|---|
| Nouveau connecteur | sur besoin | un client et un cas d'usage nommés ; serveur MCP officiel de l'éditeur en priorité, API REST en lecture sinon ; [écrire un connecteur](developer/connecteurs.md) |
| Adaptation aux évolutions des API (Salesforce, Graph, Syracuse, Dropbox, MyReport) | sur besoin | test de régression avant correction |
| Amélioration d'un connecteur existant (ex. représentations Sage X3 demandées à l'intégrateur) | sur besoin | constat en recette, test, documentation du connecteur |

Chaque intégration livre ses tests automatisés, sa section dans la [configuration des connecteurs](admin/configuration.md)
et sa ligne dans l'état des fonctionnalités. Un connecteur propre à un client est désactivé par défaut (sans
configuration, il n'est pas exposé en production) ; une personnalisation ne justifie pas un fork ni une branche client.

## 5. Hors roadmap

Écartés ou non planifiés, conservés pour mémoire dans les archives :

* registre et gestion d'Agent Skills (branche `docs/roadmap-skills-adoption-2026-10`, conservée comme archive, non
  fusionnée) ;
* interface web conversationnelle ou appel d'un LLM depuis le hub ;
* mini-portail d'administration, santé des connecteurs sur le portail, interface déclarative des connecteurs MCP,
  tableau de bord graphique des installations
  ([archive § 2](history/roadmap-2026-10.md#2-catalogue-des-évolutions-possibles-optionnel-roadmap-clevoa)) ;
* accès depuis claude.ai web et mobile, écarté ([décisions](history/decisions.md)).

Une de ces pistes ne revient qu'avec une nouvelle décision datée et un client qui la demande.
