# Audit de clôture et feuille de route — Charlois AI Gateway

**Périmètre** : version 1.0.0 et bouchon d'entreprise `charlois-mcp-stub/` (commit `20d6eb1`), 48 tests du hub verts en
pré-prod et en production, 7 tests de bout en bout hub ↔ bouchon.
**Méthode** : relecture indépendante du code par un agent validateur (faits cités fichier par fichier), crash-test en boîte
noire du vrai hub branché sur le vrai bouchon par un agent testeur (expiration forcée des jetons, deux collaborateurs en
parallèle, fichiers physiques, pannes, charge), synthèse par l'agent principal. Mise à jour du 22 octobre 2026.
**Fil conducteur** : la solution doit rester une petite machine que n'importe quel développeur Node lit en une heure.
Chaque point ci-dessous est jugé à cette aune.

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
cinq booléens (tel outil est configuré ou non) et un entier (nombre d'appels d'outils depuis le dernier envoi, tous
collaborateurs confondus). Deux en-têtes : le type de contenu et `X-Clevoa-Key`.

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

Environ 650 lignes de code, trois dépendances, un conteneur, aucune opération d'exploitation récurrente, 48 tests qui
tournent en moins de vingt secondes sans réseau. Le blindage de sécurité a coûté une variable d'environnement et une
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
| C1 | **Salesforce** | Créer une Connected App OAuth : scopes `openid`, `api`, `refresh_token`, `offline_access` ; callback `https://mcp.charlois.fr/auth/salesforce/callback` (et la version pré-prod) ; *Refresh Token Policy* = « valid until revoked » ; relâcher la restriction d'IP si l'org en a une | `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `SF_LOGIN_URL` (My Domain ou sandbox) |
| C2 | **Sage X3 24R1** | Décider du mode : OAuth (déclarer un serveur OAuth2 dans Syracuse, rattacher les utilisateurs X3, créer l'app Entra correspondante avec un scope dédié) ou **clé d'API personnelle** (plus simple : chaque collaborateur saisit la sienne dans le portail). Vérifier avec le `curl` du README que Syracuse accepte le Bearer ou le Basic ; lister les représentations utiles | `SAGE_URL`, `SAGE_FOLDER`, `SAGE_APIKEY_MODE`, `SAGE_REPRESENTATIONS`, et les `SAGE_OAUTH_*` si OAuth |
| C3 | **SharePoint / OneDrive** | Enregistrer une application Entra ID : permissions **déléguées** `User.Read`, `Files.Read.All`, `Sites.Read.All` avec consentement administrateur ; URI de redirection `https://mcp.charlois.fr/auth/sharepoint/callback` ; secret client ; identifier le site Finance | `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `SP_SITE` |
| C4 | **Dropbox** | Créer une app Dropbox (App Console) avec les permissions `account_info.read`, `files.metadata.read`, `files.content.read`, `sharing.read` et l'URI de redirection ; vérifier avec le bouton « Tester Dropbox » que `mcp.dropbox.com` accepte le jeton de cette app | `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET` |
| C5 | **MyReport** | Obtenir auprès de MyReport Server l'URL SSE de son serveur MCP et le format du jeton personnel ; chaque collaborateur saisit son jeton dans le portail ; après un premier « Tester MyReport », composer la liste blanche des outils de lecture | `MYREPORT_MCP_URL`, `MYREPORT_AUTH_HEADER`, `MYREPORT_TOOLS` |

Tant qu'un outil n'est pas configuré, son bouton reste grisé et Sage X3 / MyReport tournent en simulateur : rien ne bloque les autres.

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
