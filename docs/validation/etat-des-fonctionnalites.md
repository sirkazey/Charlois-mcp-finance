# État des fonctionnalités et limites connues

Version 1.2.1. Statuts selon [les conventions](../CONTRIBUTING.md#statut-des-fonctionnalités) : **disponible** (vérifié
sur le système réel), **testé sur bouchon** (tests automatisés et simulateur seulement), **expérimental**, **prévu**.
Preuves : [journal des tests réels](journal-tests-reels.md), [campagne de charge](charge-v1.2.1.md), CI.

## 1. Fonctionnalités

| Fonctionnalité | Statut | Preuve | Reste à faire |
|---|---|---|---|
| Sage X3 24R1, identifiant et mot de passe Syracuse (`basic`) | disponible | préproduction 4CAD Cloud, 23/10/2026 (S1–S19) | test avec un compte X3 restreint ; production |
| Sage X3, OAuth2 ou clé d'API `bearer` | testé sur bouchon | tests hub | un vrai IdP Syracuse |
| Salesforce, serveur MCP hébergé SObject Reads | disponible (sandbox) | sandbox `preprod`, 23/10/2026 (F1–F6) | org de production ; expiration réelle du JWT (durée annoncée par Salesforce, non mesurée) et rotation du refresh token ; compte restreint |
| SharePoint / OneDrive (Graph délégué) | testé sur bouchon | tests hub, bouchon | application Entra réelle, revue des permissions `Files.Read.All` et `Sites.Read.All` |
| Dropbox (serveur MCP officiel) | testé sur bouchon | tests hub, bouchon aligné sur les schémas du serveur officiel (22/10/2026) | acceptation par `mcp.dropbox.com` d'un jeton d'app tierce |
| MyReport (proxy MCP SSE) | testé sur bouchon | plomberie SSE et liste blanche seulement | serveur MCP de l'éditeur, non livré ; outils réels inconnus |
| SSO Microsoft Entra ID (`entra`) | testé sur bouchon | `hub/test/sso.test.js`, bouchon | activation sur un vrai locataire |
| Portail, diagnostic, blocs de configuration, bar à prompts | disponible | usage quotidien en préproduction | |
| Claude Desktop via `mcp-remote` | disponible | vérifié le 23/10/2026 sur Windows | |
| Claude Code, ChatGPT, Copilot (MCP HTTP + en-tête) | disponible (Claude Code) | Claude Code vérifié ; ChatGPT et Copilot non exercés | un test par client |
| Claude.ai web et mobile | écarté | décision ([historique](../history/decisions.md)) | |
| Transports Streamable HTTP et SSE | disponible | tests hub, campagne de charge | retrait du SSE quand les assistants cibles seront tous en Streamable HTTP |
| Chiffrement `users.json`, clé MCP en en-tête, limitation de débit, en-têtes de sécurité | disponible | tests hub, ZAP passif | |
| Sauvegarde automatique, restauration scriptée | testé sur bouchon | CI (`ops/test-backup-restore.sh`), `hub/test/backup.test.js` | une restauration sur un serveur du client, puis une par trimestre |
| Reverse proxy nginx (profil `proxy`) | testé sur bouchon | `docker compose config` en local ; non exercé en CI (Trivy n'analyse que la configuration des fichiers Compose) | déploiement réel ; `COMPOSE_PROFILES` sous Portainer |
| Télémétrie Clevoa et backend Lambda | testé sur bouchon | tests hub (handler exécuté localement) | déploiement AWS, nom de domaine `clevoa.fr` |
| Capacité 50 collaborateurs | démontrée sur bouchons | [campagne de charge](charge-v1.2.1.md) | recette de charge sur la préproduction réelle |
| Mini-portail d'administration (retrait d'une entrée, suspension) | prévu | [feuille de route](../history/roadmap-2026-10.md) | |
| Santé des connecteurs, tableau de bord Clevoa, connecteurs MCP déclaratifs | prévu | [feuille de route](../history/roadmap-2026-10.md) | |

## 2. Limites connues

* **Cloisonnement sur les systèmes réels** observé avec un compte administrateur seulement. Le test avec un compte
  restreint sur Sage X3 et Salesforce est la première preuve manquante.
* **Sage X3** : seules les colonnes de liste sont renvoyées par `sagex3_query` ; type de pièce (facture / avoir) et
  statut de règlement non exposés tant que l'intégrateur n'a pas publié les représentations demandées ; fiche
  complète de 60 à 130 000 caractères (paramètre `champs`) ; délai de 30 s par requête ; enregistrements techniques
  en tête sans tri.
* **Salesforce** : une session MCP vers SObject Reads par appel d'outil (trois requêtes HTTP) ; un 429 amont est rendu
  sans statut ni consigne ; usage facturable en crédits Flex (`SF_MAX_PER_MIN`).
* **MyReport** : plafond global de 20 appels par minute pour tous les collaborateurs, première limite atteinte en
  charge ; outils réels inconnus.
* **SSO** : un compte désactivé dans Entra garde sa clé MCP jusqu'à régénération ; aucun outil ne retire une entrée
  de `users.json` ; activer le SSO sur une instance existante invalide toutes les clés antérieures.
* **Sessions SSE** abandonnées sans fermeture TCP : pas de délai d'inactivité propre au hub ; non mesuré.
* **Routes MCP non plafonnées** par clé : un client emballé peut saturer un backend réel.
* **Mémoire** : stable sur 27 minutes de charge (RSS ≤ 132 Mo), non démontrée sur une journée.
* **Capacité réelle** : latences et quotas des systèmes réels non mesurés ; throttling Graph 429 non testé.
* **Claude.ai web et mobile** non pris en charge (pas d'en-tête d'autorisation possible, hub interne).
* **Rapports de test** : les tests réels ont été faits par une seule personne, avec un seul profil.

## 3. Tests restant à réaliser

| Test | Pourquoi il compte | Prérequis |
|---|---|---|
| Cloisonnement avec un compte **non administrateur** (Sage et Salesforce) | seule preuve que le hub n'élargit pas les droits | un compte de test restreint sur chaque système |
| Expiration et renouvellement réels du jeton Salesforce (JWT ~ 2 h, rotation du refresh token) | vérifié sur le bouchon seulement | laisser une session ouverte plus de 2 h puis interroger |
| Révocation : mot de passe Syracuse changé, autorisation Salesforce révoquée | voyant rouge et message de reconnexion attendus | action volontaire sur chaque système |
| Salesforce production | même procédure, serveurs d'écriture désactivés | confirmation de l'intégrateur |
| SharePoint, Dropbox sur un vrai compte | jamais branchés | application Entra déléguée ; app Dropbox |
| MyReport | serveur MCP annoncé, non livré | éditeur |
| SSO Entra en mode `entra` | jamais exercé contre Microsoft | URI de redirection sur l'application, `MS_TENANT_ID` en GUID |
| Restauration sur un serveur du client (`sudo ops/restore.sh`) | jouée en CI à chaque commit, pas sur un serveur réel | accès au serveur, `ENCRYPTION_KEY` du coffre |
| Recette de charge en préproduction réelle (`loadtest/run.js` adapté) | latences et quotas réels, 429 Graph | comptes de test, jamais la production |
| Exactitude financière sur un jeu de référence (factures, avoirs, signes, devises, dates) | réponses attendues approuvées par la Finance | jeu de référence |
| Injection de prompts et contenus non fiables dans les données relayées | aucun accès supplémentaire ni exfiltration | cas de test documentés |
| Comparaison croisée Sage + Salesforce dans une même réponse | vérifie la consigne par défaut du serveur MCP | |
