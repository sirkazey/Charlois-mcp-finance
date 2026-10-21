# Changelog

Une section par version, trois lignes au plus par rubrique. La version est celle de `hub/version.js`, le tag Git `vX.Y.Z` et la Release GitHub portent le même numéro.

## [1.0.0] — 2026-10-21

Première version déployable de Charlois AI Gateway.

- **Hub MCP** : un conteneur Node 22, transports SSE et Streamable HTTP, lecture seule, jeton personnel de chaque collaborateur transmis tel quel (aucun compte technique), cache de structure par utilisateur expiré à 03:00.
- **Connecteurs** : Salesforce (REST, OAuth + refresh), Sage X3 24R1 (REST Syracuse, OAuth ou clé d'API, simulateur intégré), SharePoint/OneDrive (Microsoft Graph délégué), Dropbox (proxy du serveur MCP officiel, liste blanche), MyReport (proxy MCP SSE, liste blanche `MYREPORT_TOOLS`, simulateur intégré).
- **Portail Charlois AI Gateway** : connexions OAuth et jetons personnels, diagnostic par outil, bar à prompts à onglets, thème sombre, mode démo, badge version et environnement.
- **Sécurité** : `users.json` chiffré AES-256-GCM (`ENCRYPTION_KEY`), clé MCP acceptée uniquement en `Authorization: Bearer`, limitation de débit par IP, anti login-CSRF, conteneur non root en lecture seule.
- **Exploitation** : stacks Portainer pré-prod (`dev`) et prod (`main`) par `extends`, télémétrie Clevoa anonyme quotidienne, backend AWS Lambda `clevoa-backend/`.
- **Tests** : 48 tests `node:test` contre des mocks, verts en pré-prod et en production.

[1.0.0]: https://github.com/sirkazey/Charlois-mcp-finance/releases/tag/v1.0.0
