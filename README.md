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
│ test/          node:test, amont mocké, 30 tests                      │
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

Connected App OAuth : scopes **`openid`**, **`api`**, **`refresh_token`**, callback `<PUBLIC_URL>/auth/salesforce/callback`.
Reporter *Consumer Key / Secret* dans `SF_CLIENT_ID` / `SF_CLIENT_SECRET`. Sandbox : `SF_LOGIN_URL=https://test.salesforce.com`.

## Côté Sage X3 24R1

Le hub appelle l'API REST Syracuse avec `Authorization: Bearer <access_token>` de l'utilisateur.
Pré-requis : un **serveur OAuth2** (ex. Entra ID) déclaré dans *Administration → Serveurs OAuth2* de Syracuse,
les utilisateurs X3 rattachés à ce serveur, et `SAGE_OAUTH_SCOPE` demandant un jeton **pour Syracuse**
(avec Entra : `openid offline_access api://<app-id-syracuse>/.default`, pas un jeton Graph).

> **À vérifier sur votre instance avant mise en production** : l'acceptation du Bearer par `/api1/x3/erp`,
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
npm test    # 30 tests node:test : SSE + Streamable HTTP, lecture seule, refresh de jeton, cache, OAuth, portail, simulateur
```
