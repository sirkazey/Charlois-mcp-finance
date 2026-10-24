# Journal des tests sur systèmes réels

Ce journal consigne ce qui a été **réellement exécuté** contre les systèmes Charlois, par qui, avec quel résultat, et ce que
le hub a dû corriger. Les tests automatisés (73 tests hub, 11 tests bouchon, scénario CI de sauvegarde et restauration)
tournent à chaque commit ; ils ne sont pas listés ici.

Compte utilisé pour tous les tests : Alexandre Chebrou de Lespinats, profil **administrateur** sur les deux systèmes.
Conséquence : le cloisonnement (un utilisateur restreint ne voit que ses données) n'est pas encore prouvé sur les vrais
systèmes. C'est le test manquant prioritaire.

## 2026-10-23 · Sage X3 préproduction (4CAD Cloud, Syracuse 24R1)

Instance `x3-test-ext-groupecharlois.4cadcloud2.com`, point de connexion `X3TST_CHREC` (dossier « Recette CHARLOIS
Salesforce PàP », copie fidèle des données), utilisateur X3 `ACHEB`.

| # | Test | Résultat | Suite donnée |
|---|---|---|---|
| S1 | Sonde sans identifiant : `/api1/x3/erp` | 401 `Basic realm=Syracuse` : API REST exposée | Aucune action 4CAD nécessaire |
| S2 | curl Basic sur `X3TST_CHTST` | `No X3 user matching in this endpoint` | Compte rattaché à CHREC seulement |
| S3 | curl `$prototypes('BPCUSTOMER.$query')` sur CHREC | 200, structure complète | Format réel ≠ hypothèse du hub |
| S4 | curl `$query` BPCUSTOMER count=2 | 200, `$resources`, pagination `$links.$next` | Conforme au parseur |
| S5 | Portail « Tester Sage X3 » | 404 sur YFAC (liste par défaut héritée du bouchon) | Diagnostic rendu tolérant |
| S6 | Portail après `SAGE_REPRESENTATIONS` | Vert, 6 représentations ; SINVOICE, GACCENTRY absentes | Ticket 4CAD |
| S7 | curl `$prototypes` SINVOICE, GACCENTRY, GACCDUDATE | 500 « Unexpected token < » au 1er appel, puis 404 « does not exist » | Non publiées sur CHREC : ticket 4CAD |
| S8 | curl where avec espaces (`--data-urlencode`) | 400 « expected beginning of term » : `+` refusé | Hub : encodage `%20` |
| S9 | curl where `(FCY eq 'TO219')` encodé `%20` | 3 factures du site, identiques à l'écran Sage | OK |
| S10 | curl where `(AMTATI gt 400)` (champ hors liste) | 200, filtre appliqué, AMTATI non renvoyé | Limite documentée |
| S11 | curl `select=NUM,AMTATI` | Ignoré, mêmes colonnes ; enregistrements techniques `00000`, `001` en tête | Limite documentée, consigne de tri |
| S12 | Capture `capture-sage.ps1` : prototypes liste et fiche de 6 représentations | Structures obtenues ; libellés en anglais (Accept-Language) | Fixtures de test anonymisées, `SAGE_LANG` |
| S13 | Claude Desktop : « Quelles représentations ? » | 6 noms, conteneur à jour | OK |
| S14 | Claude Desktop : « Décris PINVOICE » | 4 champs puis 6, libellés vides sur FCY/BPR, fiche en anglais | 3 corrections (exclus conservés, libellé `_REF`, langue) ; validé ensuite en français |
| S15 | Claude Desktop : « 3 dernières factures d'achat TO219 » | ENGIE, KOESIO, EDF, conformes | OK |
| S16 | Claude Desktop : « Détail TO2192607FAF0006 » | Fiche complète KOESIO, 80+ champs, lignes, TVA, analytique | OK ; fiche de 60 à 130 k caractères → paramètre `champs` |
| S17 | Claude Desktop : « factures SILICO payées en 2026 » | 10 factures, 97 850,88 € TTC ; « payées » non vérifiable ; date `'2026-01-01'` → 500 | Hub : dates converties en `@…@` ; GACCDUDATE demandée à 4CAD |
| S18 | Claude Desktop : « commandes Coppola 2026, barriques » | 20 commandes, 183 barriques ; données de test « Test FFC Winery » détectées par le modèle | Outils de découverte annoncent instance et dossier |
| S19 | Claude Desktop : « factures BIOEC > 400 € » | 4 pièces dont 2 avoirs AVF annulant 2 factures ; type de pièce non exposé | Piège documenté dans l'outil ; champ demandé à 4CAD |

Corrections du hub issues de ces tests : parseur de structure au format réel (champs sous `$resources.$item`, libellés
`{@n}`, compagnons `_REF`, blocs dépliés), encodage `%20`, dates `@…@`, tolérance par représentation (404 / 403 / 5xx),
`Accept-Language`, délai max par requête, structure chargée en parallèle, références aplaties en libellé, paramètre `champs`,
descriptions d'outils (colonnes de liste vs fiche, avoirs, enregistrements techniques), annonce de l'instance et du dossier.

Demandes ouvertes (ticket Redmine 4CAD #31562) : publier `SINVOICE`, `GACCENTRY`, `GACCDUDATE` sur CHREC ; exposer le type
de pièce sur PINVOICE et SINVOICE.

## 2026-10-23 · Salesforce sandbox `preprod`

Org `charloisgroup--preprod.sandbox.my.salesforce.com`, serveur MCP hébergé « SObject Reads » de la sandbox, application
cliente externe « MCP Charlois » créée le jour même (PKCE, JWT, secret exigé, étendues `mcp_api` et `refresh_token`).

| # | Test | Résultat | Suite donnée |
|---|---|---|---|
| F1 | Sonde sans jeton du serveur MCP sandbox | 401 « JWT Token is required » ; métadonnées : serveur d'autorisation = sandbox, étendues `mcp_api`, `refresh_token`, PKCE S256 | Conforme au hub |
| F2 | Demande d'autorisation avec la clé consommateur, sans connexion | Redirection vers la page d'autorisation (clé, callback, étendues acceptés) | OK, sans attendre la propagation |
| F3 | Portail « Se connecter » puis « Tester Salesforce » | Vert : 6 outils `find`, `getObjectSchema`, `getRelatedRecords`, `getUserInfo`, `listRecentSobjectRecords`, `soqlQuery` | Noms provisoires du bouchon remplacés par les réels |
| F4 | Claude Desktop : « Qui suis-je ? » | Nom, e-mail, titre DSI Groupe, profil administrateur, locale fr_FR | E-mail du portail via `getUserInfo` |
| F5 | Claude Desktop : « 5 derniers comptes modifiés » | 5 comptes, dont modifications par « Interface X3 » (interface ERP active en préprod) | OK ; SOQL sans WHERE accepté → `LIMIT` par défaut ajouté |
| F6 | Dump complet de `salesforce_tools` | Schémas d'arguments réels (`q`, `objects`, `sobject-name`, `id`, `relationship-path`) | Bouchon et mocks alignés |

## Tests non encore réalisés

| Test | Pourquoi il compte | Prérequis |
|---|---|---|
| Cloisonnement avec un compte **non administrateur** (Sage et Salesforce) | Seule preuve que le hub n'élargit pas les droits | Un compte de test restreint sur chaque système |
| Expiration et renouvellement réels du jeton Salesforce (JWT ~ 2 h, rotation du refresh token) | Vérifié sur le bouchon, pas sur Salesforce | Laisser une session ouverte plus de 2 h puis interroger |
| Révocation : mot de passe Syracuse changé, autorisation Salesforce révoquée | Voyant rouge et message de reconnexion attendus | Action volontaire sur chaque système |
| Salesforce production | Même procédure, org de production, serveurs d'écriture désactivés | Confirmation de l'intégrateur (Xavier, 4CAD) |
| SharePoint, Dropbox | Jamais branchés sur un vrai compte | App Entra ID déléguée ; app Dropbox |
| MyReport | Serveur MCP annoncé par l'éditeur, non livré | Absys Cyborg |
| Restauration sur le serveur de pré-prod (`sudo ops/restore.sh`) | Jouée en CI à chaque commit, pas encore sur un serveur Charlois ; à faire une fois par trimestre (`EXPLOITATION.md` § 5) | Accès au serveur, `ENCRYPTION_KEY` du coffre |
| SSO Entra en mode `entra` | Jamais exercé contre Microsoft, seulement contre le bouchon | URI de redirection sur l'application Entra, `MS_TENANT_ID` en GUID |
| Comparaison croisée Coppola (Sage + Salesforce dans une même réponse, deux lignes Source) | Vérifie la consigne par défaut du serveur MCP | Redéploiement du 23/10 soir |
