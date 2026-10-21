# Audit de clôture et feuille de route — Charlois AI Gateway

**Périmètre** : commit `8fe2cb8` (version 1.0.0), dépôt `Charlois-mcp-finance`, 48 tests verts en pré-prod et en production.
**Méthode** : relecture indépendante du code par un agent validateur (faits cités fichier par fichier), essais manuels des cas
de panne du store, synthèse par l'agent principal. Aucun fichier de code modifié par cet audit.
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
| B1 | Deux sous-domaines avec certificat TLS sur le reverse-proxy existant (Traefik, Nginx Proxy Manager, IIS…) : `mcp-preprod.charlois.fr` → port 8080 de la stack pré-prod, `mcp.charlois.fr` → stack prod. Transmettre `X-Forwarded-For` | DSI | Salesforce, Entra et Dropbox refusent un callback OAuth en `http` ; le hub prod refuse de démarrer sans https ; la limitation de débit a besoin de l'IP réelle |
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
| E1 | Choisir l'assistant autorisé (Claude Code, Claude Desktop, ChatGPT, Copilot) : tous se configurent avec le bloc JSON du portail. **Claude.ai web/mobile n'est pas supporté** (pas d'en-tête possible) : à annoncer clairement |
| E2 | Informer les collaborateurs : le hub ne lit que ce qu'ils ont déjà le droit de voir, leurs jetons sont chiffrés et individuels, une télémétrie anonyme (compteurs) part vers Clevoa. Mettre à jour le registre des traitements si la DSI le tient |
| E3 | Onboarding en trois gestes sur le portail : se connecter aux outils, vérifier les voyants du diagnostic, copier le bloc JSON dans son assistant |

## 3. Catalogue des évolutions possibles (optionnel, roadmap Clevoa)

Quatre évolutions à forte valeur commerciale. Pour chacune, la règle qui l'empêche de devenir une usine à gaz.

### 3.1 Santé des connecteurs et alertes proactives sur le portail

**Valeur** : la DSI voit en un coup d'œil qu'un jeton expire, qu'un outil répond en erreur ou qu'un quota API s'épuise, avant que les collaborateurs ne s'en plaignent. Clevoa peut vendre un suivi « hub sous surveillance ».

**Pour rester simple** : un compteur en mémoire par connecteur (succès, erreurs, durée moyenne sur 24 h, soit une `Map` de cinq entrées), affiché comme une pastille sur chaque carte de diagnostic, et ajouté à la télémétrie sous forme de totaux anonymes. Pas de base de données, pas d'outil de supervision, pas d'historique au-delà de la journée.

### 3.2 Nouveaux connecteurs documentaires par serveurs MCP officiels

**Valeur** : Google Drive, Notion, Confluence, Box, Gmail/Outlook en lecture : chaque outil ajouté élargit l'offre Clevoa à de nouveaux clients, pas seulement Charlois.

**Pour rester simple** : n'ajouter que des outils qui publient un serveur MCP officiel, et les brancher comme Dropbox, en proxy de 50 lignes avec jeton OAuth du collaborateur et liste blanche d'outils de lecture. Jamais de connecteur REST sur mesure quand un serveur MCP existe ; jamais d'écriture.

### 3.3 Tableau de bord Clevoa des installations

**Valeur** : Clevoa suit ses clients (version déployée, outils activés, volume d'usage, dernier contact) et détecte un hub silencieux ou une version obsolète : c'est la base d'un contrat de maintenance.

**Pour rester simple** : dans `clevoa-backend`, remplacer la simulation par un `PutItem` DynamoDB (une table, une ligne par envoi) et servir une page HTML statique depuis S3 qui lit les trente derniers jours. Une Lambda, une table, une page ; pas de framework, pas d'authentification complexe (un lien signé suffit).

### 3.4 Accès depuis claude.ai web et mobile (serveur OAuth sur le hub)

**Valeur** : les connecteurs personnalisés de claude.ai, utilisés depuis un téléphone, redeviennent possibles ; c'est l'usage le plus demandé par les directions.

**Pour rester simple** : implémenter uniquement le strict minimum du flux OAuth 2.1 côté hub avec les briques du SDK MCP officiel : le « mot de passe » échangé est la clé MCP personnelle déjà existante, sans comptes, sans rôles, sans consentement configurable, sans base. Si la mise en œuvre dépasse 150 lignes, c'est le signal d'arrêter.
