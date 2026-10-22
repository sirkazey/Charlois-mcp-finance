# charlois-mcp-stub — bouchon d'entreprise

Un seul processus Node (express + SDK MCP, ~330 lignes) qui imite, protocoles et routes compris, tout ce que le hub joint :

| Système simulé | Protocole imité | Données canines |
|---|---|---|
| Salesforce | OAuth2 code + refresh (`/services/oauth2/*`), REST `/services/data/v62.0/{sobjects,describe,query,limits}` avec mini-SOQL (`WHERE x = 'v'`, `LIMIT`) | Pistes éleveurs (`Race__c`, `Inscrits__c`), opportunités de stands d'agility (`Concours__c`), comptes, contacts |
| Microsoft Entra + Graph | OAuth2 code + refresh (`/ms/{tenant}/oauth2/v2.0/*`), Graph `/v1.0/{me,sites,drive…}` avec redirection de téléchargement pré-authentifiée | Site Finance : `Bilans/` (vrais classeurs Excel), `Concours/` (images PNG de podiums, CSV des inscrits), `Confidentiel/` (réservé) |
| Dropbox | OAuth2 code + refresh (`/oauth2/*`), **serveur MCP Streamable HTTP** `/dropbox-mcp` (`who_am_i`, `list_folder`, `search`, `get_file_metadata`, `fetch`, `file_preview` → image MCP, `delete`) | Même arborescence que SharePoint |
| Sage X3 24R1 Syracuse | IdP OAuth2 (`/oauth/*`), clé d'API en Bearer ou Basic `login:clé`, REST `/api1/x3/erp/{dossier}/{REP}` avec `$query` (where SData, orderBy, count), `('clé')`, `$prototypes` | `YFAC` (factures croquettes, axes analytiques `AXE_RACE`/`AXE_SITE`), `ZVENTE` (stands), `BPCUSTOMER`, `PINVOICE` (Royal Canin Pro), `GACCENTRY` |
| MyReport Server | **serveur MCP SSE** `/myreport/sse` + `/myreport/messages`, jeton en Bearer ou `X-Api-Key` | `liste_indicateurs`, `synthese_couts_par_race`, `valeur_indicateur`, `purger_cache` (écriture, à exclure) |
| Clevoa | `POST /api/v1/telemetry` (clé requise), `GET` pour relire ce qui a été reçu | — |

**Deux collaborateurs** à choisir sur chaque mire de connexion (`http://localhost:4000`) :

| | Marie Dupont (DAF) | Paul Martin (commercial) |
|---|---|---|
| Email | marie.dupont@charlois.com | paul.martin@charlois.com |
| Sage X3 : login / clé | `MDUPONT` / `SYR-MARIE-2026` | `PMARTIN` / `SYR-PAUL-2026` |
| MyReport : jeton | `MR-MARIE-2026` | `MR-PAUL-2026` |
| Dossier `Confidentiel` (SharePoint, Dropbox) | oui | **403** |
| `PINVOICE`, `GACCENTRY` (achats Sage) | oui | **403** |

Les jetons d'accès expirent après `TOKEN_TTL_MIN` minutes (10 par défaut) : le hub exerce donc son renouvellement
automatique en conditions réelles. Les refresh tokens n'expirent pas. Aucune persistance : tout est en mémoire.

```bash
npm install && npm start          # http://localhost:4000 (page d'accueil : collaborateurs, clés, points d'entrée)
npm test                          # 7 tests : le vrai hub branché sur le bouchon, flux OAuth via les mires, droits, télémétrie
```

Avec Docker : `docker compose -f docker-compose.dev.yml up -d --build` à la racine du dépôt lance le bouchon et le hub
déjà branché dessus (toutes les URL sortantes du hub pointent vers `mcp-stub` sauf celles que vous renseignez).
