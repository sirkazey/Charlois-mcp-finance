# Écrire un connecteur

Un connecteur est un module ES de `hub/connectors/` de 50 à 190 lignes, importé et listé dans `server.js`
(`CONNECTORS`). Il ne reçoit que le jeton qui le concerne, en argument ; il n'a accès ni au store ni aux structures
internes du hub. Règle : lecture seule, jeton personnel, aucune abstraction partagée.

## 1. Interface

| Export | Obligatoire | Rôle |
|---|---|---|
| `id` | oui | identifiant court (`dropbox`), clé dans `users.json`, préfixe des routes `/auth/<id>` et `/api/test/<id>` |
| `label` | oui | libellé du portail et de la ligne `Source : <label>` |
| `tools` | oui | tableau d'outils MCP `{ name, description, input (schéma zod), run(tok, args, schema) }` |
| `schema(tok)` | oui | structure (objets, champs, outils distants) mise en cache par utilisateur jusqu'à 03:00 ; `run` la reçoit comme fonction `schema()` |
| `ping(tok, schema)` | oui | diagnostic du portail : `{ message, tables? }`, structure relue en direct |
| `oauth` | si OAuth | `{ authUrl, tokenUrl, clientId, clientSecret, scope, extraAuthParams? }` ; `configured` = `clientId` présent |
| `apiKey` | si jeton saisi | `{ mode: "bearer" \| "basic", label }` : le collaborateur saisit un jeton (ou identifiant et mot de passe) sur le portail |
| `identity(tok)` | non | e-mail du collaborateur après connexion (affiché sur le portail) |
| `source()` | non | complément de la ligne Source (`dossier X3TST_CHREC`, `sandbox preprod`) |
| `mock` | non | `true` = simulateur intégré sans jeton ; non exposé en production |
| `maxPerMinute` | non | plafond d'appels sortants par minute, tous utilisateurs confondus (0 = illimité) |
| `silent` | non | `true` = connexion tentée sans interaction (`prompt=none`) juste après le SSO (même application Entra) |

Le hub garantit autour de chaque `run` : vérification de la clé, résolution du jeton (`withToken`), refresh sur 401,
plafond, télémétrie, ligne Source, capture des erreurs. Un outil n'a donc qu'à appeler le système et renvoyer une
chaîne, un objet (sérialisé en JSON) ou `{ $content }` (contenu MCP relayé tel quel).

## 2. Les trois familles

**REST avec jeton** (`sagex3.js`, `sharepoint.js`) : `fetch` avec `Authorization: Bearer` (ou Basic), méthodes GET
uniquement, chemins validés, délai borné (`AbortSignal.timeout`), erreurs réseau converties en message lisible
(`unreachable(label, url, e)` dans `mcpclient.js`).

**Proxy d'un serveur MCP distant** (`salesforce.js`, `dropbox.js`, `myreport.js`) : `withMcp({ url, headers, sse?,
label }, fn)` ouvre un client MCP du SDK avec le jeton de l'utilisateur, exécute `fn(client)` puis ferme la session.
`schema` liste les outils distants filtrés par une **liste blanche** de lecture ; `<id>_tools` les expose avec leurs
schémas, `<id>_call` exécute l'un d'eux (`callRemote`). Les noms évoquant une écriture sont refusés avant transfert.
Budget : 50 lignes. C'est le modèle à suivre pour tout outil qui publie un serveur MCP officiel.

**Simulateur intégré** (`sagex3.js`, `myreport.js` sans URL) : `mock = true`, données inventées et étiquetées comme
telles, aucun réseau ; sert aux tests sur un poste sans compte.

## 3. Étapes

1. Créer `hub/connectors/<id>.js` sur le modèle de `dropbox.js` (proxy MCP) ou `sharepoint.js` (REST).
2. L'ajouter à `CONNECTORS` dans `server.js`. Le portail, l'OAuth, le diagnostic et la télémétrie le prennent en
   compte sans autre modification ; les variables d'environnement apparaissent dans la configuration affichée si leur
   préfixe est dans la liste `ENV` de `server.js`.
3. Documenter ses variables dans `.env.example` (commentaire au-dessus, jamais sur la ligne) et dans
   `docker-compose.yml` ; ajouter l'URI de rappel dans [configuration § 0](../admin/configuration.md#0-le-fichier-env-et-les-uri-de-rappel).
4. Écrire les tests : mock amont dans `hub/test/helpers/upstream.js`, cas nominal, 401 + refresh, révocation, panne
   (injoignable, délai), lecture seule (outil d'écriture refusé), cloisonnement (deux utilisateurs). Ajouter le système
   au bouchon `charlois-mcp-stub/` si un test de bout en bout a du sens.
5. Ajouter la ligne du connecteur dans [l'état des fonctionnalités](../validation/etat-des-fonctionnalites.md) avec le
   statut « testé sur bouchon » tant qu'un vrai compte ne l'a pas validé, et la section dans
   [configuration](../admin/configuration.md).

## 4. Ce qui est refusé

Écriture sous quelque forme que ce soit ; compte technique ou jeton lu depuis l'environnement ; cache de données
métier ; dépendance supplémentaire ; connecteur REST sur mesure quand un serveur MCP officiel existe ; couche
d'abstraction entre connecteurs avant qu'un quatrième proxy ne la justifie.
