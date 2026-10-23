# Guide de configuration des connecteurs

Procédures **vérifiées sur les vrais systèmes** (préproduction Sage X3 et sandbox Salesforce, 23 octobre 2026).
Chaque étape a été exécutée au moins une fois ; ce qui n'a pas été vérifié est signalé.
Les connecteurs SharePoint, Dropbox et MyReport ne sont pas encore testés sur un vrai compte : voir le README pour leur
principe, et le journal des tests (`JOURNAL_TESTS.md`) pour l'état d'avancement.

## 0. Avant tout connecteur : le fichier `.env`

Le hub lit sa configuration dans **un seul fichier**, `.env`, à la racine du dépôt (à côté de `docker-compose.dev.yml`).
Il est créé à partir de `.env.example` et n'est jamais versionné.

```
PUBLIC_URL=http://localhost:8080
ENCRYPTION_KEY=<32 caractères minimum, générés une fois, jamais changés ensuite>
```

* `ENCRYPTION_KEY` chiffre `users.json` (jetons et mots de passe des collaborateurs). La perdre = tous les collaborateurs
  se reconnectent. La changer = idem.
* Sage X3 et MyReport sans URL = simulateur intégré, données inventées et étiquetées comme telles ; en production, un
  connecteur non configuré n'est pas exposé du tout. **Ne jamais mettre de commentaire sur la même ligne qu'une valeur** :
  Compose le lirait comme la valeur.

Après toute modification de `.env` :

```
git pull
docker compose -f docker-compose.dev.yml up -d --build
```

Les connexions des collaborateurs sont conservées (volume Docker). Sur Portainer, les mêmes variables se saisissent dans
l'écran « Environment variables » de la stack.

## 1. Sage X3 (API REST Syracuse)

### Ce qu'il faut

| Information | Où la trouver | Exemple |
|---|---|---|
| URL Syracuse | Barre d'adresse de Sage X3, racine du site | `https://x3-test-ext-groupecharlois.4cadcloud2.com` |
| Nom du point de connexion | Sage X3 → bandeau du haut, clic sur le nom du dossier → liste « Points de connexion », colonne **Nom** (pas l'intitulé) | `X3TST_CHREC` |
| Compte Syracuse | Identifiant et mot de passe du collaborateur, **rattaché à ce point de connexion** avec un utilisateur X3 | `alexandrechebrou` |

Pas besoin du rôle administrateur Syracuse : l'API applique les droits fonctionnels de l'utilisateur X3.

### Étape 1 : vérifier l'accès depuis un poste, avant de toucher au hub

PowerShell (le mot de passe est demandé à l'invite, ne pas le mettre dans la commande) :

```
curl.exe -sS -u IDENTIFIANT -w "`nHTTP %{http_code}`n" "https://<syracuse>/api1/x3/erp/<POINT_DE_CONNEXION>/`$prototypes('BPCUSTOMER.`$query')"
```

| Réponse | Signification | Action |
|---|---|---|
| `HTTP 200`, JSON commençant par `{"$actxUser":…` | Tout est bon | Étape 2 |
| `Utilisateur ou mot de passe incorrect` | Identifiant ou mot de passe refusé en Basic | Vérifier la fiche utilisateur Syracuse (méthode « basic ») |
| `No X3 user matching in this endpoint` | Compte non rattaché à ce point de connexion | Demander le rattachement à l'intégrateur, ou utiliser le point de connexion où le compte existe |
| `HTTP 404 … representation does not exist` | Représentation non publiée sur ce dossier | Ticket intégrateur |
| `HTTP 500 Unexpected token <` | Premier appel d'une représentation non publiée (devient 404 ensuite) | Idem |

### Étape 2 : `.env`

```
SAGE_URL=https://<syracuse>
SAGE_FOLDER=<POINT_DE_CONNEXION>
SAGE_APIKEY_MODE=basic
SAGE_REPRESENTATIONS=BPCUSTOMER,BPSUPPLIER,SINVOICE,PINVOICE,SORDER,PORDER,GACCENTRY,ITMMASTER
```

Optionnel : `SAGE_LANG` (langue des libellés, défaut `fr-FR`). Délai max par requête Syracuse : 30 s, fixe.

### Étape 3 : connexion sur le portail

Carte **Sage X3** : champ « Identifiant » = identifiant Syracuse, champ « Jeton / clé » = mot de passe Syracuse, puis
**Tester Sage X3**. Le mot de passe est chiffré dans le hub et n'est jamais renvoyé au navigateur.

Lecture du diagnostic :

* `Connecté à … (dossier X3TST_CHREC) par clé d'API (basic) · 6 représentations` : OK.
* `absentes de ce dossier (404) : …` : non publiées, ticket intégrateur, le reste fonctionne.
* `interdites à votre utilisateur X3 (403) : …` : droits fonctionnels X3 du collaborateur.
* `en erreur côté Sage (5xx) : …` : à signaler à l'intégrateur.
* Voyant rouge `Sage X3 401` : mot de passe changé ou compte désactivé, ressaisir sur le portail.

### Comportements vérifiés, à connaître

* `sagex3_query` ne renvoie que les **colonnes de liste** (6 pour PINVOICE). Le filtre `where` accepte n'importe quel champ
  d'en-tête de la fiche (ex. `AMTATI gt 400`), mais la valeur n'est pas renvoyée : le modèle lit alors chaque fiche avec
  `sagex3_get`. Un total sur 100 factures coûte 100 lectures de fiche.
* Les dates se filtrent en `@AAAA-MM-JJ@`. Le hub convertit automatiquement une date entre apostrophes.
* Le **type de pièce** (facture / avoir) n'est pas exposé par PINVOICE : seul le numéro (`…FAF…` / `…AVF…`) le distingue,
  et les montants ne sont pas signés. Le modèle en est averti dans la description de l'outil.
* Le **statut de règlement** n'est pas exposé tant que `GACCDUDATE` (échéances) n'est pas publiée.
* Sans tri, Syracuse renvoie en tête des enregistrements techniques (`NUM` = `00000`). Le modèle est instruit de trier.
* Les libellés analytiques (sections, axes) sont des **données** saisies dans X3, parfois en anglais : `SAGE_LANG` n'agit
  que sur les titres de champs.

### Trouver le nom d'une représentation

Ouvrir l'écran dans Sage X3 et lire l'URL : `…$sessions?f=GESPIH…`. Le code de fonction donne la représentation par
convention : GESPIH → `PINVOICE`, GESSIH → `SINVOICE`, GESGAS → `GACCENTRY`, GESBPC → `BPCUSTOMER`, GESBPS →
`BPSUPPLIER`, GESSOH → `SORDER`, GESPOH → `PORDER`. Les spécifiques Charlois (préfixes Y, Z) se lisent dans
Développement → Données et paramètres → Classes → Représentations (rôle admin requis).

## 2. Salesforce (serveur MCP hébergé « SObject Reads »)

### Ce qu'il faut

| Information | Où la trouver |
|---|---|
| URL My Domain | Barre d'adresse une fois connecté : `https://charloisgroup--preprod.sandbox.my.salesforce.com` (sandbox) ou `https://charloisgroup.my.salesforce.com` (production) |
| URL du serveur MCP | Configuration → recherche « Serveurs MCP » (API Catalog) → ligne **SObject Reads**, activée → copier l'URL |
| Clé et secret consommateur | Créés avec l'application cliente externe ci-dessous |

Le hub refuse de démarrer si l'URL désigne un serveur d'écriture (`sobject-all`, `mutations`, `deletes`…).

### Étape 1 : créer l'application cliente externe (une par org : sandbox, puis production)

Droits : pouvoir ouvrir Configuration → « Gestionnaire des applications clientes externes ». Ne pas modifier les
applications existantes (ex. « X3 », créée par l'intégrateur pour l'interface ERP).

1. **Nouvelle application cliente externe**. Nom « MCP Charlois », **adresse e-mail de contact** (le code de vérification
   de la clé y sera envoyé), état de distribution : Local.
2. Déplier **API (Activer les paramètres OAuth)**, cocher **Activer OAuth**.
3. **URL de rappel** : `<PUBLIC_URL>/auth/salesforce/callback`, soit `http://localhost:8080/auth/salesforce/callback` sur
   un poste, `https://<hub>/auth/salesforce/callback` sur Portainer.
4. **Étendues OAuth**, exactement deux : « Accéder aux serveurs MCP hébergés par Salesforce (mcp_api) » et « Exécuter des
   requêtes à tout moment (refresh_token, offline_access) ». Ne pas ajouter `api` : les jetons seraient refusés.
5. Section **Flux Enablement** : tout décoché.
6. Section **Sécurité** :
   * cocher **Émettre des jetons d'accès basés sur JSON Web Token (JWT) pour des utilisateurs nommés** (sans elle : 401
     sur chaque appel) ;
   * cocher **Demander un secret pour le Flux serveur Web** et **Demander un secret pour le Flux jeton d'actualisation**
     (le hub est un serveur, il garde le secret : c'est une protection en plus de PKCE) ;
   * PKCE, permutation des jetons d'actualisation et TTL 30 jours sont imposés par Salesforce : rien à faire.
7. **Créer**. Puis onglet **Paramètres** → Paramètres OAuth → **Clé et secret du consommateur** : saisir le code reçu par
   e-mail, copier la **clé** et le **secret**.

Délai de propagation : jusqu'à 30 minutes. Après toute modification de l'application, chaque collaborateur déjà connecté
doit se déconnecter puis se reconnecter sur le portail (les anciens jetons gardent les anciens réglages).

### Étape 2 : `.env`

```
SF_LOGIN_URL=https://charloisgroup--preprod.sandbox.my.salesforce.com
SF_MCP_URL=https://api.salesforce.com/platform/mcp/v1/d/charloisgroup--preprod/sandbox/platform/sobject-reads
SF_CLIENT_ID=<clé consommateur>
SF_CLIENT_SECRET=<secret consommateur>
```

Optionnel : `SF_DEFAULT_LIMIT` (LIMIT ajouté aux SOQL sans borne, défaut 200), `SF_MAX_PER_MIN` (plafond d'appels par
minute, défaut illimité ; utile en production, facturée en crédits Flex). L'URL doit se terminer par `/sobject-reads` : toute
autre est refusée au démarrage.

### Étape 3 : connexion sur le portail

Carte **Salesforce** → **Se connecter** : page de connexion Salesforce, écran « MCP Charlois demande l'accès », Autoriser,
retour sur le portail. Puis **Tester Salesforce** : six outils doivent s'afficher, `find`, `getObjectSchema`,
`getRelatedRecords`, `getUserInfo`, `listRecentSobjectRecords`, `soqlQuery`. L'e-mail du collaborateur apparaît dans le
profil du portail (obtenu via `getUserInfo`).

Erreurs vues :

* `redirect_uri_mismatch` ou `invalid_client_id` juste après la création : propagation, attendre dix minutes.
* `JWT Token is required` / 401 sur chaque appel : case JWT non cochée dans l'application.

### Passage en production (non encore fait)

Même procédure dans l'org de production : nouvelle application cliente externe, `SF_LOGIN_URL` = My Domain de production,
`SF_MCP_URL` = URL de SObject Reads de production (forme `…/d/charloisgroup/platform/sobject-reads`). Dans « Serveurs
MCP », laisser actif **SObject Reads** seul et désactiver les serveurs d'écriture (`SObject All`, `Mutations`, `Deletes`),
après confirmation de l'intégrateur Salesforce. Fixer `SF_MAX_PER_MIN`.

## 3. Brancher un assistant

### Claude Desktop (vérifié)

Claude Desktop n'accepte pas d'en-tête d'autorisation sur un serveur distant : le portail fournit un bloc **Claude
Desktop** qui passe par le pont `mcp-remote` (version épinglée `0.15`). Prérequis : Node.js LTS installé sur le poste
(`node -v`).

1. Portail → bloc « Claude Desktop » → Copier.
2. Claude Desktop → nom d'utilisateur en bas à gauche → Paramètres → Développeur → **Modifier la configuration** : ouvre le
   dossier de `claude_desktop_config.json` (`%APPDATA%\Claude`).
3. Coller **l'entrée `charlois-finance` à l'intérieur du `mcpServers` existant** (pas après l'accolade finale : le fichier
   contient déjà des réglages). Fichier vide : coller le bloc entier.
4. Quitter Claude Desktop par l'icône de la barre système (clic droit → Quitter), relancer. Premier lancement : 10 à 20 s,
   `mcp-remote` se télécharge.
5. Nouvelle conversation → icône des outils : `charlois-finance` doit figurer avec ses outils.

Journal en cas d'échec : Paramètres → Développeur → Ouvrir les journaux → `mcp-server-charlois-finance.log`.

### Claude Code, ChatGPT, Copilot, clients MCP HTTP

Bloc « Votre connecteur Claude » du portail : URL `<PUBLIC_URL>/mcp` et en-tête `Authorization: Bearer <clé>`. La clé est
personnelle, jamais dans l'URL.

## 4. Lire une réponse

Chaque résultat d'outil se termine par `Source : Sage X3 · dossier X3TST_CHREC` ou `Source : Salesforce · sandbox preprod`
(ou `· production`). L'assistant est instruit de citer cette ligne, et d'interroger Sage X3 **et** Salesforce quand une
question sur un tiers, une commande ou une facture ne nomme pas le système. Il reste libre de résumer : la ligne Source
permet la vérification, elle ne la remplace pas.

Premières questions de contrôle, dont la réponse est connue :

* « Décris les champs de PINVOICE » → `colonnes_liste` (6) et `champs_fiche` (plus de 100, lignes `PIHPID.…`).
* « Donne-moi les 3 dernières factures d'achat du site TO219 avec le fournisseur » → filtre sur `FCY`, trois fiches.
* « Qui suis-je sur Salesforce ? » → nom, e-mail, profil, via `getUserInfo`.
* « Compare ce que Sage X3 et Salesforce savent du domaine Coppola en 2026 » → deux lignes Source.

## 5. SSO Microsoft Entra ID (portail)

Sans `SSO_MODE`, le portail crée une clé au premier passage, comme avant. Avec le SSO, un visiteur non identifié est
envoyé vers Microsoft Entra ID ; s'il a déjà une session Microsoft 365 dans ce navigateur, Entra le renvoie sans rien
lui demander (comportement d'Entra : le hub n'envoie simplement pas de `prompt`). Sa clé MCP est **liée à son identité
Entra** (`oid` + locataire) : il la retrouve depuis n'importe quel navigateur, et aucune autre identité Entra ne peut
l'obtenir par le portail. La clé reste un secret porteur : qui la détient l'utilise. Les clients MCP (Claude Desktop,
Claude Code…) ne changent pas : en-tête `Authorization: Bearer <clé>`.

Le SSO authentifie, il n'autorise rien sur Microsoft Graph : il ne demande que `openid profile email`, et aucun jeton
Microsoft n'est conservé. SharePoint / OneDrive garde son consentement délégué propre à chaque collaborateur, tenté
**sans interaction** juste après le SSO (`prompt=none`), puis par le bouton « Se connecter » si Entra refuse
(consentement absent, session absente). Dans les deux cas, le hub n'accepte que des jetons Graph du **même compte
Microsoft** que l'identité du portail : choisir un autre compte dans le sélecteur d'Entra est refusé.

Deux changements s'appliquent même sans SSO : le bouton « régénérer la clé » du portail (l'ancienne clé cesse de
fonctionner aussitôt) et une limite de 60 requêtes par minute et par adresse IP sur les départs et retours OAuth
(`/auth/…`). Derrière un NAT d'entreprise, cette adresse est partagée : un premier passage consomme quatre requêtes.

### Mode `entra` : ce qu'il faut dans Entra ID

La même application que SharePoint (section « Côté SharePoint » du README), complétée. Les libellés ci-dessous
décrivent le portail Entra de mémoire, pas depuis le locataire Charlois : **à vérifier dans le portail Entra**. Seuls
l'URI de redirection, le format GUID du locataire et le scope sont imposés par le code.

| Dans le portail Entra (Inscriptions d'applications → l'application) | Valeur |
|---|---|
| Vue d'ensemble → ID d'application (client) | à copier dans `MS_CLIENT_ID` |
| Vue d'ensemble → ID de l'annuaire (locataire) | à copier dans `MS_TENANT_ID` (un GUID ; `common` est refusé) |
| Types de comptes pris en charge | Comptes de cet annuaire d'organisation uniquement (le code n'exige que l'émetteur du GUID) |
| Authentification → URI de redirection (Web) | `<PUBLIC_URL>/auth/sso/callback`, à côté de `<PUBLIC_URL>/auth/sharepoint/callback`, à l'identique (pas de barre finale) |
| Authentification → URI de redirection après déconnexion | `<PUBLIC_URL>/?sso=off` (le bouton « Se déconnecter » ferme aussi la session Microsoft ; sans cette URI, Entra affiche sa propre page) |
| Certificats et secrets | le secret client déjà utilisé pour SharePoint (`MS_CLIENT_SECRET`) |
| API autorisées (Microsoft Graph, déléguées) | `openid`, `profile`, `email` ; `Files.Read.All`, `Sites.Read.All` avec consentement administrateur pour que SharePoint se connecte sans écran |

`.env` (en production, `PUBLIC_URL` doit être en https : le hub refuse de démarrer sinon) :

```
SSO_MODE=entra
MS_TENANT_ID=<GUID de l'annuaire>
MS_CLIENT_ID=<ID d'application (client)>
MS_CLIENT_SECRET=<secret client>
```

Le hub refuse de démarrer si `MS_TENANT_ID` n'est pas un GUID, si l'application n'est pas renseignée, ou si
`MS_LOGIN_URL` ne désigne pas `login.microsoftonline.com`. L'`id_token` est vérifié (émetteur et locataire attendus,
audience = l'application, expiration) ; il arrive en direct du point de terminaison token (TLS, code + PKCE + secret),
sa signature n'est donc pas revérifiée (OIDC Core § 3.1.3.7, règle 6). Cette hypothèse tombe si l'exploitant désactive
la vérification TLS de Node (`NODE_TLS_REJECT_UNAUTHORIZED=0`) : ne jamais le faire.

Constater que le SSO est actif : la ligne de démarrage du hub se termine par `· SSO entra`, le portail affiche
« via Microsoft Entra ID » à côté de l'identité, et `SSO_MODE` apparaît dans la configuration du conteneur. Lire un
échec : « Échec de la connexion Microsoft Entra ID (400) » = `id_token` refusé (locataire ou application inattendus) ;
« (4xx ou 502) » = échange de code refusé (secret ou URI de redirection faux) ; « Système inconnu ou session absente »
= flux d'un système lancé sans identité.

### Mode `mock` : développement et CI, jamais la production

`SSO_MODE=mock` avec le bouchon (`docker-compose.dev.yml`, dont les valeurs par défaut `MS_TENANT_ID`, `MS_CLIENT_ID`
et `MS_CLIENT_SECRET` suffisent) : la mire « Microsoft Entra ID — connexion simulée » du conteneur `mcp-stub` propose
Marie Dupont (DAF) et Paul Martin (commercial), sans aucun appel à Microsoft. Le bouchon émet un `id_token` au même
format qu'Entra, vérifie PKCE, honore `prompt=none` + `login_hint` (connexion SharePoint silencieuse) et simule la
déconnexion Microsoft. Le code du hub est le même qu'en mode `entra` ; seules les adresses changent. Le hub refuse de
démarrer en `mock` si `APP_ENV=production` ou si `MS_LOGIN_URL` pointe vers Microsoft. Tests : `hub/test/sso.test.js`
(anonymes, usurpation, séparation, cloisonnement des clés : cookies manipulés, rejeu, code volé refusé par PKCE,
fixation de session, clé héritée, compte Microsoft différent, sessions SSE, rotation ; verrous) et
`charlois-mcp-stub/test/stub.test.js` (bout en bout, refus PKCE du bouchon).

### Ce que le SSO transparent ne fait pas

* **Transparent seulement avec une session Microsoft 365 dans le navigateur** (poste joint à Entra, ou compte déjà
  ouvert dans ce navigateur). Sinon Entra affiche sa page de connexion : c'est bien du SSO, mais pas silencieux.
* **« Se déconnecter » ferme la session du portail puis la session Microsoft du navigateur**, sinon le suivant sur un
  poste partagé retrouverait la clé du précédent d'un clic. Les autres onglets Microsoft 365 de ce navigateur sont
  déconnectés aussi.
* **Un compte désactivé dans Entra garde sa clé MCP** tant qu'elle n'est pas régénérée : la clé n'est pas revalidée
  auprès d'Entra à chaque appel, et aucun outil ne permet aujourd'hui de retirer une entrée de `users.json`, chiffré.
  Ses jetons Graph, eux, cessent de se renouveler. À traiter au départ d'un collaborateur : régénérer la clé depuis
  son navigateur, ou prévoir une commande d'administration (mini-portail prévu).
* **Activer le SSO sur une instance existante invalide toutes les clés créées sans identité**, y compris leurs jetons :
  chaque collaborateur se reconnecte au portail, reçoit une clé neuve, reconnecte ses systèmes et reconfigure son client
  MCP. Une clé antérieure au SSO n'est jamais reprise, même sur le même navigateur : elle pourrait porter les jetons de
  quelqu'un d'autre.
* Tout compte du locataire peut ouvrir le portail et obtenir une clé. Les droits sur les données restent ceux de chaque
  système (Sage X3, Salesforce, Graph…), avec les identifiants personnels du collaborateur.
