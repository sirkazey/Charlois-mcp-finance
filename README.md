# Charlois · Finance MCP

Passerelle MCP **ultra-légère, lecture seule**, qui donne à Claude accès à Salesforce et Sage X3 24R1
**avec les droits de chaque utilisateur** : le hub transmet le jeton OAuth personnel, il n'a aucun compte technique.

```
Claude (mobile / desktop / code)
        │  MCP : SSE (/sse) ou Streamable HTTP (/mcp) + clé perso
        ▼
┌─────────────────── mcp-hub (1 conteneur, Node 22) ───────────────────┐
│ server.js      identité (clé) · outils MCP · portail · diagnostic    │
│ oauth.js       flux OAuth2 code + refresh (Salesforce, Sage X3)      │
│ cache.js       structure des tables en mémoire, par utilisateur,     │
│                expirée chaque nuit à 03:00                           │
│ connectors/    salesforce.js · sagex3.js  (REST natif, Bearer user)  │
│ public/        index.html  (boutons OAuth, diagnostic, questions)    │
│ test/          node:test, amont mocké, 34 tests                      │
└──────────┬────────────────────────────────────────┬──────────────────┘
           ▼ /services/data/v62.0/query…             ▼ /api1/x3/erp/<dossier>/<repr>?representation=…$query
      Salesforce REST                           Sage X3 24R1 REST (Syracuse) — ou simulateur intégré
```

* **Pas de framework** : `@modelcontextprotocol/sdk` + `express` + `zod`. Environ 450 lignes de code.
* **Données jamais cachées** : chaque question interroge l'outil en direct. Seule la *structure* (objets / champs)
  est gardée en mémoire, **par utilisateur** (donc selon ses propres droits), et expire chaque nuit.
* **Lecture seule** : SOQL `SELECT` uniquement ; Sage X3 `$query` / `$details` / `$prototypes` uniquement ;
  noms d'objets validés (`^\w+$`) ; outils annotés `readOnlyHint`.
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

## Utilisation (collègue)

1. Ouvrir le portail → **Se connecter à Salesforce** (et Sage X3 si configuré).
2. Copier l'URL ou le bloc JSON affiché dans Claude (connecteur personnalisé / `mcpServers`).
3. Poser une question : *« CA facturé des 12 derniers mois par client »*.

Outils : `salesforce_objects`, `salesforce_describe`, `salesforce_query` · `sagex3_representations`, `sagex3_describe`, `sagex3_query`, `sagex3_get`.

## Développement et tests

```bash
cd hub && npm install
PUBLIC_URL=http://localhost:8080 SF_CLIENT_ID=… SF_CLIENT_SECRET=… node server.js   # Sage X3 en mode simulé
npm test    # 34 tests node:test : SSE + Streamable HTTP, lecture seule, refresh de jeton, cache, OAuth, portail, simulateur
```
