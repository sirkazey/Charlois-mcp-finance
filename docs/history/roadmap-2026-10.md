# Feuille de route d'octobre 2026 (archive)

Extrait de l'audit de clôture du 23 octobre 2026, figé à la version 1.1.0 puis complété jusqu'à la 1.2.1. Les actions
cochées ou annotées « fait » l'ont été ; le reste est à l'état du 24 octobre 2026. Ce document n'est pas mis à jour :
l'état courant est dans [l'état des fonctionnalités](../validation/etat-des-fonctionnalites.md). Les noms de fichiers
cités sont ceux de l'époque (`GUIDE_CONFIGURATION.md` → `docs/admin/configuration.md`, `EXPLOITATION.md` →
`docs/admin/exploitation.md`, `JOURNAL_TESTS.md` → `docs/validation/journal-tests-reels.md`).

> Note du 24 octobre 2026 : les orientations futures de ce document (§ 2) sont remplacées par la
> [roadmap produit](../roadmap-produit.md), après le gel fonctionnel de la 1.3.1 ([décisions](decisions.md)).

## 1. Backlog du reste à faire avant la mise en production chez Charlois

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
| B5 | Sauvegarde automatique de `users.json` (conteneur `mcp-backup`, `BACKUP_DIR` par stack) incluse dans la sauvegarde du serveur ; `ENCRYPTION_KEY` **à part**, dans le coffre DSI, jamais avec les sauvegardes (`EXPLOITATION.md` § 4) | DSI | Le fichier sans la clé est illisible ; la clé sans le fichier ne sert à rien |

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

## 2. Catalogue des évolutions possibles (optionnel, roadmap Clevoa)

Quatre évolutions à forte valeur commerciale, et une écartée. Pour chacune, la règle qui l'empêche de devenir une usine à gaz.

### 2.1 Santé des connecteurs et alertes proactives sur le portail

**Valeur** : la DSI voit en un coup d'œil qu'un jeton expire, qu'un outil répond en erreur ou qu'un quota API s'épuise, avant que les collaborateurs ne s'en plaignent. Clevoa peut vendre un suivi « hub sous surveillance ».

**Pour rester simple** : un compteur en mémoire par connecteur (succès, erreurs, durée moyenne sur 24 h, soit une `Map` de cinq entrées), affiché comme une pastille sur chaque carte de diagnostic, et ajouté à la télémétrie sous forme de totaux anonymes. Pas de base de données, pas d'outil de supervision, pas d'historique au-delà de la journée.

### 2.2 Nouveaux connecteurs documentaires par serveurs MCP officiels

**Valeur** : Google Drive, Notion, Confluence, Box, Gmail/Outlook en lecture : chaque outil ajouté élargit l'offre Clevoa à de nouveaux clients, pas seulement Charlois.

**Pour rester simple** : n'ajouter que des outils qui publient un serveur MCP officiel, et les brancher comme Dropbox, en proxy de 50 lignes avec jeton OAuth du collaborateur et liste blanche d'outils de lecture. Jamais de connecteur REST sur mesure quand un serveur MCP existe ; jamais d'écriture.

### 2.3 Tableau de bord Clevoa des installations

**Valeur** : Clevoa suit ses clients (version déployée, outils activés, volume d'usage, dernier contact) et détecte un hub silencieux ou une version obsolète : c'est la base d'un contrat de maintenance.

**Pour rester simple** : dans `clevoa-backend`, remplacer la simulation par un `PutItem` DynamoDB (une table, une ligne par envoi) et servir une page HTML statique depuis S3 qui lit les trente derniers jours. Une Lambda, une table, une page ; pas de framework, pas d'authentification complexe (un lien signé suffit).

### 2.4 Interface d'administration déclarative des connecteurs MCP

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
