# Licence du logiciel Clevoa AI Gateway

**Logiciel propriétaire. Ce dépôt n'est pas placé sous licence open source.**

Version du texte : 1.0, 24 octobre 2026. Ce texte n'a pas encore été relu par un conseil juridique : les points qui
appellent une validation sont listés à l'article 11. Il ne constitue pas un contrat à lui seul ; il rappelle le régime
de propriété du logiciel et renvoie aux contrats qui définissent les droits de chaque client.

## 1. Définitions

* **Éditeur** : Clevoa, société par actions simplifiée unipersonnelle (SASU) de droit français. Ses coordonnées légales
  figurent dans les contrats conclus avec chaque client.
* **Logiciel** : le programme « Clevoa AI Gateway » (hub MCP, portail web, connecteurs, scripts d'exploitation,
  bouchon d'entreprise, backend de télémétrie, outils de test) et sa documentation, tels que contenus dans ce dépôt,
  dans ses versions successives, à l'exclusion des Composants tiers.
* **Composants tiers** : les bibliothèques, images et outils développés par des tiers et utilisés par le Logiciel,
  listés à l'article 8, chacun soumis à sa propre licence.
* **Client** : toute personne morale ayant conclu avec l'Éditeur un contrat, une commande ou des conditions
  particulières portant sur le Logiciel.
* **Contrat** : le document signé ou accepté entre l'Éditeur et le Client qui définit les droits d'utilisation
  concédés, leur durée, leur étendue et leur prix.

## 2. Titularité

Le Logiciel est une œuvre protégée par le Code de la propriété intellectuelle (articles L. 112-2 13° et L. 122-6 et
suivants). L'Éditeur revendique la titularité des droits patrimoniaux sur les composants propriétaires du Logiciel,
sous réserve des droits des tiers sur les Composants tiers et des engagements contractuels préexistants qui en
disposeraient autrement.

La présence du Logiciel dans un dépôt GitHub, public ou privé, et le nom de ce dépôt n'emportent aucune cession ni
concession de droits. La chaîne de titularité (contributions, prestations, contexte de réalisation) relève d'une
vérification contractuelle et non de l'historique Git (voir article 11).

## 3. Absence de licence open source

Aucune licence open source, libre ou « source disponible » n'est accordée sur le code propriétaire du Logiciel. La
consultation du code source dans ce dépôt ne confère aucun droit d'utilisation, de copie, de modification ni de
diffusion en dehors de ceux expressément prévus par un Contrat.

## 4. Droits du Client

Le Client bénéficie uniquement des droits d'utilisation définis dans son Contrat : nombre d'instances ou
d'environnements, nombre de sièges, durée, périmètre fonctionnel, conditions de maintenance et de support.

Sauf stipulation contraire du Contrat, le Client est autorisé à :

* installer et exécuter le Logiciel pour ses besoins internes, dans les environnements prévus au Contrat ;
* réaliser les copies de sauvegarde nécessaires à son exploitation ;
* adapter la configuration (variables d'environnement, fichiers Compose, reverse proxy) sans modifier le code du
  Logiciel ;
* exercer les droits que la loi lui reconnaît sans possibilité d'y renoncer (article L. 122-6-1 du Code de la propriété
  intellectuelle : correction d'erreurs dans les conditions prévues au Contrat, copie de sauvegarde, observation et
  étude du fonctionnement, décompilation aux seules fins d'interopérabilité et dans les limites légales).

## 5. Restrictions

Sans autorisation écrite préalable de l'Éditeur, le Client s'interdit de :

* redistribuer, vendre, louer, prêter, sous-licencier ou mettre le Logiciel à la disposition de tiers, y compris en
  mode hébergé ou en tant que service, en dehors de ses propres collaborateurs et prestataires agissant pour son compte
  dans le cadre du Contrat ;
* publier tout ou partie du code source ou de la documentation sur un dépôt, un site ou un support accessible à des
  tiers ;
* supprimer ou modifier les mentions de propriété, de version et de licence ;
* utiliser le Logiciel au-delà du périmètre, de la durée ou du nombre de sièges définis au Contrat.

## 6. Prestations et propriété intellectuelle

Une prestation de configuration, d'intégration, de paramétrage, d'accompagnement ou de développement réalisée par
l'Éditeur pour un Client n'emporte pas, par elle-même, cession de propriété intellectuelle sur le Logiciel ni sur les
développements réalisés, conformément à l'article L. 131-3 du Code de la propriété intellectuelle qui exige une
cession expresse et délimitée.

Toute cession éventuelle de droits, totale ou partielle, doit être négociée et formalisée par un acte distinct précisant
les droits cédés, leur étendue, leur destination, leur territoire et leur durée. En l'absence d'un tel acte, le Client
dispose d'un droit d'utilisation et non d'un droit de propriété.

Les données du Client, ses paramétrages propres (listes de représentations, sites, listes blanches d'outils) et les
contenus de ses systèmes métier restent la propriété du Client.

## 7. Conditions commerciales

Les conditions commerciales, le prix, le nombre de sièges, la durée, la maintenance, le support, les niveaux de service
(SLA), les exclusions et les responsabilités respectives relèvent exclusivement du Contrat et de ses annexes. Ce texte
ne crée aucun engagement de niveau de service.

## 8. Composants tiers

Le Logiciel utilise des Composants tiers qui conservent leurs licences respectives. Leur usage dans le Logiciel ne les
place pas sous la présente licence, et la présente licence ne restreint pas les droits que ces licences accordent sur
ces composants pris isolément.

| Composant | Rôle | Licence (à la date du texte) |
|---|---|---|
| `@modelcontextprotocol/sdk` et ses dépendances | protocole MCP | MIT et dépendances MIT, ISC, BSD-2-Clause, BSD-3-Clause |
| `express` et ses dépendances | serveur HTTP | MIT et dépendances MIT, ISC, BSD |
| `zod` | validation des schémas | MIT |
| Node.js (image `node:22-alpine`) | exécution | licence Node.js (type MIT) et licences des composants Alpine Linux |
| nginx (image `nginx:1.28-alpine`) | reverse proxy optionnel | BSD-2-Clause |
| `mcp-remote` (exécuté sur le poste du collaborateur via `npx`, non distribué dans le dépôt) | pont pour Claude Desktop | à vérifier sur le registre npm |
| Outils d'analyse exécutés en intégration continue (Semgrep, CodeQL, Gitleaks, Trivy, ZAP) | contrôle qualité, non distribués | licences propres à chaque outil, soumises à leurs conditions d'usage |

Inventaire effectué le 24 octobre 2026 sur les dépendances de production de `hub/package-lock.json` (91 paquets : MIT,
ISC, BSD-2-Clause, BSD-3-Clause ; aucune licence copyleft). Le bouchon d'entreprise utilise les mêmes bibliothèques ; le
backend de télémétrie n'a aucune dépendance. Les fichiers `package-lock.json` font foi pour les versions exactes.

## 9. Garantie et responsabilité

Le Logiciel est fourni dans les conditions de garantie et de responsabilité définies au Contrat. En l'absence de
stipulation contractuelle, il est fourni en l'état, sans garantie autre que celles d'ordre public. Le Logiciel transmet
aux assistants IA des données issues des systèmes du Client avec les droits de chaque utilisateur ; l'usage qui en est
fait par les assistants et par les utilisateurs relève de la responsabilité du Client.

## 10. Droit applicable

Le présent texte et les Contrats auxquels il renvoie sont régis par le droit français. Tout litige relève des
juridictions compétentes désignées au Contrat ou, à défaut, des juridictions françaises compétentes.

## 11. Points à valider par un conseil juridique

Ce texte a été rédigé par l'équipe produit, sans revue juridique. Avant toute utilisation contractuelle :

1. **Chaîne de titularité** : vérifier, au regard des contrats de prestation conclus avec le Groupe Charlois et des
   contributions individuelles, que l'Éditeur détient bien l'intégralité des droits patrimoniaux sur les composants
   propriétaires, et formaliser ce qui doit l'être. Un dépôt GitHub ne prouve rien à cet égard.
2. **Mentions légales de l'Éditeur** (dénomination exacte, siège, immatriculation) : à insérer depuis les documents
   officiels de la société, volontairement absentes de ce texte pour ne rien inventer.
3. **Articulation avec les contrats existants** : s'assurer que ce texte ne contredit pas une clause de propriété
   intellectuelle ou de cession déjà signée avec un client.
4. **Droits impératifs de l'utilisateur** (article 4, dernier point) : vérifier la rédaction au regard de
   l'article L. 122-6-1 du Code de la propriété intellectuelle.
5. **Clause de garantie et de responsabilité** (article 9) : à aligner sur les conditions générales de l'Éditeur.
6. **Composants tiers** : confirmer la licence de `mcp-remote` et des images de base, et décider si une liste
   complète des licences doit être livrée au Client avec chaque version.
7. **Télémétrie et données personnelles** : le Logiciel envoie des compteurs d'usage à l'Éditeur
   ([sécurité](docs/admin/securite.md)) ; vérifier l'information à donner au Client et aux utilisateurs.

Aucun mécanisme technique de contrôle de licence n'est mis en œuvre par ce texte ; la télémétrie existante ne bloque
jamais le fonctionnement du Logiciel.
