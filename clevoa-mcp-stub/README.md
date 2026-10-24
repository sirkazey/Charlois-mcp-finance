# clevoa-mcp-stub — bouchon d'entreprise

Jeu de données fictif « Charlois » (deux collaborateurs, données canines) : aucune donnée réelle.

Un seul processus Node (express + SDK MCP, ~430 lignes) qui imite, protocoles et routes compris, tout ce que le hub joint :

| Système simulé | Protocole imité | Données canines |
|---|---|---|
| Salesforce | OAuth2 code + refresh + PKCE (`/services/oauth2/*`), **serveur MCP hébergé « SObject Reads » simulé** `/platform/mcp/v1/d/{org}/platform/sobject-reads` avec les six outils réels relevés sur la sandbox Charlois (find, getObjectSchema, getRelatedRecords, getUserInfo, listRecentSobjectRecords, soqlQuery) et leurs arguments | Pistes éleveurs (`Race__c`, `Inscrits__c`), opportunités de stands d'agility (`Concours__c`), comptes, contacts |
| Microsoft Entra + Graph | OAuth2 code + refresh (`/ms/{tenant}/oauth2/v2.0/*`), Graph `/v1.0/{me,sites,drive…}` avec redirection de téléchargement pré-authentifiée | Site Finance : `Bilans/` (vrais classeurs Excel), `Concours/` (images PNG de podiums, CSV des inscrits), `Confidentiel/` (réservé) |
| Dropbox | OAuth2 code + refresh (`/oauth2/*`), **serveur MCP Streamable HTTP** `/dropbox-mcp` aux schémas du serveur officiel relevés le 22/10/2026 (`who_am_i`, `list_folder` avec `ns_path`, `search`, `get_file_metadata` imbriqué, `fetch` par `id`, `file_preview` → vignettes et liens, `delete`) | Même arborescence que SharePoint |
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
npm test                          # 11 tests : le vrai hub branché sur le bouchon, flux OAuth et SSO via les mires, PKCE, droits, télémétrie
```

Avec Docker : `docker compose -f docker-compose.dev.yml up -d --build` à la racine du dépôt lance le bouchon et le hub
déjà branché dessus (toutes les URL sortantes du hub pointent vers `mcp-stub` sauf celles que vous renseignez).

## Fidélité des simulateurs : ce qui est vérifié et ce qui ne l'est pas

| Système | Confiance | Base |
|---|---|---|
| Salesforce | Élevée : protocole (OAuth PKCE, serveur MCP Streamable HTTP exigeant un jeton, 401 `JWT Token is required`) et les six outils de `SObject Reads` (noms, arguments, descriptions) relevés sur la sandbox Charlois le 24/10/2026 ; données et SOQL simplifiés. |
| Microsoft Graph et Entra ID | Élevée sur Graph (formats de réponse), moyenne sur Entra (id_token non signé, `prompt=none` honoré pour tout `login_hint` connu, déconnexion simulée) ; jamais confronté à un vrai locataire | `/me`, `/sites`, `drive/root/children`, `search(q=)`, `items/{id}/content` en 302 pré-authentifié. Pas de pagination `@odata.nextLink` (le hub lit la première page). Identifiants de site simplifiés. |
| Dropbox MCP | Élevée sur les noms, arguments et formes de réponse (relevés sur le serveur officiel) | Non vérifié : l'acceptation par `mcp.dropbox.com` d'un jeton issu d'une app Dropbox tierce. |
| Sage X3 Syracuse | Élevée sur les formats | API REST « représentations » (`$query`, `$details`, `$prototypes`, filtre SData, `$resources`, `$diagnoses`) alignée sur les captures réelles de l'instance 24R1 de préproduction (prototypes PINVOICE anonymisés en fixtures, [configuration § 1](../docs/admin/configuration.md#1-sage-x3-24r1-api-rest-syracuse)) ; données inventées. |
| MyReport | Aucune | Il n'existe pas, à ma connaissance, de serveur MCP officiel MyReport : le bouchon prouve seulement la plomberie SSE et la liste blanche, avec des outils inventés. |
| Clevoa | Exacte | C'est notre propre backend. |

Le bouchon valide le **hub** (flux OAuth, refresh, transmission des jetons, droits, transports MCP, fichiers), pas la
conformité des produits : la première connexion réelle à chaque système reste le vrai test, et les boutons de diagnostic
du portail sont faits pour ça.
