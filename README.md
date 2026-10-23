# Charlois AI Gateway · MCP Charlois

La passerelle IA des outils du Groupe Charlois : un hub MCP **ultra-léger et en lecture seule** par lequel les assistants
IA (Claude Code, Claude Desktop, ChatGPT, Copilot) interrogent le CRM (Salesforce), l'ERP (Sage X3 24R1), les documents
(SharePoint / OneDrive, Dropbox) et le reporting (MyReport) **avec les droits de chaque collaborateur** : le hub
transmet son jeton personnel, il n'a aucun compte technique. Le portail web « Charlois AI Gateway » sert de guichet
unique : connexion aux outils, diagnostic, bar à prompts, configuration du connecteur.

Né pour la Finance, le hub est générique : tout outil disposant d'une API REST ou d'un serveur MCP s'ajoute comme un
module de 50 à 90 lignes dans `hub/connectors/`.

```
Assistant IA (Claude Code, Claude Desktop, ChatGPT, Copilot)
        │  MCP : SSE (/sse) ou Streamable HTTP (/mcp) + Authorization: Bearer <clé perso>
        ▼
┌─────────────────── mcp-hub (1 conteneur, Node 22) ───────────────────┐
│ server.js      identité (clé) · outils MCP · portail · diagnostic    │
│ oauth.js       flux OAuth2 code + refresh (Salesforce, Sage X3)      │
│ cache.js       structure des tables en mémoire, par utilisateur,     │
│                expirée chaque nuit à 03:00                           │
│ mcpclient.js   client MCP partagé par les connecteurs proxy          │
│ version.js     VERSION stricte + APP_ENV (PRODUCTION / PRE-PROD)     │
│ telemetry.js   télémétrie Clevoa anonyme, au démarrage puis à 03:00  │
│ connectors/    salesforce (proxy MCP) · sagex3 · sharepoint · dropbox · myreport │
│ public/        index.html  portail Charlois AI Gateway               │
│ test/          node:test, amont mocké, 48 tests                      │
└───┬─────────────┬───────────────┬───────────────┬───────────────┬────┘
    │  (pré-prod : charlois-mcp-stub/ imite les six systèmes, 7 tests de bout en bout)
    ▼ MCP HTTP    ▼ REST Syracuse ▼ Graph (GET)   ▼ MCP HTTP      ▼ MCP SSE
 Salesforce    Sage X3 24R1    SharePoint      Dropbox (MCP    MyReport Server
 (SObject Reads) (ou simulateur) OneDrive      officiel)       (ou simulateur)
```

* **Pas de framework** : `@modelcontextprotocol/sdk` + `express` + `zod`. Environ 650 lignes de code, 5 connecteurs de 50 à 90 lignes.
* **Données jamais cachées** : chaque question interroge l'outil en direct. Seule la *structure* (objets / champs)
  est gardée en mémoire, **par utilisateur** (donc selon ses propres droits), et expire chaque nuit.
* **Lecture seule** : Salesforce via le serveur MCP hébergé `SObject Reads` uniquement ; Sage X3 `$query` / `$details` / `$prototypes` uniquement ;
  Graph en GET uniquement, chemins et sites validés ; Dropbox et MyReport limités à une liste blanche d'outils ;
  noms d'objets validés (`^\w+$`) ; outils annotés `readOnlyHint`.
* **Jeton passif** : chaque appel amont porte le jeton de l'appelant. Le callback OAuth est lié au navigateur
  qui a lancé le flux (anti login-CSRF).
* **Un conteneur** : les connecteurs sont des modules, pas des services.

## Cloisonnement des identités (règle non négociable)

Aucun compte de service, générique ou global, pour aucun des outils connectés.

* `users.json` ne contient que des jetons **individuels**, obtenus par chaque collaborateur en cliquant sur les
  boutons OAuth du portail, rangés sous sa clé MCP personnelle : `users.<clé>.salesforce` / `users.<clé>.sagex3`.
  Le fichier est **chiffré AES-256-GCM** (clé maîtresse `ENCRYPTION_KEY`, obligatoire, `openssl rand -hex 32`),
  déchiffré en mémoire uniquement, écrit avec les droits 600 dans un volume en 700. Perdre la clé rend les jetons
  illisibles : les collaborateurs se reconnectent, rien d'autre n'est perdu.
* Chaque appel MCP est authentifié par la clé de l'appelant. Le hub lit **son** jeton dans `users.json`
  (`oauth.js` → `withToken`) et le transmet tel quel en `Authorization: Bearer` à l'outil. Salesforce, Sage X3,
  Graph, Dropbox et MyReport appliquent donc le profil de droits de ce collaborateur (objets, champs,
  enregistrements, dossiers, rapports).
* Le cache de structure est par utilisateur : la liste des objets et des champs reflète ses propres droits.
* Aucun jeton n'est lu depuis l'environnement. Les seules variables d'environnement d'authentification sont
  les identifiants de l'application OAuth (client id / secret), qui servent à l'échange de code et au refresh,
  jamais à requêter les API.
* Seules exceptions : les **simulateurs** Sage X3 (sans `SAGE_URL`) et MyReport (sans `MYREPORT_MCP_URL`), qui ne
  contactent aucun système et n'ont pas de jeton.

Le test `Cloisonnement` de `hub/test/mcp.test.js` vérifie que deux utilisateurs interrogeant les mêmes outils
n'émettent que leurs propres jetons et que `users.json` ne contient rien hors de `users.<clé>`.

## Télémétrie Clevoa (licence)

Si `CLEVOA_KEY` est renseignée, le hub envoie au démarrage puis chaque jour à 03:00 un `POST` vers `CLEVOA_URL`
(défaut `https://clevoa.fr/api/v1/telemetry`) avec l'en-tête `X-Clevoa-Key`. Payload, et rien d'autre :

```json
{ "version": "1.0.0", "env": "PRODUCTION", "date": "2026-10-22", "connectors": { "salesforce": true, "sagex3": false, "sharepoint": true, "dropbox": true, "myreport": false }, "requests": 137 }
```

`connectors` = vrai système configuré (un simulateur compte `false`) ; `requests` = nombre brut d'appels d'outils MCP
depuis le dernier envoi, tous utilisateurs confondus. Aucun email, jeton, requête ni résultat ne quitte le hub ; le
backend refuse d'ailleurs tout champ supplémentaire. Clé vide = télémétrie désactivée. Le portail affiche
« Propulsé par Clevoa — Licence Active » en pied de page.

Le backend qui reçoit ces envois est dans [`clevoa-backend/`](clevoa-backend/) : une fonction AWS Lambda (Node 20)
derrière API Gateway, décrite par un `serverless.yml` commenté.

## Sécurité de l'accès MCP

* La clé MCP personnelle se transmet **uniquement** dans l'en-tête `Authorization: Bearer <clé>` (Claude Code, Claude
  Desktop, ChatGPT, Copilot). Le paramètre d'URL `?key=` est refusé : une clé dans l'URL finirait dans les journaux
  du reverse-proxy. Conséquence : les connecteurs personnalisés de claude.ai web/mobile, qui ne posent pas d'en-tête,
  ne peuvent pas se connecter tant que le hub n'expose pas un serveur OAuth 2.1 (non implémenté, volontairement).
* Limitation de débit en mémoire, par adresse IP et par minute : 20 diagnostics, 30 actions portail (jeton,
  déconnexion), 60 `/api/me`, et 20 échecs d'authentification MCP (force brute sur la clé) → `429`. `TRUST_PROXY`
  indique le nombre de reverse-proxys pour lire l'IP réelle.
* Conteneur (pré-prod et prod) : utilisateur `node`, capacités retirées, `no-new-privileges`, système de fichiers en
  lecture seule hormis `/data` et `/tmp`.

## Démarrage rapide (Docker Desktop)

**Avec le bouchon d'entreprise** (aucun compte réel nécessaire, jeu de données canin, deux collaborateurs aux droits différents) :

```bash
cp .env.example .env        # renseigner ENCRYPTION_KEY (openssl rand -hex 32) ; PUBLIC_URL=http://localhost:8080 est déjà là
docker compose -f docker-compose.dev.yml up -d --build
open http://localhost:8080  # ouvrir EXACTEMENT l'adresse de PUBLIC_URL (pas 127.0.0.1) : le cookie et les callbacks y sont liés
```

Les boutons « Se connecter » ouvrent les mires du bouchon sur `http://localhost:4000`. Si une version antérieure du hub a
déjà tourné sur ce poste, supprimer son volume avant (`docker compose -f docker-compose.dev.yml down -v`) : il appartenait
à root et le hub tourne désormais sous l'utilisateur `node`.

Le conteneur `mcp-stub` ([`charlois-mcp-stub/`](charlois-mcp-stub/)) imite Salesforce, Entra/Graph, Dropbox MCP, Sage X3
Syracuse, MyReport MCP et Clevoa. Renseigner une variable réelle dans `.env` (ex. `SF_LOGIN_URL`, `SF_CLIENT_ID`…) rebranche
ce seul système sur le vrai. Sage X3 : identifiant `MDUPONT` et clé `SYR-MARIE-2026` ; MyReport : jeton `MR-MARIE-2026`.
Dans `.env`, ne jamais mettre de commentaire sur la même ligne qu'une valeur vide : Docker Compose le lirait comme la valeur.

**Sans bouchon** (vrais comptes Salesforce, simulateurs internes Sage X3 et MyReport) :

```bash
docker compose up -d --build
```

Sur le portail, la section **Diagnostic & Connectivité** permet de :
* **Tester Salesforce** : session MCP vers le serveur hébergé `SObject Reads` avec votre jeton. Vert avec la liste des outils, rouge avec l'erreur.
* **Tester le simulateur Sage X3** : sans `SAGE_URL`, le connecteur répond avec 3 tables fictives
  (`YFAC`, `YCLIENT`, `ZVENTE`) servies depuis le cache mémoire. Voyant vert + liste des tables.
* **Tester SharePoint** : `GET /me` sur Graph avec votre jeton. Vert avec votre identité, rouge avec l'erreur.
* **Tester Dropbox** : session MCP vers `mcp.dropbox.com` avec votre jeton. Vert avec la liste des outils lecture seule.
* **Tester MyReport** : session MCP SSE vers `MYREPORT_MCP_URL` avec votre jeton, ou simulateur local si l'URL est vide.

La section **Configuration du conteneur** affiche les variables lues par le hub (secrets masqués). Sur un hub public
(`PUBLIC_URL` en https), elle n'apparaît qu'une fois l'utilisateur connecté à un système.

## Déploiement à distance : deux environnements étanches (Portainer Git auto-update)

| Environnement | Branche Git | Fichier compose           | Conteneur         | Particularités |
|---------------|-------------|---------------------------|-------------------|----------------|
| Pré-prod      | `dev`       | `docker-compose.dev.yml`  | `mcp-hub-preprod` + `mcp-stub` | `LOG_LEVEL=debug` ; par défaut toutes les API sortantes pointent vers le conteneur bouchon `mcp-stub` (jeu de données canin, mires OAuth sur le port 4000) ; chaque variable renseignée rebranche un système réel |
| Production    | `main`      | `docker-compose.prod.yml` | `mcp-hub-prod`    | `APP_ENV=production` : badge « ENV: PRODUCTION », mode démo masqué, `PUBLIC_URL` https obligatoire (sinon refus de démarrer), `CLEVOA_KEY` obligatoire, télémétrie figée sur `https://clevoa.fr`, conteneur sans privilèges, système de fichiers en lecture seule, journaux plafonnés |

Les deux fichiers **étendent** `docker-compose.yml` (base commune, aussi utilisée telle quelle sur Docker Desktop) :
une seule définition du service, seules les différences sont écrites. Chaque stack a son propre volume `mcp-data`
(nom préfixé par Portainer avec le nom de la stack), donc ses propres `users.json` : les jetons de pré-prod ne sont
jamais visibles en prod, et inversement.

**Mise en place dans Portainer** (une fois par environnement) :

1. **Stacks → Add stack → Repository** : URL de ce dépôt, *Repository reference* = `refs/heads/dev` (pré-prod) ou
   `refs/heads/main` (prod), *Compose path* = le fichier du tableau ci-dessus.
2. **GitOps updates** : activer, mode *Polling* (ex. 5 min) ou *Webhook* (coller l'URL du webhook dans GitHub →
   Settings → Webhooks, événement *push*). À chaque commit sur la branche, Portainer reconstruit l'image et redéploie.
3. Variables d'environnement : celles de `.env.example`. `PUBLIC_URL` et `ENCRYPTION_KEY` sont obligatoires partout ;
   `CLEVOA_KEY` l'est en prod. En pré-prod avec le bouchon, `BROWSER_URL_REWRITE=http://mcp-stub:4000=>http://<hôte-préprod>:4000`
   (le navigateur des collaborateurs doit joindre les mires du bouchon ; `localhost` ne vaut que sur Docker Desktop).
4. Port 8080 derrière votre reverse-proxy TLS, un sous-domaine par environnement (`mcp-preprod.` / `mcp.`).

**Cycle de livraison** : développer et committer sur `dev` → la stack de pré-prod se met à jour → vérifier le portail
(badge « ENV: PRE-PROD », diagnostic) et la suite `npm test` → fusionner `dev` dans `main` (`git merge --ff-only dev`)
→ la stack de production se met à jour. Ne jamais committer directement sur `main`.

**Version** : `hub/version.js` porte la version stricte (`VERSION = "1.0.0"`), affichée dans les logs de démarrage,
dans l'en-tête et le pied de page du portail, dans `/api/me` et dans chaque envoi de télémétrie. L'incrémenter à chaque
fusion dans `main` (et aligner `hub/package.json`).

## Suivi : backlog, versions, releases

Tout se passe dans GitHub, sans outil supplémentaire :

* **Issues** = backlog. Trois étiquettes : `bug`, `évolution`, `infra`. Deux modèles d'issue (bug, évolution) guident la
  saisie ; les issues vierges sont désactivées. Un commit qui règle une issue la cite (`Fixes #12`).
* **Milestones** = versions à venir. Chaque issue planifiée est rattachée à un milestone (`1.1.0`, …) ; quand il est vide,
  on livre.
* **Livrer une version** : incrémenter `hub/version.js` et `hub/package.json`, ajouter la section dans `CHANGELOG.md`,
  fusionner `dev` dans `main`, créer la **Release** GitHub `vX.Y.Z` (elle pose le tag) avec le texte du changelog, fermer
  le milestone. Le badge du portail et la télémétrie affichent alors ce numéro : c'est la preuve de ce qui tourne.

Pour une stack locale ou de test, `docker compose -f docker-compose.dev.yml config` et `... prod.yml config` affichent la
configuration résolue sans rien déployer.

## Côté Salesforce (serveur MCP hébergé « SObject Reads »)

Le hub est **client MCP** du serveur hébergé par Salesforce `SObject Reads` (lecture seule des objets métier : comptes,
contacts, pistes, opportunités, objets personnalisés), avec le jeton OAuth de chaque collaborateur : Salesforce applique
son profil, ses règles de partage et la sécurité au niveau des champs. Deux outils : `salesforce_tools` (outils du serveur
et leurs schémas) et `salesforce_call` (exécution). Le connecteur refuse de démarrer si `SF_MCP_URL` désigne un serveur
d'écriture (`sobject-all`, `mutations`, `deletes`…).

Configuration (Setup, droits administrateur, édition Enterprise ou supérieure ; vérifier sur l'org) :
1. **Serveurs MCP** (API Catalog) : laisser actif `SObject Reads` seul (et `salesforce-api-context` au besoin), désactiver
   `SObject All`, `SObject Mutations`, `SObject Deletes`. Copier l'URL de `SObject Reads` → `SF_MCP_URL`
   (forme `https://api.salesforce.com/platform/mcp/v1/d/<org>/platform/sobject-reads`).
2. **External Client App** (les Connected Apps classiques ne sont pas acceptées) : OAuth activé, callback
   `<PUBLIC_URL>/auth/salesforce/callback` (et `https://claude.ai/api/mcp/auth_callback` pour un usage direct depuis
   claude.ai), scopes « Access Salesforce hosted MCP servers » (`mcp_api`) et « Perform requests at any time »
   (`refresh_token`), « Require PKCE » coché, « Issue JWT based access tokens for named users » coché, secret non requis.
   Consumer Key → `SF_CLIENT_ID` ; `SF_CLIENT_SECRET` vide si l'app n'exige pas de secret. Propagation : jusqu'à 30 min.
3. `SF_LOGIN_URL` = **My Domain** de l'org (`https://<org>.my.salesforce.com`), ou de la sandbox
   (`https://<org>--<nom>.sandbox.my.salesforce.com`) : c'est le serveur d'autorisation annoncé par le serveur MCP.

Renouvellement transparent : sur 401 du serveur MCP, le hub échange le `refresh_token`, persiste le nouveau jeton et rejoue
l'appel. Un refresh token révoqué efface l'entrée et demande une reconnexion sur le portail. L'usage des serveurs MCP
hébergés peut être facturé par Salesforce en crédits Flex : à vérifier avec votre interlocuteur Salesforce.

## Côté Sage X3 24R1

Le hub appelle l'API REST Syracuse avec `Authorization: Bearer <access_token>` de l'utilisateur.
Pré-requis : un **serveur OAuth2** (ex. Entra ID) déclaré dans *Administration → Serveurs OAuth2* de Syracuse,
les utilisateurs X3 rattachés à ce serveur, et `SAGE_OAUTH_SCOPE` demandant un jeton **pour Syracuse**
(avec Entra : `openid offline_access api://<app-id-syracuse>/.default`, pas un jeton Graph).

### Alternative sans OAuth : clé d'API Syracuse personnelle

Sur le portail, sous le bouton Sage X3, chaque collaborateur peut saisir **sa** clé d'API (et son identifiant X3 en mode
`basic`). Elle est stockée dans `users.json` sous sa clé MCP (`sagex3.apiKey`, `sagex3.login`), jamais renvoyée au
navigateur, et envoyée telle quelle à chaque appel :
* `SAGE_APIKEY_MODE=bearer` (défaut) → `Authorization: Bearer <clé>`
* `SAGE_APIKEY_MODE=basic` → `Authorization: Basic base64(login:clé)` (authentification Basic classique de Syracuse)

Pas d'expiration, pas de refresh : la connexion reste permanente tant que la clé est valide côté Sage.
Le bouton « Tester Sage X3 » fait un appel réel à chaque clic (jamais le cache) : une clé révoquée produit un voyant rouge « Sage X3 401 ».

> **À vérifier sur votre instance avant mise en production** : le mode d'envoi de la clé d'API attendu par votre
> Syracuse (`bearer` ou `basic`), l'acceptation du Bearer OAuth par `/api1/x3/erp`,
> le scope exact, et l'URL des prototypes (`$prototypes('<REP>.$query')`) dépendent de la configuration Syracuse.
> Test : `curl -H "Authorization: Bearer …" "$SAGE_URL/api1/x3/erp/PROD/BPCUSTOMER?representation=BPCUSTOMER.\$query&count=1"`.

## Côté SharePoint / OneDrive (Microsoft Graph)

App Entra ID avec **permissions déléguées** `User.Read`, `Files.Read.All`, `Sites.Read.All`, callback
`<PUBLIC_URL>/auth/sharepoint/callback`. Variables `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, et `SP_SITE`
(ex. `charlois.sharepoint.com:/sites/Finance` ; vide = OneDrive de l'utilisateur). Graph répond avec les droits du
collaborateur connecté : un dossier « Finance » qu'il ne voit pas dans SharePoint renvoie 403, donc une erreur à Claude.
Outils : `sharepoint_sites`, `sharepoint_list`, `sharepoint_search`, `sharepoint_read` (texte, csv, json ; les binaires
renvoient leurs métadonnées et leur lien).

## Côté Dropbox (serveur MCP officiel)

Le hub est **client MCP** du serveur officiel `https://mcp.dropbox.com/mcp` avec le jeton OAuth Dropbox du collaborateur
(app Dropbox : `DROPBOX_APP_KEY` / `DROPBOX_APP_SECRET`, scopes `account_info.read files.metadata.read files.content.read
sharing.read`, `token_access_type=offline` pour le refresh, callback `<PUBLIC_URL>/auth/dropbox/callback`).
Deux outils : `dropbox_tools` (outils du serveur Dropbox filtrés par liste blanche lecture seule, avec leurs schémas) et
`dropbox_call` (exécution d'un de ces outils). Les outils d'écriture (`create_*`, `move`, `copy`, `delete`) sont refusés
avant tout appel, et les scopes OAuth ne les permettraient de toute façon pas. Dropbox applique les droits du collaborateur.

> **À vérifier** : l'acceptation par `mcp.dropbox.com` d'un jeton issu de votre propre app Dropbox (la doc Dropbox indique
> que les clients sans enregistrement dynamique utilisent les identifiants de l'app). Le bouton « Tester Dropbox » le dit en un clic.

## Côté MyReport (proxy MCP distant, HTTP SSE)

Pas de connecteur métier : le hub est **client MCP SSE** du serveur MCP de votre MyReport Server (`MYREPORT_MCP_URL`).
Chaque collaborateur saisit dans le portail **son** jeton MyReport, stocké sous sa clé MCP (`myreport.apiKey`) et joint à
chaque requête, sur le flux SSE comme sur les messages (`Authorization: Bearer <jeton>`, ou l'en-tête `MYREPORT_AUTH_HEADER`).
MyReport Server applique ses propres droits. Deux outils : `myreport_tools` (outils distants, leurs schémas, et s'ils sont
autorisés) et `myreport_call` (transfert d'une requête d'analyse). Seuls les outils listés dans **`MYREPORT_TOOLS`**
(liste blanche, lecture seule, à composer d'après le bouton « Tester MyReport ») sont transférés ; liste vide = aucun transfert.

`MYREPORT_MCP_URL` vide = **simulateur local** (deux outils fictifs, `liste_indicateurs` et `valeur_indicateur`, réponses
marquées `simule: true`) pour les tests Docker Desktop, sans jeton ni réseau. Le bouton « Tester MyReport » l'indique.

## Utilisation (collaborateur)

1. Ouvrir le portail Charlois AI Gateway → **Se connecter** aux outils dont vous disposez (Salesforce, SharePoint,
   Dropbox par OAuth ; Sage X3 et MyReport par OAuth ou jeton personnel).
2. Vérifier chaque connexion dans **Diagnostic & connectivité** (voyant vert).
3. Copier le bloc JSON « Votre connecteur Claude » dans la configuration de votre assistant (`mcpServers`, en-tête
   `Authorization: Bearer`). Claude Desktop n'accepte pas d'en-tête sur un serveur distant : le portail fournit un second
   bloc qui passe par le pont `mcp-remote` (Node.js sur le poste), à coller dans `claude_desktop_config.json`
   (Paramètres → Développeur → Modifier la configuration), puis redémarrer Claude Desktop.
4. Poser une question, ou partir d'une fiche du **Bar à prompts** (onglets Onboarding, Analyse de données,
   Contrôle de gestion) : *« CA facturé des 12 derniers mois par client »*.

Le serveur MCP s'annonce aux assistants sous le nom `charlois-finance` (clé du bloc `mcpServers`).

Chaque résultat d'outil se termine par une ligne **« Source : … »** (le système, et le dossier pour Sage X3), par exemple
`Source : Sage X3 · dossier X3TST_CHREC` ou `Source : Salesforce · sandbox preprod` (ou `· production`). L'assistant est instruit de la citer : l'utilisateur sait
ainsi de quel système vient chaque donnée. Il est aussi instruit d'interroger Sage X3 et Salesforce quand une question sur un
tiers, une commande ou une facture ne nomme pas le système.

Outils : `salesforce_tools`, `salesforce_call` · `sagex3_representations`, `sagex3_describe`, `sagex3_query`, `sagex3_get`
· `sharepoint_sites`, `sharepoint_list`, `sharepoint_search`, `sharepoint_read` · `dropbox_tools`, `dropbox_call` · `myreport_tools`, `myreport_call`.

## Développement et tests

```bash
cd hub && npm install
ENCRYPTION_KEY=$(openssl rand -hex 32) PUBLIC_URL=http://localhost:8080 SF_CLIENT_ID=… SF_CLIENT_SECRET=… node server.js   # Sage X3 en mode simulé
npm test                    # 48 tests node:test (pré-prod)
APP_ENV=production npm test # même suite sous les verrous de production : transports, lecture seule, refresh, cache, OAuth, jetons personnels, portail, simulateurs, Graph, proxys MCP, télémétrie et Lambda Clevoa
```
