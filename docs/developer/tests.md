# Tests et analyses

Tout tourne sans réseau et sans compte réel : mocks amont dans les tests du hub, bouchon d'entreprise pour les tests
de bout en bout, bouchons rapides pour la charge. Aucun outil n'est jamais lancé contre un système réel.

## 1. Suites de tests

| Suite | Commande | Contenu |
|---|---|---|
| Hub, pré-production | `cd hub && npm test` | 93 tests `node:test` (92 exécutés, 1 réservé à la production) : transports MCP, lecture seule, refresh et révocation, cache, OAuth et PKCE, SSO (anonymes, usurpation, cloisonnement des clés), jetons personnels, portail, simulateurs, Graph, proxys MCP, télémétrie (identifiant d'installation, essais bornés, backend en panne), diagnostic exportable (aucune valeur sensible, hub arrêté, mauvaise clé), cohérence de version et image figée (`release.test.js`), boucle de sauvegarde (`backup.test.js`, sans Docker) |
| Hub, verrous de production | `cd hub && APP_ENV=production npm test` | même suite sous `APP_ENV=production` (91 exécutés, 2 réservés à la pré-production) |
| Backend Clevoa | `cd clevoa-backend && npm test` | 15 tests sans AWS : clés client, validation stricte, persistance par installation, séparation des clients, rapport de silence et de version, adaptateur DynamoDB |
| Bouchon, bout en bout | `cd clevoa-mcp-stub && npm test` | 11 tests : le vrai hub branché sur le bouchon, flux OAuth et SSO via les mires, PKCE, droits de Marie et Paul, fichiers, télémétrie |
| Sauvegarde et restauration | `BACKUP_DIR="$PWD/backups" ops/test-backup-restore.sh` (Docker requis, stack `docker-compose.dev.yml` démarrée) | scénarios A–L : sauvegardes successives sans doublon, corruption et perte de `users.json`, sauvegarde invalide, restauration d'anciens et nouveaux noms, incohérence conteneur / volume refusée, sauvegarde manuelle, mauvaise `ENCRYPTION_KEY` |
| Retour arrière | `ops/test-rollback.sh` (Docker requis ; `PREV=vX.Y.Z` pour choisir la version précédente) | courante → précédente → courante sur le même volume, conteneur en lecture seule sans privilèges |
| Charge | `node loadtest/run.js` (≈ 15 min) | 6 scénarios sur bouchons (la référence en HTTP puis en SSE), 50 collaborateurs ([outils](../../loadtest/README.md), [rapport v1.2.1](../validation/charge-v1.2.1.md)) |
| Documentation | `node ops/check-docs.js` | liens relatifs, ancres et chemins de fichiers cités dans tous les Markdown |

Les mocks amont des tests du hub sont dans `hub/test/helpers/upstream.js` (Salesforce, Entra avec PKCE, Graph, Dropbox,
MyReport, Clevoa) ; `hub/test/helpers/hub.js` démarre un hub de test avec un `DATA_DIR` temporaire. Un test suit chaque
correction ([contribuer](../CONTRIBUTING.md)).

Aléa connu : une fois, quatre tests de `docs.test.js` ont échoué en local puis sont repassés dix fois de suite ; non
reproduit depuis. À surveiller en CI.

## 2. Intégration continue

### Workflow `CI` (`.github/workflows/security-static.yml`) : PR, push sur `main` et `dev`, chaque lundi sur `main`, ou manuel

| Job | Outil (version figée) | Ce qu'il vérifie | Bloque |
|---|---|---|---|
| tests | Node 22 | `npm audit` (production, niveau haut) puis les quatre suites ci-dessus (hub pré-prod et production, bouchon, backend Clevoa) | oui |
| backup-restore | Docker Compose, stack pré-prod, `ops/test-backup-restore.sh` | sauvegarde, perte, restauration, mauvaise clé ([exploitation § 4-5](../admin/exploitation.md#4-sauvegarde)) | oui |
| rollback | Docker, `ops/test-rollback.sh` | version courante → version publiée précédente (tag) → courante sur le même volume : démarrage, version, connexions et identifiant d'installation conservés ([exploitation § 10](../admin/exploitation.md#10-mise-à-jour-et-retour-arrière)) | oui |
| docs | Node 22, `ops/check-docs.js` | liens Markdown internes, ancres, fichiers cités supprimés | oui |
| semgrep | `semgrep/semgrep:1.181.1`, règles `p/javascript`, `p/nodejs`, `p/security-audit` | injection, XSS, crypto, Express | oui |
| codeql | `github/codeql-action@v4`, `security-extended` | flux de données JavaScript ; résultats dans Security → Code scanning | selon la configuration du dépôt |
| gitleaks | `ghcr.io/gitleaks/gitleaks:v8.30.1`, `.gitleaks.toml` | secrets dans tout l'historique Git | oui |
| trivy | `aquasecurity/trivy-action@v0.36.0` | dépendances (HIGH, CRITICAL corrigeables), configuration Docker, secrets | oui |
| trivy-image | `aquasecurity/trivy-action@v0.36.0`, `scan-type: image` | image du hub construite : paquets Alpine, Node, dépendances (HIGH, CRITICAL corrigeables) | oui |

Les rapports JSON sont des artefacts de chaque exécution. **Ne pas publier un rapport** hors de GitHub : il cite des
chemins et des extraits du code.

`.gitleaks.toml` met en liste blanche les constantes de test (`hub/test/`), le bouchon (`clevoa-mcp-stub/`), l'exemple
de commande du README Clevoa et l'ancienne clé démo du portail (présente dans l'historique). Ce ne sont pas des
secrets. Toute autre détection doit être traitée, jamais ajoutée à la liste blanche sans justification écrite dans le
fichier et dans le changelog.

### Workflow `Security - ZAP baseline (manual)` : manuel uniquement

Démarre un hub de démonstration sur le runner GitHub (`docker compose up`, simulateurs intégrés, aucun compte réel),
puis `zap-baseline.py` (`ghcr.io/zaproxy/zaproxy:2.16.1`) : exploration **passive**, aucune attaque. Rapport HTML et
JSON en artefacts. Les avertissements ne bloquent pas (`-I`) ; ils se trient à la main. Dernier résultat connu (compte rendu du 23/10/2026, rapport non versionné) : 0 échec, 57 contrôles passés, les avertissements
sur les en-têtes de sécurité ont été corrigés depuis.

**Interdit** : lancer ZAP, ou tout outil d'attaque, contre un système du client ou d'un tiers sans autorisation écrite
et périmètre convenu.

## 3. Lire un résultat d'analyse

1. Un signalement est une hypothèse, pas une vulnérabilité : retrouver le flux de données réel et les droits en amont.
2. Vrai défaut → correction minimale, test de régression, ligne dans `CHANGELOG.md`.
3. Faux positif → `// nosemgrep: <règle> -- <raison>` sur la ligne, ou entrée dans `.gitleaks.toml`, toujours avec la raison.
4. Un CI vert n'est pas un produit sûr : compte restreint sur Sage X3 et Salesforce, révocation OAuth, isolation des
   sessions MCP et justesse des réponses financières restent des tests humains
   ([état des fonctionnalités](../validation/etat-des-fonctionnalites.md)).

Historique des analyses et de leur tri : [audits d'octobre 2026](../history/audit-2026-10.md).
