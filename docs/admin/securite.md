# Sécurité

Principes de sécurité du produit, ce que l'administrateur doit vérifier, et ce qui reste à prouver. Les analyses
automatiques (Semgrep, CodeQL, Gitleaks, Trivy, ZAP) sont décrites côté développeur dans
[tests et analyses](../developer/tests.md) ; les audits passés dans [l'historique](../history/audit-2026-10.md).

## 1. Cloisonnement des identités (règle non négociable)

Aucun compte de service, générique ou global, pour aucun des outils connectés.

* `users.json` ne contient que des jetons **individuels**, obtenus par chaque collaborateur sur le portail et rangés
  sous sa clé MCP personnelle. Le fichier est **chiffré AES-256-GCM** (clé maîtresse `ENCRYPTION_KEY`, obligatoire,
  `openssl rand -hex 32`), déchiffré en mémoire uniquement, écrit avec les droits 600 dans un volume en 700.
* Chaque appel MCP est authentifié par la clé de l'appelant. Le hub lit **son** jeton et le transmet tel quel en
  `Authorization: Bearer` à l'outil, qui applique le profil de droits de ce collaborateur.
* Le cache de structure (objets, champs) est par utilisateur et expire chaque nuit ; aucune donnée métier n'est cachée.
* Aucun jeton n'est lu depuis l'environnement : les seules variables d'authentification sont les identifiants des
  applications OAuth (échange de code et refresh), jamais utilisés pour requêter les API.
* Exceptions : les **simulateurs** Sage X3 et MyReport (sans URL), qui ne contactent aucun système.

Preuves : test `Cloisonnement` de `hub/test/mcp.test.js` (deux utilisateurs, seuls leurs jetons circulent),
`hub/test/sso.test.js` (cookies manipulés, rejeu, code volé, fixation de session), campagne de charge (0 violation sur
3 950 appels). **Limite** : sur les systèmes réels, le cloisonnement n'a été observé qu'avec un compte administrateur ;
le test avec un compte restreint reste à faire ([état des fonctionnalités](../validation/etat-des-fonctionnalites.md)).

## 2. Lecture seule

Salesforce via le serveur MCP hébergé `SObject Reads` uniquement (URL verrouillée, outils au nom d'écriture refusés
avant transfert) ; Sage X3 `$query` / `$details` / `$prototypes` uniquement, en GET ; Graph en GET uniquement, chemins
et sites validés, redirections limitées aux hôtes Microsoft en https ; Dropbox et MyReport limités à une liste blanche
d'outils ; noms d'objets validés (`^\w+$`) ; outils annotés `readOnlyHint`.

## 3. Accès MCP et portail

* La clé MCP personnelle se transmet **uniquement** dans l'en-tête `Authorization: Bearer`. Le paramètre `?key=` est
  ignoré (une clé dans l'URL finirait dans les journaux du reverse proxy). Conséquence : les connecteurs de claude.ai
  web et mobile ne peuvent pas se connecter ; aucun serveur OAuth 2.1 n'est implémenté, volontairement.
* Le callback OAuth est lié au navigateur qui a lancé le flux (anti login-CSRF) ; les POST du portail refusent une
  autre origine ; PKCE S256 sur tous les flux.
* Transport SSE : `POST /messages` exige la clé MCP et la session doit avoir été ouverte par cette clé (403 sinon).
* Limitation de débit en mémoire, par adresse IP et par minute : 20 diagnostics, 30 actions portail, 60 `/api/me`,
  60 départs et retours OAuth, 20 échecs d'authentification MCP (une clé valide n'est jamais freinée par les échecs
  d'autres clients). `TRUST_PROXY` indique le nombre de reverse proxys pour lire l'IP réelle. Les routes MCP elles-mêmes
  (`/mcp`, `/sse`, `/messages`) ne sont pas plafonnées.
* Plafond d'appels sortants par connecteur, tous utilisateurs confondus : `MYREPORT_MAX_PER_MIN` (défaut 20),
  `SF_MAX_PER_MIN` (défaut illimité). Au-delà, erreur claire sans rien envoyer au système.
* En-têtes de sécurité HTTP sur toutes les réponses (CSP sans ressource externe, nosniff, anti-clickjacking,
  Referrer-Policy, Permissions-Policy, COOP/CORP), `X-Powered-By` retiré.
* Conteneur : utilisateur `node`, capacités retirées, `no-new-privileges`, système de fichiers en lecture seule hormis
  `/data` et `/tmp` ; en production, `PUBLIC_URL` en https obligatoire. Le conteneur de sauvegarde garde la seule
  capacité `DAC_OVERRIDE` pour lire le volume ([exploitation § 4](exploitation.md#4-sauvegarde)).
* Journaux : jamais de clé, de jeton, d'argument d'outil ni de résultat ; en `debug`, nom de l'outil, durée et statut.

## 4. Télémétrie Clevoa

Si `CLEVOA_KEY` est renseignée, le hub envoie au démarrage puis chaque jour à 03:00 un `POST` vers `CLEVOA_URL`
(défaut `https://clevoa.fr/api/v1/telemetry`, figé en production) avec l'en-tête `X-Clevoa-Key`. Payload, et rien d'autre :

```json
{ "version": "1.2.1", "env": "PRODUCTION", "date": "2026-10-24",
  "connectors": { "salesforce": true, "sagex3": false, "sharepoint": true, "dropbox": true, "myreport": false },
  "requests": 137, "seats": 9 }
```

`connectors` = vrai système configuré (un simulateur compte `false`) ; `requests` = nombre d'appels d'outils depuis le
dernier envoi, tous utilisateurs confondus ; `seats` = collaborateurs ayant connecté au moins un outil (base de la
licence par siège). Aucun e-mail, jeton, requête, résultat ni adresse IP de collaborateur ne quitte le hub ; le backend
refuse tout champ supplémentaire. Clé vide = télémétrie désactivée ; backend injoignable = journal `[telemetry] échec`,
nouvel essai à 1, 5 puis 30 minutes, hub inchangé. La clé identifie une **installation**, jamais une personne : parler
de télémétrie « agrégée », pas « totalement anonyme ».

Le backend est dans [`clevoa-backend/`](../../clevoa-backend/README.md) (AWS Lambda, fermé par défaut : `CLEVOA_KEYS`
vide → 503).

## 5. Ce que l'administrateur doit vérifier au déploiement

| Point | Comment |
|---|---|
| Hub joignable seulement via le reverse proxy https | `HUB_PORT=127.0.0.1:8080`, nom DNS interne, `TRUST_PROXY` juste ([exploitation § 6](exploitation.md#6-reverse-proxy-nginx-https)) |
| `ENCRYPTION_KEY` et configuration au coffre, jamais avec les sauvegardes | [exploitation § 4](exploitation.md#4-sauvegarde) |
| Une `ENCRYPTION_KEY` et une `CLEVOA_KEY` par environnement | variables de chaque stack |
| Périmètre d'accès au portail | SSO Entra ID ([guide](sso-entra.md)), ou réseau interne / VPN ; tout compte du locataire peut obtenir une clé |
| Permissions Graph `Files.Read.All` et `Sites.Read.All` justifiées | revue M365 / DPO : ces permissions déléguées donnent aux assistants l'accès aux documents que le collaborateur voit |
| Départ d'un collaborateur, clé compromise | [exploitation § 8](exploitation.md#8-départ-dun-collaborateur-clé-compromise) |
| Pas de secret dans le dépôt ni dans les issues | Gitleaks en CI ; modèles d'issue rappelant « sans jeton ni donnée métier » |

## 6. Ce qui reste à prouver

Tests humains prioritaires sur tout scanner : compte restreint sur Sage X3 et Salesforce, révocation OAuth réelle,
injection de prompts et contenus non fiables dans les données (CRM, documents) relayées aux assistants, exactitude
financière sur un jeu de référence. Liste et état : [état des fonctionnalités](../validation/etat-des-fonctionnalites.md).
