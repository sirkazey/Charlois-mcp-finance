# Charlois · Finance MCP

Passerelle MCP **ultra-légère, lecture seule**, qui donne à Claude accès à Salesforce et Sage X3 24R1
**avec les droits de chaque utilisateur** : le hub transmet le jeton OAuth personnel, il n'a aucun compte technique.

```
Claude (mobile / desktop / code)
        │  MCP : SSE (/sse) ou Streamable HTTP (/mcp) + clé perso
        ▼
┌─────────────────── mcp-hub (1 conteneur, Node 22) ───────────────────┐
│ server.js      identité (clé) · outils MCP · portail kiosque /       │
│ oauth.js       flux OAuth2 code + refresh (Salesforce, Sage X3)      │
│ cache.js       schéma des tables en JSON, rafraîchi 1×/nuit (03:00)  │
│ connectors/    salesforce.js · sagex3.js  (REST natif, Bearer user)  │
│ public/        index.html  (2 boutons + modèles de questions)        │
└──────────┬────────────────────────────────────────┬──────────────────┘
           ▼ /services/data/v62.0/query…             ▼ /api1/x3/erp/<dossier>/<repr>?representation=…$query
      Salesforce REST                           Sage X3 24R1 REST (Syracuse)
```

* **Pas de framework** : `@modelcontextprotocol/sdk` + `express` + `zod`. ~400 lignes au total.
* **Données jamais cachées** : chaque question interroge l'outil en direct. Seule la *structure* (objets / champs) est en cache nocturne.
* **Lecture seule** : SOQL `SELECT` uniquement ; Sage X3 `$query` / `$details` / `$prototypes` uniquement ; outils annotés `readOnlyHint`.
* **Un conteneur** : les connecteurs sont des modules, pas des services. Un réseau interne n'apporterait rien ici.

## Déploiement Portainer

1. Portainer → **Stacks → Add stack → Repository**, URL de ce dépôt, compose path `docker-compose.yml`.
2. Renseigner les variables (voir `.env.example`). `PUBLIC_URL` est obligatoire.
3. Mettre le port 8080 derrière votre reverse-proxy TLS (Traefik, NPM…) : Salesforce refuse les callbacks OAuth en `http`.
4. Déployer. Le volume `mcp-data` conserve `users.json` (jetons) et `schema.json` (cache).

## Côté Salesforce

Connected App OAuth : scopes **`api`** et **`refresh_token`**, callback `https://<PUBLIC_URL>/auth/salesforce/callback`.
Reporter *Consumer Key / Secret* dans `SF_CLIENT_ID` / `SF_CLIENT_SECRET`. Sandbox : `SF_LOGIN_URL=https://test.salesforce.com`.

## Côté Sage X3 24R1

Le hub appelle l'API REST Syracuse avec `Authorization: Bearer <access_token>` de l'utilisateur.
Pré-requis : un **serveur OAuth2** (ex. Entra ID) déclaré dans *Administration → Serveurs OAuth2* de Syracuse,
et les utilisateurs X3 rattachés à ce serveur, pour que Syracuse accepte le Bearer. Le même serveur OAuth2 est
renseigné dans `SAGE_OAUTH_*`. `SAGE_REPRESENTATIONS` liste les représentations mises en cache / proposées.

> **À vérifier sur votre instance avant mise en production** : l'acceptation du Bearer par la route `/api1/x3/erp`
> et l'URL exacte des prototypes (`$prototypes('<REP>.$query')`) dépendent de la configuration Syracuse.
> Testez avec `curl -H "Authorization: Bearer …" "$SAGE_URL/api1/x3/erp/PROD/BPCUSTOMER?representation=BPCUSTOMER.\$query&count=1"`.

## Utilisation (collègue)

1. Ouvrir `https://<PUBLIC_URL>/` → **Se connecter à Salesforce**, **Se connecter à Sage X3**.
2. Copier l'URL ou le bloc JSON affiché dans Claude (connecteur personnalisé / `mcpServers`).
3. Poser une question : *« CA facturé des 12 derniers mois par client »*. Claude appelle `sagex3_describe` puis `sagex3_query` avec les droits de l'utilisateur.

Outils exposés : `salesforce_objects`, `salesforce_describe`, `salesforce_query` · `sagex3_representations`, `sagex3_describe`, `sagex3_query`, `sagex3_get`.

## Développement local

```bash
cd hub && npm install
PUBLIC_URL=http://localhost:8080 SF_CLIENT_ID=… SF_CLIENT_SECRET=… node server.js
```
