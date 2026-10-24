# Documentation Clevoa AI Gateway

Un dossier par public. Chaque procédure a une seule source de vérité ; les autres documents y renvoient.

| Dossier | Public | Contenu |
|---|---|---|
| [`user/`](user/guide-utilisateur.md) | collaborateur | portail, connexion aux outils, configuration des assistants, lecture des réponses, problèmes courants |
| [`admin/`](admin/installation.md) | administrateur | [installation](admin/installation.md), [configuration des connecteurs](admin/configuration.md), [SSO Entra ID](admin/sso-entra.md), [exploitation, sauvegarde, restauration, nginx, pannes](admin/exploitation.md), [sécurité](admin/securite.md) |
| [`developer/`](developer/architecture.md) | développeur | [architecture](developer/architecture.md), [écrire un connecteur](developer/connecteurs.md), [tests et analyses](developer/tests.md), [contribuer](CONTRIBUTING.md) |
| [`validation/`](validation/etat-des-fonctionnalites.md) | DSI, recette | [état des fonctionnalités et limites](validation/etat-des-fonctionnalites.md), [journal des tests réels](validation/journal-tests-reels.md), [campagne de charge v1.2.1](validation/charge-v1.2.1.md) |
| [`history/`](history/audit-2026-10.md) | archives | [audits d'octobre 2026](history/audit-2026-10.md), [décisions](history/decisions.md), [feuille de route d'octobre 2026](history/roadmap-2026-10.md) ; comptes rendus figés, jamais des instructions à jour |

À la racine du dépôt : [`README.md`](../README.md) (présentation), [`CHANGELOG.md`](../CHANGELOG.md) (versions),
[`LICENSE.md`](../LICENSE.md) (licence propriétaire), [`.env.example`](../.env.example) (toutes les variables, commentées).
Composants annexes documentés à côté de leur code : [bouchon d'entreprise](../charlois-mcp-stub/README.md),
[backend de télémétrie](../clevoa-backend/README.md), [outils de charge](../loadtest/README.md).

Conventions de rédaction et contrôle des liens : [`CONTRIBUTING.md`](CONTRIBUTING.md).
