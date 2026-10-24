# Campagne de charge du hub (bouchons uniquement)

Outils reproductibles pour mesurer ce que le hub MCP tient avec N collaborateurs, **sans jamais toucher un système réel** :
les backends (Salesforce, Sage X3, Graph/SharePoint, Dropbox, MyReport, Clevoa) sont imités par `mock-backends.js`,
un seul serveur HTTP local. Aucune dépendance ajoutée : `sdk.js` réutilise le SDK MCP et zod installés dans `hub/node_modules`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `mock-backends.js` | Bouchons des six backends sur un port local (défaut 4100). Chaque réponse porte le marqueur `usr-NN` déduit du jeton reçu, ce qui permet de détecter tout mélange entre utilisateurs. `POST /__control` injecte latence (`delay` ms) ou pannes (`fail: {status, rate}`) sur les routes dont le chemin contient `routes` (sous-chaîne, vide = toutes ; délai borné à 60 s, statut parmi 429/500/502/503) ; `GET /__stats` donne par famille le nombre d'appels, d'erreurs et les temps de service p50/p95/p99 ; `POST /__reset`. |
| `run.js` | Lance les bouchons puis le hub de la branche courante (`hub/server.js`) en processus enfants, enregistre 50 collaborateurs avec des jetons distincts dans un `users.json` temporaire, joue les scénarios et écrit les résultats JSON dans `results/`. |
| `sdk.js` | Réexporte le SDK depuis `hub/node_modules`. |
| `results/` | Résultats de la dernière campagne (un JSON par scénario + `campagne.json` avec les conditions d'exécution et les échantillons CPU/RSS). |

## Lancer

```bash
cd hub && npm ci && cd ..        # une seule fois : installe le SDK que loadtest réutilise
node loadtest/run.js              # tous les scénarios (≈ 15 min)
node loadtest/run.js nominal,pointe   # un sous-ensemble
LT_USERS=50 LT_SSE_SHARE=0.2 LT_LOG_LEVEL=info node loadtest/run.js
```

Variables : `LT_USERS` collaborateurs enregistrés (50), `LT_SSE_SHARE` part des actifs sur le transport SSE, les autres en Streamable HTTP (0,2),
`LT_LOG_LEVEL` niveau de log du hub (`info`, comme en production).

Rien n'est lu dans `.env` : le hub est lancé avec une configuration complète pointant sur les bouchons (`APP_ENV=preprod`, clé de chiffrement aléatoire,
`DATA_DIR` temporaire supprimé à la fin). Le dépôt n'est pas modifié, aucun conteneur n'est nécessaire.

## Ce qui est joué

Chaque utilisateur actif est un vrai client MCP (`Client` du SDK) authentifié par sa propre clé `Authorization: Bearer`, en **boucle ouverte** :
il émet un appel d'outil à cadence fixe (± 30 % de gigue) sans attendre la réponse précédente, avec au plus 5 appels en cours par utilisateur
(au-delà, l'appel est compté « non émis » et apparaît dans `notEmitted`). Le débit demandé est donc indépendant du débit servi.

Mélange d'appels (pondération) : `sagex3_query` 30, `salesforce_call soqlQuery` 25, `sharepoint_list` 15, `dropbox_call list_folder` 10,
`myreport_call valeur_indicateur` 10, `sagex3_describe` 5 (structure 120 champs, mise en cache par utilisateur), `salesforce_tools` 3, `sagex3_get` 2 (200 lignes).

| Scénario | Enregistrés | Actifs | Cadence visée | Durée |
|---|---|---|---|---|
| `reference` | 50 | 1 | 30/min, chaque outil tour à tour, HTTP puis SSE | 60 s + 40 s |
| `nominal` | 50 | 5 | 30/min | 180 s |
| `soutenue` | 50 | 15 | 150/min | 180 s |
| `pointe` | 50 | 30 | 600/min | 120 s |
| `stress` | 50 | 1 → 50 (montée sur 80 % de la durée) | 1 appel / 3 s / actif, soit jusqu'à 1 000/min | 180 s |
| `defaillances` | 50 | 10 | Sage lent 2 s ; Sage > délai hub (35 s) ; Salesforce 429 à 50 % ; Graph 500 à 50 % ; 50 reconnexions SSE brutales ; 40 sessions SSE abandonnées | ≈ 3 min |

L'isolation est vérifiée à chaque appel de tous les scénarios : la réponse doit contenir le marqueur de l'appelant et aucun autre (`violations`).

## Mesures (par scénario, dans `results/<scenario>.json`)

- `scheduled`, `calls`, `notEmitted`, `achievedPerMin`, `maxInflight` : débit demandé, émis, servi, appels non émis, requêtes en cours maximum.
- `errorsByType` : `ok`, `limite_configuree` (plafond du connecteur, ex. MyReport 20/min), `backend_429`, `backend_5xx`, `backend_timeout`,
  `backend_injoignable`, `hub_http_<code>`, `connexion`, `client_timeout`, `exception`. `hubOwnErrors` et `hubOwnErrorRate` ne comptent que les erreurs
  imputables au hub (jamais les limites configurées ni les erreurs renvoyées par un backend).
- `latencyAllOk`, `latencyPerTool`, `latencyPerTransport` : p50/p95/p99/max de bout en bout (client → hub → bouchon → client), appels réussis.
- `backend` : temps de service côté bouchon par famille (p50/p95/p99), latence injectée comprise. Avec des bouchons à ~1-2 ms, la latence
  de bout en bout est à 1-3 ms près la latence propre du hub ; la différence e2e − bouchon est le coût du hub.
- `hub` : CPU moyen/max (% d'un cœur, lu dans `/proc/<pid>/stat` chaque seconde) et RSS début/fin/max en Mo. `campagne.json` conserve tous les échantillons.
- `windows` (stress) : par fenêtre de 30 s, actifs démarrés, appels servis, p95, erreurs, RSS.
- `hubExited` : non nul si le processus hub s'est arrêté pendant la campagne.

## Limites de l'outil

- Les bouchons répondent en 1-2 ms : les latences réelles de Sage X3 (session Syracuse par appel), Salesforce, Graph, Dropbox et MyReport ne sont pas représentées, seule leur forme (pages, volumes) l'est. La recette sur les systèmes réels reste à faire.
- Générateur, hub et bouchons partagent la même machine ; les chiffres CPU du hub sont isolés par PID mais la contention est partagée.
- Pas de TLS ni de reverse proxy nginx dans la boucle.
