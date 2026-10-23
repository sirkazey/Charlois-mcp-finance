# Changelog

Une section par version, trois lignes au plus par rubrique. La version est celle de `hub/version.js`, le tag Git `vX.Y.Z` et la Release GitHub portent le même numéro.

## [Non publié]

### Corrigé
- Sage X3 : lecture de la structure au format réel Syracuse 24R1 (vérifié sur l'instance de préproduction) : champs sous `$properties.$resources.$item.$properties`, libellés `{@n}` résolus via `$localization`, champs exclus/cachés ignorés, types sans le préfixe `application/x-`. Simulateur intégré, bouchon et mocks de test alignés.
- Sage X3 : une représentation absente du dossier (404) ou interdite à l'utilisateur (403) n'empêche plus le diagnostic ni les outils ; elle est signalée comme absente. Une clé révoquée (401) reste bloquante.
- Sage X3 : structure chargée en parallèle et délai max par requête (`SAGE_TIMEOUT_MS`, défaut 30 s) : le diagnostic ne reste plus « en cours » indéfiniment.
- Sage X3 : en-tête `Accept-Language` (`SAGE_LANG`, défaut `fr-FR,fr`) : Syracuse traduit les libellés selon cet en-tête (capture en anglais sans lui). Prototypes réels de PINVOICE (liste et fiche, anonymisés) ajoutés comme fixtures de test.
- Traçabilité : chaque résultat d'outil se termine par une ligne « Source : <système> » (avec le dossier pour Sage X3, sandbox ou production pour Salesforce), que les instructions du serveur demandent au modèle de citer. Ces instructions demandent aussi d'interroger Sage X3 et Salesforce quand une question sur un tiers, une commande ou une facture ne nomme pas le système.
- Salesforce : bouchon et mocks alignés sur les six outils réels du serveur SObject Reads et leurs arguments (`q`, `objects`, `sobject-name`, `id`, `relationship-path`) ; `LIMIT` ajouté d'office aux SOQL sans borne (`SF_DEFAULT_LIMIT`, défaut 200).
- Salesforce : identité (email du portail) obtenue par l'outil `getUserInfo` du serveur SObject Reads quand `userinfo` est refusé (pas d'étendue openid) ; vérifié sur la sandbox. Noms réels des six outils du serveur hébergé documentés : find, getObjectSchema, getRelatedRecords, getUserInfo, listRecentSobjectRecords, soqlQuery.
- Outils de découverte : sagex3_representations et salesforce_tools indiquent l'instance et le dossier interrogés (prod, test ou simulateur) et l'environnement du hub, pour que le modèle ne confonde pas recette et production.
- sagex3_get : paramètre `champs` pour ne garder que les champs ou blocs utiles d'une fiche (une fiche complète pèse 60 à 130 000 caractères).
- Sage X3 : dates du `where` converties en `@AAAA-MM-JJ@` (une date entre apostrophes fait échouer le moteur X3, constaté sur la préprod) ; description corrigée.
- Sage X3 : libellé du compagnon `X_REF` repris aussi dans les blocs répétés de la fiche (lignes) ; `SAGE_LANG` en étiquette unique (`fr-FR`) ; description de sagex3_query avertit que le type de pièce n'est pas exposé (FAF/AVF dans NUM) et que les montants ne sont pas signés.
- Sage X3 : descriptions d'outils précisées d'après la préprod : le `where` accepte tout champ d'en-tête de la fiche, mais seules les colonnes de liste sont renvoyées par `$query`.
- Sage X3 : sagex3_describe renvoie `colonnes_liste` (facette `$query`, y compris les colonnes masquées de la grille comme FCY et BPR sur PINVOICE, qui restent filtrables) et `champs_fiche` (facette `$details`, blocs répétés dépliés en BLOC.CHAMP). Un champ sans libellé reprend celui de son compagnon `X_REF`.
- Sage X3 : une représentation en erreur côté Sage (5xx, constaté sur la préprod : « Unexpected token < in JSON ») est signalée « en erreur côté Sage » sans bloquer les autres.
- Sage X3 : les espaces de `where`/`orderBy` sont codés `%20` et non `+` (Syracuse refuse le `+` : « expected beginning of term »), constaté sur la préprod.
- Portail : second bloc connecteur pour Claude Desktop via le pont `mcp-remote` (Claude Desktop n'accepte pas d'en-tête sur un serveur distant).

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
