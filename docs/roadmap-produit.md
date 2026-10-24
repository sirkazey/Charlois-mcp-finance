# Roadmap produit

Roadmap active de Clevoa AI Gateway, à partir de la version 1.3.1 (24 octobre 2026). Elle remplace, pour la suite,
la [feuille de route d'octobre 2026](history/roadmap-2026-10.md), conservée comme archive. L'état réel de ce qui est livré
reste dans [l'état des fonctionnalités](validation/etat-des-fonctionnalites.md). Les décisions qui fondent cette roadmap
sont consignées dans [les décisions](history/decisions.md).

Public : Clevoa (produit), DSI et référents métier du client, et les sessions de développement qui implémentent les
incréments. Chaque incrément ci-dessous se lit comme un cahier des charges : périmètre, hors périmètre, critères de sortie.

## 1. Vision

Clevoa AI Gateway évolue d'une passerelle d'accès aux données vers une plateforme qui permet à une entreprise de
**capitaliser, gouverner et partager les compétences métier** de ses collaborateurs entre plusieurs assistants IA.

Une compétence est une méthode de travail écrite : comment contrôler une facture fournisseur, préparer une revue de
pipeline, rapprocher deux sources. L'assistant IA aide l'expert à la formaliser ; le Gateway la stocke, la fait valider
par un responsable métier, puis la met à disposition de tous les assistants autorisés. Les données restent lues avec
les droits de chaque collaborateur, comme aujourd'hui.

### Décisions actées

| Décision | Conséquence pour le développement |
|---|---|
| Clevoa AI Gateway reste le produit unique | Les compétences sont un module du hub existant, pas une application séparée. Pas de « Clevoa Studio » |
| Pas de chatbot, de moteur LLM ni d'orchestrateur d'agents | Le Gateway ne converse avec personne et n'appelle aucun modèle : ce sont les assistants des collaborateurs qui mènent les entretiens |
| Les assistants IA conduisent la formalisation | Le Gateway fournit une compétence de rédaction guidée (P3) et reçoit le résultat ; il ne pilote pas l'entretien |
| Le Gateway stocke, organise, versionne, valide et distribue | Registre central (P0), exposition (P1), gouvernance (P2) |
| Standard Agent Skills (SKILL.md) | Format portable ; les données de gouvernance (statut, validateur, historique) restent dans le registre, hors du fichier |
| Indépendance vis-à-vis d'un assistant | Aucune fonction ne doit dépendre d'un comportement propre à Claude ; export standard (P4) |
| MCP comme principal mécanisme d'accès | Exposition par des outils MCP (P1), compris par tous les clients MCP |
| Consultation explicite ≠ chargement automatique | Un outil MCP renvoie le texte d'une compétence quand l'assistant le demande. Le chargement automatique dépend du client et n'est jamais supposé : il n'est déclaré supporté qu'après un test réel (P4) |
| Une compétence ne donne aucun droit sur les données | L'accès aux systèmes reste celui des jetons personnels du collaborateur ; une compétence n'est que du texte |
| Calculs métier critiques déterministes et vérifiables | Fonctions dédiées seulement quand un cas réel le justifie (P5) ; jamais un calcul critique laissé au seul modèle |

### Principes de mise en œuvre

* Simplicité et réutilisation d'abord : même conteneur, même chiffrement, même sauvegarde, même portail, mêmes tests.
  Pas de base de données, de framework ni de dépendance tant qu'un besoin mesuré ne l'impose pas.
* Les connecteurs existants ne sont pas modifiés par ce chantier.
* Lecture seule sur les systèmes métier, inchangée. Le registre est le seul endroit où le Gateway écrit, et il n'écrit
  que ses propres données.
* Chaque incrément livre sa documentation et ses tests en même temps que son code (section 4).
* La validation des règles métier reste humaine. Le Gateway trace qui a validé quoi, il ne valide rien lui-même.

## 2. Où en est le produit

Trois statuts dans ce document. Ils correspondent à ceux des [conventions](CONTRIBUTING.md#statut-des-fonctionnalités) :
« existant » regroupe **disponible** et **testé sur bouchon**, « envisagé » correspond à **prévu**.

| Statut | Périmètre |
|---|---|
| **Existant** | Passerelle MCP en lecture seule vers Salesforce, Sage X3, SharePoint / OneDrive, Dropbox et MyReport avec les droits de chaque collaborateur ; portail (connexion, test, configuration de l'assistant, exemples de questions) ; SSO Microsoft Entra ID ; sauvegarde et restauration ; télémétrie de licence. Niveau de preuve par fonction : [état des fonctionnalités](validation/etat-des-fonctionnalites.md) |
| **En cours** | Cadrage du chantier « compétences » : cette roadmap. Aucun code de compétence n'existe encore |
| **Envisagé** | Incréments P0 à P5 ci-dessous, conduite du changement (section 5) |

### Prérequis hérités du socle

Ces points ne sont pas des développements « compétences », mais ils conditionnent leur mise en service. Le détail et
les preuves restent dans [l'état des fonctionnalités](validation/etat-des-fonctionnalites.md#3-tests-restant-à-réaliser).

| Prérequis | Pourquoi il compte ici | Bloque |
|---|---|---|
| SSO Entra ID activé sur un vrai locataire | Auteur, validateur et responsable doivent être identifiés de façon fiable pour qu'un auteur ne valide pas sa propre compétence | P2 |
| Test de cloisonnement avec un compte non administrateur | Une compétence s'exécute avec les droits du collaborateur : il faut avoir prouvé que ces droits sont respectés | pilote (section 5) |
| Publication des représentations Sage X3 demandées à l'intégrateur (type de pièce, échéances) | Le premier cas métier (contrôle des factures fournisseurs) en dépend | P3, partiellement |
| Revue du portail refondu sur la préproduction réelle | Les pages de gouvernance s'ajoutent à ce portail | P2 |

## 3. Roadmap priorisée

Ordre de réalisation : P0, P1, P2 et P3 en séquence ; P4 dès que P1 est livré ; P5 seulement à la demande d'un cas
métier. Chaque incrément est livrable et utile seul.

### P0 — Registre central des compétences

**Objectif.** Le Gateway sait conserver des compétences, avec leurs métadonnées, leurs versions et leur statut, de façon
sûre et sauvegardée. Rien n'est encore visible des collaborateurs.

**Périmètre**

* Stockage du texte SKILL.md de chaque compétence, contrôlé selon la
  [spécification Agent Skills](https://agentskills.io/specification) (consultée le 24 octobre 2026) : en-tête YAML avec
  `name` (1 à 64 caractères, minuscules, chiffres et tirets, ni tiret initial, final ou double) et `description`
  (1 à 1 024 caractères) obligatoires ; `license`, `compatibility`, `metadata` (table de chaînes) acceptés.
  `allowed-tools`, expérimental dans la spécification, est conservé tel quel mais n'a aucun effet dans le Gateway.
* Fiche de registre, hors du SKILL.md : identifiant (= `name`), titre, description, domaine, thème, équipe, auteur,
  responsable métier, statut, dates.
* Statuts et transitions : `brouillon` → `soumis` → `validé` → `archivé` ; `soumis` → `brouillon` (refus, avec motif).
  Toute autre transition est refusée.
* Versionnement : chaque révision crée une version numérotée, immuable ; les versions antérieures restent lisibles.
  Une seule version `validé` est active à la fois.
* Historique : chaque création, révision et changement de statut est tracé (date, identité, action, motif).
* Stockage simple : un fichier `skills.json` dans le volume de données (`DATA_DIR`), chiffré et écrit de façon atomique
  avec le mécanisme existant de `users.json`, compris par la sauvegarde automatique et la restauration.

**Hors périmètre** : outils MCP, pages du portail, rôles, recherche plein texte, import ou export de dossiers
Agent Skills, fichiers annexes (`scripts/`, `references/`, `assets/`).

**Critères de sortie**

1. Module du hub couvert par des tests (`node:test`, sans réseau) : règles de nommage de la spécification, transitions
   permises et refusées, numérotation des versions, historique, relecture après redémarrage.
2. Aucun texte de compétence en clair sur le disque ; un fichier corrompu ou une mauvaise clé empêchent le démarrage avec
   un message explicite, comme pour `users.json`.
3. Sauvegarde automatique, sauvegarde manuelle et restauration étendues au registre et prouvées par les tests existants
   (`hub/test/backup.test.js`, `ops/test-backup-restore.sh`).
4. Aucune dépendance ajoutée ; analyses de sécurité de la CI au vert ; budget indicatif : moins de 200 lignes de code
   applicatif.
5. Documentation développeur (format, statuts, stockage) et administrateur (sauvegarde du registre) à jour ; décision de
   stockage consignée dans [les décisions](history/decisions.md).

### P1 — Exposition des compétences aux assistants

**Objectif.** Un assistant connecté au Gateway peut trouver une compétence validée, la lire et proposer une nouvelle
compétence ou une révision.

**Périmètre**

* Trois outils MCP : lister les compétences accessibles (titre, description, domaine, version), consulter une compétence
  (texte complet de la version validée, ou d'une version donnée), soumettre une compétence ou une révision (crée un
  `brouillon` ou passe en `soumis`).
* Consultation **explicite** : l'assistant appelle l'outil et reçoit le texte. Les instructions du serveur MCP disent aux
  assistants quand chercher une compétence. Aucun chargement automatique n'est supposé.
* Trois permissions distinctes : consulter, contribuer, valider. Par défaut, tout collaborateur identifié consulte les
  compétences validées ; seuls auteur et validateurs voient les brouillons et les versions soumises.
* Les outils de lecture sont annotés lecture seule ; l'outil de soumission ne l'est pas et le dit dans sa description.
* Compteurs agrégés de consultation par compétence, sans identité, pour la mesure (section 5).

**Hors périmètre** : validation par outil MCP (réservée au portail en P2), primitives MCP « prompts » ou « resources »
tant que leur prise en charge par les clients cibles n'est pas vérifiée.

**Critères de sortie**

1. Tests : un collaborateur ne voit jamais un brouillon d'un autre ; une soumission sans permission « contribuer » est
   refusée ; les droits sur les données d'un collaborateur sont identiques avec ou sans compétence chargée.
2. Test réel avec Claude Code et Claude Desktop sur la préproduction : lister, consulter, soumettre. Résultat consigné
   dans le [journal des tests réels](validation/journal-tests-reels.md). Les autres assistants restent « non vérifiés ».
3. Guide « J'utilise une compétence » (section 4) avec une première compétence de démonstration validée.

### P2 — Gouvernance dans le portail

**Objectif.** Les responsables métier valident, publient et archivent les compétences depuis le portail existant.

**Périmètre**, ajouté progressivement au portail :

* Bibliothèque des compétences avec recherche et filtres par domaine, thème et équipe.
* Fiche d'une compétence : texte, versions et différences entre versions, historique des décisions.
* Validation ou refus motivé par un responsable métier ; publication ; archivage.
* Règle : **un auteur ne peut pas approuver sa propre compétence**, y compris pour une révision qu'il a soumise.
* Affectation des rôles (contributeur, validateur par domaine) par l'administrateur, sur la base de l'identité SSO.

**Critères de sortie**

1. Tests : auto-approbation refusée ; refus sans motif refusé ; chaque décision tracée avec identité et date ; une
   compétence archivée n'est plus listée par les assistants.
2. Parcours validés dans un navigateur réel avec contrôle d'accessibilité, comme pour la refonte du portail
   ([compte rendu v1.3.1](validation/portail-v1.3.1.md)).
3. Guide « Je valide et je diffuse » avec captures réelles.

### P3 — Formalisation guidée des méthodes métier

**Objectif.** Un collaborateur non technique transmet sa méthode à son assistant IA, qui en tire une compétence prête à
être soumise.

**Périmètre**

* Une compétence de rédaction guidée, elle-même stockée dans le registre. Elle demande à l'assistant de questionner
  l'utilisateur pas à pas : objectif, sources de données, définitions, règles, exceptions, contrôles, résultat attendu.
* À la fin de l'entretien, l'assistant produit un SKILL.md structuré, liste explicitement les hypothèses non confirmées
  et propose **trois scénarios de validation** (entrée, résultat attendu, point de contrôle), puis soumet via P1.
* **Premier cas métier : contrôle des factures fournisseurs Sage X3**, construit avec un comptable fournisseurs et
  limité aux données réellement disponibles, telles que relevées en préproduction :
  - la liste `PINVOICE` ne renvoie que ses colonnes de liste ; le détail impose une lecture de fiche par facture ;
  - le type de pièce (facture ou avoir) n'est pas exposé : seul le numéro (`FAF` / `AVF`) le distingue, et les montants
    ne sont pas signés ;
  - le statut de règlement n'est pas exposé tant que les échéances (`GACCDUDATE`) ne sont pas publiées.

  Aucune règle comptable n'est inventée : chaque règle vient de l'expert et porte sa source ; ce que les données ne
  permettent pas de vérifier est écrit comme tel dans la compétence.

**Critères de sortie**

1. Un expert métier réel a formalisé le cas, sans aide technique, en suivant le guide « Je transmets ma méthode ».
2. Les trois scénarios de validation passent sur la préproduction, avec un résultat vérifié à la main par l'expert.
3. La compétence est validée par un responsable métier distinct de l'auteur (P2).

### P4 — Portabilité entre assistants

**Objectif.** Une compétence validée peut servir hors du Gateway, dans les assistants qui chargent nativement des
compétences, et la documentation dit précisément ce qui marche avec quel assistant.

**Périmètre**

* Export d'une compétence validée au format de dossier Agent Skills (`<name>/SKILL.md`). Les données de gouvernance
  utiles sont exportées dans `metadata` avec des clés préfixées, par exemple `clevoa-version` ou `clevoa-domaine`.
* Documentation de consommation par assistant : Claude Code, Claude Desktop, puis les autres assistants compatibles.
* Pour chaque assistant, deux modes décrits séparément : consultation via le Gateway (P1) et chargement natif de
  l'export.

**Critères de sortie**

1. Export vérifié par l'outil de validation de référence de la spécification (`skills-ref validate`), exécuté hors du
   dépôt, sans dépendance ajoutée.
2. Chaque mode d'intégration a été **testé réellement** avant d'être déclaré supporté ; tout le reste est marqué
   « non vérifié » dans [l'état des fonctionnalités](validation/etat-des-fonctionnalites.md).
3. Une compétence exportée puis réimportée reste identique (aller-retour testé).

### P5 — Fonctions métier déterministes

**Objectif.** Quand une compétence repose sur un calcul critique (agrégat, rapprochement, contrôle de cohérence), ce
calcul est fait par une fonction vérifiable du Gateway, pas par le modèle.

**Règles**

* Uniquement sur un cas métier réel qui le justifie, documenté et validé (P3) ; jamais par anticipation.
* Une fonction par besoin, avec ses cas de test fournis par l'expert ; pas de moteur de calcul générique.
* Même cloisonnement que les outils actuels : lecture avec les droits du collaborateur, résultat assorti de sa source.

**Critères de sortie** : résultats identiques aux cas de référence de l'expert ; la compétence concernée appelle la
fonction et ne recalcule pas elle-même ; documentation des limites (périmètre, arrondis, devises, dates).

### Hors priorités actuelles

Les évolutions du [catalogue d'octobre 2026](history/roadmap-2026-10.md#2-catalogue-des-évolutions-possibles-optionnel-roadmap-clevoa)
(santé des connecteurs, nouveaux connecteurs documentaires, tableau de bord des installations, connecteurs MCP
déclaratifs) et le mini-portail d'administration restent envisagés mais ne sont pas planifiés. Ils ne sont repris que
sur un besoin client explicite.

## 4. Documentation utilisateur

La documentation fait partie de chaque incrément. Un incrément sans sa documentation n'est pas terminé.

### Trois parcours distincts

| Parcours | Public | Contenu | Emplacement prévu |
|---|---|---|---|
| « J'utilise une compétence » | collaborateur | se connecter, trouver une compétence, exemples de questions, lire le résultat et ses sources, limites, erreurs courantes | `docs/user/` |
| « Je transmets ma méthode » | expert métier | entretien guidé avec l'assistant, rédaction, description des exceptions, tests, corrections, soumission, suivi de la validation | `docs/user/` |
| « Je valide et je diffuse » | responsable métier, administrateur | contrôle de qualité, approbation ou refus, organisation par domaine, habilitations, publication, versions, archivage | `docs/admin/` |

### Définition de terminé, pour chaque fonctionnalité livrée

1. Un guide en français clair, avec des étapes numérotées.
2. Des captures d'écran réelles dès qu'une interface existe ; aucune donnée sensible visible.
3. Au moins un exemple métier reproductible, avec une demande prête à copier.
4. Le résultat attendu et les points de vérification.
5. Les limites et les erreurs possibles, avec quoi faire.
6. Un scénario de démonstration de dix minutes.
7. La documentation administrateur quand l'incrément change l'installation, les habilitations, la sauvegarde ou la
   sécurité.

### Règles de rédaction des parcours utilisateurs

* Écrire pour un collaborateur sans connaissances techniques : « compétence », « assistant », « portail », « valider ».
* Ne pas employer sans nécessité les termes MCP, OAuth, SKILL.md ou API dans les parcours collaborateur et expert ;
  ils restent dans la documentation développeur et administrateur.
* Les autres conventions (structure, statuts, liens, secrets) sont celles de [CONTRIBUTING](CONTRIBUTING.md).

## 5. Conduite du changement

Chantier transverse, mené avec le client. Le Gateway fournit l'outil ; l'adoption repose sur des personnes.

| Étape | Contenu | Résultat attendu |
|---|---|---|
| Cadrage | Identifier le sponsor, les référents métier et deux ou trois cas d'usage prioritaires ; fixer les cas de référence de chaque cas | Liste des cas d'usage et de leurs référents, validée par le sponsor |
| Co-construction | Ateliers de formalisation des méthodes avec les experts, à partir de la rédaction guidée (P3) | Premières compétences soumises, rédigées par les experts eux-mêmes |
| Pilote | Petit groupe d'utilisateurs, usage réel observé (ce qui est utilisé, où l'on bloque, ce qui est faux) | Compte rendu du pilote, corrections, décision d'étendre ou non |
| Formation | Guides, démonstrations de dix minutes, exercices pratiques, un référent métier par équipe | Collaborateurs autonomes sur le parcours « J'utilise une compétence » |
| Déploiement | Généralisation progressive, une équipe après l'autre | Chaque équipe démarre avec ses compétences validées et son référent |
| Mesure | Suivi régulier des indicateurs ci-dessous, revue avec le sponsor | Décisions d'amélioration fondées sur des constats |

### Indicateurs

| Indicateur | Mesure | Source |
|---|---|---|
| Collaborateurs actifs | nombre de collaborateurs ayant utilisé le Gateway sur la période | le compteur de sièges existant ne compte que les collaborateurs ayant connecté un outil ; un compteur agrégé d'utilisateurs actifs est à ajouter avec P1 |
| Compétences validées | nombre de compétences au statut `validé` | registre (P0) |
| Compétences effectivement utilisées | compétences consultées au moins une fois sur la période | compteurs agrégés de consultation (P1), sans identité |
| Réussite des cas de référence | part des scénarios de validation qui donnent le résultat attendu | scénarios de P3, rejoués à chaque nouvelle version |
| Erreurs rencontrées | erreurs signalées par les utilisateurs et les référents, par compétence | retours du pilote et des référents |
| Temps gagné vérifié | temps mesuré avant et après sur une tâche de référence, constaté avec l'expert, jamais estimé | mesures du pilote |

Les mesures restent agrégées. Tout suivi nominatif de l'usage doit d'abord être validé avec le client et son DPO.

**La responsabilité de la validation des règles métier reste humaine** : le responsable métier qui valide une compétence
en répond, et le Gateway en garde la trace.

## 6. Première tâche de développement : P0.1

**Titre** : module « registre des compétences » du hub, stockage chiffré, sans exposition.

**À faire**

1. Extraire le chiffrement de `hub/store.js` (`encrypt`, `decrypt`, écriture atomique) dans un petit module partagé,
   sans changer le format `enc1:` ni le comportement de `users.json`. Les tests existants doivent passer sans
   modification.
2. Créer le module hub/skills.js (à créer) :
   * lecture de l'en-tête YAML d'un SKILL.md limitée aux champs de la spécification (paires `clé: valeur` et table
     `metadata` à un niveau), **sans dépendance YAML** ; tout en-tête hors de ce sous-ensemble est refusé avec un
     message clair ;
   * contrôle des règles de `name` et `description` de la spécification ;
   * fiches de registre (identifiant, titre, description, domaine, thème, équipe, auteur, responsable métier, statut,
     dates), versions numérotées immuables, historique des actions ;
   * transitions de statut de P0, toute autre transition refusée ;
   * persistance dans un fichier skills.json du volume de données (`DATA_DIR`), chiffré, écrit de façon atomique ; refus de démarrer sur un fichier
     illisible, comme `users.json`.
3. Créer les tests hub/test/skills.test.js (à créer) : nommage valide et invalide (exemples de la spécification), description vide ou
   trop longue, en-tête hors sous-ensemble refusé, création, révision, numérotation, transitions permises et refusées,
   historique, relecture après redémarrage, absence de texte en clair sur le disque.
4. Ne rien brancher encore : ni outil MCP, ni route HTTP, ni page de portail.

**Ne pas faire** : modifier un connecteur, les workflows de CI, la licence ; ajouter une dépendance ; créer une base de
données ; exposer quoi que ce soit aux assistants.

**Terminé quand** : la suite du hub passe en préproduction et en production, CI verte, et une note développeur décrit
le format, les statuts et le stockage. La tâche suivante, **P0.2**, étend la sauvegarde automatique, la sauvegarde
manuelle, la restauration et leurs tests à `skills.json`.

**Point à confirmer avant P0.1** : le chiffrement du registre. Il est recommandé ici pour garder une règle unique
(« rien en clair sur le disque ») et réutiliser la vérification `enc1:` de la sauvegarde. L'alternative est un fichier
lisible, plus simple à inspecter, mais qui exposerait les méthodes métier dans le volume et dans les sauvegardes.
