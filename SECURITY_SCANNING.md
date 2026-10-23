# Security scanning — Clevoa AI Gateway

This repository runs **static checks** on pull requests and pushes to `main`/`dev`: Semgrep (JS/Node rules), CodeQL (data flow), Gitleaks (Git history), and Trivy (dependencies, config, secrets). Results are retained as workflow artifacts. High/critical Trivy findings and Semgrep/Gitleaks findings can fail CI; treat false positives through documented triage, not blanket suppression.

**CodeQL note:** GitHub code scanning support and availability depend on repository visibility and plan. If CodeQL fails for an unsupported private repository, enable the relevant GitHub code-security feature or run its CLI separately; do not disable other scanners.

## First execution
1. Review and merge the workflow PR (GitHub may require approval for new workflows).
2. Open **Actions → Security - static analysis → Run workflow** to scan immediately; also runs automatically on subsequent PRs.
3. Open each job and download artifacts. **Do not publish reports containing credentials or sensitive repository details.**
4. Open **Actions → Security - ZAP baseline (manual) → Run workflow** for a passive scan of an **isolated demo** started on the GitHub runner. This workflow does not target Charlois, Sage X3, Salesforce, or any live customer endpoint. It intentionally reports ZAP findings without blocking CI until triaged.

## Interpreting findings
- Prioritize exploitable secrets, cross-user authorization, SSRF, injection, unsafe OAuth callbacks, and critical dependency vulnerabilities.
- Validate each finding against actual data flows and upstream permissions.
- Record: file/line, evidence, exploit preconditions, severity, remediation, regression test, and disposition.
- Scanner green ≠ secure product. Complete restricted-account Sage/Salesforce tests, OAuth revocation, MCP session isolation, prompt-injection scenarios, backup/restore, and financial answer correctness before production.
- **Do not** run active DAST or automated attack templates against Charlois or third-party systems without explicit written authorization and an agreed scope.
- For reproducibility, replace version-tagged container images and GitHub Actions with vetted digest/commit SHA pins after initial qualification.
