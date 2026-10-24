# Rapport de charge – Charlois AI Gateway v1.2.1

Release testée : v1.2.1, commit `9c0f79ea49ef8e445a1f768154911bc0e7ed809b`, code applicatif inchangé (branche `test/charge-v1.2.1`, ajouts sous `loadtest/` uniquement).
Campagne du 24 octobre 2026, 08:08 → 08:35 UTC. Outils et mode d'emploi : [`loadtest/README.md`](README.md). Résultats bruts : [`loadtest/results/`](results/).

## 1. Verdict

**Capacité démontrée sur bouchons** pour 50 collaborateurs enregistrés : le hub sert 30 actifs à 610 appels/min et 50 actifs à 1 010 appels/min
sans erreur propre, avec une latence propre p95 ≤ 30 ms et un processus stable (CPU ≤ 29 % d'un cœur, RSS ≤ 132 Mo, aucun redémarrage).
Aucun mélange de données ou de session sur 3 950 appels vérifiés un par un.

**Non démontrée sur les systèmes réels.** Les bouchons répondent en 1-2 ms ; la latence réelle de Sage X3 (session Syracuse à chaque appel),
Salesforce, Graph, Dropbox et MyReport, ainsi que leurs quotas, ne sont pas représentés. La recette sur les systèmes Charlois reste à faire
(hors périmètre de cette campagne, qui n'a envoyé aucune requête vers un système réel).

| Critère de qualification | Résultat |
|---|---|
| Aucun mélange de données ou de session | **Tenu** : 0 violation sur tous les scénarios (chaque réponse ne contient que le marqueur de l'appelant). |
| Pas de fuite mémoire manifeste, crash ou redémarrage | **Tenu sur 27 min** : RSS 88 → 108 Mo (max 132), stable pendant les 3 min de stress (129 → 130 Mo) ; aucun arrêt. Non mesuré sur plusieurs heures. |
| Erreurs propres au hub < 1 % en nominal et soutenu (hors limites configurées) | **Tenu** : 0 erreur propre sur 91 (nominal) et 463 (soutenu) appels ; 0 également en pointe et stress. |
| Latence propre du hub p95 < 500 ms avec bouchons rapides | **Tenu** : p95 de bout en bout 21 ms (nominal), 22 ms (soutenu), 18 ms (pointe), 15 ms (stress), bouchons à 1-3 ms. |
| Dégradation explicite et contrôlée aux limites des connecteurs | **Tenu** pour MyReport : au-delà de 20 appels/min (tous utilisateurs confondus), refus immédiat avec message clair, les autres outils ne sont pas affectés. |

## 2. Conditions d'exécution

| Élément | Valeur |
|---|---|
| Machine | conteneur Linux, 4 vCPU Intel Xeon 2,10 GHz, 16 Go RAM, noyau 6.18.44 ; générateur, hub et bouchons sur la même machine |
| Node.js | v22.22.0 (même image que `hub/Dockerfile` : node:22-alpine) |
| Docker | non utilisé : hub lancé directement (`node hub/server.js`), aucun démon Docker disponible dans l'environnement de test ; pas de nginx ni de TLS dans la boucle |
| Configuration du hub | `APP_ENV=preprod`, `LOG_LEVEL=info`, `SSO_MODE` vide, `MYREPORT_MAX_PER_MIN` par défaut (20), `SF_MAX_PER_MIN` par défaut (0 = illimité), délai Sage X3 30 s (code), tous les backends pointés sur `loadtest/mock-backends.js` |
| Collaborateurs | 50 enregistrés dans un `users.json` temporaire, chacun avec sa clé MCP et ses propres jetons Salesforce, Sage X3, Microsoft, Dropbox et MyReport |
| Clients | vrais clients MCP du SDK (`Client`), 80 % Streamable HTTP (`/mcp`), 20 % SSE (`/sse` + `/messages`), authentifiés par `Authorization: Bearer` |
| Modèle de charge | boucle ouverte : chaque actif émet à cadence fixe sans attendre la réponse précédente, au plus 5 appels en cours par actif (aucun appel n'a dû être retenu : `notEmitted` = 0 partout) |
| Durées | référence 60 + 40 s, nominal 180 s, soutenu 180 s, pointe 120 s, stress 180 s, défaillances ≈ 3 min (rejouées une fois après correction du générateur, voir §6) |

Vocabulaire : **enregistré** = présent dans `users.json` avec ses jetons ; **actif** = client MCP connecté qui émet des appels ; **en cours** = appels émis dont la réponse n'est pas encore reçue.

## 3. Résultats par scénario

Lecture : « erreurs hub » = erreurs imputables au hub (HTTP 5xx du hub, connexion refusée, exception, erreur non classée) ; « plafond configuré » = refus par un plafond
de connecteur (MyReport 20/min) ; « erreurs backend » = erreurs renvoyées ou provoquées par un bouchon (429, 500, délai). Latences en ms sur les appels réussis,
de bout en bout (client → hub → bouchon → client) ; avec des bouchons à 1-3 ms, c'est à 3 ms près la latence propre du hub.

### Synthèse par scénario

| Scénario | Enregistrés | Actifs | Visé /min | Servi /min | Non émis | Appels | OK | Erreurs hub | Plafond configuré | Erreurs backend | p50 / p95 / p99 e2e (ms, OK) | p95 bouchon max (ms) | En cours max | CPU hub moy / max (%) | RSS hub (Mo) | Violations isolation |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference_http | 50 | 1 (0 SSE) | 30 | 29 | 0 | 29 | 29 | 0 (0 %) | 0 | 0 | 13 / 30 / 90 | 39 | 1 | 1 / 11 | 88 → 84 (max 89) | 0 |
| reference_sse | 50 | 1 (1 SSE) | 30 | 33 | 0 | 22 | 22 | 0 (0 %) | 0 | 0 | 8 / 18 / 19 | 4 | 1 | 0 / 1 | 84 → 86 (max 86) | 0 |
| nominal | 50 | 5 (1 SSE) | 30 | 30 | 0 | 91 | 91 | 0 (0 %) | 0 | 0 | 13 / 21 / 28 | 3 | 5 | 0 / 6 | 88 → 92 (max 92) | 0 |
| soutenue | 50 | 15 (3 SSE) | 150 | 154 | 0 | 463 | 463 | 0 (0 %) | 0 | 0 | 8 / 22 / 98 | 2 | 15 | 2 / 20 | 94 → 121 (max 121) | 0 |
| pointe | 50 | 30 (6 SSE) | 600 | 610 | 0 | 1219 | 1157 | 0 (0 %) | 62 | 0 | 8 / 18 / 106 | 2 | 30 | 7 / 29 | 123 → 127 (max 127) | 0 |
| stress | 50 | 50 (10 SSE) | 1000 | 613 | 0 | 1838 | 1715 | 0 (0 %) | 123 | 0 | 6 / 15 / 23 | 2 | 4 | 6 / 23 | 129 → 130 (max 132) | 0 |

### Latence de bout en bout par outil (ms, appels OK)

| Outil | reference_http p50 / p95 | reference_sse p50 / p95 | nominal p50 / p95 | soutenue p50 / p95 | pointe p50 / p95 | stress p50 / p95 |
|---|---|---|---|---|---|---|
| sagex3_query | 10 / 22 (n=4) | 5 / 7 (n=3) | 6 / 15 (n=16) | 5 / 11 (n=149) | 5 / 9 (n=356) | 4 / 8 (n=531) |
| salesforce_soql | 24 / 90 (n=4) | 14 / 18 (n=3) | 15 / 21 (n=23) | 14 / 24 (n=119) | 12 / 20 (n=334) | 10 / 19 (n=482) |
| sharepoint_list | 8 / 10 (n=4) | 5 / 11 (n=3) | 7 / 25 (n=16) | 5 / 56 (n=72) | 5 / 9 (n=197) | 4 / 8 (n=267) |
| dropbox_list | 21 / 23 (n=4) | 14 / 19 (n=3) | 16 / 19 (n=9) | 13 / 22 (n=37) | 11 / 18 (n=112) | 10 / 18 (n=198) |
| myreport_call | 22 / 23 (n=4) | 13 / 14 (n=3) | 14 / 17 (n=16) | 12 / 43 (n=44) | 6 / 108 (n=117, err {"limite_configuree":62}) | 4 / 14 (n=183, err {"limite_configuree":123}) |
| sagex3_describe | 10 / 16 (n=3) | 8 / 8 (n=3) | 12 / 28 (n=6) | 6 / 10 (n=14) | 6 / 17 (n=44) | 5 / 9 (n=90) |
| salesforce_tools | 11 / 30 (n=3) | 4 / 4 (n=2) | 16 / 16 (n=2) | 7 / 103 (n=18) | 9 / 19 (n=35) | 3 / 9 (n=49) |
| sagex3_get | 7 / 10 (n=3) | 7 / 7 (n=2) | 6 / 8 (n=3) | 6 / 8 (n=10) | 5 / 7 (n=24) | 5 / 9 (n=38) |

### Erreurs par type

| Scénario | limite_configuree |
|---|---|
| reference_http | 0 |
| reference_sse | 0 |
| nominal | 0 |
| soutenue | 0 |
| pointe | 62 |
| stress | 123 |

### Temps de service côté bouchons (ms, p50 / p95 / p99)

| Scénario | sagex3 | salesforce | graph | dropbox | myreport |
|---|---|---|---|---|---|
| reference_http | 1 / 1 / 1 (n=12) | 2 / 39 / 39 (n=15) | 1 / 1 / 1 (n=4) | 2 / 4 / 4 (n=12) | 1 / 1 / 1 (n=12) |
| reference_sse | 1 / 1 / 1 (n=8) | 1 / 2 / 2 (n=9) | 1 / 1 / 1 (n=3) | 1 / 4 / 4 (n=9) | 1 / 1 / 1 (n=9) |
| nominal | 0 / 1 / 1 (n=33) | 1 / 3 / 4 (n=72) | 0 / 1 / 1 (n=16) | 1 / 2 / 3 (n=27) | 1 / 1 / 2 (n=48) |
| soutenue | 0 / 1 / 1 (n=185) | 1 / 2 / 5 (n=378) | 0 / 1 / 1 (n=72) | 1 / 2 / 3 (n=111) | 0 / 1 / 1 (n=132) |
| pointe | 0 / 1 / 1 (n=454) | 1 / 2 / 3 (n=1053) | 0 / 1 / 1 (n=197) | 1 / 2 / 3 (n=336) | 0 / 1 / 1 (n=165) |
| stress | 0 / 1 / 1 (n=695) | 1 / 2 / 3 (n=1464) | 0 / 1 / 1 (n=267) | 1 / 2 / 3 (n=594) | 0 / 1 / 2 (n=180) |

Notes de lecture :

- Scénario 1 (référence, 1 utilisateur, chaque outil tour à tour) : appels simples 5-13 ms, appels complexes (structure Sage 120 champs, catalogue Salesforce, facture 200 lignes) 7-24 ms. Le p99 à 90 ms en HTTP vient d'un seul appel Salesforce au démarrage (ouverture de la première session MCP vers le bouchon, 39 ms côté bouchon).
- Scénario 4 (pointe) : les 30 actifs démarrent au même instant, d'où 30 appels en cours au maximum ; le stress monte progressivement et ne dépasse jamais 4 appels en cours. Le hub absorbe les deux formes sans erreur.
- Scénario 5 (stress) : la cadence « servi /min » de la synthèse est une moyenne sur 180 s incluant la montée. Fenêtre par fenêtre, le hub atteint 1 010 appels/min avec 50 actifs et un p95 de 13 ms (tableau ci-dessous). Les 123 refus sont tous des refus MyReport attendus.
- Transports : aucune différence mesurable entre Streamable HTTP et SSE (stress : p95 15 ms contre 16 ms ; pointe : 18 ms contre 18 ms).

### Montée en charge (stress), fenêtres de 30 s

| t (s) | Actifs démarrés | Servis / 30 s | ≈ /min | p95 OK (ms) | Erreurs | RSS hub (Mo) |
|---|---|---|---|---|---|---|
| 30 | 11 | 63 | 126 | 13 | 11 | 101 |
| 60 | 21 | 165 | 330 | 18 | 2 | 126 |
| 90 | 31 | 268 | 536 | 18 | 25 | 128 |
| 120 | 41 | 366 | 732 | 15 | 14 | 129 |
| 150 | 50 | 471 | 942 | 12 | 48 | 130 |
| 180 | 50 | 505 | 1010 | 13 | 23 | 130 |

## 4. Scénario 6 – défaillances des backends

Chaque phase : 10 actifs à 120 appels/min pendant 30 à 40 s, panne injectée dans le bouchon visé seulement.

| Phase | Actifs | Appels | OK | Erreurs hub | Plafond | Erreurs backend (types) | p50 / p95 e2e OK (ms) | p95 bouchon (ms) | RSS hub (Mo) |
|---|---|---|---|---|---|---|---|---|---|
| sage_lent_2s | 10 | 84 | 84 | 0 | 0 | 0 | 23 / 2067 | 2003 | 102 → 105 |
| pendant_timeout | 5 | 22 | 22 | 0 | 0 | 0 | 14 / 24 | 3 | 105 → 106 |
| salesforce_429 | 10 | 64 | 10 | 0 | 0 | backend_429 54 | 14 / 44 | 2 | 107 → 107 |
| graph_500 | 10 | 65 | 35 | 0 | 0 | backend_5xx 30 | 6 / 30 | 1 | 107 → 108 |

Sage au-delà du délai du hub (bouchon à 35 s, 3 appels simultanés) : backend_timeout après 30005 ms ; backend_timeout après 30006 ms ; backend_timeout après 30007 ms ; message : « Sage X3 : pas de réponse en 30 s (/api1/x3/erp/PROD/PINVOICE) ».
Pendant ces 3 appels bloqués, les autres outils (5 actifs) : p95 24 ms, erreurs hub 0.

Reconnexions SSE brutales : 50 cycles ouverture → appel → coupure, 50 OK, 0 erreurs.
Sessions SSE abandonnées : 40 ouvertes, RSS hub 108 Mo avant → 112 Mo avec 20 ouvertes → 112 Mo après coupure de toutes. Hub arrêté : non.

Constats :

- **Backend lent (Sage à 2 s)** : les appels Sage prennent 2,0 s (`sagex3_query`, `sagex3_get` : une requête Syracuse) ou 4,0 s (`sagex3_describe` : deux requêtes). Les autres outils restent à 7-16 ms de médiane (p95 71-102 ms, légèrement au-dessus du nominal : les 10 actifs tournent au-dessus de la cadence soutenue). Rien ne bloque : Node traite les appels en parallèle.
- **Délai dépassé (Sage à 35 s)** : les 3 appels sont coupés par le hub à 30 s avec un message lisible, et 5 autres actifs continuent à 24 ms de p95 pendant ce temps. Le client MCP attend donc 30 s au pire par appel Sage ; c'est le délai codé dans le connecteur, pas une limite du hub.
- **HTTP 429 sur Salesforce (50 % des requêtes)** : 54 appels sur 64 échouent, soit bien plus que 50 %, car chaque appel d'outil Salesforce ouvre une nouvelle session MCP vers le serveur SObject Reads (initialize, notification, tools/call : 3 requêtes HTTP, un échec sur l'une suffit ; 1 − 0,5³ = 87,5 %, mesuré 84 %). Le message rendu au client, « Salesforce MCP : Streamable HTTP error: Error POSTing to endpoint: {…} », ne dit pas qu'il s'agit d'un 429 ni qu'il faut réessayer. Aucun retry côté hub.
- **HTTP 500 sur Graph (50 %)** : 30 échecs sur 65, cohérent avec l'injection (une requête Graph par appel) ; message explicite « SharePoint 500: … ».
- **Reconnexions SSE brutales** : 50 cycles ouverture → appel → coupure sans clôture propre, 50 réussites ; le hub retire la session à la fermeture TCP (`res.on("close")`).
- **Sessions abandonnées** : 40 sessions SSE ouvertes puis coupées, +4 Mo de RSS non rendus dans les 10 s d'observation (le ramasse-miettes n'a pas été sollicité) ; aucun arrêt. **Non mesuré** : une session dont le client disparaît sans fermeture TCP (portable mis en veille, coupure réseau) reste dans la table des sessions jusqu'à la détection par la pile TCP ; le hub n'a pas de délai d'inactivité propre pour `/sse`.

## 5. Scénario 7 – isolation

Vérifiée à chaque appel de chaque scénario (3 662 appels de charge + 288 appels des phases de défaillance) : chaque bouchon signe sa réponse avec le marqueur
dérivé du jeton reçu (`usr-NN`), et le générateur rejette toute réponse contenant un marqueur étranger ou dépourvue du sien. **0 violation.**
Les tests unitaires de la release couvrent en complément l'usurpation de session SSE (403 si la clé diffère) et les cas SSO (`hub/test/sso.test.js`).

## 6. Goulots d'étranglement, classés par impact pour 50 collaborateurs

1. **Latence et quotas des backends réels** (non mesurés ici). Avec des bouchons à 1-3 ms, le hub coûte 5-25 ms par appel ; sur les systèmes réels, la latence sera dominée par Syracuse (session X3 par appel, délai 30 s), Salesforce et Graph. Le hub ne bloque pas pendant ces attentes (démontré en §4), mais chaque client MCP attend sa réponse. Risque restant : quotas réels (Salesforce API, throttling Graph 429 non testé, MyReport).
2. **Plafond MyReport global de 20 appels/min, tous utilisateurs confondus** (`MYREPORT_MAX_PER_MIN`, voulu pour ménager la production MyReport). C'est la première limite atteinte : 53 % des appels MyReport refusés à 600 appels/min (30 actifs), 67 % à 1 000/min. Comportement correct (refus immédiat, message clair, autres outils intacts), mais 50 collaborateurs qui utilisent MyReport simultanément se partagent 20 appels/min. Décision métier : relever la valeur si MyReport le supporte.
3. **Une session MCP Salesforce par appel d'outil** (`hub/mcpclient.js`, `withMcp`) : 3 requêtes HTTP vers Salesforce par appel, donc 3 fois l'exposition au 429 et environ 3 fois la latence réseau réelle. Mesuré sur bouchons : `salesforce_soql` est 2 à 3 fois plus lent que `sagex3_query` (p50 10-16 ms contre 4-6 ms). Même schéma pour Dropbox et MyReport (proxys MCP).
4. **Erreur 429 amont rendue sans statut ni consigne** (§4) : le collaborateur voit une erreur technique au lieu de « Salesforce limite le débit, réessayez dans un instant ».
5. **Aucun plafond sur les routes MCP elles-mêmes** (`/mcp`, `/sse`, `/messages`) : seuls le portail, `/auth` et `/api` sont limités par IP ; les connecteurs sans `maxPerMinute` (Sage X3, Graph, Dropbox) sont illimités. Le stress a servi 1 010 appels/min sans refus, ce qui est bon pour la capacité mais signifie qu'un client MCP emballé peut saturer un backend réel sans que le hub l'arrête.
6. **Mémoire** : +40 Mo entre le début et la pointe (tas V8 et cache de structures par utilisateur et par système, conservé jusqu'à 3 h), puis stable. Pas de fuite visible sur 27 min ; non démontré sur une journée.

## 7. Recommandations (sans Redis, base, cluster ni refactorisation)

Aucune correction n'est nécessaire pour la qualification sur bouchons. Les points ci-dessous sont proposés séparément, à justifier ou non par la recette réelle, et ne font pas partie de cette PR :

1. **Recette de charge sur la pré-production réelle** avant d'affirmer la capacité : rejouer `nominal` et `soutenue` avec `loadtest/run.js` adapté aux URL réelles de pré-production (jetons de quelques comptes de test, jamais la production) pour mesurer la latence réelle par connecteur, le comportement des quotas et surtout le 429 Graph. C'est la seule mesure manquante au verdict.
2. **Rendre lisibles les 429 amont** (petite modification de `hub/mcpclient.js`) : détecter le statut de `StreamableHTTPError`/`SseError` et renvoyer « <Système> limite le débit, réessayez dans un instant ». Justification : §4, 54 erreurs opaques sur 64.
3. **Réutiliser la session MCP Salesforce par utilisateur** (ou, a minima, tenter une seule fois de rouvrir la session sur 429) seulement si la recette réelle montre une latence Salesforce ou des 429 gênants. Sur bouchons, le surcoût est de 10 ms par appel : pas de quoi justifier le changement aujourd'hui.
4. **Décider de `MYREPORT_MAX_PER_MIN`** avec le responsable MyReport : 20/min pour 50 collaborateurs est le premier plafond atteint ; aucune modification de code, variable d'environnement existante.
5. **Facultatif, si un client emballé est observé** : un plafond par clé sur `/mcp` et `/messages` (même mécanisme `hit()` que le portail, en mémoire). Non justifié par les mesures actuelles.
6. **Surveillance en exploitation** : relever la RSS du conteneur `mcp-hub` une fois par jour pendant les premières semaines (`docker stats`, déjà documenté dans `EXPLOITATION.md`) pour confirmer l'absence de fuite sur la durée, et noter les délais Sage > 30 s dans les logs.

## 8. Limites de la campagne

- Bouchons locaux à 1-3 ms : latences réelles, quotas réels, TLS et nginx non représentés. Le délai Sage de 30 s a été testé, pas le comportement de Syracuse sous charge.
- Générateur, hub et bouchons sur la même machine 4 vCPU : le hub a utilisé au plus 29 % d'un cœur, la contention n'a donc pas faussé les mesures, mais l'extrapolation « 3 000 appels/min par cœur » n'a pas été vérifiée.
- Durée de 27 minutes : la stabilité mémoire sur une journée n'est pas démontrée.
- Nombre de sessions côté hub non exposé par l'application : compté côté client. Sessions SSE abandonnées sans fermeture TCP non testées.
- Le générateur a été corrigé pendant la campagne (la remise à zéro des compteurs des bouchons effaçait aussi la panne injectée ; le délai Sage était classé « autre » ; le 429 Salesforce était classé « autre » faute de code dans le message). Les scénarios 1 à 5 n'étaient pas affectés ; le scénario 6 a été rejoué intégralement après correction (`results/campagne_defaillances.json`).
- Taux d'erreur par connecteur et par type : disponible dans `latencyPerTool[*].errors` de chaque JSON ; seuls MyReport (plafond) et les phases de défaillance en comportent.
