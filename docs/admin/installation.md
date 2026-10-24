# Installation

Pour l'administrateur qui déploie Clevoa AI Gateway. Trois façons de lancer le hub : sur un poste avec Docker Desktop
(démonstration, développement), sur un serveur Linux avec Portainer (déploiement recommandé, deux environnements),
ou à la main avec Docker Compose. L'exploitation quotidienne (sauvegarde, restauration, reverse proxy, pannes) est dans
[exploitation](exploitation.md) ; les connecteurs dans [configuration](configuration.md).

## 1. Prérequis

| Élément | Valeur |
|---|---|
| Serveur | Linux, Docker Engine et Docker Compose v2 ; Portainer pour le déploiement GitOps (recommandé) |
| Ressources | le hub tient dans 150 Mo de RAM et une fraction de cœur pour 50 collaborateurs ([campagne de charge](../validation/charge-v1.2.1.md)) |
| Réseau | sortie HTTPS du hub vers Salesforce, Microsoft (login et Graph), Dropbox, MyReport Server et `clevoa.fr` ; entrée des collaborateurs sur le reverse proxy https |
| Nom DNS et certificat | un nom par environnement (ex. `mcp-preprod.` et `mcp.`), certificat de l'autorité interne ou publique ; en production, `PUBLIC_URL` doit être en https |
| Secrets | `ENCRYPTION_KEY` générée une fois par environnement (`openssl rand -hex 32`) et rangée dans un coffre ; identifiants des applications OAuth ; `CLEVOA_KEY` fournie par Clevoa pour la production |

Le hub n'est pas conçu pour être exposé sur internet : réseau interne ou VPN. Les callbacks OAuth passent par le
navigateur du collaborateur, un nom interne convient.

## 2. Démarrage sur un poste (Docker Desktop)

Avec le **bouchon d'entreprise** `clevoa-mcp-stub` : aucun compte réel, un jeu de données fictif, deux collaborateurs
aux droits différents (Marie, DAF ; Paul, commercial).

```bash
cp .env.example .env        # renseigner ENCRYPTION_KEY ; PUBLIC_URL=http://localhost:8080 est déjà là
docker compose -f docker-compose.dev.yml up -d --build
open http://localhost:8080  # EXACTEMENT l'adresse de PUBLIC_URL (pas 127.0.0.1) : cookie et callbacks y sont liés
```

Les boutons « Se connecter » ouvrent les mires du bouchon sur `http://localhost:4000`. Identifiants fictifs : Sage X3
`MDUPONT` / `SYR-MARIE-2026`, MyReport `MR-MARIE-2026` (détail dans [le README du bouchon](../../clevoa-mcp-stub/README.md)).
Renseigner une variable réelle dans `.env` (ex. `SF_LOGIN_URL`, `SF_CLIENT_ID`) rebranche ce seul système sur le vrai.

Règles du fichier `.env` : jamais de commentaire sur la même ligne qu'une valeur vide (Docker Compose le lirait comme
la valeur) ; une variable vide garde la valeur par défaut du fichier Compose.

Si une ancienne version dont le volume appartenait à root (avant l'utilisateur `node`) a tourné sur ce poste, supprimer
son volume avant
(`docker compose -f docker-compose.dev.yml down -v`, **sur un poste de développement uniquement** : sur un serveur,
`down -v` détruit `users.json`).

Sans bouchon (vrais comptes Salesforce, simulateurs internes Sage X3 et MyReport) : `docker compose up -d --build`.

## 3. Deux environnements étanches

| Environnement | Branche Git | Fichier Compose | Conteneurs | Particularités |
|---|---|---|---|---|
| Pré-production | `dev` | `docker-compose.dev.yml` | `mcp-hub-preprod`, `mcp-stub`, `mcp-backup-preprod`, `mcp-proxy-preprod` (profil `proxy`) | `LOG_LEVEL=debug` ; toutes les API sortantes pointent par défaut vers le bouchon ; chaque variable renseignée rebranche un système réel |
| Production | `main` | `docker-compose.prod.yml` | `mcp-hub-prod`, `mcp-backup-prod`, `mcp-proxy-prod` (profil `proxy`) | `APP_ENV=production` : `PUBLIC_URL` https obligatoire, `CLEVOA_KEY` obligatoire, télémétrie figée sur `https://clevoa.fr`, conteneur sans privilèges en lecture seule, journaux plafonnés, connecteur non configuré non exposé |

Les deux fichiers **étendent** `docker-compose.yml` (définitions communes ; lancé seul, il donne une démonstration avec
les simulateurs internes, sans bouchon). Chaque stack a son
propre volume `mcp-data`, donc ses propres `users.json` : les jetons de pré-production ne sont jamais visibles en
production, et inversement.

## 4. Déploiement avec Portainer (GitOps)

Une fois par environnement, **depuis Git uniquement** : les fichiers `ops/` doivent être présents à côté du compose,
un compose collé à la main laisse `mcp-backup` sans script.

1. **Stacks → Add stack → Repository** : URL du dépôt (identifiants Git s'il est privé), *Repository reference* =
   `refs/heads/dev` (pré-production) ou `refs/heads/main` (production), *Compose path* = le fichier du tableau ci-dessus.
2. **GitOps updates** : activer, mode *Polling* (ex. 5 min) ou *Webhook* (coller l'URL dans GitHub → Settings →
   Webhooks, événement *push*). À chaque commit sur la branche, Portainer reconstruit l'image et redéploie.
3. **Environment variables** : celles de `.env.example`. Obligatoires partout : `PUBLIC_URL`, `ENCRYPTION_KEY`,
   `BACKUP_DIR` en chemin **absolu** et distinct par environnement (ex. `/srv/mcp/backups-prod`). En production :
   `CLEVOA_KEY` (si `clevoa.fr` ne répond pas, le hub journalise `[telemetry] échec` et fonctionne normalement). En
   pré-production avec le bouchon : `BROWSER_URL_REWRITE=http://mcp-stub:4000=>http://<hôte-préprod>:4000` (le navigateur
   des collaborateurs doit joindre les mires du bouchon). Facultatif : `MCP_SERVER_NAME` et `INSTANCE_LABEL` pour nommer
   l'instance ([configuration § 0](configuration.md#0-le-fichier-env-et-les-uri-de-rappel)).
4. **https** : le nginx fourni (profil `proxy`, `HUB_PORT=127.0.0.1:8080`, `CERTS_DIR`, `COMPOSE_PROFILES=proxy`) ou un
   reverse proxy existant : [exploitation § 6](exploitation.md#6-reverse-proxy-nginx-https). La prise en compte de
   `COMPOSE_PROFILES` comme variable de stack est à vérifier sur votre Portainer.
5. Premier démarrage : la ligne de journal `Hub MCP v1.3.0 · ENV: PRE-PROD · https://…` confirme la version et
   l'environnement ; le portail affiche le badge correspondant.

**Pré-production avec des systèmes réels** : une variable **vide** garde le défaut vers le bouchon. Pour brancher un vrai
système, renseigner explicitement : Microsoft (SharePoint et SSO) → `MS_LOGIN_URL=https://login.microsoftonline.com`,
`GRAPH_URL=https://graph.microsoft.com/v1.0` ; Dropbox → `DROPBOX_AUTH_URL=https://www.dropbox.com`,
`DROPBOX_API_URL=https://api.dropboxapi.com`, `DROPBOX_MCP_URL=https://mcp.dropbox.com/mcp` ; Clevoa → `CLEVOA_URL`.
Sage X3 réel sans OAuth : la carte garde un bouton « Se connecter » menant à l'IdP du bouchon, sans effet sur la
connexion par identifiant et mot de passe.

## 5. Déploiement manuel (Docker Compose)

Depuis un clone du dépôt, avec un fichier `.env` à côté :

```bash
docker compose -f docker-compose.prod.yml up -d --build          # production
docker compose --profile proxy -f docker-compose.prod.yml up -d  # avec le nginx fourni
docker compose -f docker-compose.prod.yml config                 # configuration résolue, sans rien déployer
```

Après toute modification de `.env`, relancer `up -d` : les connexions des collaborateurs sont conservées (volume).

## 6. Cycle de livraison et versions

Développer et committer sur `dev` → la stack de pré-production se met à jour → vérifier le portail (badge
« ENV: PRE-PROD », diagnostic) et la suite `npm test` → fusionner `dev` dans `main` (`git merge --ff-only dev`) → la
stack de production se met à jour. Ne jamais committer directement sur `main`.

Livrer une version : incrémenter `hub/version.js` et `hub/package.json`, ajouter la section dans `CHANGELOG.md`,
fusionner dans `main`, créer la **Release** GitHub `vX.Y.Z` avec le texte du changelog. Le badge du portail, les journaux
et la télémétrie affichent ce numéro : c'est la preuve de ce qui tourne. Suivi du backlog : issues GitHub (modèles « Bug » et
« Évolution » fournis, étiquettes du même nom) et milestones par version. Tags existants : `v1.0.0`, `v1.2.0`, `v1.2.1`
(la 1.1.0 n'a pas de tag).

## 7. Première mise en service auprès des collaborateurs

1. Choisir l'assistant autorisé (Claude Code, Claude Desktop, ChatGPT, Copilot), installé sur un poste du réseau ou en
   VPN. Claude.ai web et mobile ne sont pas pris en charge : à annoncer clairement.
2. Informer les collaborateurs : le hub ne lit que ce qu'ils ont déjà le droit de voir, leurs jetons sont chiffrés et
   individuels, une télémétrie réduite à des compteurs part vers Clevoa ([sécurité](securite.md)). Mettre à jour le
   registre des traitements si la DSI le tient.
3. Onboarding en trois gestes, décrits dans le [guide utilisateur](../user/guide-utilisateur.md) : se connecter aux
   outils, vérifier les voyants, copier le bloc dans l'assistant.
