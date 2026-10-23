# Changelog

Une section par version, trois lignes au plus par rubrique. La version est celle de `hub/version.js`, le tag Git `vX.Y.Z` et la Release GitHub portent le même numéro.

## [Non publié]

### Corrigé
- Sage X3 : lecture de la structure au format réel Syracuse 24R1 (vérifié sur l'instance de préproduction) : champs sous `$properties.$resources.$item.$properties`, libellés `{@n}` résolus via `$localization`, champs exclus/cachés ignorés, types sans le préfixe `application/x-`. Simulateur intégré, bouchon et mocks de test alignés.

### Ajouté
- Plafond d'appels sortants par connecteur : `MYREPORT_MAX_PER_MIN` (défaut 20, MyReport n'ayant qu'une production) et `SF_MAX_PER_MIN` (défaut illimité, crédits Flex).

- **Salesforce via le serveur MCP hébergé « SObject Reads »** : le connecteur REST est remplacé par un proxy MCP (outils `salesforce_tools` et `salesforce_call`), avec verrou refusant tout serveur d'écriture ; External Client App, scope `mcp_api`, PKCE S256 ajouté à tous les flux OAuth, secret client optionnel. Bouchon : serveur SObject Reads simulé (outils provisoires), serveurs d'écriture 403.

- **Bouchon d'entreprise** `charlois-mcp-stub/` : conteneur qui imite Salesforce, Entra/Graph, Dropbox MCP, Sage X3 Syracuse, MyReport MCP et Clevoa (mires OAuth avec refresh, clés d'API, Basic, serveurs MCP HTTP et SSE) sur un jeu de données canin ; deux collaborateurs aux droits différents ; vrais fichiers Excel, PNG, CSV. Intégré par défaut à `docker-compose.dev.yml`. 7 tests de bout en bout hub ↔ bouchon.
- Hub : `DROPBOX_AUTH_URL` et `BROWSER_URL_REWRITE` (mires du bouchon joignables depuis le navigateur).
- Hub, suite au crash-test : une clé MCP valide n'est plus freinée par les échecs d'authentification d'autres clients de la même IP ; un refresh token révoqué efface les jetons et demande une reconnexion claire ; les contenus MCP non textuels (images) sont relayés tels quels ; un seul refresh par collaborateur et par système en cas d'appels concurrents.
- `.env.example` : plus de commentaire sur une ligne à valeur vide (Docker Compose le lisait comme la valeur).
- Bouchon : serveur MCP Dropbox aligné sur les schémas du serveur officiel (`fetch` par `id`, `get_file_metadata` imbriqué, `file_preview` en vignettes signées, `ns_path`) ; niveau de confiance de chaque simulateur documenté.
- Hub : erreurs réseau explicites (système, hôte, cause), nouvel essai de télémétrie à 1/5/30 min après un échec, state OAuth consommé seulement par le bon navigateur. Bouchon : URL de téléchargement signées.

## [1.0.0] — 2026-10-21

Première version déployable de Charlois AI Gateway.

- **Hub MCP** : un conteneur Node 22, transports SSE et Streamable HTTP, lecture seule, jeton personnel de chaque collaborateur transmis tel quel (aucun compte technique), cache de structure par utilisateur expiré à 03:00.
- **Connecteurs** : Salesforce (REST, OAuth + refresh), Sage X3 24R1 (REST Syracuse, OAuth ou clé d'API, simulateur intégré), SharePoint/OneDrive (Microsoft Graph délégué), Dropbox (proxy du serveur MCP officiel, liste blanche), MyReport (proxy MCP SSE, liste blanche `MYREPORT_TOOLS`, simulateur intégré).
- **Portail Charlois AI Gateway** : connexions OAuth et jetons personnels, diagnostic par outil, bar à prompts à onglets, thème sombre, mode démo, badge version et environnement.
- **Sécurité** : `users.json` chiffré AES-256-GCM (`ENCRYPTION_KEY`), clé MCP acceptée uniquement en `Authorization: Bearer`, limitation de débit par IP, anti login-CSRF, conteneur non root en lecture seule.
- **Exploitation** : stacks Portainer pré-prod (`dev`) et prod (`main`) par `extends`, télémétrie Clevoa anonyme quotidienne, backend AWS Lambda `clevoa-backend/`.
- **Tests** : 48 tests `node:test` contre des mocks, verts en pré-prod et en production.

[1.0.0]: https://github.com/sirkazey/Charlois-mcp-finance/releases/tag/v1.0.0
