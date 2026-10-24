# SSO Microsoft Entra ID (portail)

Sans `SSO_MODE`, le portail crée une clé au premier passage. Avec le SSO, un visiteur non identifié est envoyé vers
Microsoft Entra ID ; s'il a déjà une session Microsoft 365 dans ce navigateur, Entra le renvoie sans rien lui demander
(le hub n'envoie pas de `prompt`). Sa clé MCP est **liée à son identité Entra** (`oid` + locataire) : il la retrouve
depuis n'importe quel navigateur, et aucune autre identité ne peut l'obtenir par le portail. La clé reste un secret
porteur : qui la détient l'utilise. Les clients MCP ne changent pas (`Authorization: Bearer <clé>`).

Le SSO **authentifie**, il n'autorise rien sur Microsoft Graph : il ne demande que `openid profile email` et aucun jeton
Microsoft n'est conservé. SharePoint / OneDrive garde son consentement délégué propre, tenté **sans interaction** juste
après le SSO (`prompt=none`), puis par le bouton « Se connecter » si Entra refuse. Le hub n'accepte que des jetons Graph
du **même compte Microsoft** que l'identité du portail.

Deux changements s'appliquent même sans SSO : le bouton « régénérer la clé » et une limite de 60 requêtes par minute et
par adresse IP sur `/auth/…` (derrière un NAT, un premier passage consomme quatre requêtes).

État : exercé contre le bouchon et les tests automatisés seulement ; **jamais contre un vrai locataire Entra**
([état des fonctionnalités](../validation/etat-des-fonctionnalites.md)).

## Mode `entra` : ce qu'il faut dans Entra ID

Une seule application Entra ID sert SharePoint et le SSO ([configuration § 3](configuration.md#3-sharepoint--onedrive-microsoft-graph--à-vérifier-sur-un-vrai-locataire)).
Les libellés ci-dessous décrivent le portail Entra de mémoire : **à vérifier**. Seuls les URI de redirection, le format
GUID du locataire et les scopes sont imposés par le code.

| Dans le portail Entra (Inscriptions d'applications → l'application) | Valeur |
|---|---|
| Vue d'ensemble → ID d'application (client) | `MS_CLIENT_ID` |
| Vue d'ensemble → ID de l'annuaire (locataire) | `MS_TENANT_ID` (un GUID ; `common` est refusé) |
| Types de comptes pris en charge | Comptes de cet annuaire d'organisation uniquement |
| Authentification → URI de redirection (Web) | `<PUBLIC_URL>/auth/sso/callback`, à côté de `<PUBLIC_URL>/auth/sharepoint/callback`, sans barre finale |
| Authentification → URI de redirection après déconnexion | `<PUBLIC_URL>/?sso=off` (sinon Entra affiche sa propre page après « Se déconnecter ») |
| Certificats et secrets | le secret client déjà utilisé pour SharePoint (`MS_CLIENT_SECRET`) |
| API autorisées (Microsoft Graph, déléguées) | `openid`, `profile`, `email`, `offline_access`, `User.Read` ; `Files.Read.All`, `Sites.Read.All` avec consentement administrateur pour que SharePoint se connecte sans écran |

`.env` (en production, `PUBLIC_URL` doit être en https) :

```
SSO_MODE=entra
MS_TENANT_ID=<GUID de l'annuaire>
MS_CLIENT_ID=<ID d'application (client)>
MS_CLIENT_SECRET=<secret client>
```

Le hub refuse de démarrer si `MS_TENANT_ID` n'est pas un GUID, si l'application n'est pas renseignée, ou si
`MS_LOGIN_URL` ne désigne pas `login.microsoftonline.com`. L'`id_token` est vérifié (émetteur, locataire, audience,
expiration) ; il arrive en direct du point de terminaison token (TLS, code + PKCE + secret), sa signature n'est donc
pas revérifiée (OIDC Core § 3.1.3.7, règle 6). Ne jamais désactiver la vérification TLS de Node
(`NODE_TLS_REJECT_UNAUTHORIZED=0`).

Constater que le SSO est actif : la ligne de démarrage contient `· SSO entra`, le portail affiche « via Microsoft
Entra ID » à côté de l'identité, `SSO_MODE` apparaît dans la configuration du conteneur. Lire un échec : « Échec de la
connexion Microsoft Entra ID (…) » avec une réponse HTTP 400 = `id_token` refusé (locataire ou application inattendus) ;
la même phrase avec une réponse HTTP 502 et la ligne de journal `[oauth] sso : échec de l'échange de jeton` = échange de
code refusé par Entra (secret ou URI faux ; le statut d'Entra est entre parenthèses) ; « Système inconnu ou session
absente » = flux lancé sans identité.

## Mode `mock` : développement et CI, jamais la production

`SSO_MODE=mock` avec le bouchon (`docker-compose.dev.yml`, dont les valeurs par défaut `MS_*` suffisent) : la mire
« Microsoft Entra ID — connexion simulée » du conteneur `mcp-stub` propose Marie Dupont et Paul Martin, sans aucun
appel à Microsoft. Le bouchon émet un `id_token` au même format qu'Entra, vérifie PKCE, honore `prompt=none` +
`login_hint` et simule la déconnexion. Le code du hub est le même qu'en mode `entra`. Le hub refuse de démarrer en
`mock` si `APP_ENV=production` ou si `MS_LOGIN_URL` pointe vers Microsoft.

Tests : `hub/test/sso.test.js` (anonymes, usurpation, séparation, cloisonnement des clés : cookies manipulés, rejeu,
code volé refusé par PKCE, fixation de session, clé héritée, compte Microsoft différent, sessions SSE, rotation,
verrous) et `clevoa-mcp-stub/test/stub.test.js` (bout en bout).

## Ce que le SSO ne fait pas

* **Transparent seulement avec une session Microsoft 365 dans le navigateur.** Sinon Entra affiche sa page de connexion.
* **« Se déconnecter » ferme la session du portail puis la session Microsoft du navigateur**, sinon le suivant sur un
  poste partagé retrouverait la clé du précédent. Les autres onglets Microsoft 365 de ce navigateur sont déconnectés.
* **Un compte désactivé dans Entra garde sa clé MCP** tant qu'elle n'est pas régénérée : la clé n'est pas revalidée
  auprès d'Entra à chaque appel, et aucun outil ne retire aujourd'hui une entrée de `users.json`. Ses jetons Graph
  cessent de se renouveler. Au départ d'un collaborateur : [exploitation § 8](exploitation.md#8-départ-dun-collaborateur-clé-compromise).
* **Activer le SSO sur une instance existante invalide toutes les clés créées sans identité** : chaque collaborateur
  se reconnecte, reçoit une clé neuve, reconnecte ses systèmes et reconfigure son client MCP. Une clé antérieure au
  SSO n'est jamais reprise : elle pourrait porter les jetons de quelqu'un d'autre.
* Tout compte du locataire peut ouvrir le portail et obtenir une clé. Les droits sur les données restent ceux de
  chaque système, avec les identifiants personnels du collaborateur.
