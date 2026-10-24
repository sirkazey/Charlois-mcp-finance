# Configuration des connecteurs

Procédures de configuration de chaque système, connecteur par connecteur. Sage X3 et Salesforce sont **vérifiés sur
les vrais systèmes** (préproduction Sage X3 et sandbox Salesforce, 23 octobre 2026) ; SharePoint, Dropbox et MyReport
n'ont été exercés que contre le bouchon : leurs procédures sont signalées « à vérifier ». État complet :
[état des fonctionnalités](../validation/etat-des-fonctionnalites.md). Le SSO du portail a son propre guide :
[SSO Entra ID](sso-entra.md).

## 0. Le fichier `.env` et les URI de rappel

Le hub lit sa configuration dans **un seul fichier**, `.env`, à la racine du dépôt (créé à partir de `.env.example`,
jamais versionné). Sur Portainer, les mêmes variables se saisissent dans l'écran « Environment variables » de la
stack, puis **Update the stack**. Après toute modification en déploiement manuel :

```bash
docker compose -f docker-compose.dev.yml up -d      # pré-production ; docker-compose.prod.yml en production
```

Les connexions des collaborateurs sont conservées (volume Docker).

* `ENCRYPTION_KEY` chiffre `users.json` (jetons et mots de passe). La perdre ou la changer = tous les collaborateurs
  se reconnectent.
* Sage X3 et MyReport sans URL = simulateur intégré, données inventées et étiquetées ; en production, un connecteur non
  configuré n'est pas exposé du tout.
* Jamais de commentaire sur la même ligne qu'une valeur vide : Compose le lirait comme la valeur.
* **Instance** : `MCP_SERVER_NAME` (défaut `clevoa-gateway`) est le nom sous lequel le serveur MCP s'annonce et la clé du
  bloc `mcpServers` que le portail fait copier ; `INSTANCE_LABEL` (vide = « Clevoa AI Gateway ») est le libellé affiché
  sur le portail. Les configurations déjà collées chez les collaborateurs ne dépendent pas du nom : le changer n'oblige
  personne à les refaire.

URI de rappel à déclarer chez chaque fournisseur (toujours `<PUBLIC_URL>` exact, sans barre finale) :

| Système | URI de redirection | Où la déclarer |
|---|---|---|
| Salesforce | `<PUBLIC_URL>/auth/salesforce/callback` | application cliente externe (§ 2) |
| Sage X3 (OAuth, optionnel) | `<PUBLIC_URL>/auth/sagex3/callback` | IdP de Syracuse |
| SharePoint / OneDrive | `<PUBLIC_URL>/auth/sharepoint/callback` | application Entra ID (§ 3) |
| SSO Entra ID | `<PUBLIC_URL>/auth/sso/callback` et, après déconnexion, `<PUBLIC_URL>/?sso=off` | application Entra ID ([SSO](sso-entra.md)) |
| Dropbox | `<PUBLIC_URL>/auth/dropbox/callback` | App Console Dropbox (§ 4) |

## 1. Sage X3 24R1 (API REST Syracuse)

Le hub appelle l'API REST Syracuse (`/api1/x3/erp/<point de connexion>/…`, facettes `$query`, `$details`, `$prototypes`
uniquement, toujours en GET) avec l'identité de chaque collaborateur. Mode vérifié : `SAGE_APIKEY_MODE=basic`, le
collaborateur saisit son identifiant et son mot de passe Syracuse sur le portail. Alternatives non vérifiées : OAuth2
(serveur OAuth2 déclaré dans Syracuse, variables `SAGE_OAUTH_*`) ou clé d'API en `bearer`.

### Ce qu'il faut

| Information | Où la trouver | Exemple |
|---|---|---|
| URL Syracuse | Barre d'adresse de Sage X3, racine du site | `https://x3-test-ext-<client>.4cadcloud2.com` |
| Nom du point de connexion | Sage X3 → bandeau du haut, clic sur le nom du dossier → liste « Points de connexion », colonne **Nom** (pas l'intitulé) | `X3TST_CHREC` |
| Compte Syracuse | Identifiant et mot de passe du collaborateur, **rattaché à ce point de connexion** avec un utilisateur X3 | |

Pas besoin du rôle administrateur Syracuse : l'API applique les droits fonctionnels de l'utilisateur X3.

### Étape 1 : vérifier l'accès depuis un poste

PowerShell (le mot de passe est demandé à l'invite, ne pas le mettre dans la commande) :

```
curl.exe -sS -u IDENTIFIANT -w "`nHTTP %{http_code}`n" "https://<syracuse>/api1/x3/erp/<POINT_DE_CONNEXION>/`$prototypes('BPCUSTOMER.`$query')"
```

| Réponse | Signification | Action |
|---|---|---|
| `HTTP 200`, JSON commençant par `{"$actxUser":…` | Tout est bon | Étape 2 |
| `Utilisateur ou mot de passe incorrect` | Identifiant ou mot de passe refusé en Basic | Vérifier la fiche utilisateur Syracuse (méthode « basic ») |
| `No X3 user matching in this endpoint` | Compte non rattaché à ce point de connexion | Demander le rattachement à l'intégrateur |
| `HTTP 404 … representation does not exist` | Représentation non publiée sur ce dossier | Ticket intégrateur |
| `HTTP 500 Unexpected token <` | Premier appel d'une représentation non publiée (devient 404 ensuite) | Idem |

### Étape 2 : `.env`

```
SAGE_URL=https://<syracuse>
SAGE_FOLDER=<POINT_DE_CONNEXION>
SAGE_APIKEY_MODE=basic
SAGE_REPRESENTATIONS=BPCUSTOMER,BPSUPPLIER,SINVOICE,PINVOICE,SORDER,PORDER,GACCENTRY,ITMMASTER
```

Optionnel : `SAGE_LANG` (langue des libellés, défaut `fr-FR`). Délai maximal par requête Syracuse : 30 s, fixe.

### Étape 3 : connexion et diagnostic sur le portail

Carte **Sage X3** : « Identifiant » = identifiant Syracuse, « Jeton / clé » = mot de passe Syracuse, puis **Tester**.

* `Connecté à … (dossier X3TST_CHREC) par identifiant et mot de passe Syracuse · 6 représentations` : OK.
* `absentes de ce dossier (404) : …` : non publiées, ticket intégrateur, le reste fonctionne.
* `interdites à votre utilisateur X3 (403) : …` : droits fonctionnels X3 du collaborateur.
* `en erreur côté Sage (5xx) : …` : à signaler à l'intégrateur.
* Voyant rouge `Sage X3 401` : mot de passe changé ou compte désactivé, ressaisir sur le portail.

### Comportements vérifiés

* La structure (représentations, champs, libellés) est lue par `$prototypes` et gardée en mémoire par utilisateur
  jusqu'à 03:00. Une représentation absente (404), interdite (403) ou en erreur (5xx) est signalée sans bloquer les autres.
* `sagex3_query` ne renvoie que les **colonnes de liste** (6 pour PINVOICE). Le filtre `where` accepte tout champ
  d'en-tête de la fiche (ex. `AMTATI gt 400`) mais la valeur n'est pas renvoyée ; `sagex3_get` lit la fiche, avec le
  paramètre `champs` pour ne garder que l'utile.
* Les dates se filtrent en `@AAAA-MM-JJ@` ; le hub convertit une date entre apostrophes.
* Le **type de pièce** (facture / avoir) n'est pas exposé par PINVOICE (numéro `…FAF…` / `…AVF…`), les montants ne sont
  pas signés ; le **statut de règlement** n'est pas exposé tant que `GACCDUDATE` n'est pas publiée. Le modèle en est averti.
* Sans tri, Syracuse renvoie en tête des enregistrements techniques (`NUM` = `00000`) ; le modèle est instruit de trier.
* `SAGE_LANG` n'agit que sur les titres de champs ; les libellés analytiques sont des données saisies dans X3.

Trouver le nom d'une représentation : lire l'URL de l'écran Sage X3 (`…$sessions?f=GESPIH…`). GESPIH → `PINVOICE`,
GESSIH → `SINVOICE`, GESGAS → `GACCENTRY`, GESBPC → `BPCUSTOMER`, GESBPS → `BPSUPPLIER`, GESSOH → `SORDER`, GESPOH →
`PORDER`. Les représentations spécifiques (préfixes Y, Z) se lisent dans Développement → Données et paramètres →
Classes → Représentations (rôle admin requis).

## 2. Salesforce (serveur MCP hébergé « SObject Reads »)

Le hub est **client MCP** du serveur hébergé par Salesforce `SObject Reads` (lecture seule des objets métier) avec le
jeton OAuth de chaque collaborateur : Salesforce applique son profil, ses règles de partage et la sécurité au niveau
des champs. Outils : `salesforce_tools` (les six outils du serveur et leurs schémas : `find`, `getObjectSchema`,
`getRelatedRecords`, `getUserInfo`, `listRecentSobjectRecords`, `soqlQuery`) et `salesforce_call` (exécution). Un
`soqlQuery` sans `LIMIT` reçoit `LIMIT 200` (`SF_DEFAULT_LIMIT`). L'e-mail du collaborateur vient de `userinfo` si
l'étendue `openid` est accordée, sinon de l'outil `getUserInfo`.
Sur 401, le hub échange le `refresh_token` (rotation gérée), persiste le nouveau jeton et rejoue l'appel ; un refresh
token révoqué efface l'entrée et demande une reconnexion.

### Ce qu'il faut

| Information | Où la trouver |
|---|---|
| URL My Domain | Barre d'adresse une fois connecté : `https://<org>.my.salesforce.com` ou `https://<org>--<sandbox>.sandbox.my.salesforce.com` |
| URL du serveur MCP | Configuration → recherche « Serveurs MCP » (API Catalog) → ligne **SObject Reads**, activée → copier l'URL |
| Clé et secret consommateur | Créés avec l'application cliente externe ci-dessous |

Le hub refuse de démarrer si l'URL ne se termine pas par `/sobject-reads` (serveurs d'écriture `sobject-all`,
`mutations`, `deletes` refusés).

### Étape 1 : créer l'application cliente externe (une par org : sandbox, puis production)

Droits : pouvoir ouvrir Configuration → « Gestionnaire des applications clientes externes ». Ne pas modifier les
applications existantes de l'intégrateur.

1. **Nouvelle application cliente externe**. Nom (ex. « MCP Finance »), **adresse e-mail de contact** (le code de
   vérification de la clé y sera envoyé), état de distribution : Local.
2. Déplier **API (Activer les paramètres OAuth)**, cocher **Activer OAuth**.
3. **URL de rappel** : `<PUBLIC_URL>/auth/salesforce/callback`.
4. **Étendues OAuth**, exactement deux : « Accéder aux serveurs MCP hébergés par Salesforce (mcp_api) » et « Exécuter
   des requêtes à tout moment (refresh_token, offline_access) ». Ne pas ajouter `api` : les jetons seraient refusés.
5. Section **Flux Enablement** : tout décoché.
6. Section **Sécurité** : cocher **Émettre des jetons d'accès basés sur JSON Web Token (JWT) pour des utilisateurs
   nommés** (sans elle : 401 sur chaque appel) ; cocher **Demander un secret pour le Flux serveur Web** et **Demander
   un secret pour le Flux jeton d'actualisation**. PKCE, permutation des jetons d'actualisation et TTL 30 jours sont
   imposés par Salesforce.
7. **Créer**. Puis onglet **Paramètres** → Paramètres OAuth → **Clé et secret du consommateur** : saisir le code reçu
   par e-mail, copier la **clé** et le **secret**.

Délai de propagation : jusqu'à 30 minutes. Après toute modification de l'application, chaque collaborateur déjà
connecté doit se déconnecter puis se reconnecter sur le portail.

### Étape 2 : `.env`

```
SF_LOGIN_URL=https://<org>--<sandbox>.sandbox.my.salesforce.com
SF_MCP_URL=https://api.salesforce.com/platform/mcp/v1/d/<org>--<sandbox>/sandbox/platform/sobject-reads
SF_CLIENT_ID=<clé consommateur>
SF_CLIENT_SECRET=<secret consommateur>
```

Optionnel : `SF_DEFAULT_LIMIT` (défaut 200), `SF_MAX_PER_MIN` (plafond d'appels par minute tous utilisateurs confondus,
défaut illimité ; utile en production, facturée en crédits Flex).

### Étape 3 : connexion sur le portail

Carte **Salesforce** → **Se connecter** : page de connexion Salesforce, écran d'autorisation, retour sur le portail.
Puis **Tester** : six outils doivent s'afficher et l'e-mail du collaborateur apparaît dans le profil.

Erreurs vues : `redirect_uri_mismatch` ou `invalid_client_id` juste après la création = propagation, attendre dix
minutes ; `JWT Token is required` / 401 sur chaque appel = case JWT non cochée.

### Passage en production

Même procédure dans l'org de production : nouvelle application cliente externe, `SF_LOGIN_URL` = My Domain de
production, `SF_MCP_URL` = URL de SObject Reads de production (forme `…/d/<org>/platform/sobject-reads`). Dans
« Serveurs MCP », laisser actif **SObject Reads** seul et désactiver les serveurs d'écriture après confirmation de
l'intégrateur Salesforce. Fixer `SF_MAX_PER_MIN`.

## 3. SharePoint / OneDrive (Microsoft Graph) — à vérifier sur un vrai locataire

Application Entra ID avec **permissions déléguées** `User.Read`, `Files.Read.All`, `Sites.Read.All` (plus `openid`,
`offline_access`), URI de redirection `<PUBLIC_URL>/auth/sharepoint/callback`. Graph répond avec les droits du
collaborateur connecté : un dossier qu'il ne voit pas dans SharePoint renvoie 403. Outils : `sharepoint_sites`,
`sharepoint_list`, `sharepoint_search`, `sharepoint_read` (texte, csv, json ; les binaires renvoient leurs métadonnées
et leur lien). Seules les redirections de téléchargement vers des hôtes Microsoft en https sont suivies.

Création (libellés du portail Entra de mémoire, **à vérifier**) : portail Entra → Identité → Applications →
Inscriptions d'applications → Nouvelle inscription : nom, comptes de cet annuaire uniquement, plateforme Web avec
l'URI ci-dessus ; Certificats et secrets → nouveau secret client (valeur visible une seule fois) ; API autorisées →
Microsoft Graph → permissions déléguées ci-dessus → Accorder le consentement d'administrateur. La même application
sert au [SSO Entra ID](sso-entra.md).

```
MS_TENANT_ID=<ID de l'annuaire (locataire)>
MS_CLIENT_ID=<ID d'application (client)>
MS_CLIENT_SECRET=<secret client>
SP_SITE=<hôte>.sharepoint.com:/sites/<site>
```

`SP_SITE` vide = OneDrive de l'utilisateur. En pré-production, renseigner aussi `MS_LOGIN_URL` et `GRAPH_URL` réels
([installation § 4](installation.md#4-déploiement-avec-portainer-gitops)). Portail → Se connecter → Tester : `GET /me`
sur Graph, vert avec votre identité.

## 4. Dropbox (serveur MCP officiel) — à vérifier sur un vrai compte

Le hub est **client MCP** du serveur officiel `https://mcp.dropbox.com/mcp` avec le jeton OAuth Dropbox du
collaborateur. Outils : `dropbox_tools` (outils du serveur filtrés par liste blanche lecture seule) et `dropbox_call`.
Les outils d'écriture (`create_*`, `move`, `copy`, `delete`) sont refusés avant tout appel ; les scopes OAuth ne les
permettraient de toute façon pas.

Procédure attendue (libellés de l'App Console de mémoire, **à vérifier**) :

1. https://www.dropbox.com/developers/apps → Create app → API « Scoped access », accès « Full Dropbox » (ou
   « App folder »), nom de l'application.
2. Onglet Permissions : `account_info.read`, `files.metadata.read`, `files.content.read`, `sharing.read`. Aucun scope
   d'écriture.
3. Onglet Settings : OAuth 2 → Redirect URIs → `<PUBLIC_URL>/auth/dropbox/callback` ; relever App key et App secret.
4. `.env` : `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET` (en pré-production, aussi les trois URL réelles). Portail → Se
   connecter → Tester.

Point à confirmer dès le premier essai : l'acceptation par `mcp.dropbox.com` d'un jeton issu de votre propre app (la
documentation Dropbox indique que les clients sans enregistrement dynamique utilisent les identifiants de l'app). En
cas de refus, le diagnostic l'affiche et le connecteur reste inactif sans effet sur les autres.

## 5. MyReport (proxy MCP SSE) — serveur éditeur non livré

Le hub est **client MCP SSE** du serveur MCP de votre MyReport Server (`MYREPORT_MCP_URL`), annoncé par l'éditeur
(Absys Cyborg) mais non livré à ce jour : le connecteur n'a été exercé que contre le bouchon. Chaque collaborateur saisit
**son** jeton MyReport dans le portail, joint à chaque requête (`Authorization: Bearer <jeton>`, ou l'en-tête
`MYREPORT_AUTH_HEADER`). Outils : `myreport_tools` (outils distants, schémas, autorisés ou non) et `myreport_call`. Seuls
les outils listés dans `MYREPORT_TOOLS` (liste blanche lecture seule, à composer d'après le bouton « Tester ») sont
transférés ; liste vide = aucun transfert. `MYREPORT_MAX_PER_MIN` (défaut 20) plafonne les appels sortants tous
utilisateurs confondus : avec 50 collaborateurs, c'est la première limite atteinte
([campagne de charge](../validation/charge-v1.2.1.md)).

`MYREPORT_MCP_URL` vide = **simulateur local** (deux outils fictifs, réponses marquées `simule: true`), sans jeton ni
réseau ; le bouton « Tester » l'indique.

## 6. Télémétrie Clevoa

`CLEVOA_KEY` (obligatoire en production) et `CLEVOA_URL` (figée sur `https://clevoa.fr` en production). Ce qui est
envoyé, et comment le vérifier : [sécurité § 4](securite.md#4-télémétrie-clevoa).
