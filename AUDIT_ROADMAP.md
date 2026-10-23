# Audit de clôture et feuille de route — Charlois AI Gateway

**Périmètre** : version 1.1.0 et bouchon d'entreprise `charlois-mcp-stub/`, 62 tests du hub verts en pré-prod et en
production, 8 tests de bout en bout hub ↔ bouchon, et la première validation sur les systèmes réels (Sage X3 préproduction,
Salesforce sandbox) consignée dans `JOURNAL_TESTS.md`.

## 0. Audit de clôture du 23 octobre 2026 (après les premiers tests réels)

Trois revues indépendantes sur le code à `be9c90c`, après une journée de tests sur la préproduction Sage X3 et la sandbox
Salesforce : un validateur (lecture seule, cloisonnement, injection), un testeur (crash-test hub ↔ bouchon, 42 vérifications
en 6 secondes, toutes conformes) et un contrôleur de simplicité.

**Verdict** : aucun point bloquant sur la lecture seule, le cloisonnement et l'injection. Quatre points importants, tous
corrigés le jour même (commit suivant), avec un test de régression chacun :

| # | Constat | Correction |
|---|---------|------------|
| 1 | Sous Docker, une variable vide (`MYREPORT_MAX_PER_MIN=`, `SF_DEFAULT_LIMIT=`) valait `0` : plafond et `LIMIT` par défaut désactivés en production, alors que les tests (variable absente) les voyaient actifs | `\|\|` au lieu de `??` ; test avec variable vide |
| 2 | Le diagnostic du portail échappait au plafond d'appels (20 clics par minute et par adresse IP, hors compteur global) | Même compteur pour le diagnostic ; un utilisateur sans jeton ne consomme plus le quota |
| 3 | `LIMIT` ajouté d'office cassait toute SOQL finissant par `OFFSET`, `ALL ROWS` ou `FOR VIEW` | Expression corrigée ; test avec `OFFSET` |
| 4 | `SAGE_REPRESENTATIONS` absente du compose de base : non réglable en production | Ajoutée ; `SAGE_TIMEOUT_MS` retirée (constante 30 s) |

Points mineurs traités dans la foulée : un délai dépassé n'est plus mis en cache comme « représentation en erreur » ;
libellé du portail en mode `basic` (« identifiant et mot de passe Syracuse », plus « clé d'API ») ; ligne Source
Salesforce « hôte … » hors sandbox et hors production (bouchon) ; `Object.hasOwn` sur les accès par nom ; corps d'erreur
Syracuse tronqué à 300 caractères et journal d'erreur réduit au statut HTTP ; `SF_MCP_URL` acceptée seulement si elle
désigne `…/sobject-reads` (liste blanche au lieu d'une liste noire) ; liste blanche `SF_MCP_TOOLS` supprimée (jamais
exercée, redondante) ; `mcp-remote` épinglé en `0.15` dans le bloc Claude Desktop ; en production, un connecteur sans
configuration n'est plus exposé (aucune donnée inventée possible en prod).

**Simplicité** : le produit reste minimaliste, 870 lignes, trois dépendances, un fichier d'état chiffré, aucune
abstraction. `sagex3.js` a doublé (90 → 180 lignes) de connaissance Syracuse vérifiée, pas de mécanique. Le poids avait
glissé vers la périphérie : la configuration existait en quatre copies désaccordées (code, liste du portail, `.env.example`,
compose). La liste codée en dur du portail est remplacée par un filtre sur l'environnement (une ligne, jamais en retard) ;
les divergences sont corrigées ; les descriptions d'outils Sage sont raccourcies et les pièges métier (factures/avoirs)
deviennent une donnée `notes` renvoyée par `sagex3_describe` ; les instructions du serveur MCP sont un tableau de phrases.
Factorisation entre connecteurs proxy : refusée (gain nul, abstraction en plus), à revoir seulement si un quatrième proxy
arrive (évolution 3.4).

**Ce que l'audit ne couvre pas** : le cloisonnement sur les vrais systèmes n'a été observé qu'avec un compte administrateur.
Le test avec un compte restreint reste le premier à faire (`JOURNAL_TESTS.md`, « Tests non encore réalisés »).
**Méthode** : relecture indépendante du code par un agent validateur (faits cités fichier par fichier), crash-test en boîte
noire du vrai hub branché sur le vrai bouchon par un agent testeur (expiration forcée des jetons, deux collaborateurs en
parallèle, fichiers physiques, pannes, charge), synthèse par l'agent principal. Mise à jour du 22 octobre 2026.
**Fil conducteur** : la solution doit rester une petite machine que n'importe quel développeur Node lit en une heure.
Chaque point ci-dessous est jugé à cette aune.

## 0 bis. Backlog de remédiation issu de la revue indépendante (23/10/2026)

**Portée** : revue statique du code, de l'architecture, des tests et de la commercialisation. Les vulnérabilités potentielles doivent être confirmées par tests ; les scanners n'ont pas encore été exécutés. Ce backlog complète les actions A–E existantes et n'annule pas les corrections déjà réalisées.

**Décision provisoire** : démonstration sur données fictives autorisée ; pilote en préproduction sous conditions ; ne pas mettre en production avec des données financières réelles avant validation des contrôles critiques.

### P0 — Vérifications et corrections prioritaires

| ID | Constat et action | Validation attendue |
|---|---|---|
| SEC-01 | **Transport SSE historique** : `GET /sse` authentifie le collaborateur, mais `POST /messages` retrouve le transport via le seul `sessionId`. Vérifier le modèle de menace (identifiant de session aléatoire et confidentiel), puis imposer l'authentification et la correspondance entre clé personnelle et session, ou désactiver SSE si inutile. | Test négatif inter-utilisateurs, test session volée et test de compatibilité des clients MCP. |
| SEC-02 | **Lambda de télémétrie** : si `CLEVOA_KEYS` est vide, la condition actuelle accepte toute clé non vide. Échouer en mode fermé et supprimer les valeurs de configuration dangereuses. | Tests sans variable, variable vide, clé invalide et clé valide. |
| SEC-03 | **Portail et création de clés** : `/api/me` peut créer une clé personnelle sans SSO applicatif natif. Définir le périmètre d'accès via reverse-proxy, VPN et/ou authentification d'entreprise ; documenter révocation et départ. | Un visiteur non autorisé ne peut pas créer ou exploiter de clé. |
| SEC-04 | **Droits métiers réels** : tester Sage X3 et Salesforce avec des comptes restreints et deux collaborateurs distincts. | Matrice d'accès signée par la DSI et les métiers ; aucune lecture hors habilitations. |
| SEC-05 | **Exposition réseau** : le compose publie le port 8080 ; vérifier l'interface d'écoute, les règles réseau, le reverse-proxy, HTTPS et `TRUST_PROXY`. | Seul l'accès approuvé est possible ; test depuis réseau non autorisé. |
| QA-01 | **Exactitude financière** : valider factures/avoirs, signes, devises, dates et rapprochements sur un jeu de référence. | Réponses attendues approuvées par la Finance, avec sources et limites. |
| AI-01 | **Injection de prompts et réponses non fiables** : tester des contenus malveillants dans CRM, documents et résultats MCP. | Aucun accès supplémentaire ni exfiltration non autorisée ; cas négatifs documentés. |

### P1 — Durcissement et qualification avant élargissement

| ID | Constat et action | Validation attendue |
|---|---|---|
| SEC-06 | Redirections de téléchargement SharePoint : vérifier l'URL `Location` avant de la suivre ; bloquer les destinations non prévues et les schémas dangereux. | Tests redirections légitimes, domaine non autorisé, IP interne et HTTP. |
| SEC-07 | OAuth : ne pas transmettre au navigateur les corps bruts d'erreur des fournisseurs ; limiter les diagnostics aux éléments non sensibles. | Aucun token, secret ou contenu sensible dans les erreurs. |
| SEC-08 | Salesforce : confirmer que les outils appelables sont strictement en lecture seule ; si nécessaire ajouter une liste autorisée explicite en défense en profondeur. | Inventaire des outils, tests d'appel refusé, droits source conservés. |
| SEC-09 | SharePoint/Graph : justifier les permissions déléguées `Files.Read.All` et `Sites.Read.All` ; valider les transferts vers les assistants IA. | Revue M365/DPO et documentation des flux. |
| SEC-10 | Store chiffré : tester restauration du volume avec la clé et procédure de perte/révocation. | Restauration et procédure d'exploitation vérifiées. |
| QA-02 | Exécuter les tests Node et tests d'intégration, ajouter les régressions pour chaque correction. | Résultats datés associés à un SHA de commit. |
| QA-03 | Tester refresh OAuth, révocation, panne upstream, quotas, timeout et taille des réponses. | Scénarios positifs et négatifs documentés. |
| QA-04 | Lancer Semgrep, CodeQL, Gitleaks, Trivy et un ZAP passif isolé ; qualifier chaque résultat. | Rapport avec preuve, sévérité, faux positifs et correctifs. |

### P2 — Commercialisation et exploitation

| ID | Constat et action | Validation attendue |
|---|---|---|
| COM-01 | Vérifier la propriété intellectuelle Clevoa / Charlois, les dépendances et les droits de réutilisation. | Conditions contractuelles validées. |
| COM-02 | Formaliser licence, installation, maintenance, support, SLA, exclusions et coûts LLM/API. | Offre et responsabilités explicites. |
| COM-03 | La télémétrie est agrégée mais une clé identifie l'installation : employer « agrégée / pseudonyme » plutôt que « totalement anonyme ». | Notice d'information cohérente avec les flux réels. |
| OPS-01 | La Lambda garde les événements en mémoire : prévoir la persistance si les données servent à facturer ou auditer les sièges. | Données réconciliables et durables avant facturation à l'usage. |
| OPS-02 | Distinguer socle multi-client et paramétrage Charlois ; vérifier l'absence de secrets ou noms internes dans les livrables. | Déploiement fictif chez un second client sans modification du socle. |
| OPS-03 | Examiner historique Git et visibilité du dépôt ; ne pas confondre dépôt public et vulnérabilité, mais révoquer les secrets éventuellement publiés. | Décision documentée sur la visibilité, historique contrôlé. |

**Règle de mise en œuvre** : correctifs localisés, tests de régression et simplicité. Ne pas introduire de microservices, de framework ou de base de données dans le Hub sans justification. La sévérité définitive dépend de l'exposition réelle et des tests.

---

## 0 ter. Exécution du backlog de la revue : analyses CI et corrections P0 (PR #1, même soir)

Première exécution du CI de la PR #1, puis relecture du code pour chaque constat du backlog ci-dessus. Les identifiants
renvoient au backlog (§ 0 bis).

### Résultats des analyses

| Outil | Résultat brut | Après relecture |
|---|---|---|
| Semgrep 1.146 | 2 signalements | **1 vrai durcissement** : `store.js` déchiffrait en AES-GCM sans longueur de tag explicite (un tag tronqué aurait pu passer) → `authTagLength: 16`. **1 faux positif** : mire OAuth du bouchon, `redirect_uri` reflétée dans un lien ; désormais validée (URL http(s) parsée) et échappée, marquée `nosemgrep` avec raison. |
| Gitleaks 8.24 | 6 « fuites » dans l'historique | **6 faux positifs** : clés MCP et clé de chiffrement de la suite de tests, clé démo du portail, exemple de commande du README Clevoa. Aucun secret réel dans l'historique (dépôt **public**, vérifié). Liste blanche `.gitleaks.toml` par chemin, documentée. |
| Trivy 0.36 | Vert après correction de la version d'action | 0 vulnérabilité HIGH/CRITICAL dans les deux `package-lock.json`, 0 mauvaise configuration dans les deux Dockerfile, 0 secret. |
| CodeQL | Vert sur `main` ; sur la PR, 3 alertes nouvelles successives dans le routeur OAuth : reflected XSS (high), puis, sur mes propres lignes de journal, clear-text logging (high) et log injection (medium) | **Confirmées et corrigées** : plus aucune donnée du fournisseur ni du navigateur n'est reflétée ou journalisée ; le journal n'écrit qu'un vocabulaire fixe, un statut HTTP et un code court validé. |

Workflows corrigés : actions `checkout@v7`, `upload-artifact@v7`, `setup-node@v6`, `codeql-action@v4` ; images
`semgrep:1.181.1`, `gitleaks:v8.30.1`, `zaproxy:2.16.1` ; délais max, concurrence, permissions minimales ; **job de tests**
ajouté (hub en pré-prod et production, bouchon) pour que toute régression fonctionnelle bloque la PR.

### Constats traités : verdict et corrections

| # | Constat de la revue | Verdict après lecture du code | Correction (toutes avec test de régression) |
|---|---|---|---|
| SEC-02 | Lambda Clevoa : `CLEVOA_KEYS` vide acceptait n'importe quelle clé | **Confirmé** (ouvert par défaut) | Fermé par défaut : `CLEVOA_KEYS` vide → 503, clé hors liste → 401 |
| SEC-06 | Redirection de téléchargement SharePoint suivie sans contrôle | **Confirmé, faible exploitabilité** (il faudrait que Graph renvoie une redirection hostile ; le jeton n'était déjà pas transmis) | Seuls les hôtes Microsoft en https (`sharepoint.com`, `1drv.com`, `microsoft.com`, `windows.net`) ou l'origine Graph configurée sont suivis ; sinon erreur explicite |
| SEC-07 | `error_description` OAuth reflétée dans une réponse HTML ; corps brut d'erreur du fournisseur renvoyé au navigateur | **Confirmé** (XSS réfléchi, exploitable seulement via un lien de callback forgé avec un state valide, donc par le navigateur de la victime lui-même) ; confirmé aussi par CodeQL (alerte « high » js/reflected-xss sur la PR) | Plus aucune donnée du fournisseur n'est reflétée : messages fixes au navigateur, détail dans le journal serveur ; routeur OAuth en `text/plain` |
| SEC-08 | Opérations Salesforce : aucun filtre de nom d'outil côté hub | **Risque théorique** (le serveur SObject Reads est en lecture seule et l'URL est verrouillée) | Défense en profondeur : tout outil dont le nom évoque une écriture (`create`, `update`, `delete`, `upsert`, `insert`, `execute`…) est refusé avant transfert |
| SEC-01 | Sessions SSE : `POST /messages` sans clé, session identifiée par `sessionId` seul | **Confirmé, faible exploitabilité** (identifiant aléatoire de 122 bits) | `/messages` exige la clé MCP et la session doit avoir été ouverte par cette clé (403 sinon) |
| QA-02, QA-04 | Tests et scanners | — | Job CI de tests, scanners exécutés et triés (tableau ci-dessus) ; connecteurs Sage X3 et Salesforce inchangés dans leur logique métier |

Tests : 63 hub (pré-prod et production), 9 bouchon, tous verts ; Semgrep local 1.181.1 : 0 signalement non justifié.
CI vert sur le dernier commit de la PR (six contrôles). Un échec unique et non reproduit de deux tests du hub (révocation
du refresh token, ligne Source) a été observé une fois en local lors de la vérification de la fusion dans `dev`, puis
dix passages consécutifs (six isolés, quatre complets avec les cinq fichiers en parallèle) sont restés verts : traité
comme un aléa d'exécution locale, à surveiller dans le CI (QA-02).

### Reste ouvert, décisions à prendre

* Confirmer dans Security → Code scanning que l'alerte CodeQL de la PR est close après le dernier commit (non lisible depuis cette session).
* ZAP passif exécuté sur `main` (démo isolée) : 0 échec, 57 contrôles passés, 10 avertissements, tous liés aux en-têtes de sécurité HTTP absents et à l'annonce `X-Powered-By` → en-têtes ajoutés avec test (PR suivante). Les rapports n'avaient pas été produits (dossier non inscriptible par le conteneur ZAP) : corrigé dans le workflow.
* OPS-03, dépôt public : historique contrôlé par Gitleaks, aucun secret publié ; décision à prendre sur la visibilité (privé, ou publication assumée).
* Non traités ce soir, car ils demandent une décision ou un test humain : SEC-03 (périmètre d'accès au portail : reverse-proxy, VPN ou SSO), SEC-04 (comptes restreints), SEC-05 (exposition réseau du port 8080), QA-01, AI-01, SEC-09, SEC-10, QA-03, et le volet P2.
* Les tests humains restent prioritaires sur tout scanner : compte restreint sur Sage X3 et Salesforce, révocation OAuth.

## 1. Bilan de la simplicité (audit actualisé)

### 1.1 Un seul conteneur, cinq modules : est-ce étanche ?

**Entre collaborateurs : oui, par construction.** Chaque requête arrive avec la clé personnelle du collaborateur dans
l'en-tête `Authorization`. Cette clé est vérifiée, puis figée pour toute la durée de la session MCP. Le hub ne lit que
le jeton rangé sous cette clé, et le cache de structure est lui aussi rangé par clé. Un test dédié fait interroger les
mêmes outils par deux personnes et vérifie que seuls leurs deux jeux de jetons circulent. Il n'existe aucun chemin
de code par lequel le jeton de l'un pourrait servir à l'autre.

**Entre connecteurs : oui, par convention de code.** Un connecteur ne reçoit que le jeton qui le concerne, en argument.
Aucun des cinq modules n'a accès au fichier des jetons ni aux structures internes du hub. C'est une étanchéité de
lecture (un connecteur pourrait techniquement être réécrit pour contourner la règle), pas un cloisonnement de
processus. Pour cinq fichiers de 50 à 130 lignes relus à chaque modification, c'est le bon niveau : un cloisonnement
par conteneurs séparés multiplierait les images, les réseaux et les secrets pour un gain nul.

**Panne d'un connecteur** : toute erreur d'un outil est capturée et renvoyée à l'assistant comme un message d'erreur ;
elle ne fait tomber ni les autres connecteurs ni le processus. Le hub ne s'arrête que dans trois cas, tous au démarrage
et tous voulus : clé de chiffrement absente, fichier de jetons illisible, production sans https.

**État partagé** : six structures en mémoire (jetons déchiffrés, cache de structure, flux OAuth en cours, compteurs de
débit, sessions SSE, compteur de télémétrie) et un seul fichier sur disque. Aucune n'est modifiable par un connecteur.
Rien de tout cela n'est problématique.

**Verdict** : architecture étanche là où cela compte (entre personnes), simple partout ailleurs. Un seul point à
retenir pour plus tard : l'endpoint `/messages` du transport SSE historique n'exige pas l'en-tête Bearer, il repose sur
l'identifiant de session aléatoire créé à l'ouverture du flux ; c'est le fonctionnement standard de ce transport, pas
une faille, mais c'est le morceau que l'on retirera en premier quand les assistants cibles seront tous sur Streamable HTTP.

### 1.2 Chiffrement du store et clé hors des URL : quel coût de maintenance ?

**Ce qui a été ajouté** : 24 lignes nettes dans `store.js` pour le chiffrement AES-256-GCM, zéro dépendance (module
`crypto` de Node), zéro ligne pour la suppression de `?key=` (la ligne de lecture de la clé est même plus courte).
Le format sur disque est versionné (`enc1:`) et un ancien fichier en clair est relu et rechiffré tout seul à la première
écriture : pas de script de migration.

**Opérations récurrentes** : aucune. Le seul geste d'exploitation est de générer une clé par environnement, une fois,
et de la ranger dans un coffre avec la sauvegarde du volume. Il n'y a pas de rotation de clé prévue ; pour en changer,
on supprime le fichier et tout le monde se reconnecte.

**Ce qui se passe si la clé est perdue, changée, ou si le fichier est corrompu** (vérifié à la main) : le hub refuse
de démarrer avec un message explicite, et Docker le redémarre en boucle jusqu'à ce qu'un exploitant remette la bonne
clé ou supprime `/data/users.json` dans le volume. Ensuite chaque collaborateur refait deux gestes : se reconnecter
sur le portail, et recopier son nouveau bloc connecteur dans son assistant, car les clés MCP personnelles vivent dans
le même fichier. Le README actuel dit « les collaborateurs se reconnectent, rien d'autre n'est perdu » : c'est vrai
sur le fond, mais il omet l'intervention sur le volume et le nouveau bloc connecteur. À corriger (voir backlog A3).

**Verdict** : aucune lourdeur. Le coût est celui d'un mot de passe d'application à sauvegarder une fois.

### 1.3 Télémétrie Clevoa : est-elle vraiment anonyme ?

**Ce qui part**, et rien d'autre : la version du hub, l'environnement (`PRODUCTION` ou `PRE-PROD`), la date du jour,
cinq booléens (tel outil est configuré ou non) et deux entiers (nombre d'appels d'outils depuis le dernier envoi, tous
collaborateurs confondus ; nombre de sièges, c'est-à-dire de collaborateurs ayant connecté au moins un outil, base de la
licence par siège depuis la 1.2.0). Deux en-têtes : le type de contenu et `X-Clevoa-Key`.

**Ce qui ne peut pas partir** : email, jeton, question posée, résultat, identifiant de collaborateur, adresse IP de
collaborateur. Le module de télémétrie ne lit aucune de ces informations ; le mode de logs détaillés n'enregistre
jamais les arguments ni les résultats ; les adresses IP des collaborateurs ne servent qu'à la limitation de débit, en
mémoire, et ne sont jamais envoyées. Côté AWS, la fonction refuse tout envoi qui contiendrait un champ supplémentaire.

**Ce qui identifie quoi** : `X-Clevoa-Key` identifie une installation (une clé par stack, commune à tous les
utilisateurs du hub), jamais une personne. L'adresse IP publique du serveur Charlois est visible par AWS, comme pour
tout appel HTTPS ; la fonction ne la lit pas.

**Verdict** : anonymisation complète. Un seul interstice théorique, sans effet pratique : les champs `env` et `date` ne
sont pas typés côté Lambda. Une ligne de validation le fermerait (candidat pour la 1.1.0, pas bloquant).

### 1.4 Verdict global de simplicité

Environ 870 lignes de code, trois dépendances, un conteneur, aucune opération d'exploitation récurrente, 62 tests qui
tournent en moins de trente secondes sans réseau. Le blindage de sécurité a coûté une variable d'environnement et une
vingtaine de lignes. S'il fallait simplifier encore une chose : retirer le transport SSE historique (treize lignes, une
structure en mémoire et un endpoint de moins) dès que les assistants utilisés sont confirmés sur Streamable HTTP.

## Bugs et alertes prioritaires — audit interne hub ↔ bouchon (22 octobre 2026)

Crash-test exécuté deux fois sur le vrai hub branché sur le vrai bouchon, jetons d'accès expirant toutes les 1,2 secondes.

| Scénario | Résultat |
|---|---|
| Expiration forcée puis 4 appels (Salesforce, SharePoint, Dropbox, Sage) | OK : refresh automatique à chaque fois, refresh token conservé, surcoût 5 à 11 ms par appel |
| Marie et Paul en parallèle, 48 appels alternés | OK : aucun mélange d'identité, 403 de Paul sur Confidentiel et PINVOICE, 200 pour Marie |
| Fichiers physiques (Excel, CSV, texte, PNG) | OK sauf l'image : le hub renvoie le PNG comme texte base64, pas comme image MCP (alerte 3) |
| Mire : refus, code rejoué, state inconnu | OK : 400 partout, store inchangé |
| Hub démarré sans bouchon, puis bouchon démarré | OK : pas de crash, voyants rouges puis verts sans redémarrage ; messages « fetch failed » peu parlants (alerte 5) ; télémétrie non réémise avant 03:00 (alerte 6) |
| 50 requêtes Sage séquentielles | OK : 4 ms en moyenne, 9 ms au maximum |
| Refresh token révoqué | KO : message brut `invalid_grant`, voyant toujours vert (alerte 2) |
| 21 mauvaises clés depuis une IP, puis une bonne clé depuis la même IP | KO : la bonne clé reçoit 429 pendant une minute (alerte 1) |

### Déjà corrigé (configuration uniquement, commit `20d6eb1`)

* `.env.example` : un commentaire sur une ligne à valeur vide était lu comme la valeur par Docker Compose. Effets au
  premier démarrage : clé de chiffrement égale à un texte public du dépôt, liste blanche MyReport absurde, Salesforce
  envoyé sur le vrai `login.salesforce.com` au lieu du bouchon. Commentaires déplacés au-dessus, valeurs vides laissées
  vides. Vérifié avec le scénario exact `cp .env.example .env`.
* README : ouvrir exactement l'adresse de `PUBLIC_URL` (sinon « State OAuth invalide »), supprimer le volume d'une version
  antérieure créée par root (`down -v`), `BROWSER_URL_REWRITE` à renseigner sur un serveur Portainer.

### Alertes 1 à 4 : corrigées (commit suivant, une vingtaine de lignes, un test de régression chacune)

* Rate-limiting : une clé valide passe toujours ; seuls les échecs sont comptés par IP.
* Refresh token révoqué : jetons effacés, message « Session … expirée ou révoquée : reconnectez-vous sur le portail »,
  voyant repassé à « non connecté ».
* Contenus MCP non textuels (image, resource) relayés tels quels : le podium arrive à l'assistant comme image.
* Refresh partagé : une seule promesse de renouvellement par collaborateur et par système, relecture du store avant de
  rafraîchir ; prêt pour les IdP à rotation de refresh token (Entra ID).

### Alertes 5 à 8 : corrigées également (même journée, un test de régression chacune)

* Système injoignable : « Sage X3 injoignable (hôte:port) : ECONNREFUSED » au lieu de « fetch failed », sur les trois
  connecteurs REST et les deux proxys MCP.
* Télémétrie : après un échec, nouvel essai à 1, 5 puis 30 minutes avant de retomber sur l'horaire quotidien.
* Callback OAuth : le `state` n'est consommé que par le navigateur qui a lancé le flux ; un appel étranger ne le grille plus.
* Bouchon : URL de téléchargement `/dl/<id>` signée (HMAC), comme le fait réellement Graph.

Le tableau ci-dessous reste comme trace de l'audit.

| # | Gravité | Ce que vous verrez | Cause | Correctif (budget) |
|---|---|---|---|---|
| 1 | Important | Après 21 appels MCP avec une mauvaise clé depuis une IP, **toute** clé valide depuis la même IP (NAT d'entreprise, reverse-proxy mal réglé) reçoit `429` pendant une minute | `server.js` : le compteur d'échecs est incrémenté avant la vérification de la clé, par IP | N'incrémenter qu'après un échec réel (3 lignes) |
| 2 | Important | Refresh token révoqué côté éditeur : chaque outil répond par un message brut `invalid_grant`, le portail affiche toujours « Connecté » | `oauth.js` : l'échec du refresh est propagé tel quel, l'entrée n'est pas invalidée | Sur `invalid_grant`, effacer les jetons et répondre « Session Salesforce expirée : reconnectez-vous sur le portail » (4 lignes) |
| 3 | Important | `dropbox_call file_preview` renvoie le podium comme 1 Ko de base64 en texte ; l'assistant ne « voit » pas l'image | `server.js` + `mcpclient.js` : tout résultat d'outil est sérialisé en texte | Relayer tels quels les items MCP `image` et `resource` (5 lignes) ; renforcer le test du bouchon |
| 4 | Important | Plusieurs outils lancés en parallèle juste après une expiration : jusqu'à 6 refresh pour 10 appels | `oauth.js` : pas de verrou sur le refresh | Partager une promesse de refresh en cours par utilisateur et système (6 lignes) ; indispensable avant Entra ID, qui fait tourner les refresh tokens |
| 5 | Mineur | Système injoignable : voyant rouge « fetch failed » sans nom d'hôte ni cause | Connecteurs REST : `fetch` sans contexte d'erreur | Envelopper : « Salesforce injoignable (hôte) : ECONNREFUSED » (1 ligne par connecteur) |
| 6 | Mineur | Clevoa injoignable au démarrage : aucune télémétrie avant le lendemain 03:00 | `telemetry.js` : pas de nouvel essai après échec | Réessayer à 1, 5 puis 30 minutes (3 lignes) |
| 7 | Mineur | Un callback OAuth reçu sans cookie consomme le `state` ; le vrai navigateur reçoit ensuite 400 | `oauth.js` : `pending.delete` avant la vérification du cookie | Supprimer le state après vérification (déplacer 1 ligne) |
| 8 | Mineur, bouchon seulement | `GET /dl/<id>` du bouchon sert les fichiers, y compris « Confidentiel », sans jeton | Choix de design (URL pré-authentifiée comme Graph), données inventées | Signer l'URL si le bouchon est exposé à d'autres personnes (6 lignes) |

Points fragiles sans anomalie reproduite : limites de débit du portail partagées par IP (60 `/api/me`, 20 diagnostics par
minute pour tout un site derrière un NAT) ; une session MCP amont ouverte et fermée à chaque appel Dropbox ou MyReport
(16 ms en local, à mesurer contre `mcp.dropbox.com`) ; le refresh ne se déclenche que sur un `401` strict.

### Fidélité des simulateurs : niveau de confiance par système

Le bouchon valide le hub, pas les produits. Confiance : **Salesforce élevée** (endpoints et formes standard ; mini-SOQL
limité), **Microsoft Graph élevée** (sans pagination), **Dropbox MCP élevée** sur les noms, arguments et réponses des
outils, relevés sur le serveur officiel le 22/10/2026 (`fetch` par `id`, `get_file_metadata` imbriqué, `file_preview` →
vignettes et liens, pas d'image MCP) mais acceptation du jeton d'une app tierce non vérifiée, **Sage X3 Syracuse élevée**
depuis le 23/10/2026 (structure, filtres, fiches et codes d'erreur relevés sur la préproduction ; prototypes réels de
PINVOICE en fixtures de test) ; **Salesforce élevée** sur les six outils réels de SObject Reads (noms, arguments et
descriptions relevés sur la sandbox), **MyReport aucune** (pas de
serveur MCP officiel connu : outils inventés, seule la plomberie SSE est prouvée). Détail dans `charlois-mcp-stub/README.md`.
La première connexion réelle à chaque système reste le vrai test ; les boutons de diagnostic sont faits pour ça.

## 2. Backlog du reste à faire avant la mise en production chez Charlois

Aucun développement : uniquement de la configuration et des décisions humaines. Dans l'ordre où elles se débloquent.
Tout ce qui est marqué **DSI Charlois** demande un accès administrateur aux outils du groupe ; **Clevoa** porte le reste.

### A. Dépôt et livraison (Clevoa, 10 minutes)

| # | Action | Qui | Pourquoi |
|---|--------|-----|----------|
| A1 | GitHub → Settings → Branches : branche par défaut `main`, puis supprimer `master` | Clevoa | La documentation et Portainer parlent de `main` et `dev` ; `master` est un vestige du premier commit |
| A2 | Releases → créer la Release `v1.0.0` sur `main` avec le texte du `CHANGELOG.md` | Clevoa | Fige ce qui est livré ; le proxy de la session IA ne peut pas poser de tag |
| A3 | Générer une `ENCRYPTION_KEY` **par environnement** (`openssl rand -hex 32`) et la ranger dans un coffre (gestionnaire de mots de passe). Corriger la phrase du README sur la clé perdue : « hub arrêté jusqu'à suppression de `/data/users.json`, puis chaque collaborateur se reconnecte et recopie son nouveau bloc connecteur » | Clevoa | Sans elle le hub refuse de démarrer ; perdue, c'est une intervention sur le volume plus deux gestes par collaborateur |

### B. Hébergement (DSI Charlois, une demi-journée)

| # | Action | Qui | Pourquoi |
|---|--------|-----|----------|
| B1 | Deux noms d'hôte **internes** (réseau Charlois ou VPN, le hub n'est pas exposé sur internet) avec certificat TLS de l'autorité interne sur le reverse-proxy existant : `mcp-preprod.charlois.local` → port 8080 de la stack pré-prod, `mcp.charlois.local` → stack prod. Transmettre `X-Forwarded-For`. Autoriser la sortie du hub vers Salesforce, Microsoft Graph, Dropbox et Clevoa | DSI | Salesforce, Entra et Dropbox refusent un callback OAuth en `http` (le callback passe par le navigateur du collaborateur, un nom interne convient) ; le hub prod refuse de démarrer sans https ; la limitation de débit a besoin de l'IP réelle |
| B2 | Portainer : stack « mcp-preprod » depuis le dépôt, référence `refs/heads/dev`, compose `docker-compose.dev.yml`, GitOps activé (polling 5 min ou webhook GitHub), variables de `.env.example` | DSI | C'est le déploiement continu : chaque commit sur `dev` met la pré-prod à jour |
| B3 | Même chose pour « mcp-prod » : `refs/heads/main`, `docker-compose.prod.yml`, `CLEVOA_KEY` obligatoire | DSI | Idem pour la prod, après validation en pré-prod |
| B4 | Premier déploiement en pré-prod et vérification des logs de démarrage (`Hub MCP v1.0.0 · ENV: PRE-PROD`) | DSI + Clevoa | Le build de l'image (utilisateur `node`, système de fichiers en lecture seule) n'a jamais été exécuté : c'est le premier vrai test |
| B5 | Sauvegarde du volume `mcp-data` de chaque stack, avec la `ENCRYPTION_KEY` correspondante à côté | DSI | Le volume sans la clé est illisible ; la clé sans le volume ne sert à rien |

### C. Comptes applicatifs, un par outil (DSI Charlois, avec l'administrateur de chaque outil)

| # | Outil | Action | Variables à renseigner dans Portainer |
|---|-------|--------|---------------------------------------|
| C1 | **Salesforce** | **Fait en sandbox le 23/10** (`GUIDE_CONFIGURATION.md` § 2). Reste pour la production : créer l'application cliente externe dans l'org de production avec les mêmes réglages (étendues `mcp_api` + `refresh_token`, PKCE, JWT, secret exigé, callback du hub), relever l'URL SObject Reads de production, désactiver les serveurs MCP d'écriture après accord de l'intégrateur, fixer `SF_MAX_PER_MIN` | `SF_LOGIN_URL`, `SF_MCP_URL`, `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `SF_MAX_PER_MIN` |
| C2 | **Sage X3 24R1** | **Fait en préproduction le 23/10** en mode `basic` (`GUIDE_CONFIGURATION.md` § 1). Reste : réponse 4CAD au ticket Redmine #31562 (publier SINVOICE, GACCENTRY, GACCDUDATE ; exposer le type de pièce), puis production : URL Syracuse de production, nom du point de connexion, liste de représentations, et un compte restreint pour le test de cloisonnement | `SAGE_URL`, `SAGE_FOLDER`, `SAGE_APIKEY_MODE=basic`, `SAGE_REPRESENTATIONS` |
| C3 | **SharePoint / OneDrive** | Enregistrer une application Entra ID : permissions **déléguées** `User.Read`, `Files.Read.All`, `Sites.Read.All` avec consentement administrateur ; URI de redirection `https://mcp.charlois.fr/auth/sharepoint/callback` ; secret client ; identifier le site Finance | `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `SP_SITE` |
| C4 | **Dropbox** | Créer une app Dropbox (App Console) avec les permissions `account_info.read`, `files.metadata.read`, `files.content.read`, `sharing.read` et l'URI de redirection ; vérifier avec le bouton « Tester Dropbox » que `mcp.dropbox.com` accepte le jeton de cette app | `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET` |
| C5 | **MyReport** | Obtenir auprès de MyReport Server l'URL SSE de son serveur MCP et le format du jeton personnel ; chaque collaborateur saisit son jeton dans le portail ; après un premier « Tester MyReport », composer la liste blanche des outils de lecture | `MYREPORT_MCP_URL`, `MYREPORT_AUTH_HEADER`, `MYREPORT_TOOLS` |

Tant qu'un outil n'est pas configuré, son bouton reste grisé ; en pré-prod Sage X3 / MyReport tournent en simulateur, en production ils ne sont pas exposés : rien ne bloque les autres.

### D. Backend Clevoa (Clevoa, une heure)

| # | Action | Pourquoi |
|---|--------|----------|
| D1 | Compte AWS, utilisateur IAM de déploiement, `serverless deploy --stage prod` dans `clevoa-backend/` avec `CLEVOA_KEYS` contenant la clé attribuée à Charlois | Sans backend, la télémétrie prod échoue silencieusement à chaque envoi (sans effet sur le hub) |
| D2 | Faire pointer `https://clevoa.fr/api/v1/telemetry` vers l'API Gateway : nom de domaine personnalisé API Gateway + certificat ACM + enregistrement DNS | La stack prod envoie **uniquement** vers cette adresse, elle n'est pas modifiable par Charlois |
| D3 | Donner à Charlois sa `CLEVOA_KEY` et, pour la pré-prod, l'URL du stage `dev` | Une clé par client, une par environnement si possible |

### E. Mise en service auprès des collaborateurs (DSI Charlois)

| # | Action |
|---|--------|
| E1 | Choisir l'assistant autorisé (Claude Code, Claude Desktop, ChatGPT, Copilot), installé sur un poste du réseau ou en VPN : tous se configurent avec le bloc JSON du portail. **Claude.ai web/mobile n'est pas supporté** (hub interne, pas d'en-tête possible) : à annoncer clairement |
| E2 | Informer les collaborateurs : le hub ne lit que ce qu'ils ont déjà le droit de voir, leurs jetons sont chiffrés et individuels, une télémétrie anonyme (compteurs) part vers Clevoa. Mettre à jour le registre des traitements si la DSI le tient |
| E3 | Onboarding en trois gestes sur le portail : se connecter aux outils, vérifier les voyants du diagnostic, copier le bloc JSON dans son assistant |

## 3. Catalogue des évolutions possibles (optionnel, roadmap Clevoa)

Quatre évolutions à forte valeur commerciale, et une écartée. Pour chacune, la règle qui l'empêche de devenir une usine à gaz.

### 3.1 Santé des connecteurs et alertes proactives sur le portail

**Valeur** : la DSI voit en un coup d'œil qu'un jeton expire, qu'un outil répond en erreur ou qu'un quota API s'épuise, avant que les collaborateurs ne s'en plaignent. Clevoa peut vendre un suivi « hub sous surveillance ».

**Pour rester simple** : un compteur en mémoire par connecteur (succès, erreurs, durée moyenne sur 24 h, soit une `Map` de cinq entrées), affiché comme une pastille sur chaque carte de diagnostic, et ajouté à la télémétrie sous forme de totaux anonymes. Pas de base de données, pas d'outil de supervision, pas d'historique au-delà de la journée.

### 3.2 Nouveaux connecteurs documentaires par serveurs MCP officiels

**Valeur** : Google Drive, Notion, Confluence, Box, Gmail/Outlook en lecture : chaque outil ajouté élargit l'offre Clevoa à de nouveaux clients, pas seulement Charlois.

**Pour rester simple** : n'ajouter que des outils qui publient un serveur MCP officiel, et les brancher comme Dropbox, en proxy de 50 lignes avec jeton OAuth du collaborateur et liste blanche d'outils de lecture. Jamais de connecteur REST sur mesure quand un serveur MCP existe ; jamais d'écriture.

### 3.3 Tableau de bord Clevoa des installations

**Valeur** : Clevoa suit ses clients (version déployée, outils activés, volume d'usage, dernier contact) et détecte un hub silencieux ou une version obsolète : c'est la base d'un contrat de maintenance.

**Pour rester simple** : dans `clevoa-backend`, remplacer la simulation par un `PutItem` DynamoDB (une table, une ligne par envoi) et servir une page HTML statique depuis S3 qui lit les trente derniers jours. Une Lambda, une table, une page ; pas de framework, pas d'authentification complexe (un lien signé suffit).

### 3.4 Interface d'administration déclarative des connecteurs MCP

**Valeur** : la DSI ajoute, suspend ou retire un serveur MCP distant (MyReport, un futur outil métier, le serveur MCP
officiel d'un éditeur) depuis le portail, sans commit ni redéploiement. Clevoa vend un hub « extensible par le client »
sans intervention.

**Ce que c'est, et rien de plus** : une liste JSON déclarative de connecteurs distants, chiffrée dans le store existant
(`users.json` a déjà le chiffrement AES-256-GCM ; la liste vit à côté, sous la même clé maîtresse). Chaque entrée tient
en six champs : identifiant, libellé, URL du serveur MCP, transport (`sse` ou `http`), nom de l'en-tête d'authentification,
liste blanche des outils autorisés. Exemple :

```json
[{ "id": "myreport", "label": "MyReport", "url": "https://myreport.charlois.local/mcp/sse", "transport": "sse",
   "authHeader": "Authorization", "tools": ["liste_indicateurs", "synthese_couts_par_race"] }]
```

Le hub lit cette liste au démarrage et à chaque modification, et instancie pour chaque entrée le **même connecteur proxy
générique** que MyReport aujourd'hui (`mcpclient.js` + liste blanche) : les outils `<id>_tools` et `<id>_call`
apparaissent dans la liste des outils, le bouton de diagnostic et la carte de connexion (jeton personnel) sur le portail.
Côté portail, une section « Administration » réservée (en-tête Entra `X-Forwarded-Email` du reverse-proxy ou clé
`ADMIN_KEY`) affiche la liste dans un formulaire de six champs par ligne.

**Règles impératives pour que cela reste simple** :

* **Standard FastMCP officiel uniquement** : le hub reste client des serveurs distants via `@modelcontextprotocol/sdk`
  (transports SSE et Streamable HTTP standards). Aucun protocole maison, aucun adaptateur par éditeur : si un outil n'a
  pas de serveur MCP standard, il n'entre pas par cette porte.
* **Aucun framework** : le formulaire est du HTML dans `index.html` ; l'API est une route `GET/PUT /api/admin/connectors`
  dans `server.js`. Pas de panneau d'administration tiers, pas de bibliothèque de formulaires.
* **Aucune base de données** : la liste JSON chiffrée dans le store est la seule persistance. Pas de table, pas de
  migration, pas de cache.
* **Un seul code de proxy** : `myreport.js` devient la première entrée de la liste ; il ne doit rester qu'un connecteur
  générique, pas un fichier par outil distant. Budget : environ 80 lignes de hub et 60 lignes de portail. Au-delà, on
  s'arrête et on revoit la copie.
* **Lecture seule par liste blanche** : sans outils listés, rien n'est transféré ; aucune option « tout autoriser ».
* **Jetons toujours personnels** : chaque collaborateur saisit son jeton par connecteur, comme pour MyReport aujourd'hui ;
  l'administrateur déclare des serveurs, jamais des identifiants.

### Écarté : accès depuis claude.ai web et mobile

Le hub a vocation à rester sur le réseau interne de Charlois (ou derrière le VPN), car il détient les jetons des
collaborateurs et joint des outils non exposés sur internet comme Sage X3. Les connecteurs personnalisés de claude.ai
web et mobile, qui partent des serveurs d'Anthropic, ne pourront donc jamais l'atteindre. Les assistants installés sur
les postes du réseau (Claude Desktop, Claude Code, ChatGPT, Copilot) couvrent le besoin. Décision actée, pas de
développement OAuth 2.1.
