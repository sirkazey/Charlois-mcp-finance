# Changelog

Versions de Clevoa AI Gateway (nommé « Charlois AI Gateway » jusqu'à la 1.2.1 ; identité produit corrigée ensuite,
noms techniques inchangés). Les documents cités par leur ancien nom sont désormais sous `docs/` :
`GUIDE_CONFIGURATION.md` → `docs/admin/configuration.md`, `EXPLOITATION.md` → `docs/admin/exploitation.md`,
`JOURNAL_TESTS.md` → `docs/validation/journal-tests-reels.md`, `AUDIT_ROADMAP.md` → `docs/history/audit-2026-10.md`.

Une section par version, trois lignes au plus par rubrique. La version est celle de `hub/version.js`, le tag Git `vX.Y.Z` et la Release GitHub portent le même numéro.

## [1.3.2-rc.1] – 2026-10-24

Version candidate (non qualifiée pour la production) : socle de maintenance, sans nouvelle fonction métier (périmètre
gelé à la 1.3.1). La 1.3.2 sera publiée après la recette sur l'installation du premier client. Compte rendu : `docs/validation/stabilisation-2026-10.md`.

### Ajouté
- Télémétrie : identifiant aléatoire d'installation (conservé dans `users.json` chiffré), délai de 10 s par envoi, avertissement dans les journaux quand Clevoa annonce une version minimale supérieure.
- Backend Clevoa : fiche par installation dans DynamoDB (expirée 400 jours après le dernier contact), rapport quotidien des installations silencieuses et des versions sous le minimum (CloudWatch, alerte SNS), validation stricte et limite de 4 Ko, clé client jamais stockée, 15 tests sans AWS en CI.

- Diagnostic exportable : `docker exec <conteneur> node diagnostic.js` produit un rapport JSON (version, santé, fichier chiffré, connecteurs, joignabilité, télémétrie) sans aucun secret, jeton, e-mail, URL ni donnée métier ; contrôle de santé Docker du hub (`healthy` dans Portainer).
- Versions figées et retour arrière : installations déployées depuis un tag Git (jamais une branche), image de base Node figée par empreinte, cohérence de version vérifiée par test, scénario `ops/test-rollback.sh` (courante → précédente → courante sur le même volume) en CI.

### Modifié
- Télémétrie : après trois nouveaux essais en échec, retour à l'horaire quotidien (auparavant un essai toutes les 30 minutes tant que Clevoa restait injoignable) ; la réponse du backend ne donne plus le nombre d'envois du jour tous clients confondus.
- Documentation : roadmap produit unique (`docs/roadmap-produit.md`), décisions de gel fonctionnel et de versions figées, finalité et conservation de la télémétrie.

## [1.3.1] – 2026-10-24

Refonte graphique et ergonomique du portail aux couleurs Clevoa. Aucun changement de route, d'API, de SSO, de logique MCP
ni de connecteur. Validation et captures avant/après : `docs/validation/portail-v1.3.1.md`.

### Modifié
- Portail : charte du kit officiel Clevoa (logos SVG fond clair et sombre, favicons, police Outfit servie par le hub), dans l'esprit du site SOCLE.SI ; progression en trois étapes avec la prochaine action ; une carte par outil (état, connexion, jeton, test et résultat) et « Tout tester » ; configuration de l'assistant en onglets, clé masquée à l'écran et copiée en entier ; écrans dédiés « connexion Microsoft » (SSO) et « passerelle injoignable » ; configuration de l'instance repliable ; thème sombre avec le logo adapté.
- Accessibilité : lien d'évitement, focus visible, onglets au clavier, champs étiquetés, résultats annoncés ; axe-core WCAG 2.1 A et AA sans violation (clair, sombre, mobile, SSO).
- Test de cohérence des URL du portail étendu aux ressources statiques (existence dans `public/`, réponse 200) ; documentation (guide utilisateur, architecture, licence : police Outfit sous SIL OFL 1.1 et signes distinctifs Clevoa).

## [1.3.0] – 2026-10-24

Socle multi-client : plus aucune valeur propre à Charlois dans le code du hub.

### Ajouté
- `MCP_SERVER_NAME` (défaut `clevoa-gateway`) : nom sous lequel le serveur MCP s'annonce et clé du bloc `mcpServers` que le portail fait copier ; `INSTANCE_LABEL` : libellé de l'instance sur le portail (titre, en-tête, pied de page, profil). Les deux apparaissent dans la configuration affichée. Test : défaut, surcharge, nom invalide ignoré.
- Instance Charlois : renseigner `MCP_SERVER_NAME=charlois-finance` et `INSTANCE_LABEL=MCP Charlois` dans les variables des stacks pour conserver l'affichage ; sans cela, le portail propose `clevoa-gateway` aux nouveaux collaborateurs. Les configurations déjà collées dans Claude Desktop ou `.mcp.json` continuent de fonctionner telles quelles (le nom n'est qu'une clé locale).

### Modifié
- Bouchon d'entreprise renommé `clevoa-mcp-stub/` (Compose, CI, Gitleaks, documentation) ; paquets `clevoa-gateway-hub` et `clevoa-mcp-stub` ; client MCP du hub `clevoa-gateway-hub`. Le jeu de données fictif « Charlois » du bouchon est conservé.
- Portail : « Département Finance » codé en dur retiré ; titre « Clevoa AI Gateway ». Exemples d'URL des fichiers Compose neutres (`mcp.exemple.fr`).
- Documentation mise à jour (variables d'instance, chemins du bouchon, 78 tests).

### Sécurité
- Dépendance `body-parser` 2.3.0 → 2.4.0 (CVE-2026-111181, déni de service via flux de décompression non géré, signalée par Trivy le 24/10 sur `main` aussi) dans le hub et le bouchon ; aucune autre dépendance modifiée.

## [1.2.1] – 2026-10-24

Lot « fiabilisation » : SSO Microsoft Entra ID du portail (inactif sans `SSO_MODE`), corrections de l'audit indépendant du SSO,
sauvegarde automatique et restauration testées en CI, reverse proxy nginx en profil Compose, guide d'exploitation, check complet
(simplicité, documentation). Les tests de charge et la recette sur les systèmes réels Charlois restent à effectuer.

### Corrigé (fiabilisation des sauvegardes avant les tests de charge)
- Sauvegarde automatique : fichiers horodatés jamais écrasés, aucun doublon quand `users.json` n'a pas changé, copie vérifiée (en-tête, taille, contenu) via un fichier temporaire publié atomiquement, source absente ou corrompue sans effet sur les sauvegardes existantes, rétention `BACKUP_KEEP_DAYS` appliquée seulement après une copie réussie, restes temporaires nettoyés. Sauvegarde manuelle : même nommage, sans écrasement, propriétaire réel sous `sudo`.
- Restauration : le conteneur retenu doit monter le volume retenu, vérifié avant tout arrêt (`Incohérence … Rien n'a été modifié`) ; avec `VOLUME`, le conteneur qui le monte est retrouvé seul ; anciens et nouveaux noms de sauvegarde acceptés.
- Tests : `hub/test/backup.test.js` (boucle de sauvegarde sans Docker) et `ops/test-backup-restore.sh` (scénarios Docker joués par la CI). `DAC_OVERRIDE` conservé, justification documentée.

### Modifié (check complet du 24/10 : simplicité, installation, exploitation)
- Portail : mode démo navigateur retiré (quatrième couche de simulation, sans test, périmée) ; le bouchon joue ce rôle. Compose : `mcp-backup` et `nginx` déclarés une fois dans la base et étendus par les stacks ; journaux plafonnés aussi en pré-prod. Lambda Clevoa en Node 22. Workflow renommé `CI`.
- Scripts : `restore.sh` exige `sudo`, vérifie l'unicité du conteneur, ne lit que les journaux postérieurs au redémarrage (plus de faux « mauvaise clé »), attend 30 s, relance le hub si la copie échoue ; `backup.sh` vérifie l'accès à Docker.
- Documentation : chiffres et version réels, procédure Entra et Dropbox dans le guide, variables de pré-prod pour quitter le bouchon dans `.env.example`, table des URI de rappel, `EXPLOITATION.md` réécrit pour Portainer (pas de `.env`, boutons), `sudo`, un dossier de sauvegarde par environnement, retour arrière, interdiction de `down -v`, `nginx -t`, copie complète du `.env` au coffre ; `.gitignore` pour `backups/` et `certs/` ; roadmap et journal à jour.

### Ajouté
- Exploitation : sauvegarde automatique quotidienne de `users.json` (conteneur `mcp-backup`, `BACKUP_DIR`, `BACKUP_KEEP_DAYS`), scripts `ops/backup.sh` et `ops/restore.sh` (détection d'une mauvaise `ENCRYPTION_KEY`), reverse proxy nginx en profil Compose `proxy` (`ops/nginx/mcp.conf`, `CERTS_DIR`, `HUB_PORT=127.0.0.1:8080`), guide `EXPLOITATION.md` pour un administrateur non spécialiste de Docker ; job CI qui joue sauvegarde, perte et restauration sur la stack pré-prod.
- SSO Microsoft Entra ID du portail (`SSO_MODE=entra`, OIDC code + PKCE via le routeur OAuth existant) : clé MCP liée à l'identité Entra, visiteur anonyme sans clé, SharePoint connecté sans interaction après le SSO (`prompt=none`) sinon parcours interactif ; `SSO_MODE=mock` sur la mire Entra du bouchon (Marie, Paul), interdit en production. Régénération de clé (`POST /api/key/rotate`) et déconnexion du portail enchaînant sur la déconnexion Microsoft. Guide § 5.
- Audit indépendant du SSO (sécurité, simplicité) : clé toujours fraîche à la première liaison (ni fixation de session, ni clé antérieure au SSO reprise) ; jetons SharePoint acceptés seulement pour le compte Microsoft de l'identité ; POST du portail refusés depuis une autre origine ; clés temporaires jamais persistées et purgées ; limite de 60 requêtes/min par IP sur `/auth` (aussi sans SSO) ; bouchon vérifiant PKCE et honorant `prompt=none`.

### Sécurité (revue indépendante, PR #1 et suite)
- En-têtes de sécurité HTTP sur toutes les réponses (CSP, nosniff, anti-clickjacking, Referrer-Policy, Permissions-Policy, COOP/CORP), `X-Powered-By` retiré : les 10 avertissements du ZAP passif portaient sur ces en-têtes. Workflow ZAP : dossier de rapport inscriptible (les artefacts n'étaient pas produits).
- Lambda Clevoa fermé par défaut (`CLEVOA_KEYS` vide → 503) ; redirections de téléchargement SharePoint limitées aux hôtes Microsoft en https ; réponses du routeur OAuth en texte brut ; outils Salesforce au nom d'écriture refusés avant transfert ; `POST /messages` exige la clé MCP et la session SSE doit lui appartenir ; AES-GCM avec longueur de tag explicite ; mire du bouchon validée et échappée.
- CI : workflows Semgrep, CodeQL, Gitleaks, Trivy (versions vérifiées), job de tests hub et bouchon, ZAP passif manuel sur démo isolée ; `.gitleaks.toml` pour les constantes de test.

## [1.2.0] – 2026-10-23

### Ajouté
- Télémétrie : `seats`, nombre de collaborateurs ayant connecté au moins un outil (un entier, aucune identité), base d'une licence par siège. Lambda Clevoa : champ optionnel validé (entier positif), les hubs antérieurs restent acceptés.

## [1.1.0] – 2026-10-23

Première validation sur les systèmes réels : Sage X3 préproduction (4CAD Cloud, Syracuse 24R1) et Salesforce sandbox. Détail dans `JOURNAL_TESTS.md`, procédures dans `GUIDE_CONFIGURATION.md`, audit dans `AUDIT_ROADMAP.md` § 0.

### Corrigé (audit de clôture du 23/10)
- Sous Docker, une variable vide désactivait `MYREPORT_MAX_PER_MIN` et `SF_DEFAULT_LIMIT` ; le diagnostic du portail échappait au plafond ; `LIMIT` par défaut cassait `OFFSET` / `ALL ROWS` ; `SAGE_REPRESENTATIONS` manquait au compose de base. Tous corrigés avec test.
- Sage X3 : délai dépassé non mis en cache ; libellé « identifiant et mot de passe Syracuse » en mode basic ; erreurs tronquées. Salesforce : `SF_MCP_URL` doit désigner `…/sobject-reads` ; `SF_MCP_TOOLS` supprimée. Production : un connecteur sans configuration n'est pas exposé. Portail : liste des variables dérivée de l'environnement ; `mcp-remote@0.15` épinglé.

### Corrigé
- Sage X3 : lecture de la structure au format réel Syracuse 24R1 (vérifié sur l'instance de préproduction) : champs sous `$properties.$resources.$item.$properties`, libellés `{@n}` résolus via `$localization`, types sans le préfixe `application/x-`. Simulateur intégré, bouchon et mocks de test alignés.
- Sage X3 : une représentation absente du dossier (404) ou interdite à l'utilisateur (403) n'empêche plus le diagnostic ni les outils ; elle est signalée comme absente. Une clé révoquée (401) reste bloquante.
- Sage X3 : structure chargée en parallèle et délai max de 30 s par requête : le diagnostic ne reste plus « en cours » indéfiniment.
- Sage X3 : en-tête `Accept-Language` (`SAGE_LANG`, défaut `fr-FR`) : Syracuse traduit les libellés selon cet en-tête (capture en anglais sans lui). Prototypes réels de PINVOICE (liste et fiche, anonymisés) ajoutés comme fixtures de test.
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

[1.0.0]: https://github.com/sirkazey/Clevoa-IA-gateway/releases/tag/v1.0.0
