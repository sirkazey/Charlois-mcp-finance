# Analyses de sécurité — Charlois AI Gateway

Deux workflows GitHub Actions, aucun ne touche un système réel.

## `Security - static analysis` (automatique : PR, push sur `main` et `dev`, ou manuel)

| Job | Outil (version figée) | Ce qu'il vérifie | Bloque le CI |
|---|---|---|---|
| tests | Node 22 | 63 tests du hub (pré-prod puis verrous de production), 9 tests de bout en bout hub ↔ bouchon | oui |
| semgrep | `semgrep/semgrep:1.181.1`, règles `p/javascript`, `p/nodejs`, `p/security-audit` | injection, XSS, crypto, Express | oui |
| codeql | `github/codeql-action@v4`, `security-extended` | flux de données JavaScript ; résultats dans l'onglet Security → Code scanning | selon la configuration du dépôt |
| gitleaks | `ghcr.io/gitleaks/gitleaks:v8.30.1`, config `.gitleaks.toml` | secrets dans tout l'historique Git | oui |
| trivy | `aquasecurity/trivy-action@v0.36.0` | dépendances (HIGH, CRITICAL corrigeables), configuration Docker, secrets | oui |

Les rapports JSON sont des artefacts de chaque exécution. **Ne pas publier un rapport** hors de GitHub : il cite des chemins
et des extraits du code.

`.gitleaks.toml` met en liste blanche les constantes de test (`hub/test/`), le bouchon (`charlois-mcp-stub/`), l'exemple
de commande du README Clevoa et le mode démo du portail. Ce ne sont pas des secrets. Toute autre détection doit être traitée,
jamais ajoutée à la liste blanche sans justification écrite dans `AUDIT_ROADMAP.md`.

## `Security - ZAP baseline (manual)` (manuel uniquement)

Démarre un hub de démonstration sur le runner GitHub (`docker compose up`, simulateurs intégrés, aucun compte réel), puis
`zap-baseline.py` (`ghcr.io/zaproxy/zaproxy:2.16.1`) : exploration **passive**, aucune attaque. Rapport HTML et JSON en
artefacts. Les avertissements ne bloquent pas (`-I`) ; ils se trient à la main.

**Interdit** : lancer ZAP, ou tout outil d'attaque, contre un système Charlois ou tiers (Sage X3, Salesforce, MyReport,
SharePoint, Dropbox) sans autorisation écrite et périmètre convenu.

## Lire un résultat

1. Un signalement est une hypothèse, pas une vulnérabilité : retrouver le flux de données réel et les droits en amont.
2. Vrai défaut → correction minimale, test de régression, ligne dans `AUDIT_ROADMAP.md` et `CHANGELOG.md`.
3. Faux positif → `// nosemgrep: <règle> -- <raison>` sur la ligne, ou entrée dans `.gitleaks.toml`, toujours avec la raison.
4. Un CI vert n'est pas un produit sûr : les tests avec un compte restreint sur Sage X3 et Salesforce, la révocation OAuth,
   l'isolation des sessions MCP et la justesse des réponses financières restent des tests humains (`JOURNAL_TESTS.md`).

Historique des analyses et décisions : `AUDIT_ROADMAP.md`, § 0 bis.
