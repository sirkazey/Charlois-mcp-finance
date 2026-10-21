# Charlois · Finance MCP

Passerelle MCP **ultra-légère, lecture seule**, qui donne à Claude accès à Salesforce, Sage X3 24R1, SharePoint, Dropbox
et MyReport **avec les droits de chaque utilisateur** : le hub transmet le jeton personnel, il n'a aucun compte technique.

```
Claude (mobile / desktop / code)
        │  MCP : SSE (/sse) ou Streamable HTTP (/mcp) + clé perso
        ▼
┌─────────────────── mcp-hub (1 conteneur, Node 22) ───────────────────┐
│ server.js      identité (clé) · outils MCP · portail · diagnostic    │
│ oauth.js       flux OAuth2 code + refresh (Salesforce, Sage X3)      │
│ cache.js       structure des tables en mémoire, par utilisateur,     │
│                expirée chaque nuit à 03:00                           │
│ mcpclient.js   client MCP partagé par les connecteurs proxy          │
│ connectors/    salesforce · sagex3 · sharepoint · dropbox · myreport  │
│ public/        index.html  (boutons OAuth, jetons, diagnostic)       │
│ test/          node:test, amont mocké, 40 tests                      │
└───┬─────────────┬───────────────┬───────────────┬───────────────┬────┘
    ▼ REST        ▼ REST Syracuse ▼ Graph (GET)   ▼ MCP HTTP      ▼ MCP SSE
 Salesforce    Sage X3 24R1    SharePoint      Dropbox (MCP    MyReport Server
               (ou simulateur) OneDrive        officiel)       (ou simulateur)
```

* **Pas de framework** : `@modelcontextprotocol/sdk` + `express` + `zod`. Environ 650 lignes de code, 5 connecteurs de 50 à 90 lignes.
* **Données jamais cachées** : chaque question interroge l'outil en direct. Seule la *structure* (objets / champs)
  est gardée en mémoire, **par utilisateur** (donc selon ses propres droits), et expire chaque nuit.
* **Lecture seule** : SOQL `SELECT` uniquement ; Sage X3 `$query` / `$details` / `$prototypes` uniquement ;
  Graph en GET uniquement ; Dropbox limité à une liste blanche d'outils de lecture ; MyReport refuse les outils dont le nom
  évoque une écriture ; noms d'objets validés (`^\w+$`) ; outils annotés `readOnlyHint`.
* **Jeton passif** : chaque appel amont porte le jeton de l'appelant. Le callback OAuth est lié au navigateur
  qui a lancé le flux (anti login-CSRF).
* **Un conteneur** : les connecteurs sont des modules, pas des services.

## Cloisonnement des identités (règle non négociable)

Aucun compte de service, générique ou global, pour Salesforce ni Sage X3.

* `users.json` ne contient que des jetons **individuels**, obtenus par chaque collaborateur en cliquant sur les
  boutons OAuth du portail, rangés sous sa clé MCP personnelle : `users.<clé>.salesforce` / `users.<clé>.sagex3`.
* Chaque appel MCP est authentifié par la clé de l'appelant. Le hub lit **son** jeton dans `users.json`
  (`oauth.js` → `withToken`) et le transmet tel quel en `Authorization: Bearer` à l'API. Salesforce et Sage X3
  appliquent donc le profil de droits de ce collaborateur (objets, champs, enregistrements, dossiers).
* Le cache de structure est par utilisateur : la liste des objets et des champs reflète ses propres droits.
* Aucun jeton n'est lu depuis l'environnement. Les seules variables d'environnement d'authentification sont
  les identifiants de l'application OAuth (client id / secret), qui servent à l'échange de code et au refresh,
  jamais à requêter les API.
* Seule exception : le **simulateur Sage X3** (sans `SAGE_URL`), qui ne contacte aucun système et n'a pas de jeton.

Le test `Cloisonnement` de `hub/test/mcp.test.js` vérifie que deux utilisateurs interrogeant les mêmes outils
n'émettent que leurs propres jetons et que `users.json` ne contient rien hors de `users.<clé>`.

## Démarrage rapide (Docker Desktop)

```bash
cp .env.example .env        # renseigner SF_CLIENT_ID / SF_CLIENT_SECRET ; laisser SAGE_URL vide
docker compose up -d --build
open http://localhost:8080
```

Sur le portail, la section **Diagnostic & Connectivité** permet de :
* **Tester la connexion Salesforce** : un `GET /limits` avec votre jeton. Voyant vert + quota API, ou rouge + erreur.
* **Tester le simulateur Sage X3** : sans `SAGE_URL`, le connecteur répond avec 3 tables fictives
  (`YFAC`, `YCLIENT`, `ZVENTE`) servies depuis le cache mémoire. Voyant vert + liste des tables.
* **Tester SharePoint** : `GET /me` sur Graph avec votre jeton. Vert avec votre identité, rouge avec l'erreur.
* **Tester Dropbox** : session MCP vers `mcp.dropbox.com` avec votre jeton. Vert avec la liste des outils lecture seule.
* **Tester MyReport** : session MCP SSE vers `MYREPORT_MCP_URL` avec votre jeton, ou simulateur local si l'URL est vide.

La section **Configuration du conteneur** affiche les variables lues par le hub (les secrets apparaissent masqués).

## Déploiement Portainer

1. **Stacks → Add stack → Repository**, URL de ce dépôt, compose path `docker-compose.yml`.
2. Renseigner les variables de `.env.example` dans l'UI. `PUBLIC_URL` est obligatoire.
3. Mettre le port 8080 derrière votre reverse-proxy TLS : Salesforce n'accepte les callbacks `http` que sur `localhost`.
4. Le volume `mcp-data` conserve `users.json` (jetons par utilisateur).

## Côté Salesforce

Connected App OAuth : scopes **`openid`**, **`api`**, **`refresh_token`**, **`offline_access`**,
callback `<PUBLIC_URL>/auth/salesforce/callback`. Dans la Connected App, régler *Refresh Token Policy* sur
**« Refresh token is valid until revoked »**, sinon le jeton de rafraîchissement expire et l'utilisateur doit se reconnecter.
Reporter *Consumer Key / Secret* dans `SF_CLIENT_ID` / `SF_CLIENT_SECRET`. Sandbox : `SF_LOGIN_URL=https://test.salesforce.com`.

Renouvellement transparent : quand Salesforce répond 401 (session expirée), le hub échange le `refresh_token` contre
un nouvel `access_token`, le persiste dans `users.json` et rejoue l'appel. L'utilisateur ne voit rien.
Il ne se reconnecte que si le refresh token est révoqué (admin, changement de mot de passe, politique d'expiration).

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
Une clé révoquée produit un voyant rouge « Sage X3 401 » dans le diagnostic.

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
MyReport Server applique ses propres droits. Deux outils : `myreport_tools` (outils distants et leurs schémas) et
`myreport_call` (transfert d'une requête d'analyse). Les noms d'outils évoquant une écriture sont refusés avant tout appel.

`MYREPORT_MCP_URL` vide = **simulateur local** (deux outils fictifs, `liste_indicateurs` et `valeur_indicateur`) pour
les tests Docker Desktop, sans jeton ni réseau. Le bouton « Tester MyReport » du portail l'indique.

## Utilisation (collègue)

1. Ouvrir le portail → **Se connecter à Salesforce** (et Sage X3 si configuré).
2. Copier l'URL ou le bloc JSON affiché dans Claude (connecteur personnalisé / `mcpServers`).
3. Poser une question : *« CA facturé des 12 derniers mois par client »*.

Outils : `salesforce_objects`, `salesforce_describe`, `salesforce_query` · `sagex3_representations`, `sagex3_describe`, `sagex3_query`, `sagex3_get`
· `sharepoint_sites`, `sharepoint_list`, `sharepoint_search`, `sharepoint_read` · `dropbox_tools`, `dropbox_call` · `myreport_tools`, `myreport_call`.

## Développement et tests

```bash
cd hub && npm install
PUBLIC_URL=http://localhost:8080 SF_CLIENT_ID=… SF_CLIENT_SECRET=… node server.js   # Sage X3 en mode simulé
npm test    # 40 tests node:test : transports, lecture seule, refresh, cache, OAuth, jetons personnels, portail, simulateurs, Graph, proxys MCP Dropbox et MyReport
```
