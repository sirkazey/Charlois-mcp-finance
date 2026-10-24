# Stabilisation d'octobre 2026

Public : direction technique Clevoa, DSI cliente. Objet : compte rendu de la mission de stabilisation qui clôt le
développement fonctionnel initial (gel à la 1.3.1) : lots réalisés, revues indépendantes, résultats des tests, limites.
Ce document sert aussi de journal de progression tant que la mission est en cours.

## Journal de progression

| Lot | Objet | État | Revue |
|---|---|---|---|
| 1 | Audit et nettoyage documentaire | en revue | — |
| 2 | Télémétrie éditeur | à faire | — |
| 3 | Diagnostic et support | à faire | — |
| 4 | Releases et mises à jour contrôlées | à faire | — |
| 5 | Compatibilité MCP et sécurité | à faire | — |
| 6 | Qualification finale et livraison | à faire | — |

Branche de travail : `maintenance/stabilisation-2026-10`, créée depuis `main` (`affa329`, v1.3.1).

## Lot 1 — Audit et nettoyage documentaire

Inventaire (24/10/2026) :

* Branches distantes : `main` et `dev` (toutes deux sur `affa329`, v1.3.1), `docs/roadmap-skills-adoption-2026-10`
  (roadmap Skills abandonnée, archive non fusionnée). Tags : `v1.2.0`, `v1.2.1`, `v1.3.0`, `v1.3.1` ; `v1.1.0` absent.
* Roadmaps : une seule sur `main`, l'archive [`roadmap-2026-10.md`](../history/roadmap-2026-10.md), dont le § 2
  (catalogue d'évolutions) servait de référence aux lignes « prévu » de l'état des fonctionnalités. Aucune mention des
  Skills sur `main` : la roadmap Skills n'existe que sur sa branche.
* Contradictions relevées : lignes « prévu » (mini-portail d'administration, tableau de bord, connecteurs
  déclaratifs) contraires au gel ; § 8 de l'exploitation annonçant un mini-portail ; cycle de livraison
  « `main` → production automatique » contraire à la stratégie de versions figées (traité au lot 4).
* Composants : hub (Node 22, 3 dépendances), bouchon `clevoa-mcp-stub`, backend Lambda `clevoa-backend` (journalisation
  seule, sans persistance), outils de charge, scripts `ops/`, CI unique (tests, docs, sauvegarde et restauration,
  Semgrep, CodeQL, Gitleaks, Trivy) et DAST.

Travaux :

* [`docs/roadmap-produit.md`](../roadmap-produit.md) : seule roadmap active, trois axes, statuts et critères de sortie,
  liste « hors roadmap ».
* Quatre décisions datées dans [`decisions.md`](../history/decisions.md) : gel 1.3.1, abandon du registre Skills,
  stratégie de maintenance, stratégie de versions multi-client.
* Nouveau statut « non planifié » ([conventions](../CONTRIBUTING.md#statut-des-fonctionnalités)) appliqué aux pistes
  écartées ; renvois mis à jour dans `README.md`, `docs/README.md`, l'exploitation et l'archive (note en tête, contenu
  inchangé).

Contrôles : `node ops/check-docs.js` réussi ; `npm test` du hub : 78 tests, 77 réussis, 1 ignoré (verrou de production,
exécuté par le job CI `APP_ENV=production`).
