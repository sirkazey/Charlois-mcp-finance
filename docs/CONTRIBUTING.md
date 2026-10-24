# Contribuer

Règles de code et de documentation. Le fil conducteur du produit : rester une petite machine qu'un développeur Node lit
en une heure. Pas de framework, pas de base de données, pas de service en plus ; chaque ajout se juge à cette aune.

## 1. Code

* Branches : `dev` (intégration) et `main` (versions validées). Travailler sur une branche dédiée, ouvrir une PR vers
  `dev`, puis `dev` vers `main` ; une version est un tag `vX.Y.Z` sur `main`, jamais déplacé (convention, protection
  `v*` à poser sur GitHub), que les installations déploient
  ([installation § 6](admin/installation.md#6-cycle-de-livraison-et-versions)). Jamais de branche permanente par client.
* Toute correction s'accompagne d'un test de régression (`hub/test/`, `node:test`, aucun réseau). Un connecteur reste
  un module d'environ 50 à 190 lignes ; au-delà, on revoit la copie ([écrire un connecteur](developer/connecteurs.md)).
* La CI doit être verte avant fusion : tests, scénario de sauvegarde et restauration, Semgrep, CodeQL, Gitleaks,
  Trivy, contrôle des liens de la documentation ([tests et analyses](developer/tests.md)).
* Jamais de secret, de jeton, d'identifiant personnel ni de donnée métier dans le code, les tests, les fixtures, les
  issues ou les commits. Les constantes de test sont inventées et listées dans `.gitleaks.toml` avec leur raison.
* Version : `hub/version.js`, `hub/package.json` et `hub/package-lock.json` portent le même numéro, incrémenté à chaque
  livraison, avec une section dans `CHANGELOG.md` (vérifié par `hub/test/release.test.js`).

## 2. Documentation

### Structure et nommage

| Dossier | Public | Ce qu'on y met |
|---|---|---|
| `docs/user/` | collaborateur | ce qu'il fait sur le portail et dans son assistant |
| `docs/admin/` | administrateur | installer, configurer, exploiter, sécuriser |
| `docs/developer/` | développeur | architecture, conventions, connecteurs, tests |
| `docs/validation/` | DSI, recette | ce qui est vérifié, mesuré, et les limites connues |
| `docs/history/` | archives | audits, décisions, feuilles de route datées : figés, jamais réécrits |
| `docs/roadmap-produit.md` | tous | la seule roadmap active : axes, statuts, critères de sortie |

Fichiers en minuscules avec tirets (`guide-utilisateur.md`), un sujet par fichier, pas de fichier de moins de vingt
lignes (on fusionne). Un composant annexe (`clevoa-mcp-stub/`, `clevoa-backend/`, `loadtest/`) garde son `README.md`
à côté de son code. Les seuls fichiers de documentation à la racine sont `README.md`, `CHANGELOG.md`, `LICENSE.md` et `.env.example`.

### Rédaction

* Français clair, phrases courtes, une idée par phrase. Dire ce que le produit fait, pas ce qu'il pourrait faire.
* Chaque document commence par son public et son objet en deux lignes. Les procédures sont numérotées ; les tableaux
  servent à comparer, pas à mettre en forme.
* Exemples reproductibles : commandes complètes, chemins exacts, valeurs fictives reconnaissables (`<PUBLIC_URL>`,
  `<org>`, `MDUPONT`). Une commande non testée est signalée « syntaxe à confirmer ».
* Une seule source de vérité par procédure : les autres documents renvoient par un lien relatif, ils ne recopient pas.
* Liens relatifs uniquement vers les fichiers du dépôt (`../admin/exploitation.md#4-sauvegarde`), vérifiés par la CI.
  Liens absolus réservés aux sites externes.
* Chiffres et versions exacts (nombre de tests, numéro de version, dates) ; les mettre à jour dans la même PR que le
  changement qui les modifie.

### Statut des fonctionnalités

Cinq mots, toujours les mêmes, dans [l'état des fonctionnalités](validation/etat-des-fonctionnalites.md) et partout
où un connecteur est décrit :

| Statut | Signification |
|---|---|
| **disponible** | livré dans la version courante et vérifié sur le système réel |
| **testé sur bouchon** | livré, couvert par les tests automatisés, jamais confronté au vrai système |
| **expérimental** | livré sans garantie, à activer explicitement, peut changer |
| **prévu** | inscrit dans la [roadmap produit](roadmap-produit.md) (« à faire » ou « sur besoin »), non livré ; ne jamais le présenter comme existant |
| **non planifié** | évoqué dans une archive, écarté de la roadmap active ; ne revient qu'avec une nouvelle décision |

### Secrets et données sensibles

Aucun jeton, clé, mot de passe, secret client, identifiant personnel réel (e-mail, nom de compte) ni extrait de donnée métier ; une URL
d'instance n'est citée que si elle est nécessaire à la reproduction d'un test dans la documentation. Les procédures utilisent des valeurs de substitution
entre chevrons. Les comptes rendus de tests citent le rôle (« compte administrateur »), pas la personne, sauf accord
explicite. Les rapports d'analyse de sécurité restent dans les artefacts GitHub.

### Mise à jour dans les PR fonctionnelles

Une PR qui change une variable, une commande, un comportement visible, un chiffre ou une limite met à jour la
documentation concernée dans le même commit, et `CHANGELOG.md`. Une PR qui déplace ou supprime un fichier corrige les
liens qui y menaient : le contrôle `docs` de la CI échoue sinon.

## 3. Contrôle des liens

`node ops/check-docs.js` parcourt tous les fichiers Markdown du dépôt (hors `node_modules`) et échoue si un lien
relatif vise un fichier absent, si une ancre `#…` vise un titre inexistant, ou si un chemin de fichier cité entre
accents graves (`docs/admin/exploitation.md`, `ops/restore.sh`) n'existe plus. Il tourne en CI sur chaque PR.
