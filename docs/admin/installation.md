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

| Environnement | Référence Git déployée | Fichier Compose | Conteneurs | Particularités |
|---|---|---|---|---|
| Pré-production | tag de la version à recetter (`refs/tags/vX.Y.Z-rc.N` ou `vX.Y.Z`) ; `dev` seulement sur la plateforme d'intégration de Clevoa | `docker-compose.dev.yml` | `mcp-hub-preprod`, `mcp-stub`, `mcp-backup-preprod`, `mcp-proxy-preprod` (profil `proxy`) | `LOG_LEVEL=debug` ; toutes les API sortantes pointent par défaut vers le bouchon ; chaque variable renseignée rebranche un système réel |
| Production | tag d'une version publiée (`refs/tags/vX.Y.Z`), jamais une branche | `docker-compose.prod.yml` | `mcp-hub-prod`, `mcp-backup-prod`, `mcp-proxy-prod` (profil `proxy`) | `APP_ENV=production` : `PUBLIC_URL` https obligatoire, `CLEVOA_KEY` obligatoire, télémétrie figée sur `https://clevoa.fr`, conteneur sans privilèges en lecture seule, journaux plafonnés, connecteur non configuré non exposé |

Les deux fichiers **étendent** `docker-compose.yml` (définitions communes ; lancé seul, il donne une démonstration avec
les simulateurs internes, sans bouchon). Chaque stack a son
propre volume `mcp-data`, donc ses propres `users.json` : les jetons de pré-production ne sont jamais visibles en
production, et inversement.

## 4. Déploiement avec Portainer (GitOps)

Une fois par environnement, **depuis Git uniquement** : les fichiers `ops/` doivent être présents à côté du compose,
un compose collé à la main laisse `mcp-backup` sans script.

1. **Stacks → Add stack → Repository** : URL du dépôt (identifiants Git s'il est privé), *Repository reference* =
   le tag de la version choisie, par exemple `refs/tags/v1.3.2` (§ 6), *Compose path* = le fichier du tableau ci-dessus.
2. **GitOps updates** : **désactivé** pour une installation client. La stack ne change que lorsque l'administrateur
   choisit une autre version ([exploitation § 10](exploitation.md#10-mise-à-jour-et-retour-arrière)). Seule la
   plateforme d'intégration de Clevoa suit la branche `dev` en continu (polling ou webhook GitHub).
3. **Environment variables** : celles de `.env.example`. Obligatoires partout : `PUBLIC_URL`, `ENCRYPTION_KEY`,
   `BACKUP_DIR` en chemin **absolu** et distinct par environnement (ex. `/srv/mcp/backups-prod`). En production :
   `CLEVOA_KEY` (si `clevoa.fr` ne répond pas, le hub journalise `[telemetry] échec` et fonctionne normalement). En
   pré-production avec le bouchon : `BROWSER_URL_REWRITE=http://mcp-stub:4000=>http://<hôte-préprod>:4000` (le navigateur
   des collaborateurs doit joindre les mires du bouchon). Facultatif : `MCP_SERVER_NAME` et `INSTANCE_LABEL` pour nommer
   l'instance ([configuration § 0](configuration.md#0-le-fichier-env-et-les-uri-de-rappel)).
4. **https** : le nginx fourni (profil `proxy`, `HUB_PORT=127.0.0.1:8080`, `CERTS_DIR`, `COMPOSE_PROFILES=proxy`) ou un
   reverse proxy existant : [exploitation § 6](exploitation.md#6-reverse-proxy-nginx-https). La prise en compte de
   `COMPOSE_PROFILES` comme variable de stack est à vérifier sur votre Portainer.
5. Premier démarrage : la ligne de journal `Hub MCP v1.3.2 · ENV: PRE-PROD · https://…` confirme la version et
   l'environnement ; le portail affiche le badge correspondant ; le hub passe « healthy » dans Portainer.

**Pré-production avec des systèmes réels** : une variable **vide** garde le défaut vers le bouchon. Pour brancher un vrai
système, renseigner explicitement : Microsoft (SharePoint et SSO) → `MS_LOGIN_URL=https://login.microsoftonline.com`,
`GRAPH_URL=https://graph.microsoft.com/v1.0` ; Dropbox → `DROPBOX_AUTH_URL=https://www.dropbox.com`,
`DROPBOX_API_URL=https://api.dropboxapi.com`, `DROPBOX_MCP_URL=https://mcp.dropbox.com/mcp` ; Clevoa → `CLEVOA_URL`.
Sage X3 réel sans OAuth : la carte garde un bouton « Se connecter » menant à l'IdP du bouchon, sans effet sur la
connexion par identifiant et mot de passe.

## 5. Déploiement manuel (Docker Compose)

Depuis un clone du dépôt positionné sur le tag de la version choisie, avec un fichier `.env` à côté :

```bash
git fetch --tags && git checkout v1.3.2                          # une version publiée, jamais une branche
docker compose -f docker-compose.prod.yml up -d --build          # production
docker compose --profile proxy -f docker-compose.prod.yml up -d  # avec le nginx fourni
docker compose -f docker-compose.prod.yml config                 # configuration résolue, sans rien déployer
```

Après toute modification de `.env`, relancer `up -d` : les connexions des collaborateurs sont conservées (volume).

## 6. Cycle de livraison et versions

Un seul code pour tous les clients ; chaque installation choisit sa version. `dev` est la branche d'intégration,
`main` porte les versions validées ; aucune installation client ne suit une branche. Une version est un **tag Git
immuable** `vX.Y.Z` (ou `vX.Y.Z-rc.N` pour une version candidate) posé sur `main`, accompagné d'une Release GitHub. Le
numéro est affiché par le portail, les journaux, le diagnostic et la télémétrie : c'est la preuve de ce qui tourne.
Un tag publié n'est jamais déplacé ni supprimé ; une correction donne une nouvelle version.

Reproductibilité : le tag fige le code et les dépendances (`package-lock.json`, `npm ci`) ; l'image de base Node est
figée par empreinte dans les `Dockerfile` et la stack. Reconstruire un tag donne la même image.

**Publier une version (Clevoa)**

1. Modifier le code sur une branche de travail, avec ses tests ; PR vers `dev`.
2. CI verte : tests du hub, du bouchon et du backend, sauvegarde et restauration, retour arrière, documentation.
3. Contrôles de sécurité de la même CI : Semgrep, CodeQL, Gitleaks, Trivy ; `npm audit` sans vulnérabilité haute ou
   critique corrigeable.
4. Préparer la version : numéro dans `hub/version.js`, `hub/package.json` et `hub/package-lock.json`, section du
   `CHANGELOG.md` à ce numéro et à la date (le test `hub/test/release.test.js` vérifie la cohérence), empreinte de
   l'image de base mise à jour si une image Node plus récente corrige des vulnérabilités.
5. Revue de la version, puis PR `dev` → `main`.
6. Créer le tag et la Release sur `main` : GitHub → Releases → *Draft a new release* → tag `vX.Y.Z` sur `main`, texte du
   changelog. Recommandé : une règle de protection des tags `v*` (GitHub → Settings → Rules) pour interdire déplacement
   et suppression.
7. Annoncer la version aux clients (notes de version, niveau d'urgence). Clevoa peut aussi déclarer une version
   minimale dans le backend de télémétrie : les hubs en dessous l'écrivent dans leurs journaux.

**Installer une version chez un client (administrateur du client)**

8. Pré-production : sauvegarde, puis *Repository reference* = le nouveau tag ([exploitation § 10](exploitation.md#10-mise-à-jour-et-retour-arrière)).
9. Recette du client sur sa pré-production : portail, « Tester » chaque outil, quelques questions dans l'assistant.
10. Production : même opération, puis contrôle après mise à jour (version, « healthy », tests des outils, diagnostic).

Aucune mise à jour n'est imposée : une installation reste sur sa version tant que son administrateur ne la change pas.
Multi-client : chaque installation a sa stack, ses variables (`MCP_SERVER_NAME`, `INSTANCE_LABEL`, connecteurs), ses
secrets (`ENCRYPTION_KEY`, `CLEVOA_KEY`), son volume et son identifiant d'installation. Aucune branche ni fork par
client ; un connecteur demandé par un client reste désactivé tant qu'il n'est pas configuré.

Tags publiés au 24/10/2026 : `v1.2.0`, `v1.2.1`, `v1.3.0`, `v1.3.1` (la 1.0.0 n'est pas publiée sur GitHub, la 1.1.0 n'a
pas de tag). Version candidate en cours : `1.3.2-rc.1`, tag à créer par Clevoa. Suivi du backlog : issues GitHub
(modèles « Bug » et « Évolution ») et milestones par version.

## 7. Première mise en service auprès des collaborateurs

1. Choisir l'assistant autorisé (Claude Code, Claude Desktop, ChatGPT, Copilot), installé sur un poste du réseau ou en
   VPN. Claude.ai web et mobile ne sont pas pris en charge : à annoncer clairement.
2. Informer les collaborateurs : le hub ne lit que ce qu'ils ont déjà le droit de voir, leurs jetons sont chiffrés et
   individuels, une télémétrie réduite à des compteurs part vers Clevoa ([sécurité](securite.md)). Mettre à jour le
   registre des traitements si la DSI le tient.
3. Onboarding en trois gestes, décrits dans le [guide utilisateur](../user/guide-utilisateur.md) : se connecter aux
   outils, vérifier les voyants, copier le bloc dans l'assistant.
